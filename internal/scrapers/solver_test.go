package scrapers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const (
	anubisPage = `<html><head><title>Making sure you're not a bot!</title></head><body><script id="anubis_challenge" type="application/json">{}</script></body></html>`
	cfPage     = `<html><head><title>Just a moment...</title></head><body></body></html>`
)

func TestIsBotWall(t *testing.T) {
	cf := http.Header{}
	cf.Set("Cf-Mitigated", "challenge")
	for _, c := range []struct {
		status int
		header http.Header
		body   string
		want   bool
	}{
		{403, cf, cfPage, true},
		{403, http.Header{}, cfPage, true},
		{200, http.Header{}, anubisPage, true},
		{200, http.Header{}, rrStoryHtml, false},
		{404, http.Header{}, "<title>Not found</title>", false},
	} {
		if got := isBotWall(c.status, c.header, []byte(c.body)); got != c.want {
			t.Errorf("isBotWall(%d, %.40q) = %v", c.status, c.body, got)
		}
	}
}

func TestBotWallWithoutSolver(t *testing.T) {
	serve(t, anubisPage)
	_, err := (&RoyalRoad{}).FetchChapterList(ctx, "https://www.royalroad.com/fiction/1/x")
	var wall *BotWallError
	if !errors.As(err, &wall) || !strings.Contains(err.Error(), "SHELFLOOM_FLARESOLVERR_URL") {
		t.Fatalf("err = %v", err)
	}
}

// fakeSolver is a FlareSolverr that answers each request.get with the next
// page (repeating the last) and records the commands it got.
type fakeSolver struct {
	pages []string
	gets  int
	cmds  []map[string]any
}

func (f *fakeSolver) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req map[string]any
	json.NewDecoder(r.Body).Decode(&req)
	f.cmds = append(f.cmds, req)
	resp := map[string]any{"status": "ok", "message": ""}
	if req["cmd"] == "request.get" {
		page := f.pages[min(f.gets, len(f.pages)-1)]
		f.gets++
		resp["solution"] = map[string]any{"url": req["url"], "status": 200, "response": page}
	}
	json.NewEncoder(w).Encode(resp)
}

func withSolver(t *testing.T, pages ...string) *fakeSolver {
	t.Helper()
	fs := &fakeSolver{pages: pages}
	srv := httptest.NewServer(fs)
	old := Solver
	Solver = NewFlareSolverr(srv.URL)
	t.Cleanup(func() {
		Solver.mu.Lock()
		if Solver.idle != nil {
			Solver.idle.Stop()
		}
		Solver.mu.Unlock()
		Solver = old
		srv.Close()
	})
	return fs
}

func TestBotWallThroughSolver(t *testing.T) {
	site := serve(t, cfPage)
	// The session's first page is still Anubis; the retry waits it out.
	fs := withSolver(t, anubisPage, rrStoryHtml)
	chapters, err := (&RoyalRoad{}).FetchChapterList(ctx, "https://www.royalroad.com/fiction/1/x")
	if err != nil {
		t.Fatal(err)
	}
	if len(chapters) == 0 {
		t.Fatal("no chapters")
	}
	if fs.cmds[0]["cmd"] != "sessions.create" || fs.gets != 2 || fs.cmds[2]["waitInSeconds"] != float64(10) {
		t.Fatalf("solver commands %v", fs.cmds)
	}
	// The host is now known to be walled: the next page skips the direct try.
	if _, err := (&RoyalRoad{}).FetchChapterList(ctx, "https://www.royalroad.com/fiction/1/x"); err != nil {
		t.Fatal(err)
	}
	if len(site.calls) != 1 {
		t.Fatalf("direct requests %v, want 1", site.calls)
	}
}

func TestSolverGivesUp(t *testing.T) {
	serve(t, cfPage)
	withSolver(t, cfPage)
	_, err := (&RoyalRoad{}).FetchChapterList(ctx, "https://www.royalroad.com/fiction/1/x")
	var wall *BotWallError
	if !errors.As(err, &wall) || !strings.Contains(err.Error(), "FlareSolverr could not") {
		t.Fatalf("err = %v", err)
	}
}

// A page fetched through a browser has its chapter table paged to 20 rows;
// the embedded window.chapters list has them all.
func TestRoyalRoadChaptersJSON(t *testing.T) {
	serve(t, `<html><body><table id="chapters"><tr><a href="/fiction/1/x/chapter/9/only-row">Only row</a></tr></table>
<script>
window.chapters = [{"id":11,"title":"Chapter 2","date":"2025-01-16T12:00:00Z","order":2,"visible":1,"url":"/fiction/1/x/chapter/11/chapter-2"},{"id":10,"title":"Chapter 1 &amp; more","date":"2025-01-15T12:00:00Z","order":1,"visible":1,"url":"/fiction/1/x/chapter/10/chapter-1"},{"id":12,"title":"Hidden","date":"2025-01-17T12:00:00Z","order":3,"visible":0,"url":"/fiction/1/x/chapter/12/hidden"}];
window.volumes = [];
</script></body></html>`)
	chapters, err := (&RoyalRoad{}).FetchChapterList(ctx, "https://www.royalroad.com/fiction/1/x")
	if err != nil || len(chapters) != 2 {
		t.Fatalf("%+v %v", chapters, err)
	}
	if *chapters[0].Title != "Chapter 1 & more" || chapters[0].SourceURL != "https://www.royalroad.com/fiction/1/x/chapter/10/chapter-1" || chapters[1].Number != 2 {
		t.Fatalf("%+v", chapters[0])
	}
	if d := chapters[0].PublishDate; d == nil || d.Format("2006-01-02T15:04:05") != "2025-01-15T12:00:00" {
		t.Errorf("date %v", d)
	}
}
