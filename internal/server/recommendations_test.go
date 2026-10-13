package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeOpenRouter answers chat requests with the given replies in turn and
// keeps the requests.
type fakeOpenRouter struct {
	*httptest.Server
	mu       sync.Mutex
	requests []map[string]any
	replies  []func(w http.ResponseWriter)
}

func newFakeOpenRouter(t *testing.T) *fakeOpenRouter {
	f := &fakeOpenRouter{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/models" {
			io.WriteString(w, `{"data": [{"id": "google/gemini-3.8-flash", "name": "Gemini 3.8 Flash", "pricing": {"prompt": "0.00000075", "completion": "0.00000375"}, "supported_parameters": ["tools"]}]}`)
			return
		}
		var req map[string]any
		json.NewDecoder(r.Body).Decode(&req)
		f.mu.Lock()
		f.requests = append(f.requests, req)
		var reply func(http.ResponseWriter)
		if len(f.replies) > 0 {
			reply, f.replies = f.replies[0], f.replies[1:]
		}
		f.mu.Unlock()
		if reply == nil {
			w.WriteHeader(500)
			io.WriteString(w, `{"error": {"message": "no reply queued"}}`)
			return
		}
		reply(w)
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *fakeOpenRouter) answer(content string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.replies = append(f.replies, func(w http.ResponseWriter) {
		json.NewEncoder(w).Encode(map[string]any{
			"model":   "google/gemini-3.8-flash",
			"choices": []any{map[string]any{"message": map[string]any{"content": content}, "finish_reason": "stop"}},
			"usage":   map[string]any{"prompt_tokens": 1000, "completion_tokens": 200, "cost": 0.002, "server_tool_use_details": map[string]any{"web_search_requests": 1}},
		})
	})
}

func (f *fakeOpenRouter) fail(status int, msg string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.replies = append(f.replies, func(w http.ResponseWriter) {
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"message": msg, "code": status}})
	})
}

func (f *fakeOpenRouter) request(i int) map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.requests[i]
}

// seedReading adds a small library: a finished, rated series book, its
// unread sequels, a dropped book and an unread standalone.
func seedReading(t *testing.T, s *testServer) {
	t.Helper()
	db := s.app.DB
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	exec("INSERT INTO shelves (id, name, path, is_default, is_sync_target, auto_organize) VALUES (1, 'Library', '/books', 1, 0, 0)")
	book := func(id, title, author string) {
		exec("INSERT INTO books (id, title, author, format, file_path, shelf_id) VALUES (?, ?, ?, 'epub', ?, 1)", id, title, author, "/books/"+id+".epub")
	}
	book("s1", "Saga One", "Ann Author")
	book("s2", "Saga Two", "Ann Author")
	book("s3", "Saga Three", "Ann Author")
	book("dnf", "Dull Book", "Bo Bore")
	book("solo", "Lone Star", "Cy Solo")
	exec("INSERT INTO series (id, name, sort_order) VALUES (1, 'The Saga', 0)")
	exec("INSERT INTO book_series (book_id, series_id, sequence) VALUES ('s1', 1, 1), ('s2', 1, 2), ('s3', 1, 3)")
	exec("INSERT INTO genres (id, name) VALUES (1, 'Fantasy')")
	exec("INSERT INTO book_genres (book_id, genre_id) VALUES ('s1', 1), ('solo', 1)")
	exec("UPDATE books SET rating = 4.5, review = 'Secret thoughts' WHERE id = 's1'")
	exec("UPDATE books SET reading_state = 'dnf' WHERE id = 'dnf'")
	exec("INSERT INTO reading_progress (book_id, progress, device) VALUES ('s1', 100, 'manual')")
	exec("INSERT INTO reading_sessions (book_id, start_time, duration, source, dismissed) VALUES ('s1', '2026-09-01 10:00:00.000000', 36000, 'stats_db', 0)")
	exec("INSERT INTO highlights (book_id, text) VALUES ('s1', 'A highlighted line')")
}

func newRecServer(t *testing.T) (*testServer, *fakeOpenRouter) {
	s := newTestServer(t)
	f := newFakeOpenRouter(t)
	s.app.Config.OpenRouterKey = "key"
	s.app.Config.OpenRouterURL = f.URL
	seedReading(t, s)
	return s, f
}

type recResponse struct {
	Enabled  bool `json:"enabled"`
	Settings struct {
		Model         string `json:"model"`
		WebSearch     bool   `json:"web_search"`
		ShareNotes    bool   `json:"share_notes"`
		DiscoverKinds string `json:"discover_kinds"`
	} `json:"settings"`
	ReadNext recListResponse `json:"read_next"`
	Discover recListResponse `json:"discover"`
	Saved    []struct {
		ID    int64  `json:"id"`
		Title string `json:"title"`
	} `json:"saved"`
}

type recListResponse struct {
	Run *struct {
		Status      string   `json:"status"`
		Error       *string  `json:"error"`
		Cost        *float64 `json:"cost"`
		WebSearch   bool     `json:"web_search"`
		WebSearches *int64   `json:"web_searches"`
	} `json:"run"`
	Running bool `json:"running"`
	Items   []struct {
		ID   int64 `json:"id"`
		Book *struct {
			ID string `json:"id"`
		} `json:"book"`
		Title     string  `json:"title"`
		Format    string  `json:"format"`
		Site      *string `json:"site"`
		Reason    string  `json:"reason"`
		SourceURL *string `json:"source_url"`
		Feedback  *string `json:"feedback"`
	} `json:"items"`
}

// waitRecs polls until no refresh is running.
func waitRecs(t *testing.T, s *testServer) recResponse {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		var out recResponse
		expect(t, "recommendations", s.do("GET", "/api/recommendations", nil, &out), 200)
		if !out.ReadNext.Running && !out.Discover.Running {
			return out
		}
		if time.Now().After(deadline) {
			t.Fatal("refresh did not finish")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestRecommendationsDisabled(t *testing.T) {
	s := newTestServer(t)
	var out recResponse
	expect(t, "list", s.do("GET", "/api/recommendations", nil, &out), 200)
	if out.Enabled || out.Settings.Model != DefaultRecommendationModel || !out.Settings.WebSearch {
		t.Errorf("defaults: %+v", out)
	}
	expect(t, "refresh", s.do("POST", "/api/recommendations/refresh", map[string]any{}, nil), 404)
	var app map[string]any
	s.do("GET", "/api/app", nil, &app)
	if app["recommendations"] != false {
		t.Errorf("app: %v", app)
	}
}

func TestReadNext(t *testing.T) {
	s, f := newRecServer(t)
	// The model may pick ids that aren't on the list; those are dropped.
	f.answer(`{"picks": [{"id": "b9", "reason": "Not real."}, {"id": "b1", "reason": "You loved Saga One."}, {"id": "b2", "reason": "Fantasy again."}, {"id": "b1", "reason": "Twice."}]}`)
	var started map[string][]string
	expect(t, "refresh", s.do("POST", "/api/recommendations/refresh", map[string]any{"kind": "read_next"}, &started), 202)
	if len(started["started"]) != 1 {
		t.Fatalf("started: %v", started)
	}
	out := waitRecs(t, s)
	if out.ReadNext.Run == nil || out.ReadNext.Run.Status != "done" || *out.ReadNext.Run.Cost != 0.002 {
		t.Fatalf("run: %+v", out.ReadNext.Run)
	}
	if len(out.ReadNext.Items) != 2 {
		t.Fatalf("items: %+v", out.ReadNext.Items)
	}

	req := f.request(0)
	msgs := req["messages"].([]any)
	prompt := msgs[1].(map[string]any)["content"].(string)
	// Only the next unread book of the series is offered, not the dropped
	// book or the one already read.
	for _, want := range []string{"The Saga — Ann Author", "rated 4.5", "10h read", "Saga Two — Ann Author | The Saga #2", "Lone Star — Cy Solo", "Dull Book — Bo Bore | DNF"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt lacks %q:\n%s", want, prompt)
		}
	}
	for _, unwanted := range []string{"Saga Three", "| Dull Book", "Secret thoughts", "A highlighted line"} {
		if strings.Contains(prompt, unwanted) {
			t.Errorf("prompt has %q:\n%s", unwanted, prompt)
		}
	}
	if req["tools"] != nil {
		t.Error("read next must not search the web")
	}
	if req["response_format"] == nil {
		t.Error("structured output not asked for")
	}
	ids := map[string]bool{}
	for _, it := range out.ReadNext.Items {
		ids[it.Book.ID] = true
	}
	// b1 and b2 are the candidates in order: Saga Two (series under way)
	// first, then Lone Star.
	if !ids["s2"] || !ids["solo"] || out.ReadNext.Items[0].Title != "Saga Two" {
		t.Errorf("picked %+v", out.ReadNext.Items)
	}

	// Not interested hides the book from the next run's candidates.
	solo := out.ReadNext.Items[1]
	expect(t, "feedback", s.do("POST", "/api/recommendations/"+itoa(solo.ID)+"/feedback", map[string]any{"verdict": "not_interested"}, nil), 200)
	expect(t, "bad verdict", s.do("POST", "/api/recommendations/"+itoa(solo.ID)+"/feedback", map[string]any{"verdict": "saved"}, nil), 400)
	f.answer(`{"picks": [{"id": "b1", "reason": "Again."}]}`)
	s.do("POST", "/api/recommendations/refresh", map[string]any{"kind": "read_next"}, nil)
	waitRecs(t, s)
	prompt = f.request(1)["messages"].([]any)[1].(map[string]any)["content"].(string)
	if strings.Contains(prompt, "Lone Star — Cy Solo |") {
		t.Errorf("rejected book offered again:\n%s", prompt)
	}
}

func TestReadNextSharesNotesWhenAllowed(t *testing.T) {
	s, f := newRecServer(t)
	expect(t, "settings", s.do("PUT", "/api/recommendations/settings", map[string]any{"share_notes": true}, nil), 200)
	f.answer(`{"picks": [{"id": "b1", "reason": "x"}]}`)
	s.do("POST", "/api/recommendations/refresh", map[string]any{"kind": "read_next"}, nil)
	waitRecs(t, s)
	prompt := f.request(0)["messages"].([]any)[1].(map[string]any)["content"].(string)
	if !strings.Contains(prompt, "Secret thoughts") || !strings.Contains(prompt, "A highlighted line") {
		t.Errorf("notes missing:\n%s", prompt)
	}
}

func TestDiscover(t *testing.T) {
	s, f := newRecServer(t)
	f.answer(`{"picks": [
		{"title": "Saga One", "author": "Ann Author", "kind": "book", "site": "", "reason": "Owned.", "source_url": ""},
		{"title": "Mother of Learning", "author": "nobody103", "kind": "web_serial", "site": "Royal Road", "reason": "Time loops.", "source_url": "https://www.royalroad.com/fiction/21220"},
		{"title": "Cradle", "author": "Will Wight", "kind": "book", "site": "", "reason": "Progression.", "source_url": ""},
		{"title": "Made Up", "author": "Nobody", "kind": "book", "site": "", "reason": "Hmm.", "source_url": ""}
	]}`)
	s.do("POST", "/api/recommendations/refresh", map[string]any{"kind": "discover"}, nil)
	out := waitRecs(t, s)
	if out.Discover.Run == nil || out.Discover.Run.Status != "done" || !out.Discover.Run.WebSearch ||
		out.Discover.Run.WebSearches == nil || *out.Discover.Run.WebSearches != 1 {
		t.Fatalf("run: %+v", out.Discover.Run)
	}
	if len(out.Discover.Items) != 3 || out.Discover.Items[0].Title != "Mother of Learning" {
		t.Fatalf("owned titles must be dropped: %+v", out.Discover.Items)
	}
	req := f.request(0)
	tool := req["tools"].([]any)[0].(map[string]any)
	if tool["type"] != "openrouter:web_search" {
		t.Errorf("tools: %v", req["tools"])
	}
	prompt := req["messages"].([]any)[1].(map[string]any)["content"].(string)
	if !strings.Contains(prompt, "- The Saga (series) — Ann Author") || !strings.Contains(prompt, "search the web") {
		t.Errorf("prompt:\n%s", prompt)
	}

	// Feedback: saved goes to the saved list; not found and saved titles
	// are told to the model and never shown again.
	mol, cradle, madeUp := out.Discover.Items[0], out.Discover.Items[1], out.Discover.Items[2]
	expect(t, "save", s.do("POST", "/api/recommendations/"+itoa(mol.ID)+"/feedback", map[string]any{"verdict": "saved"}, nil), 200)
	expect(t, "not found", s.do("POST", "/api/recommendations/"+itoa(madeUp.ID)+"/feedback", map[string]any{"verdict": "not_found"}, nil), 200)
	expect(t, "read", s.do("POST", "/api/recommendations/"+itoa(cradle.ID)+"/feedback", map[string]any{"verdict": "already_read"}, nil), 200)
	expect(t, "undo", s.do("POST", "/api/recommendations/"+itoa(cradle.ID)+"/feedback", map[string]any{"verdict": nil}, nil), 204)
	out = waitRecs(t, s)
	if len(out.Saved) != 1 || out.Saved[0].Title != "Mother of Learning" {
		t.Errorf("saved: %+v", out.Saved)
	}
	if out.Discover.Items[0].Feedback == nil || *out.Discover.Items[0].Feedback != "saved" || out.Discover.Items[1].Feedback != nil {
		t.Errorf("feedback on items: %+v", out.Discover.Items)
	}

	// Books only, no web search; titles turned down are dropped even if the
	// model suggests them again.
	expect(t, "settings", s.do("PUT", "/api/recommendations/settings", map[string]any{"web_search": false, "discover_kinds": "books"}, nil), 200)
	f.answer(`{"picks": [
		{"title": "Made Up", "author": "Nobody", "kind": "book", "site": "", "reason": "Again.", "source_url": ""},
		{"title": "The Wandering Inn", "author": "pirateaba", "kind": "web_serial", "site": "wanderinginn.com", "reason": "Serial.", "source_url": ""},
		{"title": "Cradle", "author": "Will Wight", "kind": "book", "site": "", "reason": "Progression.", "source_url": ""}
	]}`)
	s.do("POST", "/api/recommendations/refresh", map[string]any{"kind": "discover"}, nil)
	out = waitRecs(t, s)
	if len(out.Discover.Items) != 1 || out.Discover.Items[0].Title != "Cradle" {
		t.Errorf("items: %+v", out.Discover.Items)
	}
	req = f.request(1)
	if req["tools"] != nil {
		t.Error("web search should be off")
	}
	prompt = req["messages"].([]any)[1].(map[string]any)["content"].(string)
	for _, want := range []string{"Only published books", "Saved to read later", "- Mother of Learning — nobody103", "Could not be found", "- Made Up — Nobody"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt lacks %q", want)
		}
	}

	// Removing a saved title.
	expect(t, "unsave", s.do("DELETE", "/api/recommendations/feedback/"+itoa(out.Saved[0].ID), nil, nil), 204)
	out = waitRecs(t, s)
	if len(out.Saved) != 0 {
		t.Errorf("saved: %+v", out.Saved)
	}
}

func TestRecommendationErrors(t *testing.T) {
	s, f := newRecServer(t)
	// No provider supports structured output: asked again without it.
	f.fail(404, "No endpoints found that support the requested parameters")
	f.answer("Sure! ```json\n{\"picks\": [{\"id\": \"b1\", \"reason\": \"x\"}]}\n```")
	s.do("POST", "/api/recommendations/refresh", map[string]any{"kind": "read_next"}, nil)
	out := waitRecs(t, s)
	if out.ReadNext.Run.Status != "done" || len(out.ReadNext.Items) != 1 {
		t.Fatalf("fallback: %+v", out.ReadNext)
	}
	if f.request(1)["response_format"] != nil {
		t.Error("retry still asked for structured output")
	}

	// A failed run keeps the last good picks and reports the error.
	f.fail(402, "Insufficient credits")
	s.do("POST", "/api/recommendations/refresh", map[string]any{"kind": "read_next"}, nil)
	out = waitRecs(t, s)
	if out.ReadNext.Run.Status != "error" || !strings.Contains(*out.ReadNext.Run.Error, "Insufficient credits") || len(out.ReadNext.Items) != 1 {
		t.Errorf("after failure: %+v", out.ReadNext)
	}

	// A run left running by a restart is marked failed on start.
	s.app.DB.Exec("INSERT INTO recommendation_runs (kind, status, model, web_search, started_at) VALUES ('discover', 'running', 'm', 0, '2026-10-01 00:00:00.000000')")
	s.app.failInterruptedRecRuns(t.Context())
	out = waitRecs(t, s)
	if out.Discover.Run.Status != "error" {
		t.Errorf("interrupted run: %+v", out.Discover.Run)
	}
}

func TestRecommendationSettings(t *testing.T) {
	s, _ := newRecServer(t)
	var out map[string]any
	expect(t, "bad model", s.do("PUT", "/api/recommendations/settings", map[string]any{"model": "has space"}, nil), 400)
	expect(t, "bad kinds", s.do("PUT", "/api/recommendations/settings", map[string]any{"discover_kinds": "films"}, nil), 400)
	expect(t, "save", s.do("PUT", "/api/recommendations/settings", map[string]any{"model": " anthropic/claude-sonnet-5.5 ", "weekly": true}, &out), 200)
	settings := out["settings"].(map[string]any)
	if settings["model"] != "anthropic/claude-sonnet-5.5" || settings["weekly"] != true || settings["web_search"] != true {
		t.Errorf("settings: %v", settings)
	}
	var models struct {
		Models []struct {
			ID         string  `json:"id"`
			InputPrice float64 `json:"input_price"`
		} `json:"models"`
	}
	expect(t, "models", s.do("GET", "/api/recommendations/models", nil, &models), 200)
	if len(models.Models) != 1 || models.Models[0].InputPrice != 0.75 {
		t.Errorf("models: %+v", models)
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func TestRecommendationPrompt(t *testing.T) {
	s, f := newRecServer(t)
	var out struct {
		Model        string          `json:"model"`
		WebSearch    bool            `json:"web_search"`
		System       string          `json:"system"`
		User         string          `json:"user"`
		Schema       json.RawMessage `json:"schema"`
		Tools        []any           `json:"tools"`
		ApproxTokens int             `json:"approx_tokens"`
	}
	expect(t, "read next", s.do("GET", "/api/recommendations/prompt?kind=read_next", nil, &out), 200)
	if !strings.Contains(out.User, "Saga Two — Ann Author") || out.WebSearch || out.Tools != nil || out.ApproxTokens == 0 || len(out.Schema) == 0 {
		t.Errorf("read next prompt: %+v", out)
	}
	// The preview is what a refresh sends.
	f.answer(`{"picks": [{"id": "b1", "reason": "x"}]}`)
	s.do("POST", "/api/recommendations/refresh", map[string]any{"kind": "read_next"}, nil)
	waitRecs(t, s)
	sent := f.request(0)["messages"].([]any)
	if sent[0].(map[string]any)["content"] != out.System || sent[1].(map[string]any)["content"] != out.User {
		t.Error("preview differs from what was sent")
	}

	expect(t, "discover", s.do("GET", "/api/recommendations/prompt?kind=discover", nil, &out), 200)
	if !out.WebSearch || len(out.Tools) != 1 || !strings.Contains(out.User, "search the web") {
		t.Errorf("discover prompt: %+v", out)
	}
	expect(t, "bad kind", s.do("GET", "/api/recommendations/prompt?kind=films", nil, nil), 400)
}
