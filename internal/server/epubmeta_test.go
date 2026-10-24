package server

import (
	"archive/zip"
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func readOPF(t *testing.T, file string) string {
	t.Helper()
	zr, err := zip.OpenReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	for _, f := range zr.File {
		if strings.HasSuffix(f.Name, ".opf") {
			rc, _ := f.Open()
			defer rc.Close()
			b, _ := io.ReadAll(rc)
			return string(b)
		}
	}
	t.Fatal("no OPF")
	return ""
}

// withExtraEntry is the EPUB with one more file in it: another book, as far
// as hashes go.
func withExtraEntry(t *testing.T, data []byte) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range zr.File {
		if err := zw.Copy(f); err != nil {
			t.Fatal(err)
		}
	}
	w, _ := zw.Create("EPUB/extra.txt")
	w.Write([]byte("other"))
	zw.Close()
	return buf.Bytes()
}

func TestEPUBMetadataSync(t *testing.T) {
	s := newTestServer(t)
	ctx := context.Background()
	expect(t, "shelf", s.do("POST", "/api/shelves", map[string]any{"name": "Library", "path": s.shelf, "is_default": true}, nil), 201)
	epubData, _ := os.ReadFile("testdata/test.epub")
	var book, other map[string]any
	expect(t, "upload", s.upload("/api/books", "Saga 2.epub", "application/epub+zip", epubData, &book), 201)
	expect(t, "upload other", s.upload("/api/books", "Other.epub", "application/epub+zip", withExtraEntry(t, epubData), &other), 201)
	id := book["id"].(string)
	file := filepath.Join(s.shelf, "Saga 2.epub")
	otherFile := filepath.Join(s.shelf, "Other.epub")
	otherBefore, _ := os.ReadFile(otherFile)

	var parent, series seriesResponse
	expect(t, "parent", s.do("POST", "/api/series", map[string]any{"name": "Universe"}, &parent), 201)
	expect(t, "series", s.do("POST", "/api/series", map[string]any{"name": "Saga", "parent_id": parent.ID}, &series), 201)
	expect(t, "in parent", s.do("POST", "/api/series/"+itoa64(parent.ID)+"/books/"+id, map[string]any{}, nil), 201)
	expect(t, "in series", s.do("POST", "/api/series/"+itoa64(series.ID)+"/books/"+id+"?sequence=2.5", map[string]any{}, nil), 201)
	var genre, tag idName
	expect(t, "genre", s.do("POST", "/api/genres", map[string]string{"name": "Fantasy"}, &genre), 201)
	expect(t, "tag", s.do("POST", "/api/tags", map[string]string{"name": "Favourites"}, &tag), 201)
	expect(t, "assign genre", s.do("POST", "/api/books/"+id+"/genres/"+itoa64(genre.ID), map[string]any{}, nil), 204)
	expect(t, "assign tag", s.do("POST", "/api/books/"+id+"/tags/"+itoa64(tag.ID), map[string]any{}, nil), 204)

	before, _ := getBook(ctx, s.app.DB, id)
	written, failed, err := s.app.syncEPUBMetadata(ctx)
	if err != nil || written != 1 || failed != 0 {
		t.Fatalf("written=%d failed=%d err=%v", written, failed, err)
	}
	opf := readOPF(t, file)
	for _, want := range []string{
		`<meta name="calibre:series" content="Saga"/>`,
		`<meta name="calibre:series_index" content="2.5"/>`,
		`id="shelfloom-series-2">Universe</meta>`,
		"<dc:subject>Fantasy</dc:subject>",
		"<dc:subject>Favourites</dc:subject>",
		"urn:shelfloom:" + id,
	} {
		if !strings.Contains(opf, want) {
			t.Errorf("missing %s:\n%s", want, opf)
		}
	}
	if after, _ := os.ReadFile(otherFile); string(after) != string(otherBefore) {
		t.Error("a book with nothing to write was rewritten")
	}

	// The new hash is the book's; the old one still finds it (KOReader).
	after, _ := getBook(ctx, s.app.DB, id)
	if *after.FileHash == *before.FileHash {
		t.Fatal("hash not refreshed")
	}
	if b, _ := findByHash(ctx, s.app.DB, *before.FileHash); b == nil || b.ID != id {
		t.Fatal("old hash forgotten")
	}
	var shelf *Shelf
	if shelf, err = getShelf(ctx, s.app.DB, after.ShelfID); err != nil {
		t.Fatal(err)
	}
	if res, err := s.app.processFile(ctx, shelf, file); err != nil || res != "skipped" {
		t.Fatalf("rescan: %s %v", res, err)
	}

	if written, _, _ := s.app.syncEPUBMetadata(ctx); written != 0 {
		t.Fatalf("nothing changed but wrote %d", written)
	}

	// Renaming a series reaches the file; so does leaving it.
	expect(t, "rename", s.do("PATCH", "/api/series/"+itoa64(series.ID), map[string]any{"name": "The Saga"}, nil), 200)
	expect(t, "untag", s.do("DELETE", "/api/books/"+id+"/tags/"+itoa64(tag.ID), nil, nil), 204)
	if written, _, _ := s.app.syncEPUBMetadata(ctx); written != 1 {
		t.Fatalf("rename wrote %d", written)
	}
	opf = readOPF(t, file)
	if !strings.Contains(opf, `content="The Saga"`) || strings.Contains(opf, "Favourites") {
		t.Fatalf("%s", opf)
	}
	expect(t, "leave", s.do("DELETE", "/api/series/"+itoa64(series.ID)+"/books/"+id, nil, nil), 204)
	expect(t, "leave parent", s.do("DELETE", "/api/series/"+itoa64(parent.ID)+"/books/"+id, nil, nil), 204)
	s.app.syncEPUBMetadata(ctx)
	if opf = readOPF(t, file); strings.Contains(opf, "series") || !strings.Contains(opf, "Fantasy") {
		t.Fatalf("%s", opf)
	}
}
