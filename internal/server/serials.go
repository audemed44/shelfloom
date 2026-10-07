package server

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/audemed44/shelfloom/internal/scrapers"
	"github.com/audemed44/shelfloom/internal/store"
)

const wordsPerPage = 280

// Serial is a row of web_serials.
type Serial struct {
	ID               int64      `json:"id"`
	URL              string     `json:"url"`
	Source           string     `json:"source"`
	Title            *string    `json:"title"`
	Author           *string    `json:"author"`
	Description      *string    `json:"description"`
	CoverPath        *string    `json:"cover_path"`
	CoverURL         *string    `json:"cover_url"`
	Status           string     `json:"status"`
	TotalChapters    int64      `json:"total_chapters"`
	LiveChapterCount int64      `json:"live_chapter_count"`
	StubbedCount     int64      `json:"stubbed_chapter_count"`
	LastCheckedAt    store.Time `json:"last_checked_at"`
	LastError        *string    `json:"last_error"`
	CreatedAt        store.Time `json:"created_at"`
	SeriesID         *int64     `json:"series_id"`
	LastViewedAt     store.Time `json:"-"`
}

const serialColumns = "id, url, source, title, author, description, cover_path, cover_url, status, total_chapters, live_chapter_count, last_checked_at, last_error, created_at, series_id, last_viewed_at"

func scanSerial(row scanner) (*Serial, error) {
	var s Serial
	err := row.Scan(&s.ID, &s.URL, &s.Source, &s.Title, &s.Author, &s.Description, &s.CoverPath, &s.CoverURL, &s.Status,
		&s.TotalChapters, &s.LiveChapterCount, &s.LastCheckedAt, &s.LastError, &s.CreatedAt, &s.SeriesID, &s.LastViewedAt)
	if err != nil {
		return nil, err
	}
	s.StubbedCount = max(s.TotalChapters-s.LiveChapterCount, 0)
	return &s, nil
}

func getSerial(ctx context.Context, q querier, id int64) (*Serial, error) {
	s, err := scanSerial(q.QueryRowContext(ctx, "SELECT "+serialColumns+" FROM web_serials WHERE id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("Serial %d not found", id)
	}
	return s, err
}

func querySerials(ctx context.Context, q querier, query string, args ...any) ([]*Serial, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Serial
	for rows.Next() {
		s, err := scanSerial(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// Chapter is a row of serial_chapters without its content.
type Chapter struct {
	ID            int64
	SerialID      int64
	ChapterNumber int64
	SourceKey     string
	Title         *string
	SourceURL     string
	PublishDate   store.Time
	WordCount     *int64
	FetchedAt     store.Time
	IsStubbed     bool
	StubbedAt     store.Time
	HasContent    bool
}

const chapterColumns = "id, serial_id, chapter_number, source_key, title, source_url, publish_date, word_count, fetched_at, is_stubbed, stubbed_at, content IS NOT NULL"

func scanChapter(row scanner) (*Chapter, error) {
	var c Chapter
	err := row.Scan(&c.ID, &c.SerialID, &c.ChapterNumber, &c.SourceKey, &c.Title, &c.SourceURL, &c.PublishDate, &c.WordCount, &c.FetchedAt, &c.IsStubbed, &c.StubbedAt, &c.HasContent)
	return &c, err
}

func queryChapters(ctx context.Context, q querier, query string, args ...any) ([]*Chapter, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Chapter
	for rows.Next() {
		c, err := scanChapter(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func requireSerial(ctx context.Context, q querier, id int64) error {
	var x int64
	err := q.QueryRowContext(ctx, "SELECT id FROM web_serials WHERE id = ?", id).Scan(&x)
	if errors.Is(err, sql.ErrNoRows) {
		return notFound("Serial %d not found", id)
	}
	return err
}

// Volume is a row of serial_volumes.
type Volume struct {
	ID            int64      `json:"id"`
	SerialID      int64      `json:"serial_id"`
	BookID        *string    `json:"book_id"`
	VolumeNumber  int64      `json:"volume_number"`
	Kind          string     `json:"kind"`
	Name          *string    `json:"name"`
	CoverPath     *string    `json:"cover_path"`
	ChapterStart  *int64     `json:"chapter_start"`
	ChapterEnd    *int64     `json:"chapter_end"`
	GeneratedAt   store.Time `json:"generated_at"`
	IsStale       bool       `json:"is_stale"`
	ChapterCount  int64      `json:"chapter_count"`
	FetchedCount  int64      `json:"fetched_chapter_count"`
	IsPartial     bool       `json:"is_partial"`
	StubbedMiss   int64      `json:"stubbed_missing_count"`
	EstimatedPage *int64     `json:"estimated_pages"`
	TotalWords    *int64     `json:"total_words"`
}

const volumeColumns = "id, serial_id, book_id, volume_number, kind, name, cover_path, chapter_start, chapter_end, generated_at, is_stale"

func scanVolume(row scanner) (*Volume, error) {
	var v Volume
	err := row.Scan(&v.ID, &v.SerialID, &v.BookID, &v.VolumeNumber, &v.Kind, &v.Name, &v.CoverPath, &v.ChapterStart, &v.ChapterEnd, &v.GeneratedAt, &v.IsStale)
	return &v, err
}

func listVolumes(ctx context.Context, q querier, serialID int64) ([]*Volume, error) {
	rows, err := q.QueryContext(ctx, "SELECT "+volumeColumns+" FROM serial_volumes WHERE serial_id = ? ORDER BY volume_number", serialID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Volume
	for rows.Next() {
		v, err := scanVolume(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func getVolume(ctx context.Context, q querier, serialID, volumeID int64) (*Volume, error) {
	v, err := scanVolume(q.QueryRowContext(ctx, "SELECT "+volumeColumns+" FROM serial_volumes WHERE id = ? AND serial_id = ?", volumeID, serialID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("Volume %d not found for serial %d", volumeID, serialID)
	}
	return v, err
}

func estimatePages(words *int64) *int64 {
	if words == nil || *words <= 0 {
		return nil
	}
	p := max(1, *words/wordsPerPage)
	return &p
}

type chapterStat struct {
	words      *int64
	hasContent bool
	stubbed    bool
}

func chapterStats(ctx context.Context, q querier, serialID, from, to int64) (map[int64]chapterStat, error) {
	rows, err := q.QueryContext(ctx, "SELECT chapter_number, word_count, content IS NOT NULL, is_stubbed FROM serial_chapters WHERE serial_id = ? AND chapter_number >= ? AND chapter_number <= ? ORDER BY chapter_number", serialID, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]chapterStat{}
	for rows.Next() {
		var n int64
		var c chapterStat
		if err := rows.Scan(&n, &c.words, &c.hasContent, &c.stubbed); err != nil {
			return nil, err
		}
		out[n] = c
	}
	return out, rows.Err()
}

// rangeMetrics measures chapters start..end: words, fetched count, whether
// any are missing and how many of those were removed upstream.
func rangeMetrics(stats map[int64]chapterStat, start, end int64) (words, fetched int64, partial bool, stubbedMissing int64) {
	for n := start; n <= end; n++ {
		c, found := stats[n]
		if !found || c.words == nil {
			partial = true
			if found && c.stubbed && !c.hasContent {
				stubbedMissing++
			}
			continue
		}
		fetched++
		words += *c.words
	}
	return
}

// withMetrics fills the derived fields of volumes (get_volume_metrics and
// the router's _enrich_volumes).
func withMetrics(ctx context.Context, q querier, serialID int64, vols []*Volume) error {
	all, err := listVolumes(ctx, q, serialID)
	if err != nil {
		return err
	}
	var generated []*Volume
	minCh, maxCh := int64(1<<62), int64(-1)
	for _, v := range all {
		if v.Kind == "ebook" || v.ChapterStart == nil || v.ChapterEnd == nil {
			continue
		}
		generated = append(generated, v)
		minCh, maxCh = min(minCh, *v.ChapterStart), max(maxCh, *v.ChapterEnd)
	}
	stats := map[int64]chapterStat{}
	if len(generated) > 0 {
		if stats, err = chapterStats(ctx, q, serialID, minCh, maxCh); err != nil {
			return err
		}
	}
	known := map[int64]bool{}
	for _, v := range all {
		known[v.ID] = true
	}
	for _, v := range vols {
		if !known[v.ID] {
			continue
		}
		if v.Kind == "ebook" || v.ChapterStart == nil || v.ChapterEnd == nil {
			count := int64(0)
			if v.ChapterStart != nil && v.ChapterEnd != nil {
				count = *v.ChapterEnd - *v.ChapterStart + 1
			}
			v.ChapterCount, v.TotalWords, v.FetchedCount, v.IsPartial, v.StubbedMiss = max(0, count), ptr(int64(0)), 0, false, 0
			v.EstimatedPage = nil
			continue
		}
		words, fetched, partial, stubbed := rangeMetrics(stats, *v.ChapterStart, *v.ChapterEnd)
		v.TotalWords = &words
		v.EstimatedPage = estimatePages(&words)
		v.ChapterCount = max(0, *v.ChapterEnd-*v.ChapterStart+1)
		v.FetchedCount, v.IsPartial, v.StubbedMiss = fetched, partial, stubbed
	}
	return nil
}

// ── handlers: serials ─────────────────────────────────────────────────────────

func (s *Server) serialAdaptersHandler(w http.ResponseWriter, r *http.Request) error {
	return ok(w, scrapers.Names())
}

func (s *Server) detectAdapterHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	u := q.Required("url")
	if err := q.err(); err != nil {
		return err
	}
	var name *string
	if a := scrapers.ForURL(u); a != nil {
		n := a.Name()
		name = &n
	}
	return ok(w, map[string]any{"adapter": name})
}

func (s *Server) listSerialsHandler(w http.ResponseWriter, r *http.Request) error {
	list, err := querySerials(r.Context(), s.DB, "SELECT "+serialColumns+" FROM web_serials ORDER BY created_at DESC")
	if err != nil {
		return err
	}
	if list == nil {
		list = []*Serial{}
	}
	return ok(w, list)
}

func (s *Server) getSerialHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	sr, err := getSerial(r.Context(), s.DB, id)
	if err != nil {
		return err
	}
	return ok(w, sr)
}

func (s *Server) updateSerialHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	fields := map[string]*string{}
	for _, k := range []string{"title", "author", "description", "status"} {
		fields[k] = b.Str(k, false, true)
	}
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := getSerial(ctx, s.DB, id); err != nil {
		return err
	}
	var sets []string
	var args []any
	for _, k := range []string{"title", "author", "description", "status"} {
		if v := fields[k]; v != nil {
			sets, args = append(sets, k+" = ?"), append(args, *v)
		}
	}
	if len(sets) > 0 {
		if _, err := s.DB.ExecContext(ctx, "UPDATE web_serials SET "+strings.Join(sets, ", ")+" WHERE id = ?", append(args, id)...); err != nil {
			return err
		}
	}
	sr, err := getSerial(ctx, s.DB, id)
	if err != nil {
		return err
	}
	return ok(w, sr)
}

func (s *Server) serialCoverHandler(w http.ResponseWriter, r *http.Request) error {
	noStore := http.Header{"Cache-Control": {"no-store"}}
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	sr, err := getSerial(r.Context(), s.DB, id)
	if err != nil {
		if he, isHTTP := err.(*httpError); isHTTP {
			he.header = noStore
		}
		return err
	}
	if sr.CoverPath == nil || !fileExists(*sr.CoverPath) {
		return &httpError{status: http.StatusNotFound, detail: "No cover available", header: noStore}
	}
	w.Header().Set("Cache-Control", "no-store")
	return serveFile(w, r, *sr.CoverPath, "image/jpeg", "")
}

// uploadSuffix is the router's suffix logic: the file name's extension, or
// .jpg.
func uploadSuffix(name string) string {
	if name != "" && strings.Contains(name, ".") {
		return "." + name[strings.LastIndex(name, ".")+1:]
	}
	return ".jpg"
}

func (s *Server) uploadSerialCoverHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	name, _, data, err := readUpload(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := getSerial(ctx, s.DB, id); err != nil {
		return err
	}
	dest := filepath.Join(s.Config.CoversDir, "serial_"+itoa64(id)+uploadSuffix(name))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		return err
	}
	if _, err := s.DB.ExecContext(ctx, "UPDATE web_serials SET cover_path = ? WHERE id = ?", dest, id); err != nil {
		return err
	}
	sr, err := getSerial(ctx, s.DB, id)
	if err != nil {
		return err
	}
	return ok(w, sr)
}

func (s *Server) refreshSerialCoverHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	sr, err := getSerial(ctx, s.DB, id)
	if err != nil {
		return err
	}
	if sr.CoverURL == nil {
		return badRequest("Serial has no cover_url to refresh from")
	}
	suffix := strings.ToLower(filepath.Ext(strings.SplitN(*sr.CoverURL, "?", 2)[0]))
	if ext := filepath.Ext(strings.SplitN(*sr.CoverURL, "?", 2)[0]); ext != "" && !strings.Contains(ext, "/") {
		suffix = ext
	} else {
		suffix = ".jpg"
	}
	dest := filepath.Join(s.Config.CoversDir, "serial_"+itoa64(id)+suffix)
	downloadCover(ctx, *sr.CoverURL, dest)
	if _, err := s.DB.ExecContext(ctx, "UPDATE web_serials SET cover_path = ? WHERE id = ?", dest, id); err != nil {
		return err
	}
	sr, err = getSerial(ctx, s.DB, id)
	if err != nil {
		return err
	}
	return ok(w, sr)
}

func (s *Server) deleteSerialHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	q := newQuery(r)
	deleteFiles := q.BoolDefault("delete_files", false)
	if err := q.err(); err != nil {
		return err
	}
	ctx := r.Context()
	sr, err := getSerial(ctx, s.DB, id)
	if err != nil {
		return err
	}
	if deleteFiles && sr.CoverPath != nil && *sr.CoverPath != "" {
		os.Remove(*sr.CoverPath)
	}
	if _, err := s.DB.ExecContext(ctx, "DELETE FROM web_serials WHERE id = ?", id); err != nil {
		return err
	}
	return noContent(w)
}

func (s *Server) acknowledgeSerialHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	res, err := s.DB.ExecContext(r.Context(), "UPDATE web_serials SET last_viewed_at = ? WHERE id = ?", store.Now(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return notFound("Serial %d not found", id)
	}
	return noContent(w)
}

type dashboardEntry struct {
	ID                 int64      `json:"id"`
	Title              *string    `json:"title"`
	Author             *string    `json:"author"`
	CoverPath          *string    `json:"cover_path"`
	Status             string     `json:"status"`
	TotalChapters      int64      `json:"total_chapters"`
	LiveChapterCount   int64      `json:"live_chapter_count"`
	StubbedCount       int64      `json:"stubbed_chapter_count"`
	FetchedCount       int64      `json:"fetched_count"`
	NewChapterCount    int64      `json:"new_chapter_count"`
	LatestChapterTitle *string    `json:"latest_chapter_title"`
	LatestChapterDate  store.Time `json:"latest_chapter_date"`
	LastCheckedAt      store.Time `json:"last_checked_at"`
	FetchState         string     `json:"fetch_state"`
}

func (s *Server) serialsDashboardHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	serials, err := querySerials(ctx, s.DB, "SELECT "+serialColumns+" FROM web_serials WHERE status IN ('ongoing', 'error') ORDER BY last_checked_at DESC NULLS LAST")
	if err != nil {
		return err
	}
	out := []dashboardEntry{}
	if len(serials) == 0 {
		return ok(w, out)
	}
	ids := make([]any, len(serials))
	for i, sr := range serials {
		ids[i] = sr.ID
	}
	in := "(" + placeholders(len(ids)) + ")"
	counts := func(query string) (map[int64]int64, error) {
		rows, err := s.DB.QueryContext(ctx, query, ids...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		m := map[int64]int64{}
		for rows.Next() {
			var id, n int64
			if err := rows.Scan(&id, &n); err != nil {
				return nil, err
			}
			m[id] = n
		}
		return m, rows.Err()
	}
	newCounts, err := counts("SELECT serial_chapters.serial_id, count(*) FROM serial_chapters JOIN web_serials ON web_serials.id = serial_chapters.serial_id WHERE serial_chapters.serial_id IN " + in + " AND serial_chapters.is_stubbed IS 0 AND (web_serials.last_viewed_at IS NULL OR serial_chapters.publish_date > web_serials.last_viewed_at) GROUP BY serial_chapters.serial_id")
	if err != nil {
		return err
	}
	fetched, err := counts("SELECT serial_chapters.serial_id, count(*) FROM serial_chapters WHERE serial_chapters.serial_id IN " + in + " AND serial_chapters.content IS NOT NULL GROUP BY serial_chapters.serial_id")
	if err != nil {
		return err
	}
	type latest struct {
		title *string
		date  store.Time
	}
	latestBy := map[int64]latest{}
	rows, err := s.DB.QueryContext(ctx, "SELECT serial_chapters.serial_id, serial_chapters.title, serial_chapters.publish_date FROM serial_chapters JOIN (SELECT serial_chapters.serial_id AS serial_id, max(serial_chapters.chapter_number) AS chapter_number FROM serial_chapters WHERE serial_chapters.serial_id IN "+in+" AND serial_chapters.is_stubbed IS 0 GROUP BY serial_chapters.serial_id) AS anon_1 ON serial_chapters.serial_id = anon_1.serial_id AND serial_chapters.chapter_number = anon_1.chapter_number", ids...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id int64
		var l latest
		if err := rows.Scan(&id, &l.title, &l.date); err != nil {
			rows.Close()
			return err
		}
		latestBy[id] = l
	}
	rows.Close()
	for _, sr := range serials {
		l := latestBy[sr.ID]
		out = append(out, dashboardEntry{
			ID: sr.ID, Title: sr.Title, Author: sr.Author, CoverPath: sr.CoverPath, Status: sr.Status,
			TotalChapters: sr.TotalChapters, LiveChapterCount: sr.LiveChapterCount, StubbedCount: sr.StubbedCount,
			FetchedCount: fetched[sr.ID], NewChapterCount: newCounts[sr.ID],
			LatestChapterTitle: l.title, LatestChapterDate: l.date, LastCheckedAt: sr.LastCheckedAt,
			FetchState: s.fetches.state(sr.ID),
		})
	}
	return ok(w, out)
}

// ── chapters ──────────────────────────────────────────────────────────────────

type chapterResponse struct {
	ID                    int64      `json:"id"`
	SerialID              int64      `json:"serial_id"`
	ChapterNumber         int64      `json:"chapter_number"`
	Title                 *string    `json:"title"`
	SourceURL             string     `json:"source_url"`
	IsStubbed             bool       `json:"is_stubbed"`
	StubbedAt             store.Time `json:"stubbed_at"`
	PublishDate           store.Time `json:"publish_date"`
	WordCount             *int64     `json:"word_count"`
	EstimatedPages        *int64     `json:"estimated_pages"`
	RunningWordCount      int64      `json:"running_word_count"`
	RunningEstimatedPages *int64     `json:"running_estimated_pages"`
	RunningIsPartial      bool       `json:"running_is_partial"`
	FetchedAt             store.Time `json:"fetched_at"`
	HasContent            bool       `json:"has_content"`
}

func (s *Server) listChaptersHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	q := newQuery(r)
	offset := q.IntRange("offset", 0, 0, 1<<62)
	limit := q.IntRange("limit", 100, 1, 500)
	if err := q.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if err := requireSerial(ctx, s.DB, id); err != nil {
		return err
	}
	chapters, err := queryChapters(ctx, s.DB, "SELECT "+chapterColumns+" FROM serial_chapters WHERE serial_id = ? ORDER BY chapter_number LIMIT ?", id, offset+limit)
	if err != nil {
		return err
	}
	out := []chapterResponse{}
	var running int64
	partial := false
	for i, c := range chapters {
		if c.WordCount == nil {
			partial = true
		} else {
			running += *c.WordCount
		}
		if int64(i) < offset {
			continue
		}
		rw := running
		out = append(out, chapterResponse{
			ID: c.ID, SerialID: c.SerialID, ChapterNumber: c.ChapterNumber, Title: c.Title, SourceURL: c.SourceURL,
			IsStubbed: c.IsStubbed, StubbedAt: c.StubbedAt, PublishDate: c.PublishDate, WordCount: c.WordCount,
			EstimatedPages: estimatePages(c.WordCount), RunningWordCount: rw, RunningEstimatedPages: estimatePages(&rw),
			RunningIsPartial: partial, FetchedAt: c.FetchedAt, HasContent: c.HasContent,
		})
	}
	return ok(w, out)
}

func itoa64(n int64) string {
	return strconv.FormatInt(n, 10)
}
