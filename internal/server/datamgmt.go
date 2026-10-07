package server

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/audemed44/shelfloom/internal/store"
	"golang.org/x/text/unicode/norm"
)

// normalizeTitle lowercases, strips accents and keeps letters, digits and
// whitespace, for spotting duplicate books.
func normalizeTitle(s string) string {
	var b strings.Builder
	for _, r := range norm.NFKD.String(strings.ToLower(s)) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsNumber(r) || isPySpaceRune(r) {
			b.WriteRune(r)
		}
	}
	return strings.TrimFunc(b.String(), isPySpaceRune)
}

func isPySpaceRune(r rune) bool { return unicode.IsSpace(r) || (r >= 0x1c && r <= 0x1f) }

type sessionBrief struct {
	ID        int64   `json:"id"`
	BookID    string  `json:"book_id"`
	StartTime *string `json:"start_time"`
	Duration  *int64  `json:"duration"`
	PagesRead *int64  `json:"pages_read"`
	Source    string  `json:"source"`
	Dismissed bool    `json:"dismissed"`
}

func briefOf(s sessionOut) sessionBrief {
	b := sessionBrief{ID: s.ID, BookID: s.BookID, Duration: s.Duration, PagesRead: s.PagesRead, Source: s.Source, Dismissed: s.Dismissed}
	if s.StartTime.Valid {
		b.StartTime = ptr(s.StartTime.ISO())
	}
	return b
}

func (s *Server) duplicateSessionsHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	rows, err := s.DB.QueryContext(ctx, "SELECT "+prefixed("reading_sessions", sessionColumns)+", books.title, books.author FROM reading_sessions JOIN books ON reading_sessions.book_id = books.id WHERE reading_sessions.dismissed = 1 ORDER BY books.id, reading_sessions.start_time")
	if err != nil {
		return err
	}
	type row struct {
		sess   sessionOut
		title  string
		author *string
	}
	var list []row
	for rows.Next() {
		var x row
		if err := rows.Scan(&x.sess.ID, &x.sess.BookID, &x.sess.StartTime, &x.sess.Duration, &x.sess.PagesRead, &x.sess.Device, &x.sess.Source, &x.sess.Dismissed, &x.title, &x.author); err != nil {
			rows.Close()
			return err
		}
		list = append(list, x)
	}
	rows.Close()
	type pair struct {
		Dismissed sessionBrief  `json:"dismissed"`
		Active    *sessionBrief `json:"active"`
	}
	type group struct {
		BookID     string  `json:"book_id"`
		BookTitle  string  `json:"book_title"`
		BookAuthor *string `json:"book_author"`
		Pairs      []pair  `json:"pairs"`
	}
	out := []*group{}
	byBook := map[string]*group{}
	for _, x := range list {
		var active *sessionBrief
		if x.sess.StartTime.Valid {
			lo, hi := store.T(x.sess.StartTime.Add(-5*time.Minute)), store.T(x.sess.StartTime.Add(5*time.Minute))
			a, err := scanSession(s.DB.QueryRowContext(ctx, "SELECT "+sessionColumns+" FROM reading_sessions WHERE book_id = ? AND dismissed = 0 AND start_time >= ? AND start_time <= ? LIMIT 1", x.sess.BookID, lo, hi))
			if err == nil {
				b := briefOf(a)
				active = &b
			} else if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
		}
		g := byBook[x.sess.BookID]
		if g == nil {
			g = &group{BookID: x.sess.BookID, BookTitle: x.title, BookAuthor: x.author}
			byBook[x.sess.BookID] = g
			out = append(out, g)
		}
		g.Pairs = append(g.Pairs, pair{Dismissed: briefOf(x.sess), Active: active})
	}
	return ok(w, out)
}

func (s *Server) setSessionDismissedHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "session_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	dismissed := b.Bool("dismissed", true, false)
	if err := b.err(); err != nil {
		return err
	}
	res, err := s.DB.ExecContext(r.Context(), "UPDATE reading_sessions SET dismissed = ? WHERE id = ?", *dismissed, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return notFound("Session not found")
	}
	return ok(w, map[string]string{"status": "ok"})
}

func (s *Server) bulkResolveHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	rows, err := s.DB.QueryContext(ctx, "SELECT DISTINCT book_id FROM reading_sessions WHERE source = 'sdr' AND dismissed = 0")
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	total := 0
	for _, id := range ids {
		n, err := dedupSessions(ctx, s.DB, id)
		if err != nil {
			return err
		}
		total += n
	}
	return ok(w, map[string]int{"dismissed": total})
}

func (s *Server) unmatchedHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	includeDismissed := q.BoolDefault("include_dismissed", false)
	if err := q.err(); err != nil {
		return err
	}
	query := "SELECT id, title, author, source, source_path, session_count, total_duration_seconds, dismissed, linked_book_id, created_at FROM unmatched_koreader_entries"
	if !includeDismissed {
		query += " WHERE dismissed = 0"
	}
	rows, err := s.DB.QueryContext(r.Context(), query+" ORDER BY created_at DESC")
	if err != nil {
		return err
	}
	defer rows.Close()
	type entry struct {
		ID           int64      `json:"id"`
		Title        string     `json:"title"`
		Author       *string    `json:"author"`
		Source       string     `json:"source"`
		SourcePath   *string    `json:"source_path"`
		SessionCount int64      `json:"session_count"`
		TotalSeconds int64      `json:"total_duration_seconds"`
		Dismissed    bool       `json:"dismissed"`
		LinkedBookID *string    `json:"linked_book_id"`
		CreatedAt    store.Time `json:"created_at"`
	}
	out := []entry{}
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.ID, &e.Title, &e.Author, &e.Source, &e.SourcePath, &e.SessionCount, &e.TotalSeconds, &e.Dismissed, &e.LinkedBookID, &e.CreatedAt); err != nil {
			return err
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return ok(w, out)
}

func (s *Server) linkUnmatchedHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "entry_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	bookID := b.Str("book_id", true, false)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	var x int64
	if err := s.DB.QueryRowContext(ctx, "SELECT id FROM unmatched_koreader_entries WHERE id = ?", id).Scan(&x); err != nil {
		return notFound("Entry or book not found")
	}
	if bk, err := getBook(ctx, s.DB, *bookID); err != nil {
		return err
	} else if bk == nil {
		return notFound("Entry or book not found")
	}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "UPDATE unmatched_koreader_entries SET linked_book_id = ?, dismissed = 1 WHERE id = ?", *bookID, id); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, "SELECT start_time, duration, pages_read, source_key FROM unmatched_sessions WHERE unmatched_entry_id = ?", id)
		if err != nil {
			return err
		}
		type us struct {
			start           store.Time
			duration, pages *int64
			key             *string
		}
		var list []us
		for rows.Next() {
			var u us
			rows.Scan(&u.start, &u.duration, &u.pages, &u.key)
			list = append(list, u)
		}
		rows.Close()
		for _, u := range list {
			if u.key != nil && *u.key != "" {
				var e int64
				if err := tx.QueryRowContext(ctx, "SELECT id FROM reading_sessions WHERE source_key = ?", *u.key).Scan(&e); err == nil {
					continue
				}
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO reading_sessions (book_id, start_time, duration, pages_read, source, source_key, dismissed) VALUES (?, ?, ?, ?, 'stats_db', ?, 0)", *bookID, u.start, u.duration, u.pages, u.key); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return ok(w, map[string]string{"status": "ok"})
}

func (s *Server) dismissUnmatchedHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "entry_id")
	if err != nil {
		return err
	}
	res, err := s.DB.ExecContext(r.Context(), "UPDATE unmatched_koreader_entries SET dismissed = 1 WHERE id = ?", id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return notFound("Entry not found")
	}
	return ok(w, map[string]string{"status": "ok"})
}

type bookSummary struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Author       *string `json:"author"`
	Format       string  `json:"format"`
	ShelfID      int64   `json:"shelf_id"`
	DateAdded    string  `json:"date_added"`
	SessionCount int64   `json:"session_count"`
}

// duplicateBookGroups groups books whose normalised title and author match.
func duplicateBookGroups(ctx context.Context, q querier) ([][]bookSummary, error) {
	books, err := queryBooks(ctx, q, "SELECT "+bookColumns("books")+" FROM books ORDER BY books.author, books.title")
	if err != nil {
		return nil, err
	}
	type key struct{ author, title string }
	groups := map[key][]*Book{}
	var order []key
	for _, b := range books {
		k := key{normalizeTitle(deref(b.Author)), normalizeTitle(b.Title)}
		if _, seen := groups[k]; !seen {
			order = append(order, k)
		}
		groups[k] = append(groups[k], b)
	}
	out := [][]bookSummary{}
	for _, k := range order {
		g := groups[k]
		if len(g) < 2 {
			continue
		}
		var summaries []bookSummary
		for _, b := range g {
			var n int64
			if err := q.QueryRowContext(ctx, "SELECT count(*) FROM reading_sessions WHERE book_id = ? AND dismissed = 0", b.ID).Scan(&n); err != nil {
				return nil, err
			}
			summaries = append(summaries, bookSummary{ID: b.ID, Title: b.Title, Author: b.Author, Format: b.Format, ShelfID: b.ShelfID, DateAdded: b.DateAdded.ISO(), SessionCount: n})
		}
		out = append(out, summaries)
	}
	return out, nil
}

func (s *Server) duplicateBooksHandler(w http.ResponseWriter, r *http.Request) error {
	groups, err := duplicateBookGroups(r.Context(), s.DB)
	if err != nil {
		return err
	}
	out := []map[string]any{}
	for _, g := range groups {
		out = append(out, map[string]any{"books": g})
	}
	return ok(w, out)
}

func (s *Server) mergeBooksHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	keep := b.Str("keep_id", true, false)
	discard := b.Str("discard_id", true, false)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	fail := notFound("Book(s) not found or same ID given")
	if *keep == *discard {
		return fail
	}
	kb, err := getBook(ctx, s.DB, *keep)
	if err != nil {
		return err
	}
	db2, err := getBook(ctx, s.DB, *discard)
	if err != nil {
		return err
	}
	if kb == nil || db2 == nil {
		return fail
	}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "UPDATE reading_sessions SET book_id = ? WHERE book_id = ?", *keep, *discard); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE highlights SET book_id = ? WHERE book_id = ?", *keep, *discard); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, "SELECT id, device FROM reading_progress WHERE book_id = ?", *discard)
		if err != nil {
			return err
		}
		type prog struct {
			id     int64
			device *string
		}
		var list []prog
		for rows.Next() {
			var p prog
			rows.Scan(&p.id, &p.device)
			list = append(list, p)
		}
		rows.Close()
		for _, p := range list {
			var x int64
			var err error
			if p.device == nil {
				err = tx.QueryRowContext(ctx, "SELECT id FROM reading_progress WHERE book_id = ? AND device IS NULL", *keep).Scan(&x)
			} else {
				err = tx.QueryRowContext(ctx, "SELECT id FROM reading_progress WHERE book_id = ? AND device = ?", *keep, *p.device).Scan(&x)
			}
			if errors.Is(err, sql.ErrNoRows) {
				_, err = tx.ExecContext(ctx, "UPDATE reading_progress SET book_id = ? WHERE id = ?", *keep, p.id)
			} else if err == nil {
				_, err = tx.ExecContext(ctx, "DELETE FROM reading_progress WHERE id = ?", p.id)
			}
			if err != nil {
				return err
			}
		}
		_, err = tx.ExecContext(ctx, "DELETE FROM books WHERE id = ?", *discard)
		return err
	})
	if err != nil {
		return err
	}
	return ok(w, map[string]string{"status": "ok"})
}

func (s *Server) importLogHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	limit := q.IntRange("limit", 100, 1, 500)
	offset := q.IntRange("offset", 0, 0, 1<<62)
	search := q.Str("search")
	if err := q.err(); err != nil {
		return err
	}
	where, args := "", []any{}
	if search != nil && *search != "" {
		where = " WHERE (lower(books.title) LIKE lower(?) OR lower(books.author) LIKE lower(?))"
		args = append(args, "%"+*search+"%", "%"+*search+"%")
	}
	ctx := r.Context()
	var total int64
	if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM book_hashes JOIN books ON book_hashes.book_id = books.id"+where, args...).Scan(&total); err != nil {
		return err
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT book_hashes.id, books.id, books.title, books.author, book_hashes.hash_sha, book_hashes.hash_md5, book_hashes.page_count, book_hashes.recorded_at FROM book_hashes JOIN books ON book_hashes.book_id = books.id"+where+" ORDER BY book_hashes.recorded_at DESC LIMIT ? OFFSET ?", append(args, limit, offset)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	type entry struct {
		ID         int64   `json:"id"`
		BookID     string  `json:"book_id"`
		BookTitle  string  `json:"book_title"`
		BookAuthor *string `json:"book_author"`
		HashSHA    string  `json:"hash_sha"`
		HashMD5    string  `json:"hash_md5"`
		PageCount  *int64  `json:"page_count"`
		RecordedAt string  `json:"recorded_at"`
	}
	items := []entry{}
	for rows.Next() {
		var e entry
		var rec store.Time
		if err := rows.Scan(&e.ID, &e.BookID, &e.BookTitle, &e.BookAuthor, &e.HashSHA, &e.HashMD5, &e.PageCount, &rec); err != nil {
			return err
		}
		e.HashSHA = truncRunes(e.HashSHA, 12) + "…"
		e.HashMD5 = truncRunes(e.HashMD5, 12) + "…"
		e.RecordedAt = rec.ISO()
		items = append(items, e)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return ok(w, map[string]any{"items": items, "total": total, "limit": limit, "offset": offset})
}

func truncRunes(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

func (s *Server) sessionLogHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	limit := q.IntRange("limit", 50, 1, 500)
	offset := q.IntRange("offset", 0, 0, 1<<62)
	search := q.Str("search")
	source := q.Str("source")
	if err := q.err(); err != nil {
		return err
	}
	var where []string
	var args []any
	if search != nil && *search != "" {
		where = append(where, "(lower(books.title) LIKE lower(?) OR lower(books.author) LIKE lower(?))")
		args = append(args, "%"+*search+"%", "%"+*search+"%")
	}
	if source != nil && *source != "" {
		where = append(where, "reading_sessions.source = ?")
		args = append(args, *source)
	}
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = " WHERE " + strings.Join(where, " AND ")
	}
	ctx := r.Context()
	var total int64
	if err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM reading_sessions JOIN books ON reading_sessions.book_id = books.id"+whereSQL, args...).Scan(&total); err != nil {
		return err
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT reading_sessions.id, books.id, books.title, books.author, reading_sessions.source, reading_sessions.start_time, reading_sessions.duration, reading_sessions.pages_read, reading_sessions.device, reading_sessions.dismissed, reading_sessions.created_at FROM reading_sessions JOIN books ON reading_sessions.book_id = books.id"+whereSQL+" ORDER BY reading_sessions.created_at DESC, reading_sessions.id DESC LIMIT ? OFFSET ?", append(args, limit, offset)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	type entry struct {
		ID         int64   `json:"id"`
		BookID     string  `json:"book_id"`
		BookTitle  string  `json:"book_title"`
		BookAuthor *string `json:"book_author"`
		Source     string  `json:"source"`
		StartTime  *string `json:"start_time"`
		Duration   *int64  `json:"duration"`
		PagesRead  *int64  `json:"pages_read"`
		Device     *string `json:"device"`
		Dismissed  bool    `json:"dismissed"`
		CreatedAt  *string `json:"created_at"`
	}
	items := []entry{}
	for rows.Next() {
		var e entry
		var start, created store.Time
		if err := rows.Scan(&e.ID, &e.BookID, &e.BookTitle, &e.BookAuthor, &e.Source, &start, &e.Duration, &e.PagesRead, &e.Device, &e.Dismissed, &created); err != nil {
			return err
		}
		if start.Valid {
			e.StartTime = ptr(start.ISO())
		}
		if created.Valid {
			e.CreatedAt = ptr(created.ISO())
		}
		items = append(items, e)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return ok(w, map[string]any{"items": items, "total": total, "limit": limit, "offset": offset})
}
