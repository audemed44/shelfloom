package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/audemed44/shelfloom/internal/openrouter"
	"github.com/audemed44/shelfloom/internal/recommend"
	"github.com/audemed44/shelfloom/internal/store"
)

// Recommendation kinds.
const (
	recReadNext = "read_next"
	recDiscover = "discover"
)

const (
	readNextPicks = 12
	discoverPicks = 15
	// Discover asks for a few more than it shows: some turn out to be
	// owned already.
	discoverAsk = 20
	// Read next sends at most this many unread books.
	maxCandidates = 600
)

// Where web search may look: Royal Road and reader communities.
var recSearchDomains = []string{"royalroad.com", "reddit.com", "goodreads.com", "scribblehub.com", "novelupdates.com"}

const settingRecommendations = "recommendations"

// recSettings are the recommendation settings changed in the UI.
type recSettings struct {
	Model string `json:"model"`
	// WebSearch lets Discover search the web.
	WebSearch bool `json:"web_search"`
	// ShareNotes adds reviews and highlights to what is sent.
	ShareNotes bool `json:"share_notes"`
	// Weekly refreshes both lists once a week in the background.
	Weekly bool `json:"weekly"`
	// DiscoverKinds is both, books or web_serials.
	DiscoverKinds string `json:"discover_kinds"`
}

// DefaultRecommendationModel is the model used unless one is picked.
const DefaultRecommendationModel = "google/gemini-3.8-flash"

func (s *Server) recSettings(ctx context.Context) (recSettings, error) {
	out := recSettings{Model: s.Config.OpenRouterModel, WebSearch: true, DiscoverKinds: recommend.KindBoth}
	if out.Model == "" {
		out.Model = DefaultRecommendationModel
	}
	_, err := s.getSetting(ctx, settingRecommendations, &out)
	if strings.TrimSpace(out.Model) == "" {
		out.Model = DefaultRecommendationModel
	}
	switch out.DiscoverKinds {
	case recommend.KindBooks, recommend.KindWebSerials:
	default:
		out.DiscoverKinds = recommend.KindBoth
	}
	return out, err
}

// recState tracks running refreshes and the cached model list.
type recState struct {
	once   sync.Once
	client *openrouter.Client

	mu      sync.Mutex
	running map[string]bool

	modelsMu sync.Mutex
	models   []openrouter.Model
	modelsAt time.Time
}

// openRouter returns the OpenRouter client, or nil without an API key.
func (s *Server) openRouter() *openrouter.Client {
	s.recs.once.Do(func() {
		if key := strings.TrimSpace(s.Config.OpenRouterKey); key != "" {
			s.recs.client = openrouter.New(key)
			s.recs.client.BaseURL = s.Config.OpenRouterURL
		}
	})
	return s.recs.client
}

func (s *Server) requireOpenRouter() (*openrouter.Client, error) {
	c := s.openRouter()
	if c == nil {
		return nil, notFound("Recommendations are off: set OPENROUTER_API_KEY (SHELFLOOM_OPENROUTER_API_KEY in the container)")
	}
	return c, nil
}

// ── reading the library ────────────────────────────────────────────────────

type recBook struct {
	ID          string
	Title       string
	Author      string
	Description string
	Rating      *float64
	DNF         bool
	Review      string
	Progress    float64
	Hours       float64
	LastRead    store.Time
	DateAdded   store.Time
	SeriesID    *int64
	SeriesName  string
	Sequence    *float64
	SerialID    *int64
	Genres      []string
	Tags        []string
	Highlights  []string
}

func (b *recBook) started() bool  { return b.Progress > 0 || b.Hours > 0 }
func (b *recBook) finished() bool { return b.Progress >= 100 }

type recSerial struct {
	ID       int64
	Title    string
	Author   string
	Source   string
	Status   string
	SeriesID *int64
}

type recLibrary struct {
	books   []*recBook
	serials []*recSerial
}

func (s *Server) loadRecLibrary(ctx context.Context, notes bool) (*recLibrary, error) {
	lib := &recLibrary{}
	byID := map[string]*recBook{}
	rows, err := s.DB.QueryContext(ctx, `
		SELECT b.id, b.title, coalesce(b.author, ''), coalesce(b.description, ''), b.rating,
			coalesce(b.reading_state, '') = 'dnf', coalesce(b.review, ''), b.date_added,
			coalesce((SELECT max(p.progress) FROM reading_progress p WHERE p.book_id = b.id), 0),
			coalesce((SELECT sum(s.duration) FROM reading_sessions s WHERE s.book_id = b.id AND NOT s.dismissed), 0),
			(SELECT max(s.start_time) FROM reading_sessions s WHERE s.book_id = b.id AND NOT s.dismissed),
			(SELECT v.serial_id FROM serial_volumes v WHERE v.book_id = b.id LIMIT 1)
		FROM books b ORDER BY b.date_added DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		b := &recBook{}
		var seconds float64
		if err := rows.Scan(&b.ID, &b.Title, &b.Author, &b.Description, &b.Rating, &b.DNF, &b.Review, &b.DateAdded,
			&b.Progress, &seconds, &b.LastRead, &b.SerialID); err != nil {
			return nil, err
		}
		b.Hours = seconds / 3600
		lib.books = append(lib.books, b)
		byID[b.ID] = b
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// A book's first series (lowest id) is the one it is grouped under.
	if err := eachRow(ctx, s.DB, `
		SELECT bs.book_id, bs.series_id, s.name, bs.sequence FROM book_series bs
		JOIN series s ON s.id = bs.series_id ORDER BY bs.series_id`, func(r *sql.Rows) error {
		var id, name string
		var sid int64
		var seq *float64
		if err := r.Scan(&id, &sid, &name, &seq); err != nil {
			return err
		}
		if b := byID[id]; b != nil && b.SeriesID == nil {
			b.SeriesID, b.SeriesName, b.Sequence = &sid, name, seq
		}
		return nil
	}); err != nil {
		return nil, err
	}
	for _, link := range []struct{ query string }{
		{"SELECT bg.book_id, g.name, 'g' FROM book_genres bg JOIN genres g ON g.id = bg.genre_id ORDER BY g.name"},
		{"SELECT bt.book_id, t.name, 't' FROM book_tags bt JOIN tags t ON t.id = bt.tag_id ORDER BY t.name"},
	} {
		if err := eachRow(ctx, s.DB, link.query, func(r *sql.Rows) error {
			var id, name, kind string
			if err := r.Scan(&id, &name, &kind); err != nil {
				return err
			}
			if b := byID[id]; b != nil {
				if kind == "g" {
					b.Genres = append(b.Genres, name)
				} else {
					b.Tags = append(b.Tags, name)
				}
			}
			return nil
		}); err != nil {
			return nil, err
		}
	}
	if notes {
		if err := eachRow(ctx, s.DB, "SELECT book_id, text FROM highlights ORDER BY created DESC", func(r *sql.Rows) error {
			var id, text string
			if err := r.Scan(&id, &text); err != nil {
				return err
			}
			if b := byID[id]; b != nil && len(b.Highlights) < 3 {
				b.Highlights = append(b.Highlights, text)
			}
			return nil
		}); err != nil {
			return nil, err
		}
	}
	if err := eachRow(ctx, s.DB, "SELECT id, coalesce(title, url), coalesce(author, ''), source, status, series_id FROM web_serials ORDER BY id", func(r *sql.Rows) error {
		w := &recSerial{}
		if err := r.Scan(&w.ID, &w.Title, &w.Author, &w.Source, &w.Status, &w.SeriesID); err != nil {
			return err
		}
		lib.serials = append(lib.serials, w)
		return nil
	}); err != nil {
		return nil, err
	}
	return lib, nil
}

func eachRow(ctx context.Context, db *store.DB, query string, fn func(*sql.Rows) error) error {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := fn(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}

var serialSites = map[string]string{
	"royalroad": "Royal Road",
	"novelfire": "NovelFire",
	"wildbow":   "Wildbow's own site",
	"wordpress": "its own WordPress site",
}

// workKey groups a book with the rest of its series or web serial.
func (lib *recLibrary) workKey(b *recBook, serialOfSeries map[int64]int64) string {
	if b.SerialID != nil {
		return fmt.Sprintf("serial:%d", *b.SerialID)
	}
	if b.SeriesID != nil {
		if sid, found := serialOfSeries[*b.SeriesID]; found {
			return fmt.Sprintf("serial:%d", sid)
		}
		return fmt.Sprintf("series:%d", *b.SeriesID)
	}
	return "book:" + b.ID
}

// profile builds what the model is told about the reader.
func (lib *recLibrary) profile(feedback []recommend.Feedback, notes bool, now time.Time) (recommend.Profile, map[string]bool) {
	serialOfSeries := map[int64]int64{}
	serials := map[int64]*recSerial{}
	for _, w := range lib.serials {
		serials[w.ID] = w
		if w.SeriesID != nil {
			serialOfSeries[*w.SeriesID] = w.ID
		}
	}
	type group struct {
		work  recommend.Work
		books []*recBook
	}
	groups := map[string]*group{}
	var order []string
	for _, b := range lib.books {
		key := lib.workKey(b, serialOfSeries)
		g := groups[key]
		if g == nil {
			g = &group{}
			groups[key] = g
			order = append(order, key)
		}
		g.books = append(g.books, b)
	}
	p := recommend.Profile{Today: now, Feedback: feedback}
	dnfWorks := map[string]bool{}
	genreHours := map[string]*recommend.Count{}
	tagHours := map[string]*recommend.Count{}
	readSerials := map[int64]bool{}
	for _, key := range order {
		g := groups[key]
		w := &g.work
		first := g.books[0]
		switch {
		case strings.HasPrefix(key, "serial:"):
			var id int64
			fmt.Sscanf(key, "serial:%d", &id)
			sr := serials[id]
			w.Kind, w.Title, w.Author, w.Site = "web serial", sr.Title, sr.Author, serialSites[sr.Source]
			if w.Author == "" {
				w.Author = first.Author
			}
		case strings.HasPrefix(key, "series:") && len(g.books) > 1:
			w.Kind, w.Title, w.Author = "series", first.SeriesName, first.Author
		default:
			w.Kind, w.Title, w.Author = "book", first.Title, first.Author
			if first.SeriesName != "" {
				w.Title += " (" + first.SeriesName + seqText(first.Sequence) + ")"
			}
		}
		labels := map[string]bool{}
		dnf := false
		for _, b := range g.books {
			w.Books++
			if b.finished() {
				w.BooksFinished++
			} else if b.started() {
				w.BooksStarted++
			}
			dnf = dnf || b.DNF
			w.Hours += b.Hours
			if b.Rating != nil && *b.Rating > 0 {
				w.Ratings = append(w.Ratings, *b.Rating)
			}
			if b.LastRead.Valid && b.LastRead.After(w.LastRead) {
				w.LastRead = b.LastRead.Time
			}
			for _, x := range b.Genres {
				if !labels["g:"+x] {
					labels["g:"+x] = true
					w.Genres = append(w.Genres, x)
				}
			}
			for _, x := range b.Tags {
				if !labels["t:"+x] {
					labels["t:"+x] = true
					w.Tags = append(w.Tags, x)
				}
			}
			if notes {
				if b.Review != "" {
					w.Notes = append(w.Notes, "Review of "+b.Title+": "+b.Review)
				}
				for _, h := range b.Highlights {
					w.Notes = append(w.Notes, "Highlight: "+h)
				}
			}
			if b.started() {
				for _, x := range b.Genres {
					addCount(genreHours, x, b.Hours)
				}
				for _, x := range b.Tags {
					addCount(tagHours, x, b.Hours)
				}
			}
		}
		// A series is DNF when the reader dropped it and finished nothing
		// after; a single DNF volume among finished ones is noted the same.
		w.DNF = dnf
		if len(w.Notes) > 4 {
			w.Notes = w.Notes[:4]
		}
		if w.BooksFinished+w.BooksStarted == 0 && !w.DNF && len(w.Ratings) == 0 {
			continue
		}
		if w.DNF {
			dnfWorks[key] = true
		}
		if strings.HasPrefix(key, "serial:") {
			var id int64
			fmt.Sscanf(key, "serial:%d", &id)
			readSerials[id] = true
		}
		p.Works = append(p.Works, *w)
	}
	for _, sr := range lib.serials {
		line := sr.Title
		if sr.Author != "" {
			line += " — " + sr.Author
		}
		state := sr.Status
		if readSerials[sr.ID] {
			state += ", read in part"
		} else {
			state += ", not started"
		}
		site := serialSites[sr.Source]
		if site == "" {
			site = sr.Source
		}
		p.Following = append(p.Following, fmt.Sprintf("%s (%s, %s)", line, site, state))
	}
	p.Genres = sortedCounts(genreHours)
	p.Tags = sortedCounts(tagHours)
	return p, dnfWorks
}

func seqText(seq *float64) string {
	if seq == nil {
		return ""
	}
	return " #" + strings.TrimSuffix(strings.TrimSuffix(fmt.Sprintf("%.2f", *seq), "0"), ".0")
}

func addCount(m map[string]*recommend.Count, name string, hours float64) {
	c := m[name]
	if c == nil {
		c = &recommend.Count{Name: name}
		m[name] = c
	}
	c.Hours += hours
	c.Books++
}

func sortedCounts(m map[string]*recommend.Count) []recommend.Count {
	out := make([]recommend.Count, 0, len(m))
	for _, c := range m {
		out = append(out, *c)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Hours != out[j].Hours {
			return out[i].Hours > out[j].Hours
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// candidates are the unread books Read next may pick: the first unread book
// of each series, and unread standalone books, skipping dropped series and
// books turned down before.
func (lib *recLibrary) candidates(dnfWorks map[string]bool, rejected map[string]bool) ([]recommend.Candidate, map[string]string) {
	serialOfSeries := map[int64]int64{}
	for _, w := range lib.serials {
		if w.SeriesID != nil {
			serialOfSeries[*w.SeriesID] = w.ID
		}
	}
	type cand struct {
		b       *recBook
		key     string
		ongoing bool // the reader has read some of the series
	}
	readWorks := map[string]bool{}
	for _, b := range lib.books {
		if b.started() {
			readWorks[lib.workKey(b, serialOfSeries)] = true
		}
	}
	best := map[string]*cand{}
	var standalone []*cand
	for _, b := range lib.books {
		if b.started() || b.DNF || rejected[b.ID] {
			continue
		}
		key := lib.workKey(b, serialOfSeries)
		if dnfWorks[key] {
			continue
		}
		c := &cand{b: b, key: key, ongoing: readWorks[key]}
		if strings.HasPrefix(key, "book:") {
			standalone = append(standalone, c)
			continue
		}
		if cur := best[key]; cur == nil || seqLess(b.Sequence, cur.b.Sequence) {
			best[key] = c
		}
	}
	all := standalone
	for _, c := range best {
		all = append(all, c)
	}
	sort.SliceStable(all, func(i, j int) bool {
		if all[i].ongoing != all[j].ongoing {
			return all[i].ongoing
		}
		return all[i].b.DateAdded.After(all[j].b.DateAdded.Time)
	})
	if len(all) > maxCandidates {
		all = all[:maxCandidates]
	}
	out := make([]recommend.Candidate, 0, len(all))
	ids := map[string]string{}
	for i, c := range all {
		key := fmt.Sprintf("b%d", i+1)
		ids[key] = c.b.ID
		out = append(out, recommend.Candidate{
			Key: key, Title: c.b.Title, Author: c.b.Author, Series: c.b.SeriesName, Sequence: c.b.Sequence,
			WebSerial: c.b.SerialID != nil, Genres: c.b.Genres, Tags: c.b.Tags, Description: plainText(c.b.Description),
		})
	}
	return out, ids
}

func seqLess(a, b *float64) bool {
	switch {
	case a == nil:
		return false
	case b == nil:
		return true
	}
	return *a < *b
}

// owned lists the library for Discover (series once, not each book) and
// indexes it to drop picks the reader has.
func (lib *recLibrary) owned() ([]string, *recommend.Owned) {
	var lines, titles []string
	seen := map[string]bool{}
	add := func(title, author string) {
		line := title
		if author != "" {
			line += " — " + author
		}
		if k := strings.ToLower(line); !seen[k] {
			seen[k] = true
			lines = append(lines, line)
		}
	}
	for _, sr := range lib.serials {
		add(sr.Title+" (web serial)", sr.Author)
		titles = append(titles, sr.Title)
	}
	for _, b := range lib.books {
		titles = append(titles, b.Title)
		if b.SeriesName != "" {
			titles = append(titles, b.SeriesName)
			add(b.SeriesName+" (series)", b.Author)
		} else {
			add(b.Title, b.Author)
		}
	}
	return lines, recommend.NewOwned(titles)
}

// ── feedback ───────────────────────────────────────────────────────────────

type recFeedbackRow struct {
	ID        int64      `json:"id"`
	BookID    *string    `json:"book_id"`
	Title     string     `json:"title"`
	Author    *string    `json:"author"`
	Format    string     `json:"format"`
	Site      *string    `json:"site"`
	Reason    *string    `json:"reason"`
	SourceURL *string    `json:"source_url"`
	Verdict   string     `json:"verdict"`
	CreatedAt store.Time `json:"created_at"`
	matchKey  string
}

func (s *Server) recFeedback(ctx context.Context) ([]recFeedbackRow, error) {
	rows, err := s.DB.QueryContext(ctx, "SELECT id, match_key, book_id, title, author, format, site, reason, source_url, verdict, created_at FROM recommendation_feedback ORDER BY created_at DESC, id DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []recFeedbackRow
	for rows.Next() {
		var f recFeedbackRow
		if err := rows.Scan(&f.ID, &f.matchKey, &f.BookID, &f.Title, &f.Author, &f.Format, &f.Site, &f.Reason, &f.SourceURL, &f.Verdict, &f.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// ── running a refresh ──────────────────────────────────────────────────────

// startRecRun starts a refresh of one kind in the background, unless one is
// running. It returns whether it started.
func (s *Server) startRecRun(ctx context.Context, kind string) (bool, error) {
	c, err := s.requireOpenRouter()
	if err != nil {
		return false, err
	}
	settings, err := s.recSettings(ctx)
	if err != nil {
		return false, err
	}
	s.recs.mu.Lock()
	if s.recs.running == nil {
		s.recs.running = map[string]bool{}
	}
	if s.recs.running[kind] {
		s.recs.mu.Unlock()
		return false, nil
	}
	s.recs.running[kind] = true
	s.recs.mu.Unlock()
	done := func() {
		s.recs.mu.Lock()
		delete(s.recs.running, kind)
		s.recs.mu.Unlock()
	}
	webSearch := kind == recDiscover && settings.WebSearch
	res, err := s.DB.ExecContext(ctx, "INSERT INTO recommendation_runs (kind, status, model, web_search, started_at) VALUES (?, 'running', ?, ?, ?)",
		kind, settings.Model, webSearch, store.Now())
	if err != nil {
		done()
		return false, err
	}
	runID, _ := res.LastInsertId()
	s.bg.Add(1)
	go func() {
		defer s.bg.Done()
		defer done()
		s.runRec(s.bgCtx, c, runID, kind, settings, webSearch)
	}()
	return true, nil
}

func (s *Server) recRunning(kind string) bool {
	s.recs.mu.Lock()
	defer s.recs.mu.Unlock()
	return s.recs.running[kind]
}

func (s *Server) runRec(ctx context.Context, c *openrouter.Client, runID int64, kind string, settings recSettings, webSearch bool) {
	start := time.Now()
	n, usage, err := s.generateRec(ctx, c, runID, kind, settings, webSearch)
	finish := func(ctx context.Context) error {
		status, msg := "done", (*string)(nil)
		if err != nil {
			status, msg = "error", ptr(err.Error())
		}
		_, dbErr := s.DB.ExecContext(ctx, `UPDATE recommendation_runs SET status = ?, error = ?, input_tokens = ?, output_tokens = ?,
			web_searches = ?, cost = ?, finished_at = ? WHERE id = ?`,
			status, msg, usage.InputTokens, usage.OutputTokens, usage.WebSearches, usage.Cost, store.Now(), runID)
		return dbErr
	}
	// Record the outcome even when shutting down.
	if dbErr := finish(context.WithoutCancel(ctx)); dbErr != nil {
		slog.Error(fmt.Sprintf("Could not save recommendation run %d: %v", runID, dbErr))
	}
	if err != nil {
		slog.Warn(fmt.Sprintf("Recommendations (%s) failed: %v", kind, err))
		return
	}
	slog.Info(fmt.Sprintf("Recommendations (%s): %d picks from %s in %s, %d+%d tokens, %d searches, $%.4f",
		kind, n, settings.Model, time.Since(start).Round(time.Second), usage.InputTokens, usage.OutputTokens, usage.WebSearches, usage.Cost))
}

func (s *Server) generateRec(ctx context.Context, c *openrouter.Client, runID int64, kind string, settings recSettings, webSearch bool) (int, openrouter.Usage, error) {
	var usage openrouter.Usage
	lib, err := s.loadRecLibrary(ctx, settings.ShareNotes)
	if err != nil {
		return 0, usage, err
	}
	fbRows, err := s.recFeedback(ctx)
	if err != nil {
		return 0, usage, err
	}
	var feedback []recommend.Feedback
	rejectedBooks := map[string]bool{}
	turnedDown := map[string]bool{}
	for _, f := range fbRows {
		turnedDown[f.matchKey] = true
		if f.BookID != nil {
			if f.Verdict == "not_interested" {
				rejectedBooks[*f.BookID] = true
			}
			// Library books turned down are left out of the candidates
			// rather than listed.
			continue
		}
		feedback = append(feedback, recommend.Feedback{Title: f.Title, Author: deref(f.Author), Verdict: f.Verdict})
	}
	profile, dnfWorks := lib.profile(feedback, settings.ShareNotes, time.Now())
	text := profile.Text()

	req := openrouter.Request{Model: settings.Model}
	switch kind {
	case recReadNext:
		cands, ids := lib.candidates(dnfWorks, rejectedBooks)
		if len(cands) == 0 {
			return 0, usage, errors.New("there are no unread books to pick from")
		}
		system, user := recommend.ReadNextPrompt(text, cands, readNextPicks)
		req.Messages = []openrouter.Message{{Role: "system", Content: system}, {Role: "user", Content: user}}
		req.SchemaName, req.Schema = "read_next", recommend.ReadNextSchema
		resp, err := chatWithFallback(ctx, c, req)
		if resp != nil {
			usage = resp.Usage
		}
		if err != nil {
			return 0, usage, err
		}
		picks, err := recommend.ParseReadNext(resp.Content)
		if err != nil {
			return 0, usage, err
		}
		var items []recItem
		used := map[string]bool{}
		for _, p := range picks {
			id, found := ids[p.ID]
			if !found || used[id] {
				continue
			}
			used[id] = true
			items = append(items, recItem{BookID: &id, Reason: p.Reason, Format: "book"})
			if len(items) == readNextPicks {
				break
			}
		}
		if len(items) == 0 {
			return 0, usage, errors.New("the model picked none of the library's unread books")
		}
		return len(items), usage, s.saveRecItems(ctx, runID, items)

	case recDiscover:
		ownedLines, owned := lib.owned()
		system, user := recommend.DiscoverPrompt(text, ownedLines, settings.DiscoverKinds, discoverAsk, webSearch)
		req.Messages = []openrouter.Message{{Role: "system", Content: system}, {Role: "user", Content: user}}
		req.SchemaName, req.Schema = "discover", recommend.DiscoverSchema
		if webSearch {
			req.WebSearch = &openrouter.WebSearch{Engine: "exa", MaxResults: 5, MaxUses: 6, AllowedDomains: recSearchDomains}
		}
		resp, err := chatWithFallback(ctx, c, req)
		if resp != nil {
			usage = resp.Usage
		}
		if err != nil {
			return 0, usage, err
		}
		picks, err := recommend.ParseDiscover(resp.Content)
		if err != nil {
			return 0, usage, err
		}
		var items []recItem
		used := map[string]bool{}
		for _, p := range picks {
			key := recommend.Key(p.Title, p.Author)
			if used[key] || turnedDown[key] || owned.Has(p.Title) {
				continue
			}
			switch settings.DiscoverKinds {
			case recommend.KindBooks:
				if p.Kind != "book" {
					continue
				}
			case recommend.KindWebSerials:
				if p.Kind != "web_serial" {
					continue
				}
			}
			used[key] = true
			items = append(items, recItem{Title: p.Title, Author: p.Author, Format: p.Kind, Site: p.Site, Reason: p.Reason, SourceURL: p.SourceURL})
			if len(items) == discoverPicks {
				break
			}
		}
		if len(items) == 0 {
			return 0, usage, errors.New("every title the model suggested is already in the library or was turned down")
		}
		return len(items), usage, s.saveRecItems(ctx, runID, items)
	}
	return 0, usage, fmt.Errorf("unknown kind %q", kind)
}

// chatWithFallback asks for structured output, and asks again without it
// when no provider of the model supports it.
func chatWithFallback(ctx context.Context, c *openrouter.Client, req openrouter.Request) (*openrouter.Response, error) {
	resp, err := c.Chat(ctx, req)
	var apiErr *openrouter.APIError
	if err != nil && len(req.Schema) > 0 && errors.As(err, &apiErr) && (apiErr.Status == 400 || apiErr.Status == 404) {
		slog.Info(fmt.Sprintf("Asking %s again without structured output: %v", req.Model, err))
		req.Schema = nil
		retry, err2 := c.Chat(ctx, req)
		if retry != nil && resp != nil {
			retry.Usage.Cost += resp.Usage.Cost
		}
		return retry, err2
	}
	return resp, err
}

type recItem struct {
	BookID    *string
	Title     string
	Author    string
	Format    string
	Site      string
	Reason    string
	SourceURL string
}

func (s *Server) saveRecItems(ctx context.Context, runID int64, items []recItem) error {
	return s.DB.Tx(ctx, func(tx *sql.Tx) error {
		for i, it := range items {
			title, author := it.Title, it.Author
			if it.BookID != nil {
				// Read next names the book as the library has it.
				if err := tx.QueryRowContext(ctx, "SELECT title, coalesce(author, '') FROM books WHERE id = ?", *it.BookID).Scan(&title, &author); err != nil {
					return err
				}
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO recommendations (run_id, position, book_id, title, author, format, site, reason, source_url)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, runID, i, it.BookID, title, strOrNil(author), it.Format, strOrNil(it.Site), it.Reason, strOrNil(it.SourceURL)); err != nil {
				return err
			}
		}
		return nil
	})
}

// failInterruptedRecRuns marks runs left running by a restart as failed.
func (s *Server) failInterruptedRecRuns(ctx context.Context) {
	if _, err := s.DB.ExecContext(ctx, "UPDATE recommendation_runs SET status = 'error', error = 'Stopped when Shelfloom restarted', finished_at = ? WHERE status = 'running'", store.Now()); err != nil {
		slog.Warn(fmt.Sprintf("Could not tidy recommendation runs: %v", err))
	}
}

// weeklyRecs refreshes both lists when weekly refreshes are on and the last
// one is a week old.
func (s *Server) weeklyRecs(ctx context.Context) {
	if s.openRouter() == nil {
		return
	}
	settings, err := s.recSettings(ctx)
	if err != nil || !settings.Weekly {
		return
	}
	for _, kind := range []string{recReadNext, recDiscover} {
		var last store.Time
		err := s.DB.QueryRowContext(ctx, "SELECT max(started_at) FROM recommendation_runs WHERE kind = ?", kind).Scan(&last)
		if err != nil {
			continue
		}
		if !last.Valid || time.Since(last.Time) >= 7*24*time.Hour {
			if _, err := s.startRecRun(ctx, kind); err != nil {
				slog.Warn(fmt.Sprintf("Weekly recommendations (%s) did not start: %v", kind, err))
			}
		}
	}
}

// ── handlers ───────────────────────────────────────────────────────────────

type recRunOut struct {
	ID           int64      `json:"id"`
	Status       string     `json:"status"`
	Model        string     `json:"model"`
	WebSearch    bool       `json:"web_search"`
	Error        *string    `json:"error"`
	InputTokens  *int64     `json:"input_tokens"`
	OutputTokens *int64     `json:"output_tokens"`
	WebSearches  *int64     `json:"web_searches"`
	Cost         *float64   `json:"cost"`
	StartedAt    store.Time `json:"started_at"`
	FinishedAt   store.Time `json:"finished_at"`
}

type recItemOut struct {
	ID        int64       `json:"id"`
	Book      *recBookOut `json:"book"`
	Title     string      `json:"title"`
	Author    *string     `json:"author"`
	Format    string      `json:"format"`
	Site      *string     `json:"site"`
	Reason    string      `json:"reason"`
	SourceURL *string     `json:"source_url"`
	Feedback  *string     `json:"feedback"`
}

type recBookOut struct {
	ID         string   `json:"id"`
	CoverPath  *string  `json:"cover_path"`
	SeriesName *string  `json:"series_name"`
	Sequence   *float64 `json:"series_sequence"`
	Progress   *float64 `json:"progress"`
}

type recListOut struct {
	Run     *recRunOut   `json:"run"`
	Running bool         `json:"running"`
	Items   []recItemOut `json:"items"`
}

const recRunColumns = "id, status, model, web_search, error, input_tokens, output_tokens, web_searches, cost, started_at, finished_at"

func scanRecRun(row scanner) (*recRunOut, error) {
	var r recRunOut
	err := row.Scan(&r.ID, &r.Status, &r.Model, &r.WebSearch, &r.Error, &r.InputTokens, &r.OutputTokens, &r.WebSearches, &r.Cost, &r.StartedAt, &r.FinishedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &r, err
}

func (s *Server) recList(ctx context.Context, kind string, verdicts map[string]string, bookVerdicts map[string]string) (recListOut, error) {
	out := recListOut{Running: s.recRunning(kind), Items: []recItemOut{}}
	run, err := scanRecRun(s.DB.QueryRowContext(ctx, "SELECT "+recRunColumns+" FROM recommendation_runs WHERE kind = ? ORDER BY id DESC LIMIT 1", kind))
	if err != nil {
		return out, err
	}
	out.Run = run
	// The picks shown are the last good run's, even if a later one failed.
	rows, err := s.DB.QueryContext(ctx, `
		SELECT r.id, r.book_id, r.title, r.author, r.format, r.site, r.reason, r.source_url,
			b.cover_path,
			(SELECT s.name FROM book_series bs JOIN series s ON s.id = bs.series_id WHERE bs.book_id = b.id ORDER BY bs.series_id LIMIT 1),
			(SELECT bs.sequence FROM book_series bs WHERE bs.book_id = b.id ORDER BY bs.series_id LIMIT 1),
			(SELECT max(p.progress) FROM reading_progress p WHERE p.book_id = b.id)
		FROM recommendations r
		LEFT JOIN books b ON b.id = r.book_id
		WHERE r.run_id = (SELECT max(id) FROM recommendation_runs WHERE kind = ? AND status = 'done')
		ORDER BY r.position`, kind)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var it recItemOut
		var bookID *string
		var coverPath *string
		var seriesName *string
		var seq, progress *float64
		if err := rows.Scan(&it.ID, &bookID, &it.Title, &it.Author, &it.Format, &it.Site, &it.Reason, &it.SourceURL,
			&coverPath, &seriesName, &seq, &progress); err != nil {
			return out, err
		}
		if bookID != nil {
			it.Book = &recBookOut{ID: *bookID, CoverPath: coverPath, SeriesName: seriesName, Sequence: seq, Progress: progress}
			if v, found := bookVerdicts[*bookID]; found {
				it.Feedback = &v
			}
		} else if v, found := verdicts[recommend.Key(it.Title, deref(it.Author))]; found {
			it.Feedback = &v
		}
		out.Items = append(out.Items, it)
	}
	return out, rows.Err()
}

func (s *Server) recommendationsHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	settings, err := s.recSettings(ctx)
	if err != nil {
		return err
	}
	fb, err := s.recFeedback(ctx)
	if err != nil {
		return err
	}
	verdicts := map[string]string{}
	bookVerdicts := map[string]string{}
	saved := []recFeedbackRow{}
	for _, f := range fb {
		if f.BookID != nil {
			bookVerdicts[*f.BookID] = f.Verdict
		} else {
			verdicts[f.matchKey] = f.Verdict
		}
		if f.Verdict == "saved" {
			saved = append(saved, f)
		}
	}
	readNext, err := s.recList(ctx, recReadNext, verdicts, bookVerdicts)
	if err != nil {
		return err
	}
	discover, err := s.recList(ctx, recDiscover, verdicts, bookVerdicts)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{
		"enabled":   s.openRouter() != nil,
		"settings":  settings,
		"read_next": readNext,
		"discover":  discover,
		"saved":     saved,
	})
}

func (s *Server) refreshRecommendationsHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, true)
	if err != nil {
		return err
	}
	kind := "all"
	if v := b.Str("kind", false, true); v != nil {
		kind = *v
	}
	if err := b.err(); err != nil {
		return err
	}
	var kinds []string
	switch kind {
	case "all":
		kinds = []string{recReadNext, recDiscover}
	case recReadNext, recDiscover:
		kinds = []string{kind}
	default:
		return badRequest("kind must be all, read_next or discover")
	}
	started := []string{}
	for _, k := range kinds {
		did, err := s.startRecRun(r.Context(), k)
		if err != nil {
			return err
		}
		if did {
			started = append(started, k)
		}
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"started": started})
	return nil
}

var recVerdicts = []string{"not_interested", "already_read", "not_found", "saved"}

func (s *Server) recFeedbackHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id, err := pathInt(r, "rec_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	verdict := b.Str("verdict", true, true)
	if err := b.err(); err != nil {
		return err
	}
	var it struct {
		bookID                     *string
		title                      string
		author, site, reason, link *string
		format                     string
	}
	err = s.DB.QueryRowContext(ctx, "SELECT book_id, title, author, format, site, reason, source_url FROM recommendations WHERE id = ?", id).
		Scan(&it.bookID, &it.title, &it.author, &it.format, &it.site, &it.reason, &it.link)
	if errors.Is(err, sql.ErrNoRows) {
		return notFound("Recommendation not found")
	}
	if err != nil {
		return err
	}
	key := recommend.Key(it.title, deref(it.author))
	if it.bookID != nil {
		key = "book:" + *it.bookID
	}
	if verdict == nil {
		if _, err := s.DB.ExecContext(ctx, "DELETE FROM recommendation_feedback WHERE match_key = ?", key); err != nil {
			return err
		}
		return noContent(w)
	}
	if !slices.Contains(recVerdicts, *verdict) {
		return badRequest("verdict must be one of %s", strings.Join(recVerdicts, ", "))
	}
	if it.bookID != nil && *verdict != "not_interested" {
		return badRequest("A book in the library can only be marked not interested")
	}
	_, err = s.DB.ExecContext(ctx, `INSERT INTO recommendation_feedback (match_key, book_id, title, author, format, site, reason, source_url, verdict, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (match_key) DO UPDATE SET verdict = excluded.verdict, created_at = excluded.created_at`,
		key, it.bookID, it.title, it.author, it.format, it.site, it.reason, it.link, *verdict, store.Now())
	if err != nil {
		return err
	}
	return ok(w, map[string]string{"verdict": *verdict})
}

func (s *Server) deleteRecFeedbackHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "feedback_id")
	if err != nil {
		return err
	}
	if _, err := s.DB.ExecContext(r.Context(), "DELETE FROM recommendation_feedback WHERE id = ?", id); err != nil {
		return err
	}
	return noContent(w)
}

func (s *Server) recSettingsHandler(w http.ResponseWriter, r *http.Request) error {
	settings, err := s.recSettings(r.Context())
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"enabled": s.openRouter() != nil, "settings": settings, "default_model": s.defaultRecModel()})
}

func (s *Server) defaultRecModel() string {
	if m := strings.TrimSpace(s.Config.OpenRouterModel); m != "" {
		return m
	}
	return DefaultRecommendationModel
}

func (s *Server) putRecSettingsHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	cur, err := s.recSettings(ctx)
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	model := b.Str("model", false, false)
	web := b.Bool("web_search", false, false)
	notes := b.Bool("share_notes", false, false)
	weekly := b.Bool("weekly", false, false)
	kinds := b.Str("discover_kinds", false, false)
	if err := b.err(); err != nil {
		return err
	}
	if model != nil {
		m := strings.TrimSpace(*model)
		if m == "" || strings.ContainsAny(m, " \t\n") || len(m) > 200 {
			return badRequest("Enter a model ID like %s", DefaultRecommendationModel)
		}
		cur.Model = m
	}
	if web != nil {
		cur.WebSearch = *web
	}
	if notes != nil {
		cur.ShareNotes = *notes
	}
	if weekly != nil {
		cur.Weekly = *weekly
	}
	if kinds != nil {
		switch *kinds {
		case recommend.KindBoth, recommend.KindBooks, recommend.KindWebSerials:
			cur.DiscoverKinds = *kinds
		default:
			return badRequest("discover_kinds must be both, books or web_serials")
		}
	}
	if err := s.putSetting(ctx, settingRecommendations, cur); err != nil {
		return err
	}
	return ok(w, map[string]any{"enabled": s.openRouter() != nil, "settings": cur, "default_model": s.defaultRecModel()})
}

// recModelsHandler lists OpenRouter's models (cached for an hour) for the
// model picker.
func (s *Server) recModelsHandler(w http.ResponseWriter, r *http.Request) error {
	s.recs.modelsMu.Lock()
	defer s.recs.modelsMu.Unlock()
	if s.recs.models == nil || time.Since(s.recs.modelsAt) > time.Hour {
		c := s.openRouter()
		if c == nil {
			c = &openrouter.Client{BaseURL: s.Config.OpenRouterURL, HTTP: &http.Client{Timeout: 30 * time.Second}}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		models, err := c.Models(ctx)
		if err != nil {
			if s.recs.models == nil {
				return errStatus(http.StatusBadGateway, "Could not load OpenRouter's models: "+err.Error())
			}
		} else {
			sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
			s.recs.models, s.recs.modelsAt = models, time.Now()
		}
	}
	return ok(w, map[string]any{"models": s.recs.models})
}
