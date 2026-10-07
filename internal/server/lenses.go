package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"

	"github.com/audemed44/shelfloom/internal/store"
)

// lensFilter is LensFilterState.
type lensFilter struct {
	Genres    []int64  `json:"genres"`
	Tags      []int64  `json:"tags"`
	SeriesIDs []int64  `json:"series_ids"`
	Authors   []string `json:"authors"`
	Formats   []string `json:"formats"`
	HasGenre  *bool    `json:"has_genre"`
	HasTag    *bool    `json:"has_tag"`
	HasAuthor *bool    `json:"has_author"`
	HasSeries *bool    `json:"has_series"`
	MinRating *float64 `json:"min_rating"`
	HasRating *bool    `json:"has_rating"`
	HasReview *bool    `json:"has_review"`
	Mode      string   `json:"mode"`
	ShelfID   *int64   `json:"shelf_id"`
	Status    *string  `json:"status"`
}

func (f *lensFilter) normalise() {
	for _, l := range []*[]int64{&f.Genres, &f.Tags, &f.SeriesIDs} {
		if *l == nil {
			*l = []int64{}
		}
	}
	for _, l := range []*[]string{&f.Authors, &f.Formats} {
		if *l == nil {
			*l = []string{}
		}
	}
	if f.Mode == "" {
		f.Mode = "and"
	}
}

// pydanticJSON is model_dump_json(): compact, fields in order, floats as
// Python writes them.
func (f lensFilter) pydanticJSON() string {
	var b strings.Builder
	ints := func(v []int64) string {
		parts := make([]string, len(v))
		for i, n := range v {
			parts[i] = strconv.FormatInt(n, 10)
		}
		return "[" + strings.Join(parts, ",") + "]"
	}
	strs := func(v []string) string {
		parts := make([]string, len(v))
		for i, s := range v {
			enc, _ := json.Marshal(s)
			parts[i] = string(enc)
		}
		return "[" + strings.Join(parts, ",") + "]"
	}
	optBool := func(v *bool) string {
		if v == nil {
			return "null"
		}
		return strconv.FormatBool(*v)
	}
	b.WriteString(`{"genres":` + ints(f.Genres) + `,"tags":` + ints(f.Tags) + `,"series_ids":` + ints(f.SeriesIDs))
	b.WriteString(`,"authors":` + strs(f.Authors) + `,"formats":` + strs(f.Formats))
	b.WriteString(`,"has_genre":` + optBool(f.HasGenre) + `,"has_tag":` + optBool(f.HasTag) + `,"has_author":` + optBool(f.HasAuthor) + `,"has_series":` + optBool(f.HasSeries))
	b.WriteString(`,"min_rating":`)
	if f.MinRating == nil {
		b.WriteString("null")
	} else {
		b.WriteString(pyFloatRepr(*f.MinRating))
	}
	b.WriteString(`,"has_rating":` + optBool(f.HasRating) + `,"has_review":` + optBool(f.HasReview))
	mode, _ := json.Marshal(f.Mode)
	b.WriteString(`,"mode":` + string(mode) + `,"shelf_id":`)
	if f.ShelfID == nil {
		b.WriteString("null")
	} else {
		b.WriteString(strconv.FormatInt(*f.ShelfID, 10))
	}
	b.WriteString(`,"status":`)
	if f.Status == nil {
		b.WriteString("null")
	} else {
		st, _ := json.Marshal(*f.Status)
		b.Write(st)
	}
	b.WriteString("}")
	return b.String()
}

// pyFloatRepr is Python's repr() of a float.
func pyFloatRepr(f float64) string {
	if math.IsInf(f, 1) {
		return "Infinity"
	}
	abs := math.Abs(f)
	if abs != 0 && (abs < 1e-4 || abs >= 1e16) {
		return strconv.FormatFloat(f, 'e', -1, 64)
	}
	s := strconv.FormatFloat(f, 'f', -1, 64)
	if !strings.ContainsAny(s, ".") {
		s += ".0"
	}
	return s
}

// parseLensFilter is LensFilterState.model_validate(); loc prefixes errors.
func parseLensFilter(raw json.RawMessage, loc []any) (lensFilter, []validationIssue) {
	var f lensFilter
	var issues []validationIssue
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return f, []validationIssue{{Type: "model_type", Loc: loc, Msg: "Input should be a valid dictionary or instance of LensFilterState", Input: nil}}
	}
	fb := &body{raw: obj}
	f.Genres = fb.IntList("genres", false)
	f.Tags = fb.IntList("tags", false)
	f.SeriesIDs = fb.IntList("series_ids", false)
	f.Authors = fb.StrList("authors", false)
	f.Formats = fb.StrList("formats", false)
	f.HasGenre = fb.Bool("has_genre", false, true)
	f.HasTag = fb.Bool("has_tag", false, true)
	f.HasAuthor = fb.Bool("has_author", false, true)
	f.HasSeries = fb.Bool("has_series", false, true)
	f.MinRating = fb.Float("min_rating", false, true)
	f.HasRating = fb.Bool("has_rating", false, true)
	f.HasReview = fb.Bool("has_review", false, true)
	if m := fb.Str("mode", false, false); m != nil {
		if *m != "and" && *m != "or" {
			fb.errs = append(fb.errs, validationIssue{Type: "literal_error", Loc: []any{"body", "mode"}, Msg: "Input should be 'and' or 'or'", Input: *m})
		}
		f.Mode = *m
	}
	f.ShelfID = fb.Int("shelf_id", false, true)
	f.Status = fb.Str("status", false, true)
	for _, e := range fb.errs {
		e.Loc = append(append([]any{}, loc...), e.Loc[1:]...)
		issues = append(issues, e)
	}
	f.normalise()
	return f, issues
}

// bookFilter turns a lens into list_books arguments (_fs_to_kwargs).
func (f lensFilter) bookFilter() bookFilter {
	bf := defaultBookFilter()
	join := func(ids []int64) *string {
		parts := make([]string, len(ids))
		for i, n := range ids {
			parts[i] = strconv.FormatInt(n, 10)
		}
		s := strings.Join(parts, ",")
		return &s
	}
	if len(f.Genres) > 0 {
		bf.Genre = join(f.Genres)
	}
	if len(f.Tags) > 0 {
		bf.Tag = join(f.Tags)
	}
	if len(f.SeriesIDs) > 0 {
		bf.SeriesID = join(f.SeriesIDs)
	}
	if len(f.Authors) > 0 {
		bf.Author = ptr(strings.Join(f.Authors, ","))
	}
	if len(f.Formats) > 0 {
		bf.Format = ptr(strings.Join(f.Formats, ","))
	}
	bf.HasGenre, bf.HasTag, bf.HasAuthor, bf.HasSeries = f.HasGenre, f.HasTag, f.HasAuthor, f.HasSeries
	bf.MinRating, bf.HasRating, bf.HasReview = f.MinRating, f.HasRating, f.HasReview
	bf.ShelfID, bf.Status = f.ShelfID, f.Status
	bf.FilterMode = f.Mode
	return bf
}

type lensRow struct {
	ID          int64
	Name        string
	FilterState string
	CreatedAt   store.Time
	UpdatedAt   store.Time
}

type lensResponse struct {
	ID            int64      `json:"id"`
	Name          string     `json:"name"`
	FilterState   lensFilter `json:"filter_state"`
	BookCount     int64      `json:"book_count"`
	CoverBookID   *string    `json:"cover_book_id"`
	CoverBookPath *string    `json:"cover_book_path"`
	CreatedAt     store.Time `json:"created_at"`
	UpdatedAt     store.Time `json:"updated_at"`
}

func getLens(ctx context.Context, q querier, id int64) (*lensRow, error) {
	var l lensRow
	err := q.QueryRowContext(ctx, "SELECT id, name, filter_state, created_at, updated_at FROM lenses WHERE id = ?", id).Scan(&l.ID, &l.Name, &l.FilterState, &l.CreatedAt, &l.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("Lens %d not found", id)
	}
	return &l, err
}

func storedLensFilter(l *lensRow) (lensFilter, error) {
	f, issues := parseLensFilter(json.RawMessage(l.FilterState), []any{})
	if len(issues) > 0 {
		return f, invalid(issues...)
	}
	return f, nil
}

// lensSummary is a lens with its book count and the first book as cover.
func lensSummary(ctx context.Context, q querier, l *lensRow) (lensResponse, error) {
	f, err := storedLensFilter(l)
	if err != nil {
		return lensResponse{}, err
	}
	bf := f.bookFilter()
	bf.PerPage = 1
	books, total, _, err := listBooks(ctx, q, bf)
	if err != nil {
		return lensResponse{}, err
	}
	resp := lensResponse{ID: l.ID, Name: l.Name, FilterState: f, BookCount: total, CreatedAt: l.CreatedAt, UpdatedAt: l.UpdatedAt}
	if len(books) > 0 {
		resp.CoverBookID = &books[0].ID
		resp.CoverBookPath = books[0].CoverPath
	}
	return resp, nil
}

func (s *Server) listLensesHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	rows, err := s.DB.QueryContext(ctx, "SELECT id, name, filter_state, created_at, updated_at FROM lenses ORDER BY sort_order, created_at")
	if err != nil {
		return err
	}
	var lenses []*lensRow
	for rows.Next() {
		var l lensRow
		if err := rows.Scan(&l.ID, &l.Name, &l.FilterState, &l.CreatedAt, &l.UpdatedAt); err != nil {
			rows.Close()
			return err
		}
		lenses = append(lenses, &l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	out := []lensResponse{}
	for _, l := range lenses {
		resp, err := lensSummary(ctx, s.DB, l)
		if err != nil {
			return err
		}
		out = append(out, resp)
	}
	return ok(w, out)
}

func (s *Server) getLensHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "lens_id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	l, err := getLens(ctx, s.DB, id)
	if err != nil {
		return err
	}
	resp, err := lensSummary(ctx, s.DB, l)
	if err != nil {
		return err
	}
	return ok(w, resp)
}

func (s *Server) createLensHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	name := b.Str("name", true, false)
	var f lensFilter
	if !b.Has("filter_state") {
		b.missing("filter_state")
	} else {
		var issues []validationIssue
		f, issues = parseLensFilter(b.Raw("filter_state"), []any{"body", "filter_state"})
		b.errs = append(b.errs, issues...)
	}
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	res, err := s.DB.ExecContext(ctx, "INSERT INTO lenses (name, filter_state, sort_order) VALUES (?, ?, 0)", *name, f.pydanticJSON())
	if err != nil {
		return err
	}
	id, _ := res.LastInsertId()
	l, err := getLens(ctx, s.DB, id)
	if err != nil {
		return err
	}
	stored, err := storedLensFilter(l)
	if err != nil {
		return err
	}
	return created(w, lensResponse{ID: l.ID, Name: l.Name, FilterState: stored, CreatedAt: l.CreatedAt, UpdatedAt: l.UpdatedAt})
}

func (s *Server) updateLensHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "lens_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	name := b.Str("name", false, true)
	var f *lensFilter
	if b.Has("filter_state") && !b.isNull("filter_state") {
		parsed, issues := parseLensFilter(b.Raw("filter_state"), []any{"body", "filter_state"})
		b.errs = append(b.errs, issues...)
		f = &parsed
	}
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	l, err := getLens(ctx, s.DB, id)
	if err != nil {
		return err
	}
	var sets []string
	var args []any
	if name != nil && *name != l.Name {
		sets, args = append(sets, "name = ?"), append(args, *name)
	}
	if f != nil {
		if js := f.pydanticJSON(); js != l.FilterState {
			sets, args = append(sets, "filter_state = ?"), append(args, js)
		}
	}
	if len(sets) > 0 {
		sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
		if _, err := s.DB.ExecContext(ctx, "UPDATE lenses SET "+strings.Join(sets, ", ")+" WHERE id = ?", append(args, id)...); err != nil {
			return err
		}
		if l, err = getLens(ctx, s.DB, id); err != nil {
			return err
		}
	}
	resp, err := lensSummary(ctx, s.DB, l)
	if err != nil {
		return err
	}
	return ok(w, resp)
}

func (s *Server) deleteLensHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "lens_id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := getLens(ctx, s.DB, id); err != nil {
		return err
	}
	if _, err := s.DB.ExecContext(ctx, "DELETE FROM lenses WHERE id = ?", id); err != nil {
		return err
	}
	return noContent(w)
}

func (s *Server) lensBooksHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "lens_id")
	if err != nil {
		return err
	}
	q := newQuery(r)
	page := q.IntRange("page", 1, 1, math.MaxInt64)
	perPage := q.IntRange("per_page", 25, 1, 200)
	sortBy := q.StrDefault("sort", "created_at")
	search := q.Str("search")
	group := q.BoolDefault("group_by_series", false)
	if err := q.err(); err != nil {
		return err
	}
	ctx := r.Context()
	l, err := getLens(ctx, s.DB, id)
	if err != nil {
		return err
	}
	f, err := storedLensFilter(l)
	if err != nil {
		return err
	}
	bf := f.bookFilter()
	bf.Page, bf.PerPage, bf.Sort, bf.Search, bf.GroupBySeries = page, perPage, sortBy, search, group
	books, total, pages, err := listBooks(ctx, s.DB, bf)
	if err != nil {
		return err
	}
	items, err := bookListItems(ctx, s.DB, books)
	if err != nil {
		return err
	}
	return ok(w, bookListResponse{Items: items, Total: total, Page: page, PerPage: perPage, Pages: pages})
}
