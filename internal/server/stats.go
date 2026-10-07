package server

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/audemed44/shelfloom/internal/store"
)

// Reading times are stored as naive UTC; stats group them in local time
// (the TZ the server runs in).
const localStart = "datetime(reading_sessions.start_time, 'localtime')"

// date is a calendar day.
type date struct{ time.Time }

func newDate(y int, m time.Month, d int) date { return date{time.Date(y, m, d, 0, 0, 0, 0, time.UTC)} }

func parseDate(s string) (date, bool) {
	t, err := time.ParseInLocation("2006-01-02", s, time.UTC)
	return date{t}, err == nil
}

func (d date) iso() string                  { return d.Format("2006-01-02") }
func (d date) addDays(n int) date           { return date{d.AddDate(0, 0, n)} }
func (d date) daysUntil(o date) int         { return int(o.Sub(d.Time).Hours() / 24) }
func (d date) before(o date) bool           { return d.Time.Before(o.Time) }
func dateOf(t store.Time) date              { return newDate(t.Year(), t.Month(), t.Day()) }
func today() date                           { n := time.Now(); return newDate(n.Year(), n.Month(), n.Day()) }
func (d date) weekdayMon0() int             { return (int(d.Weekday()) + 6) % 7 }
func (d date) MarshalJSON() ([]byte, error) { return []byte(`"` + d.iso() + `"`), nil }

// localDayBounds is local_day_bounds: the UTC times covering local days
// first through last.
func localDayBounds(first, last date) (store.Time, store.Time) {
	return store.FromLocal(first.Year(), first.Month(), first.Day(), 0, 0, 0, 0),
		store.FromLocal(last.Year(), last.Month(), last.Day(), 23, 59, 59, 999999)
}

// sessionFilters is _session_filters as SQL.
func sessionFilters(from, to store.Time) (string, []any) {
	where := "reading_sessions.dismissed = 0 AND reading_sessions.start_time IS NOT NULL"
	var args []any
	if from.Valid {
		where += " AND reading_sessions.start_time >= ?"
		args = append(args, from)
	}
	if to.Valid {
		where += " AND reading_sessions.start_time <= ?"
		args = append(args, to)
	}
	return where, args
}

// readingDates are the local days with a session longer than zero.
func readingDates(ctx context.Context, q querier) ([]date, error) {
	rows, err := q.QueryContext(ctx, "SELECT date("+localStart+") AS day FROM reading_sessions WHERE reading_sessions.dismissed = 0 AND reading_sessions.start_time IS NOT NULL AND reading_sessions.duration > 0 GROUP BY day ORDER BY day")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []date
	for rows.Next() {
		var s *string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		if s == nil || *s == "" {
			continue
		}
		if d, good := parseDate(*s); good {
			out = append(out, d)
		}
	}
	return out, rows.Err()
}

type streakRun struct {
	Start string `json:"start"`
	End   string `json:"end"`
	Days  int    `json:"days"`
}

type streaks struct {
	Current      int         `json:"current"`
	Longest      int         `json:"longest"`
	LastReadDate *string     `json:"last_read_date"`
	History      []streakRun `json:"history"`
}

func streaksFrom(dates []date) streaks {
	if len(dates) == 0 {
		return streaks{History: []streakRun{}}
	}
	var runs []streakRun
	start, n := dates[0], 1
	for i := 1; i < len(dates); i++ {
		if dates[i-1].daysUntil(dates[i]) == 1 {
			n++
			continue
		}
		runs = append(runs, streakRun{Start: start.iso(), End: dates[i-1].iso(), Days: n})
		start, n = dates[i], 1
	}
	last := dates[len(dates)-1]
	runs = append(runs, streakRun{Start: start.iso(), End: last.iso(), Days: n})
	longest := 0
	for _, r := range runs {
		longest = max(longest, r.Days)
	}
	current := 0
	if last.daysUntil(today()) <= 1 {
		current = runs[len(runs)-1].Days
	}
	l := last.iso()
	return streaks{Current: current, Longest: longest, LastReadDate: &l, History: runs}
}

type completedBook struct {
	BookID      string     `json:"book_id"`
	Title       string     `json:"title"`
	Author      *string    `json:"author"`
	CompletedAt store.Time `json:"completed_at"`
	CoverPath   *string    `json:"cover_path"`
}

// booksCompleted is get_books_completed: books at 99%+ (not DNF), most
// recently completed first, optionally completed within [from, to].
func booksCompleted(ctx context.Context, q querier, from, to store.Time) ([]completedBook, error) {
	completedAt := "coalesce(max(reading_sessions.start_time), max(reading_progress.updated_at))"
	query := "SELECT books.id, books.title, books.author, books.cover_path, reading_progress.updated_at, max(reading_sessions.start_time) AS last_session " +
		"FROM books JOIN reading_progress ON reading_progress.book_id = books.id " +
		"LEFT OUTER JOIN reading_sessions ON reading_sessions.book_id = books.id AND reading_sessions.dismissed = 0 " +
		"WHERE reading_progress.progress >= 99.0 AND (books.reading_state IS NULL OR books.reading_state != 'dnf') " +
		"GROUP BY books.id, reading_progress.book_id"
	var having []string
	var args []any
	if from.Valid {
		having = append(having, completedAt+" >= ?")
		args = append(args, from)
	}
	if to.Valid {
		having = append(having, completedAt+" <= ?")
		args = append(args, to)
	}
	if len(having) > 0 {
		query += " HAVING " + joinAnd(having)
	}
	query += " ORDER BY " + completedAt + " DESC"
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []completedBook{}
	seen := map[string]bool{}
	for rows.Next() {
		var c completedBook
		var updated, lastSession store.Time
		if err := rows.Scan(&c.BookID, &c.Title, &c.Author, &c.CoverPath, &updated, &lastSession); err != nil {
			return nil, err
		}
		if seen[c.BookID] {
			continue
		}
		seen[c.BookID] = true
		if lastSession.Valid {
			c.CompletedAt = lastSession.Local()
		} else {
			c.CompletedAt = updated.Local()
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func joinAnd(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += " AND "
		}
		out += p
	}
	return out
}

type overview struct {
	BooksOwned        int64    `json:"books_owned"`
	BooksRead         int      `json:"books_read"`
	TotalSeconds      int64    `json:"total_reading_time_seconds"`
	TotalPages        int64    `json:"total_pages_read"`
	Sessions          int64    `json:"sessions"`
	ReadingDays       int64    `json:"reading_days"`
	PagesPerHour      *float64 `json:"pages_per_hour"`
	FirstSessionDate  *string  `json:"first_session_date"`
	CurrentStreakDays int      `json:"current_streak_days"`
}

func getOverview(ctx context.Context, q querier, from, to store.Time) (*overview, error) {
	var o overview
	if err := q.QueryRowContext(ctx, "SELECT count(*) FROM books").Scan(&o.BooksOwned); err != nil {
		return nil, err
	}
	completed, err := booksCompleted(ctx, q, from, to)
	if err != nil {
		return nil, err
	}
	o.BooksRead = len(completed)
	where, args := sessionFilters(from, to)
	var first store.Time
	if err := q.QueryRowContext(ctx, "SELECT coalesce(sum(reading_sessions.duration), 0), coalesce(sum(reading_sessions.pages_read), 0), count(reading_sessions.id), "+
		"count(DISTINCT CASE WHEN (reading_sessions.duration > 0) THEN date("+localStart+") END), min(reading_sessions.start_time) FROM reading_sessions WHERE "+where, args...).
		Scan(&o.TotalSeconds, &o.TotalPages, &o.Sessions, &o.ReadingDays, &first); err != nil {
		return nil, err
	}
	var pages, seconds int64
	if err := q.QueryRowContext(ctx, "SELECT coalesce(sum(reading_sessions.pages_read), 0), coalesce(sum(reading_sessions.duration), 0) FROM reading_sessions WHERE "+where+" AND reading_sessions.pages_read > 0 AND reading_sessions.duration > 0", args...).Scan(&pages, &seconds); err != nil {
		return nil, err
	}
	if seconds != 0 && pages != 0 {
		o.PagesPerHour = ptr(pyRound(float64(pages)/float64(seconds)*3600, 1))
	}
	if first.Valid {
		o.FirstSessionDate = ptr(dateOf(first.Local()).iso())
	}
	dates, err := readingDates(ctx, q)
	if err != nil {
		return nil, err
	}
	o.CurrentStreakDays = streaksFrom(dates).Current
	return &o, nil
}

func bucketSQL(granularity string) string {
	switch granularity {
	case "day":
		return "date(" + localStart + ")"
	case "week":
		// 'weekday 0' moves forward to Sunday (or stays); -6 days is that week's Monday.
		return "date(" + localStart + ", 'weekday 0', '-6 days')"
	}
	return "strftime('%Y-%m', " + localStart + ")"
}

func bucketStart(key, granularity string) date {
	if granularity == "month" {
		key += "-01"
	}
	d, _ := parseDate(key)
	return d
}

func bucketKeys(granularity string, first, last date) []string {
	var keys []string
	switch granularity {
	case "day":
		for d := first; !last.before(d); d = d.addDays(1) {
			keys = append(keys, d.iso())
		}
	case "week":
		for d := first.addDays(-first.weekdayMon0()); !last.before(d); d = d.addDays(7) {
			keys = append(keys, d.iso())
		}
	default:
		y, m := first.Year(), int(first.Month())
		for y < last.Year() || (y == last.Year() && m <= int(last.Month())) {
			keys = append(keys, fmt.Sprintf("%04d-%02d", y, m))
			if m == 12 {
				y, m = y+1, 1
			} else {
				m++
			}
		}
	}
	return keys
}

type seriesPoint struct {
	Date  string `json:"date"`
	Value int64  `json:"value"`
}

func timeSeries(ctx context.Context, q querier, metric, granularity string, from, to store.Time) ([]seriesPoint, error) {
	col := "reading_sessions.duration"
	if metric == "pages" {
		col = "reading_sessions.pages_read"
	}
	where, args := sessionFilters(from, to)
	rows, err := q.QueryContext(ctx, "SELECT "+bucketSQL(granularity)+" AS bucket, coalesce(sum("+col+"), 0) AS value FROM reading_sessions WHERE "+where+" GROUP BY bucket ORDER BY bucket", args...)
	if err != nil {
		return nil, err
	}
	values := map[string]int64{}
	var keys []string
	for rows.Next() {
		var bucket *string
		var v int64
		if err := rows.Scan(&bucket, &v); err != nil {
			rows.Close()
			return nil, err
		}
		if bucket != nil && *bucket != "" {
			values[*bucket] = v
			keys = append(keys, *bucket)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := []seriesPoint{}
	if len(values) == 0 && !from.Valid {
		return out, nil
	}
	sort.Strings(keys)
	var first, last date
	if from.Valid {
		first = dateOf(from.Local())
	} else {
		first = bucketStart(keys[0], granularity)
	}
	if to.Valid {
		last = dateOf(to.Local())
	} else {
		last = today()
	}
	if len(keys) > 0 {
		if m := bucketStart(keys[len(keys)-1], granularity); last.before(m) {
			last = m
		}
	}
	for _, k := range bucketKeys(granularity, first, last) {
		out = append(out, seriesPoint{Date: k, Value: values[k]})
	}
	return out, nil
}

func (s *Server) statsRange(r *http.Request) (store.Time, store.Time, error) {
	q := newQuery(r)
	from, to := q.Datetime("from"), q.Datetime("to")
	return from, to, q.err()
}

func (s *Server) overviewHandler(w http.ResponseWriter, r *http.Request) error {
	from, to, err := s.statsRange(r)
	if err != nil {
		return err
	}
	o, err := getOverview(r.Context(), s.DB, from, to)
	if err != nil {
		return err
	}
	return ok(w, o)
}

func (s *Server) timeSeriesHandler(metric string) handlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		q := newQuery(r)
		granularity := q.StrDefault("granularity", "day")
		if granularity != "day" && granularity != "week" && granularity != "month" {
			q.fail("granularity", "literal_error", "Input should be 'day', 'week' or 'month'", granularity)
		}
		from, to := q.Datetime("from"), q.Datetime("to")
		if err := q.err(); err != nil {
			return err
		}
		out, err := timeSeries(r.Context(), s.DB, metric, granularity, from, to)
		if err != nil {
			return err
		}
		return ok(w, out)
	}
}

func (s *Server) booksCompletedHandler(w http.ResponseWriter, r *http.Request) error {
	from, to, err := s.statsRange(r)
	if err != nil {
		return err
	}
	out, err := booksCompleted(r.Context(), s.DB, from, to)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (s *Server) pendingVerdictsHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	completed, err := booksCompleted(ctx, s.DB, store.Time{}, store.Time{})
	if err != nil {
		return err
	}
	type verdict struct {
		ID          string     `json:"id"`
		Title       string     `json:"title"`
		Author      *string    `json:"author"`
		CoverPath   *string    `json:"cover_path"`
		PageCount   *int64     `json:"page_count"`
		CompletedAt store.Time `json:"completed_at"`
	}
	out := []verdict{}
	for _, c := range completed {
		b, err := getBook(ctx, s.DB, c.BookID)
		if err != nil {
			return err
		}
		if b == nil || b.Rating != nil || (b.Review != nil && trimPy(*b.Review) != "") {
			continue
		}
		out = append(out, verdict{ID: b.ID, Title: b.Title, Author: b.Author, CoverPath: b.CoverPath, PageCount: b.PageCount, CompletedAt: c.CompletedAt})
	}
	return ok(w, out)
}

func (s *Server) streaksHandler(w http.ResponseWriter, r *http.Request) error {
	dates, err := readingDates(r.Context(), s.DB)
	if err != nil {
		return err
	}
	return ok(w, streaksFrom(dates))
}

func (s *Server) heatmapHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	year := q.IntRange("year", 2024, 2000, 2100)
	if err := q.err(); err != nil {
		return err
	}
	start, end := newDate(int(year), 1, 1), newDate(int(year), 12, 31)
	where, args := sessionFilters(localDayBounds(start, end))
	rows, err := s.DB.QueryContext(r.Context(), "SELECT date("+localStart+") AS day, coalesce(sum(reading_sessions.duration), 0) AS seconds FROM reading_sessions WHERE "+where+" GROUP BY day ORDER BY day", args...)
	if err != nil {
		return err
	}
	days := map[string]int64{}
	for rows.Next() {
		var d *string
		var v int64
		if err := rows.Scan(&d, &v); err != nil {
			rows.Close()
			return err
		}
		if d != nil {
			days[*d] = v
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	type day struct {
		Date    string `json:"date"`
		Seconds int64  `json:"seconds"`
	}
	out := []day{}
	for d := start; !end.before(d); d = d.addDays(1) {
		out = append(out, day{Date: d.iso(), Seconds: days[d.iso()]})
	}
	return ok(w, out)
}

func (s *Server) distributionHandler(w http.ResponseWriter, r *http.Request) error {
	from, to, err := s.statsRange(r)
	if err != nil {
		return err
	}
	where, args := sessionFilters(from, to)
	by := func(format string) (map[int]int64, error) {
		rows, err := s.DB.QueryContext(r.Context(), "SELECT strftime('"+format+"', "+localStart+") AS k, coalesce(sum(reading_sessions.duration), 0) AS seconds FROM reading_sessions WHERE "+where+" GROUP BY k", args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := map[int]int64{}
		for rows.Next() {
			var k *string
			var v int64
			if err := rows.Scan(&k, &v); err != nil {
				return nil, err
			}
			if k != nil {
				n, _ := strconv.Atoi(*k)
				out[n] = v
			}
		}
		return out, rows.Err()
	}
	hours, err := by("%H")
	if err != nil {
		return err
	}
	weekdays, err := by("%w")
	if err != nil {
		return err
	}
	type hour struct {
		Hour    int   `json:"hour"`
		Seconds int64 `json:"seconds"`
	}
	type weekday struct {
		Weekday int   `json:"weekday"`
		Seconds int64 `json:"seconds"`
	}
	byHour := make([]hour, 24)
	for h := range byHour {
		byHour[h] = hour{h, hours[h]}
	}
	byWeekday := make([]weekday, 7)
	for d := range byWeekday {
		byWeekday[d] = weekday{d, weekdays[d]}
	}
	return ok(w, map[string]any{"by_hour": byHour, "by_weekday": byWeekday})
}

func (s *Server) byGroupHandler(kind string) handlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		from, to, err := s.statsRange(r)
		if err != nil {
			return err
		}
		where, args := sessionFilters(from, to)
		var query, key string
		if kind == "author" {
			key = "author"
			query = "SELECT books.author, coalesce(sum(reading_sessions.duration), 0), count(reading_sessions.id) FROM books JOIN reading_sessions ON reading_sessions.book_id = books.id WHERE " + where + " AND books.author IS NOT NULL GROUP BY books.author ORDER BY sum(reading_sessions.duration) DESC"
		} else {
			key = "tag"
			query = "SELECT tags.name, coalesce(sum(reading_sessions.duration), 0), count(reading_sessions.id) FROM tags JOIN book_tags ON book_tags.tag_id = tags.id JOIN reading_sessions ON reading_sessions.book_id = book_tags.book_id WHERE " + where + " GROUP BY tags.name ORDER BY sum(reading_sessions.duration) DESC"
		}
		rows, err := s.DB.QueryContext(r.Context(), query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var name string
			var total, count int64
			if err := rows.Scan(&name, &total, &count); err != nil {
				return err
			}
			out = append(out, map[string]any{key: name, "total_seconds": total, "session_count": count})
		}
		if err := rows.Err(); err != nil {
			return err
		}
		return ok(w, out)
	}
}

func (s *Server) recentSessionsHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	limit := q.IntRange("limit", 10, 1, 50)
	if err := q.err(); err != nil {
		return err
	}
	rows, err := s.DB.QueryContext(r.Context(), "SELECT books.id, books.title, books.author, reading_sessions.duration, reading_sessions.pages_read, reading_sessions.start_time FROM reading_sessions JOIN books ON reading_sessions.book_id = books.id WHERE reading_sessions.dismissed = 0 AND reading_sessions.start_time IS NOT NULL AND reading_sessions.duration > 0 ORDER BY reading_sessions.start_time DESC LIMIT ?", limit)
	if err != nil {
		return err
	}
	defer rows.Close()
	type recent struct {
		BookID    string  `json:"book_id"`
		Title     string  `json:"title"`
		Author    *string `json:"author"`
		Duration  *int64  `json:"duration"`
		PagesRead *int64  `json:"pages_read"`
		StartTime *string `json:"start_time"`
	}
	out := []recent{}
	for rows.Next() {
		var rc recent
		var start store.Time
		if err := rows.Scan(&rc.BookID, &rc.Title, &rc.Author, &rc.Duration, &rc.PagesRead, &start); err != nil {
			return err
		}
		if start.Valid {
			rc.StartTime = ptr(start.ISO())
		}
		out = append(out, rc)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return ok(w, out)
}

func (s *Server) calendarHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	year := int(q.IntRange("year", 2024, 2000, 2100))
	month := int(q.IntRange("month", 1, 1, 12))
	if err := q.err(); err != nil {
		return err
	}
	first := newDate(year, time.Month(month), 1)
	last := first.addDays(32)
	last = newDate(last.Year(), last.Month(), 1).addDays(-1)
	start, end := localDayBounds(first, last)
	rows, err := s.DB.QueryContext(r.Context(), "SELECT date("+localStart+") AS day, books.id AS book_id, books.title, coalesce(sum(reading_sessions.duration), 0) AS total_duration FROM reading_sessions JOIN books ON reading_sessions.book_id = books.id "+
		"WHERE reading_sessions.dismissed = 0 AND reading_sessions.start_time IS NOT NULL AND reading_sessions.start_time >= ? AND reading_sessions.start_time <= ? AND reading_sessions.duration > 0 "+
		"GROUP BY day, books.id ORDER BY day, sum(reading_sessions.duration) DESC", start, end)
	if err != nil {
		return err
	}
	type entry struct {
		BookID   string `json:"book_id"`
		Title    string `json:"title"`
		Duration int64  `json:"duration"`
	}
	days := map[string][]entry{}
	for rows.Next() {
		var day *string
		var e entry
		if err := rows.Scan(&day, &e.BookID, &e.Title, &e.Duration); err != nil {
			rows.Close()
			return err
		}
		if day != nil {
			days[*day] = append(days[*day], e)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	type dayOut struct {
		Date  string  `json:"date"`
		Books []entry `json:"books"`
	}
	out := []dayOut{}
	for d := first; d.Month() == first.Month(); d = d.addDays(1) {
		books := days[d.iso()]
		if books == nil {
			books = []entry{}
		}
		out = append(out, dayOut{Date: d.iso(), Books: books})
	}
	return ok(w, out)
}

func (s *Server) bookStatsHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id := r.PathValue("book_id")
	b, err := getBook(ctx, s.DB, id)
	if err != nil {
		return err
	}
	if b == nil {
		return notFound("Book not found")
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT start_time, duration, pages_read FROM reading_sessions WHERE book_id = ? AND dismissed = 0 ORDER BY start_time", id)
	if err != nil {
		return err
	}
	var seconds, pages, count int64
	var firstS, lastS store.Time
	for rows.Next() {
		var st store.Time
		var d, p *int64
		if err := rows.Scan(&st, &d, &p); err != nil {
			rows.Close()
			return err
		}
		count++
		seconds += deref(d)
		pages += deref(p)
		if st.Valid {
			if !firstS.Valid || st.Before(firstS.Time) {
				firstS = st
			}
			if !lastS.Valid || st.After(lastS.Time) {
				lastS = st
			}
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	var speed *float64
	if seconds > 0 && pages > 0 {
		speed = ptr(pyRound(float64(pages)/float64(seconds)*3600, 2))
	}
	var progress *float64
	err = s.DB.QueryRowContext(ctx, "SELECT progress FROM reading_progress WHERE book_id = ? ORDER BY updated_at DESC LIMIT 1", id).Scan(&progress)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	return ok(w, map[string]any{
		"book_id": b.ID, "title": b.Title, "author": b.Author,
		"total_seconds": seconds, "total_pages": pages, "session_count": count,
		"avg_pages_per_hour": speed, "first_session": firstS, "last_session": lastS, "progress": progress,
	})
}

var _ = math.Max
