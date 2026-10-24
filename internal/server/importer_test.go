package server

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/audemed44/shelfloom/internal/koreader"
)

// copyEPUB writes a copy of src whose bytes differ (a zip comment) but
// whose content, embedded Shelfloom ID included, is the same.
func copyEPUB(t *testing.T, src, dst string) {
	t.Helper()
	r, err := zip.OpenReader(src)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	os.MkdirAll(filepath.Dir(dst), 0o755)
	out, err := os.Create(dst)
	if err != nil {
		t.Fatal(err)
	}
	w := zip.NewWriter(out)
	for _, f := range r.File {
		if err := w.Copy(f); err != nil {
			t.Fatal(err)
		}
	}
	w.SetComment("copy")
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	out.Close()
}

func TestScanLeavesDuplicateCopyAlone(t *testing.T) {
	s := newTestServer(t)
	ctx := context.Background()
	var shelf map[string]any
	expect(t, "create shelf", s.do("POST", "/api/shelves", map[string]any{"name": "Library", "path": s.shelf, "is_default": true}, &shelf), 201)
	data, _ := os.ReadFile("testdata/test.epub")
	original := filepath.Join(s.shelf, "Book.epub")
	os.WriteFile(original, data, 0o644)

	s.app.runScan(ctx)
	if p := s.app.scan.progress; p.Created != 1 || len(p.Errors) != 0 {
		t.Fatalf("first scan: %+v", p)
	}
	// The import embedded the book's ID; a copy now carries the same ID.
	copyEPUB(t, original, filepath.Join(s.shelf, "Old", "Book copy.epub"))

	for i := range 2 {
		s.app.runScan(ctx)
		if p := s.app.scan.progress; p.Updated != 0 || p.Created != 0 {
			t.Fatalf("scan %d: %+v", i, p)
		}
	}
	var list bookListResponse
	expect(t, "list", s.do("GET", "/api/books", nil, &list), 200)
	if list.Total != 1 || list.Items[0].FilePath != "Book.epub" {
		t.Fatalf("%+v", list)
	}

	// Once the original is gone the copy takes its place.
	os.Remove(original)
	s.app.runScan(ctx)
	if p := s.app.scan.progress; p.Updated != 1 {
		t.Fatalf("after removing the original: %+v", p)
	}
	expect(t, "list", s.do("GET", "/api/books", nil, &list), 200)
	if list.Total != 1 || list.Items[0].FilePath != filepath.Join("Old", "Book copy.epub") {
		t.Fatalf("%+v", list)
	}
}

// A rewrite that leaves KOReader's partial MD5 alone (it samples a few
// chunks) gives one book two hash rows with the same fingerprint; matching
// must still find the book once.
func TestStatsMatchSharedFingerprint(t *testing.T) {
	s := newTestServer(t)
	ctx := context.Background()
	expect(t, "shelf", s.do("POST", "/api/shelves", map[string]any{"name": "Library", "path": s.shelf, "is_default": true}, nil), 201)
	epubData, _ := os.ReadFile("testdata/test.epub")
	var book map[string]any
	expect(t, "upload", s.upload("/api/books", "a.epub", "application/epub+zip", epubData, &book), 201)
	id := book["id"].(string)
	db := s.app.DB
	ko := "0123456789abcdef0123456789abcdef"
	for _, sha := range []string{"sha-old", "sha-older"} {
		if err := recordHash(ctx, db, id, sha, sha+"-md5", nil, &ko); err != nil {
			t.Fatal(err)
		}
	}
	b, err := findBookForStats(ctx, db, koreader.StatsBook{Title: "x", MD5: &ko})
	if err != nil || b == nil || b.ID != id {
		t.Fatalf("book=%v err=%v", b, err)
	}
	if b, err := findByHash(ctx, db, "sha-old"); err != nil || b == nil || b.ID != id {
		t.Fatalf("by hash: book=%v err=%v", b, err)
	}
}
