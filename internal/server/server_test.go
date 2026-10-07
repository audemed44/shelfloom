package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/audemed44/shelfloom/internal/store"
)

type testServer struct {
	*httptest.Server
	t     *testing.T
	app   *Server
	shelf string
}

func newTestServer(t *testing.T) *testServer {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "shelfloom.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	app := &Server{DB: db, Config: Config{CoversDir: filepath.Join(dir, "covers"), DefaultShelfName: "Library", DefaultShelfPath: filepath.Join(dir, "library")},
		Frontend: fstest.MapFS{
			"index.html":           {Data: []byte("<!doctype html>shell")},
			"assets/app-abc.js":    {Data: []byte("console.log(1)")},
			"manifest.webmanifest": {Data: []byte("{}")},
		}}
	ctx, cancel := context.WithCancel(context.Background())
	h := app.Handler()
	app.Start(ctx, false)
	srv := httptest.NewServer(h)
	t.Cleanup(func() { srv.Close(); cancel(); app.Wait() })
	shelf := filepath.Join(dir, "books")
	os.MkdirAll(shelf, 0o755)
	return &testServer{Server: srv, t: t, app: app, shelf: shelf}
}

// do sends a request and decodes a JSON answer into out (if given).
func (s *testServer) do(method, path string, body any, out any) int {
	s.t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, s.URL+path, r)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		s.t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			s.t.Fatalf("%s %s: %v: %s", method, path, err, data)
		}
	}
	return resp.StatusCode
}

func (s *testServer) upload(path, name, ctype string, data []byte, out any) int {
	s.t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(map[string][]string)
	h["Content-Disposition"] = []string{`form-data; name="file"; filename="` + name + `"`}
	h["Content-Type"] = []string{ctype}
	part, _ := w.CreatePart(h)
	part.Write(data)
	w.Close()
	resp, err := http.Post(s.URL+path, w.FormDataContentType(), &buf)
	if err != nil {
		s.t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
}

func expect(t *testing.T, what string, got, want int) {
	t.Helper()
	if got != want {
		t.Fatalf("%s: status %d, want %d", what, got, want)
	}
}

func TestLibraryFlow(t *testing.T) {
	s := newTestServer(t)
	var health map[string]string
	expect(t, "health", s.do("GET", "/api/health", nil, &health), 200)

	var shelf map[string]any
	expect(t, "create shelf", s.do("POST", "/api/shelves", map[string]any{"name": " Library ", "path": s.shelf, "is_default": true}, &shelf), 201)
	if shelf["name"] != "Library" || shelf["seq_pad"].(float64) != 2 {
		t.Fatalf("%+v", shelf)
	}
	var problem map[string]any
	expect(t, "missing dir", s.do("POST", "/api/shelves", map[string]any{"name": "x", "path": "/nope"}, &problem), 422)
	expect(t, "duplicate", s.do("POST", "/api/shelves", map[string]any{"name": "Library", "path": s.shelf}, nil), 409)
	expect(t, "invalid", s.do("POST", "/api/shelves", map[string]any{"name": "  "}, &problem), 422)
	if detail := problem["detail"].([]any); len(detail) != 2 {
		t.Fatalf("%+v", problem)
	}

	epubData, _ := os.ReadFile("testdata/test.epub")
	var book map[string]any
	expect(t, "upload", s.upload("/api/books", "Test Book.epub", "application/epub+zip", epubData, &book), 201)
	id := book["id"].(string)
	if book["format"] != "epub" || book["file_path"] != "Test Book.epub" || book["status"] != "unread" {
		t.Fatalf("%+v", book)
	}
	expect(t, "upload txt", s.upload("/api/books", "x.txt", "text/plain", []byte("x"), nil), 400)

	var list bookListResponse
	expect(t, "list", s.do("GET", "/api/books?sort=title", nil, &list), 200)
	if list.Total != 1 || len(list.Items) != 1 {
		t.Fatalf("%+v", list)
	}
	expect(t, "bad page", s.do("GET", "/api/books?page=0", nil, nil), 422)
	expect(t, "download", s.do("GET", "/api/books/"+id+"/download", nil, nil), 200)
	expect(t, "missing book", s.do("GET", "/api/books/nope", nil, nil), 404)

	// Tags, genres, series.
	var tag idName
	expect(t, "tag", s.do("POST", "/api/tags", map[string]string{"name": " Fav "}, &tag), 201)
	expect(t, "tag again", s.do("POST", "/api/tags", map[string]string{"name": "Fav"}, nil), 409)
	expect(t, "assign", s.do("POST", "/api/books/"+id+"/tags/"+itoa64(tag.ID), map[string]any{}, nil), 204)
	var genre idName
	expect(t, "genre", s.do("POST", "/api/genres", map[string]string{"name": "Fantasy"}, &genre), 201)
	expect(t, "genre case", s.do("POST", "/api/genres", map[string]string{"name": "fantasy"}, nil), 409)
	var series seriesResponse
	expect(t, "series", s.do("POST", "/api/series", map[string]any{"name": "Saga"}, &series), 201)
	expect(t, "add to series", s.do("POST", "/api/series/"+itoa64(series.ID)+"/books/"+id+"?sequence=2", map[string]any{}, nil), 201)
	var detail map[string]any
	expect(t, "detail", s.do("GET", "/api/books/"+id, nil, &detail), 200)
	if len(detail["tags"].([]any)) != 1 || detail["review"] != nil {
		t.Fatalf("%+v", detail)
	}
	expect(t, "filter by tag", s.do("GET", "/api/books?tag="+itoa64(tag.ID), nil, &list), 200)
	if list.Total != 1 || *list.Items[0].SeriesName != "Saga" {
		t.Fatalf("%+v", list)
	}

	// Reading.
	expect(t, "rating", s.do("PATCH", "/api/books/"+id, map[string]any{"rating": 4.5, "review": "Great"}, &book), 200)
	if book["has_review"] != true {
		t.Fatalf("%+v", book)
	}
	expect(t, "bad rating", s.do("PATCH", "/api/books/"+id, map[string]any{"rating": 4.2}, nil), 422)
	expect(t, "session", s.do("POST", "/api/books/"+id+"/sessions", map[string]any{"start_time": "2026-01-02T10:00:00Z", "duration": 600, "pages_read": 12}, nil), 201)
	expect(t, "mark read", s.do("POST", "/api/books/"+id+"/mark-read", map[string]any{}, nil), 200)
	var summary map[string]any
	expect(t, "summary", s.do("GET", "/api/books/"+id+"/reading-summary", nil, &summary), 200)
	if summary["total_sessions"].(float64) != 1 || summary["percent_finished"].(float64) != 100 {
		t.Fatalf("%+v", summary)
	}
	var completed []completedBook
	expect(t, "completed", s.do("GET", "/api/stats/books-completed", nil, &completed), 200)
	if len(completed) != 1 {
		t.Fatalf("%+v", completed)
	}
	var overview map[string]any
	expect(t, "overview", s.do("GET", "/api/stats/overview", nil, &overview), 200)
	if overview["books_read"].(float64) != 1 || overview["total_reading_time_seconds"].(float64) != 600 {
		t.Fatalf("%+v", overview)
	}
	var review map[string]any
	expect(t, "year", s.do("GET", "/api/stats/year/2026", nil, &review), 200)
	expect(t, "goal", s.do("PUT", "/api/stats/goal/2026", map[string]int{"books": 12}, &review), 200)
	if review["target"].(float64) != 12 {
		t.Fatalf("%+v", review)
	}

	// Covers.
	expect(t, "generated cover", s.do("GET", "/api/books/"+id+"/generated-cover", nil, nil), 200)
	var gen map[string]any
	expect(t, "generate cover", s.do("POST", "/api/books/"+id+"/generate-cover", map[string]bool{"embed": true}, &gen), 200)
	if !strings.HasSuffix(gen["cover_path"].(string), generatedSuffix) {
		t.Fatalf("%+v", gen)
	}
	expect(t, "cover", s.do("GET", "/api/books/"+id+"/cover", nil, nil), 200)

	// Health and delete.
	var report map[string]any
	expect(t, "library health", s.do("GET", "/api/library-health", nil, &report), 200)
	if report["total_books"].(float64) != 1 {
		t.Fatalf("%+v", report)
	}
	expect(t, "delete", s.do("DELETE", "/api/books/"+id+"?delete_file=true", nil, nil), 204)
	if fileExists(filepath.Join(s.shelf, "Test Book.epub")) {
		t.Fatal("file kept")
	}
	expect(t, "purge series", s.do("DELETE", "/api/series/empty", nil, nil), 200)
}

func TestKosync(t *testing.T) {
	s := newTestServer(t)
	key := userkeyForPassword("secret")
	expect(t, "register", s.do("POST", "/api/kosync/users/create", map[string]string{"username": "kobo", "password": key}, nil), 201)
	expect(t, "register again", s.do("PUT", "/api/kosync/users/create", map[string]string{"username": "kobo", "password": key}, nil), 402)

	call := func(method, path string, body any, k string) (int, map[string]any) {
		var r io.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			r = bytes.NewReader(b)
		}
		req, _ := http.NewRequest(method, s.URL+path, r)
		req.Header.Set("x-auth-user", "kobo")
		req.Header.Set("x-auth-key", k)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var out map[string]any
		json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}
	if code, out := call("GET", "/api/kosync/users/auth", nil, key); code != 200 || out["authorized"] != "OK" {
		t.Fatalf("%d %+v", code, out)
	}
	if code, out := call("GET", "/api/kosync/users/auth", nil, "wrong"); code != 401 || out["code"].(float64) != 2001 {
		t.Fatalf("%d %+v", code, out)
	}
	if code, _ := call("PUT", "/api/kosync/syncs/progress", map[string]any{"document": "doc1", "progress": "12", "percentage": 42, "device": "Kobo"}, key); code != 200 {
		t.Fatal(code)
	}
	code, out := call("GET", "/api/kosync/syncs/progress/doc1", nil, key)
	if code != 200 || out["percentage"].(float64) != 0.42 || out["device"] != "Kobo" {
		t.Fatalf("%d %+v", code, out)
	}
	if code, out := call("GET", "/api/kosync/syncs/progress?document=unknown", nil, key); code != 200 || len(out) != 0 {
		t.Fatalf("%d %+v", code, out)
	}
	var accounts []syncAccount
	expect(t, "accounts", s.do("GET", "/api/sync-accounts", nil, &accounts), 200)
	if len(accounts) != 1 || *accounts[0].LastDevice != "Kobo" {
		t.Fatalf("%+v", accounts)
	}
	expect(t, "delete account", s.do("DELETE", "/api/sync-accounts/kobo", nil, nil), 204)
}

func TestFrontend(t *testing.T) {
	s := newTestServer(t)
	cases := []struct{ path, cache string }{
		{"/", "no-cache"}, {"/library/books/12", "no-cache"}, {"/assets/app-abc.js", ""},
	}
	for _, c := range cases {
		resp, err := http.Get(s.URL + c.path)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 200 || resp.Header.Get("Cache-Control") != c.cache {
			t.Errorf("%s: %d %q", c.path, resp.StatusCode, resp.Header.Get("Cache-Control"))
		}
	}
	for _, p := range []string{"/assets/missing.js", "/api/nope"} {
		resp, _ := http.Get(s.URL + p)
		resp.Body.Close()
		if resp.StatusCode != 404 {
			t.Errorf("%s: %d", p, resp.StatusCode)
		}
	}
	resp, _ := http.Get(s.URL + "/manifest.webmanifest")
	resp.Body.Close()
	if ct := resp.Header.Get("Content-Type"); ct != "application/manifest+json" {
		t.Errorf("manifest %q", ct)
	}
}

func TestStoreRefusesOldSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db, err := store.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	db.Exec("DROP TABLE schema_migrations")
	db.Exec("UPDATE alembic_version SET version_num = 'a5158d4bceab'")
	db.Close()
	if _, err := store.Open(path); err == nil || !strings.Contains(err.Error(), "a5158d4bceab") {
		t.Fatalf("expected a refusal, got %v", err)
	}
}
