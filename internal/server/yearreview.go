package server

import (
	"context"
	"database/sql"
	"errors"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/audemed44/shelfloom/internal/store"
)

func trimPy(s string) string { return strings.TrimSpace(s) }

func yearBounds(year int) (store.Time, store.Time) {
	return localDayBounds(newDate(year, 1, 1), newDate(year, 12, 31))
}

func isLeap(y int) bool { return y%4 == 0 && (y%100 != 0 || y%400 == 0) }

func yearFraction(year int, t date) float64 {
	if year < t.Year() {
		return 1
	}
	if year > t.Year() {
		return 0
	}
	days := 365.0
	if isLeap(year) {
		days = 366
	}
	return float64(t.YearDay()) / days
}

type goalProgressOut struct {
	Year           int      `json:"year"`
	Target         *int64   `json:"target"`
	Completed      int      `json:"completed"`
	ExpectedByNow  *float64 `json:"expected_by_now"`
	Status         *string  `json:"status"`
	Remaining      *int64   `json:"remaining"`
	PerMonthNeeded *float64 `json:"per_month_needed"`
}

func goalProgress(ctx context.Context, q querier, year int) (*goalProgressOut, error) {
	t := today()
	var books int64
	err := q.QueryRowContext(ctx, "SELECT books FROM reading_goals WHERE year = ?", year).Scan(&books)
	hasGoal := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	start, end := yearBounds(year)
	completed, err := booksCompleted(ctx, q, start, end)
	if err != nil {
		return nil, err
	}
	out := &goalProgressOut{Year: year, Completed: len(completed)}
	if !hasGoal {
		return out, nil
	}
	out.Target = &books
	fraction := yearFraction(year, t)
	expected := float64(books) * fraction
	remaining := max(0, books-int64(len(completed)))
	var status string
	switch {
	case int64(len(completed)) >= books:
		status = "done"
	case fraction >= 1:
		status = "missed"
	case float64(len(completed))-expected >= 1:
		status = "ahead"
	case float64(len(completed))-expected <= -1:
		status = "behind"
	default:
		status = "on_track"
	}
	monthsLeft := 0
	switch {
	case year == t.Year():
		monthsLeft = 12 - int(t.Month()) + 1
	case year > t.Year():
		monthsLeft = 12
	}
	out.ExpectedByNow = ptr(pyRound(expected, 1))
	out.Status = &status
	out.Remaining = &remaining
	if remaining != 0 && monthsLeft != 0 {
		out.PerMonthNeeded = ptr(pyRound(float64(remaining)/float64(monthsLeft), 1))
	}
	return out, nil
}

func (s *Server) yearsHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	years := map[int]bool{today().Year(): true}
	rows, err := s.DB.QueryContext(ctx, "SELECT DISTINCT strftime('%Y', "+localStart+") FROM reading_sessions WHERE reading_sessions.start_time IS NOT NULL AND reading_sessions.dismissed = 0")
	if err != nil {
		return err
	}
	for rows.Next() {
		var y *string
		if err := rows.Scan(&y); err != nil {
			rows.Close()
			return err
		}
		if y != nil && *y != "" {
			n, _ := strconv.Atoi(*y)
			years[n] = true
		}
	}
	rows.Close()
	grows, err := s.DB.QueryContext(ctx, "SELECT year FROM reading_goals")
	if err != nil {
		return err
	}
	for grows.Next() {
		var y int
		if err := grows.Scan(&y); err != nil {
			grows.Close()
			return err
		}
		years[y] = true
	}
	grows.Close()
	completed, err := booksCompleted(ctx, s.DB, store.Time{}, store.Time{})
	if err != nil {
		return err
	}
	for _, c := range completed {
		if c.CompletedAt.Valid {
			years[c.CompletedAt.Year()] = true
		}
	}
	out := make([]int, 0, len(years))
	for y := range years {
		out = append(out, y)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(out)))
	return ok(w, out)
}

func timeOfDay(hour int) string {
	switch {
	case hour >= 5 && hour < 12:
		return "morning"
	case hour >= 12 && hour < 17:
		return "afternoon"
	case hour >= 17 && hour < 22:
		return "evening"
	}
	return "night"
}

// counter is collections.Counter: counts plus first-insertion order, so
// mostCommon breaks ties the way Python does.
type counter[K comparable] struct {
	order  []K
	counts map[K]int64
}

func newCounter[K comparable]() *counter[K] { return &counter[K]{counts: map[K]int64{}} }

func (c *counter[K]) add(k K, n int64) {
	if _, seen := c.counts[k]; !seen {
		c.order = append(c.order, k)
	}
	c.counts[k] += n
}

func (c *counter[K]) mostCommon(n int) []K {
	keys := append([]K(nil), c.order...)
	sort.SliceStable(keys, func(i, j int) bool { return c.counts[keys[i]] > c.counts[keys[j]] })
	if n >= 0 && len(keys) > n {
		keys = keys[:n]
	}
	return keys
}

type finishedBook struct {
	ID          string     `json:"id"`
	Title       string     `json:"title"`
	Author      *string    `json:"author"`
	CoverPath   *string    `json:"cover_path"`
	CompletedAt store.Time `json:"completed_at"`
	Rating      *float64   `json:"rating"`
	PageCount   *int64     `json:"page_count"`
	DaysToRead  *int64     `json:"days_to_read"`
}

func (s *Server) yearReviewHandler(w http.ResponseWriter, r *http.Request) error {
	year64, err := pathInt(r, "year")
	if err != nil {
		return err
	}
	year := int(year64)
	if year < 1900 || year > 2200 {
		return unprocessable("Year out of range")
	}
	ctx := r.Context()
	start, end := yearBounds(year)
	completed, err := booksCompleted(ctx, s.DB, start, end)
	if err != nil {
		return err
	}
	sort.SliceStable(completed, func(i, j int) bool { return completed[i].CompletedAt.Before(completed[j].CompletedAt.Time) })
	ids := make([]string, len(completed))
	for i, c := range completed {
		ids[i] = c.BookID
	}
	books := map[string]*Book{}
	if len(ids) > 0 {
		list, err := queryBooks(ctx, s.DB, "SELECT "+bookColumns("books")+" FROM books WHERE books.id IN ("+placeholders(len(ids))+")", anySlice(ids)...)
		if err != nil {
			return err
		}
		for _, b := range list {
			books[b.ID] = b
		}
	}

	type month struct {
		Month   int   `json:"month"`
		Books   int   `json:"books"`
		Seconds int64 `json:"seconds"`
		Pages   int64 `json:"pages"`
	}
	months := make([]month, 12)
	for i := range months {
		months[i].Month = i + 1
	}
	for _, c := range completed {
		months[c.CompletedAt.Month()-1].Books++
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT reading_sessions.book_id, reading_sessions.start_time, reading_sessions.duration, reading_sessions.pages_read FROM reading_sessions WHERE reading_sessions.dismissed = 0 AND reading_sessions.start_time IS NOT NULL AND reading_sessions.start_time >= ? AND reading_sessions.start_time <= ?", start, end)
	if err != nil {
		return err
	}
	perDay := newCounter[date]()
	tod := newCounter[string]()
	firstSession := map[string]store.Time{}
	sessions := 0
	for rows.Next() {
		var bookID string
		var started store.Time
		var duration, pages *int64
		if err := rows.Scan(&bookID, &started, &duration, &pages); err != nil {
			rows.Close()
			return err
		}
		sessions++
		local := started.Local()
		seconds := deref(duration)
		m := &months[local.Month()-1]
		m.Seconds += seconds
		m.Pages += deref(pages)
		if seconds > 0 {
			perDay.add(dateOf(local), seconds)
		}
		tod.add(timeOfDay(local.Hour()), seconds)
		if f, seen := firstSession[bookID]; !seen || local.Before(f.Time) {
			firstSession[bookID] = local
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	// First sessions before this year still count for how long a book took.
	if len(ids) > 0 {
		frows, err := s.DB.QueryContext(ctx, "SELECT reading_sessions.book_id, min(reading_sessions.start_time) FROM reading_sessions WHERE reading_sessions.book_id IN ("+placeholders(len(ids))+") AND reading_sessions.dismissed = 0 AND reading_sessions.start_time IS NOT NULL GROUP BY reading_sessions.book_id", anySlice(ids)...)
		if err != nil {
			return err
		}
		for frows.Next() {
			var bookID string
			var first store.Time
			if err := frows.Scan(&bookID, &first); err != nil {
				frows.Close()
				return err
			}
			firstSession[bookID] = first.Local()
		}
		frows.Close()
	}

	genres := newCounter[string]()
	if len(ids) > 0 {
		grows, err := s.DB.QueryContext(ctx, "SELECT genres.name FROM genres JOIN book_genres ON genres.id = book_genres.genre_id WHERE book_genres.book_id IN ("+placeholders(len(ids))+")", anySlice(ids)...)
		if err != nil {
			return err
		}
		for grows.Next() {
			var name string
			if err := grows.Scan(&name); err != nil {
				grows.Close()
				return err
			}
			genres.add(name, 1)
		}
		grows.Close()
	}
	authors := newCounter[string]()
	for _, id := range ids {
		if b := books[id]; b != nil && b.Author != nil && *b.Author != "" {
			authors.add(*b.Author, 1)
		}
	}

	finished := []finishedBook{}
	for _, c := range completed {
		f := finishedBook{ID: c.BookID, Title: c.Title, Author: c.Author, CoverPath: c.CoverPath, CompletedAt: c.CompletedAt}
		if b := books[c.BookID]; b != nil {
			f.Rating, f.PageCount = b.Rating, b.PageCount
		}
		if first, seen := firstSession[c.BookID]; seen {
			if days := int64(dateOf(first).daysUntil(dateOf(c.CompletedAt))) + 1; days > 0 {
				f.DaysToRead = &days
			}
		}
		finished = append(finished, f)
	}

	// pick is sorted(candidates, key=…, reverse=…)[0]: the first of the
	// largest (or smallest) values, in list order.
	pick := func(key func(f finishedBook) (float64, bool), largest bool) *finishedBook {
		var best *finishedBook
		var bestV float64
		for i := range finished {
			v, has := key(finished[i])
			if !has {
				continue
			}
			if best == nil || (largest && v > bestV) || (!largest && v < bestV) {
				best, bestV = &finished[i], v
			}
		}
		return best
	}
	pageCount := func(f finishedBook) (float64, bool) {
		if f.PageCount == nil {
			return 0, false
		}
		return float64(*f.PageCount), true
	}
	daysToRead := func(f finishedBook) (float64, bool) {
		if f.DaysToRead == nil {
			return 0, false
		}
		return float64(*f.DaysToRead), true
	}
	rating := func(f finishedBook) (float64, bool) {
		if f.Rating == nil {
			return 0, false
		}
		return *f.Rating, true
	}

	var totalSeconds, totalPages int64
	for _, m := range months {
		totalSeconds += m.Seconds
		totalPages += m.Pages
	}
	var busiest any
	if len(perDay.order) > 0 {
		var bd date
		var bv int64 = math.MinInt64
		for _, d := range perDay.order {
			if v := perDay.counts[d]; v > bv {
				bd, bv = d, v
			}
		}
		busiest = map[string]any{"date": bd.iso(), "seconds": bv}
	}
	var favourite *string
	if totalSeconds != 0 && len(tod.order) > 0 {
		favourite = &tod.mostCommon(1)[0]
	}
	longest, run := 0, 0
	days := append([]date(nil), perDay.order...)
	sort.Slice(days, func(i, j int) bool { return days[i].before(days[j]) })
	for i, d := range days {
		if i > 0 && days[i-1].daysUntil(d) == 1 {
			run++
		} else {
			run = 1
		}
		longest = max(longest, run)
	}

	var avgRating *float64
	var ratingSum float64
	rated := 0
	for _, f := range finished {
		if f.Rating != nil && *f.Rating != 0 {
			ratingSum += *f.Rating
			rated++
		}
	}
	if rated > 0 {
		avgRating = ptr(pyRound(ratingSum/float64(rated), 2))
	}
	var avgDays *int64
	var daySum, dayCount int64
	for _, f := range finished {
		if f.DaysToRead != nil && *f.DaysToRead != 0 {
			daySum += *f.DaysToRead
			dayCount++
		}
	}
	if dayCount > 0 {
		v := int64(math.Ceil(float64(daySum) / float64(dayCount)))
		avgDays = &v
	}

	type named struct {
		Name  string `json:"name"`
		Books int64  `json:"books"`
	}
	topAuthors, topGenres := []named{}, []named{}
	for _, a := range authors.mostCommon(5) {
		topAuthors = append(topAuthors, named{a, authors.counts[a]})
	}
	for _, g := range genres.mostCommon(5) {
		topGenres = append(topGenres, named{g, genres.counts[g]})
	}
	goal, err := goalProgress(ctx, s.DB, year)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{
		"year": year,
		"goal": goal,
		"totals": map[string]any{
			"books": len(finished), "pages": totalPages, "seconds": totalSeconds, "sessions": sessions,
			"reading_days": len(perDay.order), "longest_streak": longest,
		},
		"months":      months,
		"books":       finished,
		"top_authors": topAuthors,
		"top_genres":  topGenres,
		"highlights": map[string]any{
			"longest_book":   pick(pageCount, true),
			"shortest_book":  pick(pageCount, false),
			"fastest_read":   pick(daysToRead, false),
			"top_rated":      pick(rating, true),
			"busiest_day":    busiest,
			"favourite_time": favourite,
		},
		"average_rating":       avgRating,
		"average_days_to_read": avgDays,
	})
}

func (s *Server) getGoalHandler(w http.ResponseWriter, r *http.Request) error {
	year, err := pathInt(r, "year")
	if err != nil {
		return err
	}
	out, err := goalProgress(r.Context(), s.DB, int(year))
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (s *Server) putGoalHandler(w http.ResponseWriter, r *http.Request) error {
	year, err := pathInt(r, "year")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	books := b.Int("books", true, false)
	if books != nil && (*books < 1 || *books > 1000) {
		typ, msg := "greater_than_equal", "Input should be greater than or equal to 1"
		if *books > 1000 {
			typ, msg = "less_than_equal", "Input should be less than or equal to 1000"
		}
		b.errs = append(b.errs, validationIssue{Type: typ, Loc: []any{"body", "books"}, Msg: msg, Input: *books})
	}
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := s.DB.ExecContext(ctx, "INSERT INTO reading_goals (year, books) VALUES (?, ?) ON CONFLICT(year) DO UPDATE SET books = excluded.books, updated_at = CASE WHEN reading_goals.books != excluded.books THEN CURRENT_TIMESTAMP ELSE reading_goals.updated_at END", year, *books); err != nil {
		return err
	}
	out, err := goalProgress(ctx, s.DB, int(year))
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (s *Server) deleteGoalHandler(w http.ResponseWriter, r *http.Request) error {
	year, err := pathInt(r, "year")
	if err != nil {
		return err
	}
	res, err := s.DB.ExecContext(r.Context(), "DELETE FROM reading_goals WHERE year = ?", year)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return notFound("No goal for that year")
	}
	return noContent(w)
}
