package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/audemed44/shelfloom/internal/scrapers"
	"github.com/audemed44/shelfloom/internal/store"
)

const (
	fetchLogLimit     = 100
	fetchJobRetention = 300 * time.Second
)

type fetchLog struct {
	Timestamp     store.UTCTime `json:"timestamp"`
	Level         string        `json:"level"`
	Message       string        `json:"message"`
	ChapterNumber *int64        `json:"chapter_number"`
}

// fetchJob is a running or finished chapter fetch for one serial.
type fetchJob struct {
	SerialID     int64         `json:"serial_id"`
	State        string        `json:"state"`
	Start        int64         `json:"start"`
	End          int64         `json:"end"`
	Total        int64         `json:"total"`
	Processed    int64         `json:"processed"`
	Fetched      int64         `json:"fetched"`
	Skipped      int64         `json:"skipped"`
	Failed       int64         `json:"failed"`
	CurrentNum   *int64        `json:"current_chapter_number"`
	CurrentTitle *string       `json:"current_chapter_title"`
	StartedAt    store.UTCTime `json:"started_at"`
	FinishedAt   store.UTCTime `json:"finished_at"`
	Logs         []fetchLog    `json:"logs"`
	Error        *string       `json:"error"`
	numbers      []int64
	done         chan struct{}
}

// batchJob is the "fetch all pending chapters" run across serials.
type batchJob struct {
	State           string        `json:"state"`
	TotalSerials    int           `json:"total_serials"`
	ProcessedSerial int           `json:"processed_serials"`
	CurrentSerialID *int64        `json:"current_serial_id"`
	Started         int           `json:"started"`
	AlreadyRunning  int           `json:"already_running"`
	Noop            int           `json:"noop"`
	Failed          int           `json:"failed"`
	NewChapters     int64         `json:"new_chapters"`
	StartedAt       store.UTCTime `json:"started_at"`
	FinishedAt      store.UTCTime `json:"finished_at"`
	Error           *string       `json:"error"`
}

type fetchJobs struct {
	mu    sync.Mutex
	jobs  map[int64]*fetchJob
	batch *batchJob
}

func expired(state string, finished store.UTCTime) bool {
	return state != "running" && finished.Valid && time.Since(finished.Time) > fetchJobRetention
}

// get returns the job for a serial (dropping it once it has expired).
// Callers hold mu.
func (f *fetchJobs) get(id int64) *fetchJob {
	if f.jobs == nil {
		f.jobs = map[int64]*fetchJob{}
	}
	j := f.jobs[id]
	if j != nil && expired(j.State, j.FinishedAt) {
		delete(f.jobs, id)
		return nil
	}
	return j
}

func (f *fetchJobs) state(id int64) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	if j := f.get(id); j != nil {
		return j.State
	}
	return "idle"
}

func (f *fetchJobs) currentBatch() *batchJob {
	if f.batch != nil && expired(f.batch.State, f.batch.FinishedAt) {
		f.batch = nil
	}
	return f.batch
}

var (
	errFetchRunning = errors.New("fetch running")
	errBatchBusy    = errors.New("batch busy")
)

// ensureNoConflictingBatch fails when a pending batch is busy with another serial.
func (s *Server) ensureNoConflictingBatch(id int64) error {
	s.fetches.mu.Lock()
	defer s.fetches.mu.Unlock()
	b := s.fetches.currentBatch()
	if b == nil || b.State != "running" || (b.CurrentSerialID != nil && *b.CurrentSerialID == id) {
		return nil
	}
	return conflict("A pending chapter batch is already running")
}

func (s *Server) ensureNoRunningFetch(id int64) error {
	s.fetches.mu.Lock()
	defer s.fetches.mu.Unlock()
	if j := s.fetches.get(id); j != nil && j.State == "running" {
		return conflict("A chapter fetch is already running for serial %d", id)
	}
	return nil
}

func (j *fetchJob) log(level, msg string, chapter *int64) {
	j.Logs = append(j.Logs, fetchLog{Timestamp: store.UTCNow(), Level: level, Message: msg, ChapterNumber: chapter})
	if len(j.Logs) > fetchLogLimit {
		j.Logs = j.Logs[len(j.Logs)-fetchLogLimit:]
	}
}

func chapterLabel(c *Chapter) string {
	if c.Title != nil && *c.Title != "" {
		return fmt.Sprintf("chapter %d \"%s\"", c.ChapterNumber, *c.Title)
	}
	return fmt.Sprintf("chapter %d", c.ChapterNumber)
}

// scheduleFetch starts a background fetch of chapters start..end (or just
// numbers) for a serial.
func (s *Server) scheduleFetch(id, start, end, total int64, numbers []int64) (*fetchJob, error) {
	s.fetches.mu.Lock()
	if j := s.fetches.get(id); j != nil && j.State == "running" {
		s.fetches.mu.Unlock()
		return nil, conflict("A chapter fetch is already running for serial %d", id)
	}
	job := &fetchJob{SerialID: id, State: "running", Start: start, End: end, Total: total, StartedAt: store.UTCNow(), Logs: []fetchLog{}, numbers: numbers, done: make(chan struct{})}
	s.fetches.jobs[id] = job
	s.fetches.mu.Unlock()
	s.bg.Add(1)
	go func() {
		defer s.bg.Done()
		defer close(job.done)
		err := s.fetchChapterContents(s.bgCtx, id, start, end, numbers, job)
		s.fetches.mu.Lock()
		defer s.fetches.mu.Unlock()
		job.FinishedAt = store.UTCNow()
		job.CurrentNum, job.CurrentTitle = nil, nil
		if err != nil {
			slog.Error(fmt.Sprintf("Chapter fetch job failed for serial %d: %v", id, err))
			msg := err.Error()
			job.State, job.Error = "error", &msg
			job.log("error", msg, nil)
			return
		}
		job.State = "completed"
		job.log("info", "Finished fetching requested chapter range", nil)
	}()
	return job, nil
}

// fetchChapterContents downloads the chapters that have no content yet,
// one at a time, storing each before fetching the next. job may be nil.
func (s *Server) fetchChapterContents(ctx context.Context, id, start, end int64, numbers []int64, job *fetchJob) error {
	sr, err := getSerial(ctx, s.DB, id)
	if err != nil {
		return err
	}
	adapter := scrapers.ByName(sr.Source)
	if adapter == nil {
		return unprocessable("No adapter named '%s' for serial URL: '%s'", sr.Source, sr.URL)
	}
	var chapters []*Chapter
	if numbers == nil {
		chapters, err = queryChapters(ctx, s.DB, "SELECT "+chapterColumns+" FROM serial_chapters WHERE serial_id = ? AND chapter_number >= ? AND chapter_number <= ? ORDER BY chapter_number", id, start, end)
	} else {
		chapters, err = queryChapters(ctx, s.DB, "SELECT "+chapterColumns+" FROM serial_chapters WHERE serial_id = ? AND chapter_number IN ("+placeholders(len(numbers))+") ORDER BY chapter_number", append([]any{id}, anySlice(numbers)...)...)
	}
	if err != nil {
		return err
	}
	slog.Info(fmt.Sprintf("Fetching content for chapters %d–%d of serial %d (%d to fetch)", start, end, id, len(chapters)))
	update := func(fn func(j *fetchJob)) {
		if job == nil {
			return
		}
		s.fetches.mu.Lock()
		defer s.fetches.mu.Unlock()
		fn(job)
	}
	update(func(j *fetchJob) {
		j.log("info", fmt.Sprintf("Started fetching chapters %d-%d for serial %d", j.Start, j.End, j.SerialID), nil)
	})
	var newly []int64
	for _, c := range chapters {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		num := c.ChapterNumber
		if c.HasContent {
			update(func(j *fetchJob) {
				j.Processed++
				j.Skipped++
				j.CurrentNum, j.CurrentTitle = nil, nil
				j.log("info", "Skipped "+chapterLabel(c)+"; content already present", &num)
			})
			continue
		}
		if c.IsStubbed {
			msg := "chapter is stubbed upstream and has no cached content"
			slog.Warn(fmt.Sprintf("Skipping stubbed chapter %d: %s", num, msg))
			update(func(j *fetchJob) {
				j.Processed++
				j.Failed++
				j.CurrentNum, j.CurrentTitle = nil, nil
				j.log("warning", "Failed to fetch "+chapterLabel(c)+": "+msg, &num)
			})
			continue
		}
		slog.Info(fmt.Sprintf("Fetching chapter %d: %s", num, c.SourceURL))
		update(func(j *fetchJob) {
			j.CurrentNum, j.CurrentTitle = &num, c.Title
			j.log("info", "Fetching "+chapterLabel(c), &num)
		})
		content, err := adapter.FetchChapterContent(ctx, c.SourceURL)
		if err == nil {
			title := c.Title
			if (title == nil || *title == "") && content.Title != nil && *content.Title != "" {
				title = content.Title
			}
			_, err = s.DB.ExecContext(ctx, "UPDATE serial_chapters SET content = ?, word_count = ?, fetched_at = ?, title = ? WHERE id = ?",
				content.HTML, content.WordCount, store.Now(), title, c.ID)
			if err == nil {
				c.Title = title
				wc := int64(content.WordCount)
				c.WordCount = &wc
				newly = append(newly, num)
				update(func(j *fetchJob) {
					j.Processed++
					j.Fetched++
					j.CurrentNum, j.CurrentTitle = nil, nil
					j.log("info", fmt.Sprintf("Fetched %s (%d words)", chapterLabel(c), content.WordCount), &num)
				})
				slog.Info(fmt.Sprintf("Chapter %d fetched (%d words)", num, content.WordCount))
				continue
			}
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		slog.Warn(fmt.Sprintf("Failed to fetch chapter %d: %v", num, err))
		if _, dbErr := s.DB.ExecContext(ctx, "UPDATE web_serials SET last_error = ?, status = 'error' WHERE id = ?", err.Error(), id); dbErr != nil {
			return dbErr
		}
		update(func(j *fetchJob) {
			j.Processed++
			j.Failed++
			j.CurrentNum, j.CurrentTitle = nil, nil
			j.log("warning", "Failed to fetch "+chapterLabel(c)+": "+err.Error(), &num)
		})
	}
	if len(newly) > 0 {
		return markVolumesStale(ctx, s.DB, id, newly)
	}
	return nil
}

// markVolumesStale flags generated volumes that cover changed chapters.
func markVolumesStale(ctx context.Context, q querier, serialID int64, changed []int64) error {
	if len(changed) == 0 {
		return nil
	}
	vols, err := listVolumes(ctx, q, serialID)
	if err != nil {
		return err
	}
	for _, v := range vols {
		if !v.GeneratedAt.Valid || v.Kind != "generated" || v.ChapterStart == nil || v.ChapterEnd == nil {
			continue
		}
		for _, n := range changed {
			if *v.ChapterStart <= n && n <= *v.ChapterEnd {
				if _, err := q.ExecContext(ctx, "UPDATE serial_volumes SET is_stale = 1 WHERE id = ?", v.ID); err != nil {
					return err
				}
				break
			}
		}
	}
	return nil
}

// syncChapterList merges a fresh chapter list into the stored one: new
// chapters are numbered after the last, chapters gone upstream are marked
// stubbed (and keep their content), returning ones are unmarked.
func syncChapterList(ctx context.Context, tx *sql.Tx, sr *Serial, remote []scrapers.ChapterInfo) (int64, []int64, error) {
	existing, err := queryChapters(ctx, tx, "SELECT "+chapterColumns+" FROM serial_chapters WHERE serial_id = ? ORDER BY chapter_number", sr.ID)
	if err != nil {
		return 0, nil, err
	}
	byKey := map[string]*Chapter{}
	next := int64(0)
	for _, c := range existing {
		byKey[c.SourceKey] = c
		next = max(next, c.ChapterNumber)
	}
	next++
	now := store.Now()
	seen := map[string]bool{}
	var changed []int64
	var newCount int64
	for _, rc := range remote {
		key := scrapers.NormalizeURL(rc.SourceURL)
		if seen[key] {
			continue
		}
		seen[key] = true
		var pub store.Time
		if rc.PublishDate != nil {
			pub = store.T(*rc.PublishDate)
		}
		c := byKey[key]
		if c == nil {
			if _, err := tx.ExecContext(ctx, "INSERT INTO serial_chapters (serial_id, chapter_number, source_key, title, source_url, publish_date, is_stubbed) VALUES (?, ?, ?, ?, ?, ?, 0)",
				sr.ID, next, key, rc.Title, rc.SourceURL, pub); err != nil {
				return 0, nil, err
			}
			changed = append(changed, next)
			next++
			newCount++
			continue
		}
		if c.IsStubbed {
			changed = append(changed, c.ChapterNumber)
			if _, err := tx.ExecContext(ctx, "UPDATE serial_chapters SET title = ?, source_url = ?, publish_date = ?, is_stubbed = 0, stubbed_at = NULL WHERE id = ?", rc.Title, rc.SourceURL, pub, c.ID); err != nil {
				return 0, nil, err
			}
		} else if _, err := tx.ExecContext(ctx, "UPDATE serial_chapters SET title = ?, source_url = ?, publish_date = ? WHERE id = ?", rc.Title, rc.SourceURL, pub, c.ID); err != nil {
			return 0, nil, err
		}
	}
	var live int64
	for _, c := range existing {
		if seen[c.SourceKey] {
			live++
			continue
		}
		if !c.IsStubbed {
			if _, err := tx.ExecContext(ctx, "UPDATE serial_chapters SET is_stubbed = 1, stubbed_at = ? WHERE id = ?", now, c.ID); err != nil {
				return 0, nil, err
			}
			changed = append(changed, c.ChapterNumber)
		}
	}
	if _, err := tx.ExecContext(ctx, "UPDATE web_serials SET total_chapters = ?, live_chapter_count = ? WHERE id = ?", max(next-1, 0), live+newCount, sr.ID); err != nil {
		return 0, nil, err
	}
	return newCount, changed, nil
}

// updateFromSource refreshes a serial's chapter list.
func (s *Server) updateFromSource(ctx context.Context, id int64) (int64, int64, error) {
	sr, err := getSerial(ctx, s.DB, id)
	if err != nil {
		return 0, 0, err
	}
	adapter := scrapers.ByName(sr.Source)
	if adapter == nil {
		return 0, 0, unprocessable("No adapter named '%s' for serial URL: '%s'", sr.Source, sr.URL)
	}
	remote, err := adapter.FetchChapterList(ctx, sr.URL)
	if err != nil {
		if _, dbErr := s.DB.ExecContext(ctx, "UPDATE web_serials SET last_error = ?, status = 'error' WHERE id = ?", err.Error(), id); dbErr != nil {
			return 0, 0, dbErr
		}
		return 0, 0, unprocessable("%s", err.Error())
	}
	var newCount int64
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		var changed []int64
		var err error
		if newCount, changed, err = syncChapterList(ctx, tx, sr, remote); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE web_serials SET last_checked_at = ?, last_error = NULL, status = CASE WHEN status = 'error' THEN 'ongoing' ELSE status END WHERE id = ?", store.Now(), id); err != nil {
			return err
		}
		return markVolumesStale(ctx, tx, id, changed)
	})
	if err != nil {
		return 0, 0, err
	}
	var total int64
	s.DB.QueryRowContext(ctx, "SELECT total_chapters FROM web_serials WHERE id = ?", id).Scan(&total)
	return newCount, total, nil
}

// checkSerial is check_serial_for_updates: errors are recorded on the serial.
func (s *Server) checkSerial(ctx context.Context, sr *Serial) int64 {
	adapter := scrapers.ByName(sr.Source)
	if adapter == nil {
		s.DB.ExecContext(ctx, "UPDATE web_serials SET status = 'error', last_error = ?, last_checked_at = ? WHERE id = ?", fmt.Sprintf("No adapter named '%s'", sr.Source), store.Now(), sr.ID)
		return 0
	}
	remote, err := adapter.FetchChapterList(ctx, sr.URL)
	if err != nil {
		s.DB.ExecContext(ctx, "UPDATE web_serials SET status = 'error', last_error = ?, last_checked_at = ? WHERE id = ?", err.Error(), store.Now(), sr.ID)
		slog.Warn(fmt.Sprintf("Failed to fetch chapter list for serial %d: %v", sr.ID, err))
		return 0
	}
	var newCount int64
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		var changed []int64
		var err error
		if newCount, changed, err = syncChapterList(ctx, tx, sr, remote); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE web_serials SET last_checked_at = ?, last_error = NULL, status = CASE WHEN status = 'error' THEN 'ongoing' ELSE status END WHERE id = ?", store.Now(), sr.ID); err != nil {
			return err
		}
		return markVolumesStale(ctx, tx, sr.ID, changed)
	})
	if err != nil {
		slog.Error("serial check failed", "serial", sr.ID, "err", err)
		return 0
	}
	if newCount > 0 {
		slog.Info(fmt.Sprintf("Serial %d (%s): found %d new chapters", sr.ID, deref(sr.Title), newCount))
	}
	return newCount
}

// checkAllSerials checks every ongoing serial for new chapters.
func (s *Server) checkAllSerials(ctx context.Context) (int, int64, error) {
	serials, err := querySerials(ctx, s.DB, "SELECT "+serialColumns+" FROM web_serials WHERE status = 'ongoing'")
	if err != nil {
		return 0, 0, err
	}
	var total int64
	for _, sr := range serials {
		if ctx.Err() != nil {
			return len(serials), total, ctx.Err()
		}
		fresh, err := getSerial(ctx, s.DB, sr.ID)
		if err != nil {
			continue
		}
		total += s.checkSerial(ctx, fresh)
	}
	return len(serials), total, nil
}

func (s *Server) checkUpdatesHandler(w http.ResponseWriter, r *http.Request) error {
	checked, found, err := s.checkAllSerials(r.Context())
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"checked": checked, "new_chapters": found})
}

func (s *Server) updateFromSourceHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	newCount, total, err := s.updateFromSource(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"new_chapters": newCount, "total_chapters": total})
}

func jobResponse(j *fetchJob) map[string]any {
	return map[string]any{"serial_id": j.SerialID, "state": j.State, "start": j.Start, "end": j.End, "total": j.Total, "started_at": j.StartedAt}
}

func (s *Server) fetchChaptersHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	start := b.Int("start", true, false)
	end := b.Int("end", true, false)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if err := s.ensureNoConflictingBatch(id); err != nil {
		return err
	}
	sr, err := getSerial(ctx, s.DB, id)
	if err != nil {
		return err
	}
	if scrapers.ByName(sr.Source) == nil {
		return unprocessable("No adapter named '%s' for serial URL: '%s'", sr.Source, sr.URL)
	}
	var total int64
	if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM serial_chapters WHERE serial_id = ? AND chapter_number >= ? AND chapter_number <= ?", id, *start, *end).Scan(&total); err != nil {
		return err
	}
	job, err := s.scheduleFetch(id, *start, *end, total, nil)
	if err != nil {
		return err
	}
	s.fetches.mu.Lock()
	resp := jobResponse(job)
	s.fetches.mu.Unlock()
	writeJSON(w, http.StatusAccepted, resp)
	return nil
}

func pendingNumbers(ctx context.Context, q querier, id int64) ([]int64, error) {
	rows, err := q.QueryContext(ctx, "SELECT chapter_number FROM serial_chapters WHERE serial_id = ? AND content IS NULL AND is_stubbed IS 0 ORDER BY chapter_number", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var n int64
		rows.Scan(&n)
		out = append(out, n)
	}
	return out, rows.Err()
}

type pendingResult struct {
	status      string
	newChapters int64
	pending     int
	job         *fetchJob
}

// fetchPending refreshes a serial's chapter list and starts fetching every
// chapter without content.
func (s *Server) fetchPending(ctx context.Context, id int64) (*pendingResult, error) {
	if err := s.ensureNoConflictingBatch(id); err != nil {
		return nil, err
	}
	if err := s.ensureNoRunningFetch(id); err != nil {
		return nil, err
	}
	newCount, _, err := s.updateFromSource(ctx, id)
	if err != nil {
		return nil, err
	}
	numbers, err := pendingNumbers(ctx, s.DB, id)
	if err != nil {
		return nil, err
	}
	if len(numbers) == 0 {
		return &pendingResult{status: "noop", newChapters: newCount}, nil
	}
	job, err := s.scheduleFetch(id, numbers[0], numbers[len(numbers)-1], int64(len(numbers)), numbers)
	if err != nil {
		return nil, err
	}
	return &pendingResult{status: "started", newChapters: newCount, pending: len(numbers), job: job}, nil
}

func (s *Server) fetchPendingHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	res, err := s.fetchPending(r.Context(), id)
	if err != nil {
		return err
	}
	var job any
	if res.job != nil {
		s.fetches.mu.Lock()
		job = jobResponse(res.job)
		s.fetches.mu.Unlock()
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"status": res.status, "new_chapters": res.newChapters, "pending_count": res.pending, "job": job})
	return nil
}

func (s *Server) fetchStatusHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	if err := requireSerial(r.Context(), s.DB, id); err != nil {
		return err
	}
	s.fetches.mu.Lock()
	defer s.fetches.mu.Unlock()
	j := s.fetches.get(id)
	if j == nil {
		return ok(w, map[string]any{"serial_id": id, "state": "idle", "start": nil, "end": nil, "total": 0, "processed": 0, "fetched": 0, "skipped": 0, "failed": 0,
			"current_chapter_number": nil, "current_chapter_title": nil, "started_at": nil, "finished_at": nil, "logs": []any{}, "error": nil})
	}
	return ok(w, j)
}

func (s *Server) batchStatus() any {
	s.fetches.mu.Lock()
	defer s.fetches.mu.Unlock()
	b := s.fetches.currentBatch()
	if b == nil {
		return map[string]any{"state": "idle", "total_serials": 0, "processed_serials": 0, "current_serial_id": nil, "started": 0, "already_running": 0,
			"noop": 0, "failed": 0, "new_chapters": 0, "started_at": nil, "finished_at": nil, "error": nil}
	}
	copy := *b
	return copy
}

func (s *Server) fetchPendingStatusHandler(w http.ResponseWriter, r *http.Request) error {
	return ok(w, s.batchStatus())
}

func (s *Server) fetchAllPendingHandler(w http.ResponseWriter, r *http.Request) error {
	rows, err := s.DB.QueryContext(r.Context(), "SELECT id FROM web_serials WHERE status IN ('ongoing', 'error') ORDER BY last_checked_at DESC NULLS LAST")
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	s.fetches.mu.Lock()
	if b := s.fetches.currentBatch(); b != nil && b.State == "running" {
		s.fetches.mu.Unlock()
		return conflict("A pending chapter batch is already running")
	}
	job := &batchJob{State: "running", TotalSerials: len(ids), StartedAt: store.UTCNow()}
	s.fetches.batch = job
	resp := *job
	s.fetches.mu.Unlock()
	s.bg.Add(1)
	go func() {
		defer s.bg.Done()
		s.runBatch(s.bgCtx, job, ids)
	}()
	writeJSON(w, http.StatusAccepted, resp)
	return nil
}

func (s *Server) runBatch(ctx context.Context, job *batchJob, ids []int64) {
	set := func(fn func()) {
		s.fetches.mu.Lock()
		defer s.fetches.mu.Unlock()
		fn()
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			break
		}
		set(func() { job.CurrentSerialID = ptr(id) })
		res, err := s.fetchPending(ctx, id)
		if err != nil {
			var he *httpError
			if errors.As(err, &he) && he.status == http.StatusConflict && fmt.Sprint(he.detail) != "A pending chapter batch is already running" {
				set(func() { job.AlreadyRunning++; job.ProcessedSerial++ })
				continue
			}
			slog.Error(fmt.Sprintf("Pending chapter batch failed for serial %d: %v", id, err))
			set(func() { job.Failed++; job.ProcessedSerial++ })
			continue
		}
		set(func() { job.NewChapters += res.newChapters })
		if res.status == "noop" {
			set(func() { job.Noop++; job.ProcessedSerial++ })
			continue
		}
		set(func() { job.Started++ })
		if res.job != nil {
			select {
			case <-res.job.done:
			case <-ctx.Done():
			}
		}
		set(func() { job.ProcessedSerial++ })
	}
	set(func() {
		job.State = "completed"
		job.CurrentSerialID = nil
		job.FinishedAt = store.UTCNow()
	})
}

// plainUserAgent is what the Python backend sent when downloading covers
// and chapter images (httpx's default); some image CDNs refuse Go's default.
const plainUserAgent = "python-httpx/0.28.1"

// downloadCover saves an image from url; false when it couldn't.
func downloadCover(ctx context.Context, url, dest string) bool {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err == nil {
		req.Header.Set("User-Agent", plainUserAgent)
		var resp *http.Response
		if resp, err = http.DefaultClient.Do(req); err == nil {
			defer resp.Body.Close()
			if resp.StatusCode >= 400 {
				err = fmt.Errorf("status %d", resp.StatusCode)
			} else {
				var data []byte
				if data, err = io.ReadAll(io.LimitReader(resp.Body, 50<<20)); err == nil {
					if err = os.MkdirAll(filepath.Dir(dest), 0o755); err == nil {
						err = os.WriteFile(dest, data, 0o644)
					}
				}
			}
		}
	}
	if err != nil {
		slog.Warn(fmt.Sprintf("Failed to download cover from %s: %v", url, err))
		return false
	}
	return true
}

func (s *Server) addSerialHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	u := b.Str("url", true, false)
	b.Int("shelf_id", false, true)
	adapterName := b.Str("adapter", false, true)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	var existing int64
	if err := s.DB.QueryRowContext(ctx, "SELECT id FROM web_serials WHERE url = ?", *u).Scan(&existing); err == nil {
		return conflict("Serial with URL %s already exists", pyRepr(*u))
	}
	var adapter scrapers.Adapter
	if adapterName != nil && *adapterName != "" {
		if adapter = scrapers.ByName(*adapterName); adapter == nil {
			return unprocessable("Unknown adapter: %s", pyRepr(*adapterName))
		}
	} else if adapter = scrapers.ForURL(*u); adapter == nil {
		return unprocessable("No scraping adapter supports URL: %s", pyRepr(*u))
	}
	meta, err := adapter.FetchMetadata(ctx, *u)
	var remote []scrapers.ChapterInfo
	if err == nil {
		remote, err = adapter.FetchChapterList(ctx, *u)
	}
	if err != nil {
		return unprocessable("Failed to fetch serial from %s: %v", pyRepr(*u), err)
	}
	var serialID int64
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, "INSERT INTO series (name, description, sort_order) VALUES (?, ?, 0)", meta.Title, meta.Description)
		if err != nil {
			return err
		}
		seriesID, _ := res.LastInsertId()
		var coverPath *string
		if meta.CoverURL != nil {
			dest := filepath.Join(s.Config.CoversDir, "serial_"+strconv.FormatInt(seriesID, 10)+".jpg")
			if downloadCover(ctx, *meta.CoverURL, dest) {
				coverPath = &dest
			}
		}
		res, err = tx.ExecContext(ctx, "INSERT INTO web_serials (url, source, title, author, description, cover_path, cover_url, status, total_chapters, live_chapter_count, last_checked_at, series_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)",
			*u, adapter.Name(), meta.Title, meta.Author, meta.Description, coverPath, meta.CoverURL, meta.Status, store.Now(), seriesID)
		if err != nil {
			return err
		}
		serialID, _ = res.LastInsertId()
		sr, err := getSerial(ctx, tx, serialID)
		if err != nil {
			return err
		}
		_, _, err = syncChapterList(ctx, tx, sr, remote)
		return err
	})
	if err != nil {
		return err
	}
	sr, err := getSerial(ctx, s.DB, serialID)
	if err != nil {
		return err
	}
	return created(w, sr)
}

// pyRepr is repr() of a str (single quotes unless the text has one).
func pyRepr(s string) string {
	if containsByte(s, '\'') && !containsByte(s, '"') {
		return `"` + s + `"`
	}
	r := ""
	for _, c := range s {
		switch c {
		case '\'':
			r += `\'`
		case '\\':
			r += `\\`
		case '\n':
			r += `\n`
		default:
			r += string(c)
		}
	}
	return "'" + r + "'"
}

func containsByte(s string, b byte) bool {
	for i := 0; i < len(s); i++ {
		if s[i] == b {
			return true
		}
	}
	return false
}
