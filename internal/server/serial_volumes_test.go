package server

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// A rebuild of a volume whose book was organized into a folder replaces that
// file instead of leaving a second copy at the shelf root.
func TestRebuildOrganizedVolume(t *testing.T) {
	ts := newTestServer(t)
	ctx := context.Background()
	db := ts.app.DB
	var shelf Shelf
	expect(t, "create shelf", ts.do("POST", "/api/shelves", map[string]any{"name": "Books", "path": ts.shelf}, &shelf), 201)
	if _, err := db.ExecContext(ctx, "INSERT INTO web_serials (id, url, source, title, author, status, total_chapters) VALUES (1, 'https://www.royalroad.com/fiction/1/x', 'royalroad', 'Serial', 'Author', 'ongoing', 2)"); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 2; i++ {
		if _, err := db.ExecContext(ctx, "INSERT INTO serial_chapters (serial_id, chapter_number, title, source_url, content, source_key) VALUES (1, ?, ?, ?, '<p>Text</p>', ?)", i, "Chapter", "https://example.com/"+string(rune('0'+i)), string(rune('0'+i))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO serial_volumes (id, serial_id, volume_number, name, chapter_start, chapter_end, is_stale) VALUES (1, 1, 2, 'Serial Book 2', 1, 2, 0)"); err != nil {
		t.Fatal(err)
	}
	var v Volume
	expect(t, "generate", ts.do("POST", "/api/serials/1/volumes/1/generate?shelf_id="+itoa(shelf.ID), nil, &v), 200)
	if v.BookID == nil {
		t.Fatal("generated volume has no book")
	}

	// Organize the book into a folder, then change a chapter so it is stale.
	rel := filepath.Join("Serial", "02 - Serial Book 2.epub")
	os.MkdirAll(filepath.Join(ts.shelf, "Serial"), 0o755)
	if err := os.Rename(filepath.Join(ts.shelf, "serial-book-2.epub"), filepath.Join(ts.shelf, rel)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE books SET file_path = ? WHERE id = ?", rel, *v.BookID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE serial_chapters SET content = '<p>New text</p>' WHERE chapter_number = 2"); err != nil {
		t.Fatal(err)
	}

	var nv Volume
	expect(t, "rebuild", ts.do("POST", "/api/serials/1/volumes/1/rebuild", nil, &nv), 200)
	if nv.BookID == nil || *nv.BookID != *v.BookID {
		t.Fatalf("rebuild linked book %v, want %s", nv.BookID, *v.BookID)
	}
	book, err := getBook(ctx, db, *v.BookID)
	if err != nil || book == nil {
		t.Fatal(err)
	}
	if book.FilePath != rel {
		t.Fatalf("book file %q, want %q", book.FilePath, rel)
	}
	if fileExists(filepath.Join(ts.shelf, "serial-book-2.epub")) {
		t.Fatal("rebuild left a copy at the shelf root")
	}
	if !fileExists(filepath.Join(ts.shelf, rel)) {
		t.Fatal("organized file is gone")
	}
}
