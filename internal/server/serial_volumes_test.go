package server

import (
	"context"
	"os"
	"path/filepath"
	"strings"
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

// Generate All rebuilds a volume that already has a book into that book, on
// its own shelf, instead of importing a second copy onto the chosen shelf.
func TestGenerateAllKeepsExistingBooks(t *testing.T) {
	ts := newTestServer(t)
	ctx := context.Background()
	db := ts.app.DB
	var library, other Shelf
	otherPath := t.TempDir()
	expect(t, "create shelf", ts.do("POST", "/api/shelves", map[string]any{"name": "Books", "path": ts.shelf}, &library), 201)
	expect(t, "create shelf", ts.do("POST", "/api/shelves", map[string]any{"name": "Reader", "path": otherPath}, &other), 201)
	if _, err := db.ExecContext(ctx, "INSERT INTO web_serials (id, url, source, title, author, status, total_chapters) VALUES (1, 'https://www.royalroad.com/fiction/1/x', 'royalroad', 'Serial', 'Author', 'ongoing', 2)"); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 2; i++ {
		if _, err := db.ExecContext(ctx, "INSERT INTO serial_chapters (serial_id, chapter_number, title, source_url, content, source_key) VALUES (1, ?, ?, ?, '<p>Text</p>', ?)", i, "Chapter", "https://example.com/"+string(rune('0'+i)), string(rune('0'+i))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO serial_volumes (id, serial_id, volume_number, chapter_start, chapter_end, is_stale) VALUES (1, 1, 1, 1, 1, 0), (2, 1, 2, 2, 2, 0)"); err != nil {
		t.Fatal(err)
	}
	var v Volume
	expect(t, "generate", ts.do("POST", "/api/serials/1/volumes/1/generate?shelf_id="+itoa(other.ID), nil, &v), 200)
	if v.BookID == nil {
		t.Fatal("generated volume has no book")
	}

	var out []Volume
	expect(t, "generate all", ts.do("POST", "/api/serials/1/volumes/generate-all?shelf_id="+itoa(library.ID), nil, &out), 200)
	if len(out) != 2 {
		t.Fatalf("generate all returned %d volumes, want 2", len(out))
	}
	var count int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM books").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("%d books after generate all, want 2", count)
	}
	nv, err := getVolume(ctx, db, 1, 1)
	if err != nil {
		t.Fatal(err)
	}
	if nv.BookID == nil || *nv.BookID != *v.BookID {
		t.Fatalf("volume 1 linked to %v, want %s", nv.BookID, *v.BookID)
	}
	book, err := getBook(ctx, db, *v.BookID)
	if err != nil || book == nil {
		t.Fatal(err)
	}
	if book.ShelfID != other.ID {
		t.Fatalf("volume 1 book moved to shelf %d, want %d", book.ShelfID, other.ID)
	}
}

// A volume rebuilt in place keeps its series in the EPUB: the new file is
// written without one, so the next library sync has to write it again.
func TestRebuiltVolumeKeepsSeries(t *testing.T) {
	ts := newTestServer(t)
	ctx := context.Background()
	db := ts.app.DB
	var shelf Shelf
	expect(t, "create shelf", ts.do("POST", "/api/shelves", map[string]any{"name": "Books", "path": ts.shelf}, &shelf), 201)
	var series seriesResponse
	expect(t, "series", ts.do("POST", "/api/series", map[string]any{"name": "Serial"}, &series), 201)
	if _, err := db.ExecContext(ctx, "INSERT INTO web_serials (id, url, source, title, author, status, total_chapters, series_id) VALUES (1, 'https://www.royalroad.com/fiction/1/x', 'royalroad', 'Serial', 'Author', 'ongoing', 1, ?)", series.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO serial_chapters (serial_id, chapter_number, title, source_url, content, source_key) VALUES (1, 1, 'Chapter', 'https://example.com/1', '<p>Text</p>', '1')"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO serial_volumes (id, serial_id, volume_number, chapter_start, chapter_end, is_stale) VALUES (1, 1, 3, 1, 1, 0)"); err != nil {
		t.Fatal(err)
	}
	var v Volume
	expect(t, "generate", ts.do("POST", "/api/serials/1/volumes/1/generate?shelf_id="+itoa(shelf.ID), nil, &v), 200)
	book, err := getBook(ctx, db, *v.BookID)
	if err != nil || book == nil {
		t.Fatal(err)
	}
	file := filepath.Join(ts.shelf, book.FilePath)
	wantSeries := []string{`<meta name="calibre:series" content="Serial"/>`, `<meta name="calibre:series_index" content="3"/>`}
	sync := func(stage string) {
		t.Helper()
		if _, failed, err := ts.app.syncEPUBMetadata(ctx); err != nil || failed != 0 {
			t.Fatalf("%s: sync failed=%d err=%v", stage, failed, err)
		}
		opf := readOPF(t, file)
		for _, want := range wantSeries {
			if !strings.Contains(opf, want) {
				t.Fatalf("%s: missing %s:\n%s", stage, want, opf)
			}
		}
	}
	sync("generate")

	if _, err := db.ExecContext(ctx, "UPDATE serial_chapters SET content = '<p>New text</p>'"); err != nil {
		t.Fatal(err)
	}
	expect(t, "rebuild", ts.do("POST", "/api/serials/1/volumes/1/rebuild", nil, &v), 200)
	if strings.Contains(readOPF(t, file), "calibre:series") {
		t.Fatal("the rebuilt file already has a series; the test no longer covers the sync")
	}
	sync("rebuild")
}

// Extending a generated volume's range marks it stale, and a rebuild puts the
// new chapters into the same book instead of a new one.
func TestExtendVolumeRange(t *testing.T) {
	ts := newTestServer(t)
	ctx := context.Background()
	db := ts.app.DB
	var shelf Shelf
	expect(t, "create shelf", ts.do("POST", "/api/shelves", map[string]any{"name": "Books", "path": ts.shelf}, &shelf), 201)
	if _, err := db.ExecContext(ctx, "INSERT INTO web_serials (id, url, source, title, author, status, total_chapters) VALUES (1, 'https://www.royalroad.com/fiction/1/x', 'royalroad', 'Serial', 'Author', 'ongoing', 3)"); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 3; i++ {
		if _, err := db.ExecContext(ctx, "INSERT INTO serial_chapters (serial_id, chapter_number, title, source_url, content, source_key) VALUES (1, ?, ?, ?, '<p>Text</p>', ?)", i, "Chapter", "https://example.com/"+itoa(int64(i)), itoa(int64(i))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO serial_volumes (id, serial_id, volume_number, chapter_start, chapter_end, is_stale) VALUES (1, 1, 1, 1, 2, 0)"); err != nil {
		t.Fatal(err)
	}
	var v Volume
	expect(t, "generate", ts.do("POST", "/api/serials/1/volumes/1/generate?shelf_id="+itoa(shelf.ID), nil, &v), 200)
	book, err := getBook(ctx, db, *v.BookID)
	if err != nil || book == nil {
		t.Fatal(err)
	}
	before, err := epubSpine(filepath.Join(ts.shelf, book.FilePath))
	if err != nil {
		t.Fatal(err)
	}
	// Reading chapter 2 (the nav page is DocFragment 1).
	if _, err := saveProgress(ctx, db, saveArgs{username: "reader", document: webDocument(book), progress: "/body/DocFragment[3]/body/p[1]/text().0", percentage: 0.9, device: "KOReader", bookID: &book.ID}); err != nil {
		t.Fatal(err)
	}

	expect(t, "bad range", ts.do("PATCH", "/api/serials/1/volumes/1", map[string]any{"chapter_end": 0}, nil), 400)
	var ev Volume
	expect(t, "extend", ts.do("PATCH", "/api/serials/1/volumes/1", map[string]any{"chapter_end": 3}, &ev), 200)
	if *ev.ChapterStart != 1 || *ev.ChapterEnd != 3 || ev.ChapterCount != 3 || !ev.IsStale {
		t.Fatalf("extended volume: start=%d end=%d count=%d stale=%v", *ev.ChapterStart, *ev.ChapterEnd, ev.ChapterCount, ev.IsStale)
	}

	var nv Volume
	expect(t, "rebuild", ts.do("POST", "/api/serials/1/volumes/1/rebuild", nil, &nv), 200)
	if nv.BookID == nil || *nv.BookID != *v.BookID || nv.IsStale {
		t.Fatalf("rebuild: book %v stale %v, want book %s fresh", nv.BookID, nv.IsStale, *v.BookID)
	}
	book, _ = getBook(ctx, db, *v.BookID)
	after, err := epubSpine(filepath.Join(ts.shelf, book.FilePath))
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before)+1 {
		t.Fatalf("rebuilt spine has %d items, want %d", len(after), len(before)+1)
	}
	latest, err := latestProgressForBook(ctx, db, book.ID, nil)
	if err != nil || latest == nil {
		t.Fatal("no progress after rebuild", err)
	}
	if latest.Device != rebuildDevice || !strings.HasPrefix(latest.Progress, "/body/DocFragment[3]/") || latest.Percentage >= 0.9 {
		t.Fatalf("position after rebuild: %s %s %.2f, want chapter 2 carried over", latest.Device, latest.Progress, latest.Percentage)
	}
}
