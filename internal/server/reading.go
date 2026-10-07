package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/audemed44/shelfloom/internal/store"
)

type sessionOut struct {
	ID        int64      `json:"id"`
	BookID    string     `json:"book_id"`
	StartTime store.Time `json:"start_time"`
	Duration  *int64     `json:"duration"`
	PagesRead *int64     `json:"pages_read"`
	Device    *string    `json:"device"`
	Source    string     `json:"source"`
	Dismissed bool       `json:"dismissed"`
}

const sessionColumns = "id, book_id, start_time, duration, pages_read, device, source, dismissed"

func scanSession(row scanner) (sessionOut, error) {
	var s sessionOut
	err := row.Scan(&s.ID, &s.BookID, &s.StartTime, &s.Duration, &s.PagesRead, &s.Device, &s.Source, &s.Dismissed)
	return s, err
}

func (s *Server) setReadState(w http.ResponseWriter, r *http.Request, mark bool) error {
	ctx := r.Context()
	id := r.PathValue("book_id")
	if _, err := mustGetBook(ctx, s.DB, id); err != nil {
		return err
	}
	if !mark {
		if _, err := s.DB.ExecContext(ctx, "DELETE FROM reading_progress WHERE book_id = ? AND device = 'manual'", id); err != nil {
			return err
		}
		return noContent(w)
	}
	err := s.DB.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, "UPDATE reading_progress SET progress = 100.0 WHERE book_id = ? AND device = 'manual'", id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			if _, err := tx.ExecContext(ctx, "INSERT INTO reading_progress (book_id, device, progress) VALUES (?, 'manual', 100.0)", id); err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, "UPDATE books SET reading_state = NULL WHERE id = ?", id)
		return err
	})
	if err != nil {
		return err
	}
	return ok(w, map[string]string{"status": "ok"})
}

func (s *Server) markReadHandler(w http.ResponseWriter, r *http.Request) error {
	return s.setReadState(w, r, true)
}

func (s *Server) unmarkReadHandler(w http.ResponseWriter, r *http.Request) error {
	return s.setReadState(w, r, false)
}

func (s *Server) markDNFHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	b, err := mustGetBook(ctx, s.DB, r.PathValue("book_id"))
	if err != nil {
		return err
	}
	if _, err := s.DB.ExecContext(ctx, "UPDATE books SET reading_state = 'dnf' WHERE id = ?", b.ID); err != nil {
		return err
	}
	return ok(w, map[string]string{"status": "ok"})
}

func (s *Server) clearDNFHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	b, err := mustGetBook(ctx, s.DB, r.PathValue("book_id"))
	if err != nil {
		return err
	}
	if b.ReadingState != nil && *b.ReadingState == "dnf" {
		if _, err := s.DB.ExecContext(ctx, "UPDATE books SET reading_state = NULL WHERE id = ?", b.ID); err != nil {
			return err
		}
	}
	return noContent(w)
}

func (s *Server) createManualSessionHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	start, _, _ := b.Datetime("start_time", true)
	duration := b.Int("duration", false, true)
	pages := b.Int("pages_read", false, true)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("book_id")
	if _, err := mustGetBook(ctx, s.DB, id); err != nil {
		return err
	}
	// An aware time keeps its wall clock and loses the offset, as
	// .replace(tzinfo=None) does.
	res, err := s.DB.ExecContext(ctx, "INSERT INTO reading_sessions (book_id, start_time, duration, pages_read, source, dismissed) VALUES (?, ?, ?, ?, 'manual', 0)",
		id, wallTime(start, b, "start_time"), duration, pages)
	if err != nil {
		return err
	}
	sid, _ := res.LastInsertId()
	out, err := scanSession(s.DB.QueryRowContext(ctx, "SELECT "+sessionColumns+" FROM reading_sessions WHERE id = ?", sid))
	if err != nil {
		return err
	}
	return created(w, out)
}

// wallTime returns the wall-clock time the client sent, dropping any offset
// (Python's dt.replace(tzinfo=None)), not converting it.
func wallTime(parsed time.Time, b *body, key string) store.Time {
	var raw string
	if err := jsonUnmarshalString(b.Raw(key), &raw); err == nil {
		if t, good := parseWallClock(raw); good {
			return store.T(t)
		}
	}
	return store.T(parsed)
}

func paged(total, perPage int64) int64 {
	return int64(math.Max(1, math.Ceil(float64(total)/float64(perPage))))
}

func (s *Server) highlightsHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	page := q.IntRange("page", 1, 1, math.MaxInt64)
	perPage := q.IntRange("per_page", 50, 1, 200)
	if err := q.err(); err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("book_id")
	if _, err := mustGetBook(ctx, s.DB, id); err != nil {
		return err
	}
	var total int64
	if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM highlights WHERE highlights.book_id = ?", id).Scan(&total); err != nil {
		return err
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT id, book_id, text, note, chapter, page, created FROM highlights WHERE book_id = ? ORDER BY page, id LIMIT ? OFFSET ?", id, perPage, (page-1)*perPage)
	if err != nil {
		return err
	}
	defer rows.Close()
	type highlight struct {
		ID      int64      `json:"id"`
		BookID  string     `json:"book_id"`
		Text    string     `json:"text"`
		Note    *string    `json:"note"`
		Chapter *string    `json:"chapter"`
		Page    *int64     `json:"page"`
		Created store.Time `json:"created"`
	}
	items := []highlight{}
	for rows.Next() {
		var h highlight
		if err := rows.Scan(&h.ID, &h.BookID, &h.Text, &h.Note, &h.Chapter, &h.Page, &h.Created); err != nil {
			return err
		}
		items = append(items, h)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return ok(w, map[string]any{"items": items, "total": total, "page": page, "per_page": perPage, "pages": paged(total, perPage)})
}

func (s *Server) sessionsHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	page := q.IntRange("page", 1, 1, math.MaxInt64)
	perPage := q.IntRange("per_page", 50, 1, 200)
	if err := q.err(); err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("book_id")
	if _, err := mustGetBook(ctx, s.DB, id); err != nil {
		return err
	}
	var total int64
	if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM reading_sessions WHERE book_id = ? AND dismissed = 0", id).Scan(&total); err != nil {
		return err
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT "+sessionColumns+" FROM reading_sessions WHERE book_id = ? AND dismissed = 0 ORDER BY start_time DESC LIMIT ? OFFSET ?", id, perPage, (page-1)*perPage)
	if err != nil {
		return err
	}
	defer rows.Close()
	items := []sessionOut{}
	for rows.Next() {
		so, err := scanSession(rows)
		if err != nil {
			return err
		}
		items = append(items, so)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return ok(w, map[string]any{"items": items, "total": total, "page": page, "per_page": perPage, "pages": paged(total, perPage)})
}

type progressOut struct {
	ID        int64      `json:"id"`
	BookID    string     `json:"book_id"`
	Progress  *float64   `json:"progress"`
	Device    *string    `json:"device"`
	Chapter   *string    `json:"chapter"`
	Position  *string    `json:"position"`
	UpdatedAt store.Time `json:"updated_at"`
}

func bookProgress(ctx context.Context, q querier, bookID string) ([]progressOut, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, book_id, progress, device, chapter, position, updated_at FROM reading_progress WHERE book_id = ? ORDER BY updated_at DESC", bookID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []progressOut{}
	for rows.Next() {
		var p progressOut
		if err := rows.Scan(&p.ID, &p.BookID, &p.Progress, &p.Device, &p.Chapter, &p.Position, &p.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Server) progressHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id := r.PathValue("book_id")
	if _, err := mustGetBook(ctx, s.DB, id); err != nil {
		return err
	}
	out, err := bookProgress(ctx, s.DB, id)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (s *Server) readingSummaryHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id := r.PathValue("book_id")
	if _, err := mustGetBook(ctx, s.DB, id); err != nil {
		return err
	}
	var sessions, seconds int64
	if err := s.DB.QueryRowContext(ctx, "SELECT count(*), coalesce(sum(coalesce(duration, 0)), 0) FROM reading_sessions WHERE book_id = ? AND dismissed = 0", id).Scan(&sessions, &seconds); err != nil {
		return err
	}
	progress, err := bookProgress(ctx, s.DB, id)
	if err != nil {
		return err
	}
	var pct *float64
	if len(progress) > 0 {
		pct = progress[0].Progress
	}
	return ok(w, map[string]any{"total_sessions": sessions, "total_time_seconds": seconds, "percent_finished": pct})
}

type positionOut struct {
	Progress      string  `json:"progress"`
	Percentage    float64 `json:"percentage"`
	Device        string  `json:"device"`
	DeviceID      *string `json:"device_id"`
	Timestamp     int64   `json:"timestamp"`
	Locator       *string `json:"locator"`
	FromWebReader bool    `json:"from_web_reader"`
}

func (s *Server) getPositionHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id := r.PathValue("book_id")
	if _, err := mustGetBook(ctx, s.DB, id); err != nil {
		return err
	}
	rec, err := latestProgressForBook(ctx, s.DB, id, nil)
	if err != nil {
		return err
	}
	if rec == nil {
		return ok(w, nil)
	}
	fromWeb := rec.Username == webReaderUsername
	out := positionOut{Progress: rec.Progress, Percentage: rec.Percentage, Device: rec.Device, DeviceID: rec.DeviceID, Timestamp: rec.Timestamp, FromWebReader: fromWeb}
	if fromWeb {
		out.Locator = rec.Locator
	}
	return ok(w, out)
}

func (s *Server) putPositionHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	progress := b.Str("progress", true, false)
	pct := b.Float("percentage", true, false)
	locator := b.Str("locator", false, true)
	if pct != nil && (*pct < 0 || *pct > 1) {
		typ, msg := "greater_than_equal", "Input should be greater than or equal to 0"
		if *pct > 1 {
			typ, msg = "less_than_equal", "Input should be less than or equal to 1"
		}
		b.errs = append(b.errs, validationIssue{Type: typ, Loc: []any{"body", "percentage"}, Msg: msg, Input: *pct})
	}
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	book, err := mustGetBook(ctx, s.DB, r.PathValue("book_id"))
	if err != nil {
		return err
	}
	rec, err := saveWebProgress(ctx, s.DB, book, *progress, *pct, locator)
	if err != nil {
		return err
	}
	return ok(w, positionOut{Progress: rec.Progress, Percentage: rec.Percentage, Device: rec.Device, DeviceID: rec.DeviceID, Timestamp: rec.Timestamp, Locator: rec.Locator, FromWebReader: true})
}

func (s *Server) putWebSessionHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	start, _, _ := b.Datetime("start_time", true)
	duration := b.Int("duration", true, false)
	pages := b.Int("pages_read", false, true)
	if duration != nil && *duration < 0 {
		b.errs = append(b.errs, validationIssue{Type: "greater_than_equal", Loc: []any{"body", "duration"}, Msg: "Input should be greater than or equal to 0", Input: *duration})
	}
	if pages != nil && *pages < 0 {
		b.errs = append(b.errs, validationIssue{Type: "greater_than_equal", Loc: []any{"body", "pages_read"}, Msg: "Input should be greater than or equal to 0", Input: *pages})
	}
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("book_id")
	if _, err := mustGetBook(ctx, s.DB, id); err != nil {
		return err
	}
	wall := wallTime(start, b, "start_time")
	key := fmt.Sprintf("web:%s:%d", id, wall.Time.Unix())
	var sid int64
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx, "SELECT id FROM reading_sessions WHERE source_key = ?", key).Scan(&sid)
		if errors.Is(err, sql.ErrNoRows) {
			res, err := tx.ExecContext(ctx, "INSERT INTO reading_sessions (book_id, start_time, duration, pages_read, device, source, source_key, dismissed) VALUES (?, ?, ?, ?, ?, 'web', ?, 0)",
				id, wall, *duration, pages, webReaderDevice, key)
			if err != nil {
				return err
			}
			sid, _ = res.LastInsertId()
			return nil
		}
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "UPDATE reading_sessions SET duration = ?, pages_read = ? WHERE id = ?", *duration, pages, sid)
		return err
	})
	if err != nil {
		return err
	}
	out, err := scanSession(s.DB.QueryRowContext(ctx, "SELECT "+sessionColumns+" FROM reading_sessions WHERE id = ?", sid))
	if err != nil {
		return err
	}
	return ok(w, out)
}
