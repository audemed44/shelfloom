package server

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestAutoOrganize(t *testing.T) {
	s := newTestServer(t)
	ctx := context.Background()
	var shelf map[string]any
	expect(t, "shelf", s.do("POST", "/api/shelves", map[string]any{"name": "Library", "path": s.shelf, "is_default": true}, &shelf), 201)
	shelfID := itoa64(int64(shelf["id"].(float64)))
	epubData, _ := os.ReadFile("testdata/test.epub")
	var a, b map[string]any
	expect(t, "upload", s.upload("/api/books", "pact-endgame.epub", "application/epub+zip", epubData, &a), 201)
	expect(t, "upload other", s.upload("/api/books", "other.epub", "application/epub+zip", withExtraEntry(t, epubData), &b), 201)
	var series seriesResponse
	expect(t, "series", s.do("POST", "/api/series", map[string]any{"name": "Pact"}, &series), 201)
	expect(t, "in series", s.do("POST", "/api/series/"+itoa64(series.ID)+"/books/"+a["id"].(string)+"?sequence=6", map[string]any{}, nil), 201)

	// Off: nothing moves.
	if moved, _, err := s.app.autoOrganize(ctx); err != nil || moved != 0 {
		t.Fatalf("moved=%d err=%v", moved, err)
	}
	expect(t, "turn on", s.do("PATCH", "/api/shelves/"+shelfID, map[string]any{"auto_organize": true, "organize_template": "{series_path}/{sequence| - }{title}"}, nil), 200)

	// A different file where the second book belongs stays, and so does the book.
	clash := filepath.Join(s.shelf, "Test Book Title.epub")
	os.WriteFile(clash, []byte("someone else"), 0o644)
	moved, failed, err := s.app.autoOrganize(ctx)
	if err != nil || moved != 1 || failed != 1 {
		t.Fatalf("moved=%d failed=%d err=%v", moved, failed, err)
	}
	book, _ := getBook(ctx, s.app.DB, a["id"].(string))
	if book.FilePath != "Pact/06 - Test Book Title.epub" || !fileExists(filepath.Join(s.shelf, book.FilePath)) || fileExists(filepath.Join(s.shelf, "pact-endgame.epub")) {
		t.Fatalf("not filed: %s", book.FilePath)
	}
	if data, _ := os.ReadFile(clash); string(data) != "someone else" {
		t.Fatal("overwrote another file")
	}
	other, _ := getBook(ctx, s.app.DB, b["id"].(string))
	if other.FilePath != "other.epub" {
		t.Fatalf("moved onto another file: %s", other.FilePath)
	}

	// An identical copy there is replaced.
	data, _ := os.ReadFile(filepath.Join(s.shelf, "other.epub"))
	os.WriteFile(clash, data, 0o644)
	if moved, failed, err = s.app.autoOrganize(ctx); err != nil || moved != 1 || failed != 0 {
		t.Fatalf("moved=%d failed=%d err=%v", moved, failed, err)
	}
	if other, _ = getBook(ctx, s.app.DB, b["id"].(string)); other.FilePath != "Test Book Title.epub" || fileExists(filepath.Join(s.shelf, "other.epub")) {
		t.Fatalf("copy not replaced: %s", other.FilePath)
	}
}
