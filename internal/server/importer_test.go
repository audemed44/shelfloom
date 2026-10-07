package server

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"testing"
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
