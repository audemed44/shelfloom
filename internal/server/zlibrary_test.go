package server

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/audemed44/shelfloom/internal/zlibrary"
)

// fakeZLib serves the parts of Z-Library's /eapi that Shelfloom uses.
func fakeZLib(t *testing.T, file []byte) (*httptest.Server, *int) {
	t.Helper()
	downloads := 0
	sum := md5.Sum(file)
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		loggedIn := false
		if c, err := r.Cookie("remix_userkey"); err == nil && c.Value == "key" {
			loggedIn = true
		}
		reply := func(v any) { json.NewEncoder(w).Encode(v) }
		switch r.URL.Path {
		case "/eapi/user/login":
			if r.FormValue("password") != "secret" {
				reply(map[string]any{"success": 0, "error": "Incorrect email or password"})
				return
			}
			reply(map[string]any{"success": 1, "user": map[string]any{"id": 7, "remix_userkey": "key"}})
		case "/eapi/user/profile":
			if !loggedIn {
				reply(map[string]any{"success": 0, "error": "Please login"})
				return
			}
			reply(map[string]any{"success": 1, "user": map[string]any{"downloads_today": downloads, "downloads_limit": 10}})
		case "/eapi/book/search":
			if r.FormValue("message") == "" {
				reply(map[string]any{"success": 0, "error": "empty"})
				return
			}
			reply(map[string]any{"success": 1, "books": []map[string]any{
				{"id": 17, "hash": "abc", "title": "Fake Book", "author": "Jane Doe", "year": 2020, "pages": "321",
					"identifier": "978-0-00-000000-2,B00FAKE", "extension": "epub", "filesizeString": "1 MB",
					"md5": hex.EncodeToString(sum[:]), "series": "Saga", "volume": "2", "cover": srv.URL + "/cover.png",
					"description": "<p>Hi &amp; bye</p><p>Two</p>", "edition": nil},
				{"id": 18, "hash": "def", "title": "Mobi Book", "extension": "mobi"},
			}})
		case "/eapi/book/17/abc/file":
			if !loggedIn {
				reply(map[string]any{"success": 0, "error": "Please login"})
				return
			}
			reply(map[string]any{"success": 1, "file": map[string]any{"downloadLink": "/dl/xyz", "extension": "epub"}})
		case "/dl/xyz":
			downloads++
			w.Header().Set("Content-Type", "application/epub+zip")
			w.Header().Set("Content-Disposition", `attachment; filename="whatever.epub"`)
			w.Write(file)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &downloads
}

func TestZLibraryDisabled(t *testing.T) {
	s := newTestServer(t)
	var status map[string]any
	if code := s.do("GET", "/api/zlibrary/status", nil, &status); code != 200 || status["enabled"] != false {
		t.Fatalf("status = %d %v", code, status)
	}
	if code := s.do("GET", "/api/zlibrary/search?q=x", nil, nil); code != 404 {
		t.Fatalf("search without an account = %d, want 404", code)
	}
}

func TestZLibrarySearchAndAdd(t *testing.T) {
	file, err := os.ReadFile("testdata/test.epub")
	if err != nil {
		t.Fatal(err)
	}
	zl, downloads := fakeZLib(t, file)
	s := newTestServer(t)
	s.app.Config.ZLibraryDomain = zl.URL
	s.app.Config.ZLibraryEmail = "me@example.com"
	s.app.Config.ZLibraryPassword = "secret"
	expect(t, "create shelf", s.do("POST", "/api/shelves", map[string]any{"name": "Library", "path": s.shelf, "is_default": true}, nil), 201)

	var status map[string]any
	if code := s.do("GET", "/api/zlibrary/status", nil, &status); code != 200 || status["enabled"] != true || status["downloads_limit"] != 10.0 {
		t.Fatalf("status = %d %v", code, status)
	}

	var found struct {
		Results []zlibResult `json:"results"`
		HasMore bool         `json:"has_more"`
	}
	if code := s.do("GET", "/api/zlibrary/search?q=fake&format=epub", nil, &found); code != 200 {
		t.Fatalf("search = %d", code)
	}
	if len(found.Results) != 1 {
		t.Fatalf("results = %+v, want only the EPUB", found.Results)
	}
	r := found.Results[0]
	if r.ID != "17" || r.Pages == nil || *r.Pages != 321 || len(r.ISBNs) != 1 || r.ISBNs[0] != "9780000000002" || r.InLibraryBookID != nil {
		t.Fatalf("result = %+v", r)
	}
	if r.Description == nil || *r.Description != "Hi & bye\n\nTwo" {
		t.Fatalf("description = %q", *r.Description)
	}
	if r.CoverURL == nil || *r.CoverURL != "/api/zlibrary/books/17/cover" {
		t.Fatalf("cover = %v", r.CoverURL)
	}

	var added struct {
		Book             bookResponse `json:"book"`
		AlreadyInLibrary bool         `json:"already_in_library"`
		Series           *string      `json:"series"`
		SeriesSequence   *string      `json:"series_sequence"`
	}
	if code := s.do("POST", "/api/zlibrary/books", map[string]string{"id": "17", "hash": "abc"}, &added); code != 201 {
		t.Fatalf("add = %d", code)
	}
	if added.AlreadyInLibrary || added.Series == nil || *added.Series != "Saga" || added.SeriesSequence == nil || *added.SeriesSequence != "2" {
		t.Fatalf("added = %+v", added)
	}
	if _, err := os.Stat(filepath.Join(s.shelf, "Jane Doe - Fake Book.epub")); err != nil {
		t.Fatalf("file not in the library: %v", err)
	}
	book, err := mustGetBook(t.Context(), s.app.DB, added.Book.ID)
	if err != nil {
		t.Fatal(err)
	}
	if book.ISBN == nil || book.DatePublished == nil {
		t.Fatalf("metadata not filled in: isbn %v, published %v", book.ISBN, book.DatePublished)
	}

	// The same file again is the book already there, without a download.
	if code := s.do("POST", "/api/zlibrary/books", map[string]string{"id": "17", "hash": "abc"}, &added); code != 201 || !added.AlreadyInLibrary || added.Book.ID != book.ID {
		t.Fatalf("second add = %d %+v", code, added)
	}
	if *downloads != 1 {
		t.Fatalf("downloads = %d, want 1", *downloads)
	}
	if code := s.do("GET", "/api/zlibrary/search?q=fake", nil, &found); code != 200 || found.Results[0].InLibraryBookID == nil || *found.Results[0].InLibraryBookID != book.ID {
		t.Fatalf("search after add = %d %+v", code, found.Results)
	}
}

func TestZLibraryBadLogin(t *testing.T) {
	zl, _ := fakeZLib(t, []byte("x"))
	s := newTestServer(t)
	s.app.Config.ZLibraryDomain = zl.URL
	s.app.Config.ZLibraryEmail = "me@example.com"
	s.app.Config.ZLibraryPassword = "wrong"
	var status map[string]any
	s.do("GET", "/api/zlibrary/status", nil, &status)
	if msg, _ := status["error"].(string); !strings.Contains(msg, "email or password") {
		t.Fatalf("status = %v", status)
	}
	var out map[string]any
	if code := s.do("POST", "/api/zlibrary/books", map[string]string{"id": "17", "hash": "abc"}, &out); code != 502 {
		t.Fatalf("add with a bad login = %d %v", code, out)
	}
}

func TestZLibSeries(t *testing.T) {
	for _, c := range []struct{ series, volume, name, seq string }{
		{"Mistborn: Original Trilogy #2", "", "Mistborn: Original Trilogy", "2"},
		{"Mistborn #1.5", "3", "Mistborn", "1.5"},
		{"Saga", "2", "Saga", "2"},
		{"The Mistborn Trilogy", "", "The Mistborn Trilogy", ""},
		{"", "4", "", ""},
	} {
		name, seq := zlibSeries(zlibrary.Book{Series: c.series, Volume: c.volume})
		if name != c.name || seq != c.seq {
			t.Errorf("zlibSeries(%q, %q) = %q, %q", c.series, c.volume, name, seq)
		}
	}
}

func TestBookFileName(t *testing.T) {
	for _, c := range []struct{ author, title, want string }{
		{"Jane Doe", "Fake Book", "Jane Doe - Fake Book"},
		{"", "What? A/B: Story", "What A B Story"},
		{"", "  ", "book"},
	} {
		if got := bookFileName(c.author, c.title); got != c.want {
			t.Errorf("bookFileName(%q, %q) = %q, want %q", c.author, c.title, got, c.want)
		}
	}
}
