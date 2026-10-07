package server

import (
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/audemed44/shelfloom/internal/store"
)

var (
	bookCoverNoCache   = http.Header{"Cache-Control": {"no-cache"}}
	bookCoverImmutable = "public, max-age=31536000, immutable"
)

func (s *Server) listBooksHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	f := defaultBookFilter()
	f.Page = q.IntRange("page", 1, 1, math.MaxInt64)
	f.PerPage = q.IntRange("per_page", 50, 1, 200)
	f.Search = q.Str("search")
	f.ShelfID = q.Int("shelf_id")
	f.Format = q.Str("format")
	f.Tag = q.Str("tag")
	f.Genre = q.Str("genre")
	f.Author = q.Str("author")
	if sid := q.Int("series_id"); sid != nil {
		f.SeriesID = ptr(strconv.FormatInt(*sid, 10))
	}
	f.HasGenre = q.Bool("has_genre")
	f.HasTag = q.Bool("has_tag")
	f.HasAuthor = q.Bool("has_author")
	f.HasSeries = q.Bool("has_series")
	f.Status = q.Str("status")
	if mr := q.Float("min_rating"); mr != nil {
		if *mr < 0.5 {
			q.fail("min_rating", "greater_than_equal", "Input should be greater than or equal to 0.5", fmt.Sprint(*mr))
		} else if *mr > 5 {
			q.fail("min_rating", "less_than_equal", "Input should be less than or equal to 5", fmt.Sprint(*mr))
		} else {
			f.MinRating = mr
		}
	}
	f.HasRating = q.Bool("has_rating")
	f.HasReview = q.Bool("has_review")
	f.Sort = q.StrDefault("sort", "created_at")
	f.FilterMode = q.StrDefault("filter_mode", "and")
	f.GroupBySeries = q.BoolDefault("group_by_series", false)
	if err := q.err(); err != nil {
		return err
	}
	ctx := r.Context()
	books, total, pages, err := listBooks(ctx, s.DB, f)
	if err != nil {
		return err
	}
	items, err := bookListItems(ctx, s.DB, books)
	if err != nil {
		return err
	}
	return ok(w, bookListResponse{Items: items, Total: total, Page: f.Page, PerPage: f.PerPage, Pages: pages})
}

func (s *Server) getBookHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id := r.PathValue("book_id")
	b, err := mustGetBook(ctx, s.DB, id)
	if err != nil {
		return err
	}
	var progress *float64
	if err := s.DB.QueryRowContext(ctx, "SELECT max(reading_progress.progress) FROM reading_progress WHERE reading_progress.book_id = ?", id).Scan(&progress); err != nil {
		return err
	}
	var lastRead store.Time
	if err := s.DB.QueryRowContext(ctx, "SELECT max(reading_sessions.start_time) FROM reading_sessions WHERE reading_sessions.book_id = ? AND reading_sessions.dismissed = 0", id).Scan(&lastRead); err != nil {
		return err
	}
	tags, genres, err := bookMetadata(ctx, s.DB, []string{id})
	if err != nil {
		return err
	}
	return ok(w, newBookResponse(b, bookExtras{progress: progress, lastRead: lastRead, tags: tags[id], genres: genres[id], detail: true}))
}

type seriesNeighbour struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Sequence *float64 `json:"sequence"`
}

type seriesMembership struct {
	SeriesID   int64            `json:"series_id"`
	SeriesName string           `json:"series_name"`
	Sequence   *float64         `json:"sequence"`
	PrevBook   *seriesNeighbour `json:"prev_book"`
	NextBook   *seriesNeighbour `json:"next_book"`
}

func (s *Server) bookSeriesHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	id := r.PathValue("book_id")
	if _, err := mustGetBook(ctx, s.DB, id); err != nil {
		return err
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT series.id, series.name, book_series.sequence FROM book_series JOIN series ON book_series.series_id = series.id WHERE book_series.book_id = ?", id)
	if err != nil {
		return err
	}
	var memberships []seriesMembership
	for rows.Next() {
		var m seriesMembership
		if err := rows.Scan(&m.SeriesID, &m.SeriesName, &m.Sequence); err != nil {
			rows.Close()
			return err
		}
		memberships = append(memberships, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	out := []seriesMembership{}
	if len(memberships) == 0 {
		return ok(w, out)
	}
	ids := make([]any, len(memberships))
	for i, m := range memberships {
		ids[i] = m.SeriesID
	}
	type sibling struct {
		bookID   string
		title    string
		sequence *float64
	}
	siblings := map[int64][]sibling{}
	srows, err := s.DB.QueryContext(ctx, "SELECT book_series.series_id, book_series.book_id, book_series.sequence, books.title FROM book_series JOIN books ON book_series.book_id = books.id WHERE book_series.series_id IN ("+placeholders(len(ids))+") ORDER BY book_series.series_id, book_series.sequence NULLS LAST, books.title", ids...)
	if err != nil {
		return err
	}
	for srows.Next() {
		var sid int64
		var sb sibling
		if err := srows.Scan(&sid, &sb.bookID, &sb.sequence, &sb.title); err != nil {
			srows.Close()
			return err
		}
		siblings[sid] = append(siblings[sid], sb)
	}
	srows.Close()
	if err := srows.Err(); err != nil {
		return err
	}
	for _, m := range memberships {
		all := siblings[m.SeriesID]
		idx := -1
		for i, sb := range all {
			if sb.bookID == id {
				idx = i
				break
			}
		}
		if idx > 0 {
			p := all[idx-1]
			m.PrevBook = &seriesNeighbour{ID: p.bookID, Title: p.title, Sequence: p.sequence}
		}
		if idx >= 0 && idx < len(all)-1 {
			n := all[idx+1]
			m.NextBook = &seriesNeighbour{ID: n.bookID, Title: n.title, Sequence: n.sequence}
		}
		out = append(out, m)
	}
	return ok(w, out)
}

func (s *Server) createManualBookHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	title := b.Str("title", true, false)
	author := b.Str("author", false, true)
	isbn := b.Str("isbn", false, true)
	format := b.Str("format", false, false)
	publisher := b.Str("publisher", false, true)
	language := b.Str("language", false, true)
	description := b.Str("description", false, true)
	pageCount := b.Int("page_count", false, true)
	datePublished := b.Str("date_published", false, true)
	if err := b.err(); err != nil {
		return err
	}
	if format == nil {
		format = ptr("physical")
	}
	ctx := r.Context()
	shelf, err := ensureManualShelf(ctx, s.DB)
	if err != nil {
		return err
	}
	id := newUUID()
	if _, err := s.DB.ExecContext(ctx, `INSERT INTO books (id, title, author, isbn, format, file_path, shelf_id, publisher, language, description, page_count, date_published)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, *title, author, isbn, *format, "manual://"+id, shelf.ID, publisher, language, description, pageCount, datePublished); err != nil {
		return err
	}
	book, err := mustGetBook(ctx, s.DB, id)
	if err != nil {
		return err
	}
	return created(w, newBookResponse(book, bookExtras{}))
}

func (s *Server) updateBookHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	type field struct {
		name      string
		value     any
		clearable bool
	}
	var fields []field
	for _, name := range []string{"title", "author", "isbn", "publisher", "language", "description", "date_published", "review"} {
		if b.Has(name) {
			v := b.Str(name, false, true)
			fields = append(fields, field{name: name, value: v, clearable: name != "title"})
		}
	}
	var rating *float64
	if b.Has("rating") {
		rating = b.Float("rating", false, true)
		if rating != nil {
			doubled := *rating * 2
			if *rating < 0.5 || *rating > 5 {
				b.errs = append(b.errs, validationIssue{Type: "value_error", Loc: []any{"body", "rating"}, Msg: "Value error, Rating must be between 0.5 and 5.0", Input: *rating})
			} else if math.Abs(doubled-math.RoundToEven(doubled)) > 1e-9 {
				b.errs = append(b.errs, validationIssue{Type: "value_error", Loc: []any{"body", "rating"}, Msg: "Value error, Rating must be in 0.5 increments", Input: *rating})
			}
		}
		fields = append(fields, field{name: "rating", value: rating, clearable: true})
	}
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("book_id")
	book, err := mustGetBook(ctx, s.DB, id)
	if err != nil {
		return err
	}
	var sets []string
	var args []any
	for _, f := range fields {
		isNil := false
		switch v := f.value.(type) {
		case *string:
			isNil = v == nil
		case *float64:
			isNil = v == nil
		}
		if isNil && !f.clearable {
			continue
		}
		sets = append(sets, f.name+" = ?")
		args = append(args, f.value)
		if f.name == "review" {
			v := f.value.(*string)
			if v == nil || *v == "" {
				sets = append(sets, "review_updated_at = NULL")
			} else {
				sets = append(sets, "review_updated_at = CURRENT_TIMESTAMP")
			}
		}
	}
	if len(sets) > 0 {
		if _, err := s.DB.ExecContext(ctx, "UPDATE books SET "+strings.Join(sets, ", ")+" WHERE id = ?", append(args, id)...); err != nil {
			return err
		}
		if book, err = mustGetBook(ctx, s.DB, id); err != nil {
			return err
		}
	}
	resp, err := bookResponseFor(ctx, s.DB, book)
	if err != nil {
		return err
	}
	return ok(w, resp)
}

func (s *Server) deleteBookHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	deleteFile := q.BoolDefault("delete_file", false)
	if err := q.err(); err != nil {
		return err
	}
	ctx := r.Context()
	book, err := mustGetBook(ctx, s.DB, r.PathValue("book_id"))
	if err != nil {
		return err
	}
	if deleteFile {
		shelf, err := getShelf(ctx, s.DB, book.ShelfID)
		if err != nil {
			return err
		}
		if shelf != nil {
			full := filepath.Join(shelf.Path, book.FilePath)
			if _, err := os.Stat(full); err == nil {
				if err := os.Remove(full); err != nil {
					return err
				}
			}
			sdr := full + ".sdr"
			if st, err := os.Stat(sdr); err == nil && st.IsDir() {
				if err := os.RemoveAll(sdr); err != nil {
					return err
				}
			}
		}
	}
	if _, err := s.DB.ExecContext(ctx, "DELETE FROM books WHERE id = ?", book.ID); err != nil {
		return err
	}
	return noContent(w)
}

func (s *Server) bookCoverHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	book, err := getBook(ctx, s.DB, r.PathValue("book_id"))
	if err != nil {
		return err
	}
	if book == nil {
		return &httpError{status: http.StatusNotFound, detail: fmt.Sprintf("Book %s not found", r.PathValue("book_id")), header: bookCoverNoCache}
	}
	if book.CoverPath == nil || !fileExists(*book.CoverPath) {
		return &httpError{status: http.StatusNotFound, detail: "No cover available", header: bookCoverNoCache}
	}
	cache := "no-cache"
	if v := r.URL.Query(); v.Has("cover") || v.Has("v") {
		cache = bookCoverImmutable
	}
	w.Header().Set("Cache-Control", cache)
	return serveFile(w, r, *book.CoverPath, "image/jpeg", "")
}

func (s *Server) downloadBookHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	book, err := mustGetBook(ctx, s.DB, r.PathValue("book_id"))
	if err != nil {
		return err
	}
	if book.isManual() {
		return badRequest("Manual books have no downloadable file")
	}
	shelf, err := getShelf(ctx, s.DB, book.ShelfID)
	if err != nil {
		return err
	}
	if shelf == nil {
		return notFound("Shelf not found")
	}
	full := filepath.Join(shelf.Path, book.FilePath)
	if !fileExists(full) {
		return notFound("File not found on disk")
	}
	media := "application/pdf"
	if book.Format == "epub" {
		media = "application/epub+zip"
	}
	return serveFile(w, r, full, media, filepath.Base(full))
}

func (s *Server) moveBookHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	shelfID := b.Int("shelf_id", true, false)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	book, err := mustGetBook(ctx, s.DB, r.PathValue("book_id"))
	if err != nil {
		return err
	}
	if book.isManual() {
		return badRequest("Manual books cannot be moved between shelves")
	}
	if book, err = s.moveBook(ctx, book.ID, *shelfID); err != nil {
		if fe, isFileErr := err.(*fileOpError); isFileErr {
			return errStatus(http.StatusInternalServerError, fe.Error())
		}
		return err
	}
	resp, err := bookResponseFor(ctx, s.DB, book)
	if err != nil {
		return err
	}
	return ok(w, resp)
}

type bulkResult struct {
	BookID  string  `json:"book_id"`
	Success bool    `json:"success"`
	Error   *string `json:"error"`
}

type bulkResponse struct {
	Results   []bulkResult `json:"results"`
	Total     int          `json:"total"`
	Succeeded int          `json:"succeeded"`
	Failed    int          `json:"failed"`
}

func newBulkResponse(results []bulkResult) bulkResponse {
	succeeded := 0
	for _, r := range results {
		if r.Success {
			succeeded++
		}
	}
	if results == nil {
		results = []bulkResult{}
	}
	return bulkResponse{Results: results, Total: len(results), Succeeded: succeeded, Failed: len(results) - succeeded}
}

func (s *Server) bulkMetadataHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	bookIDs := b.StrList("book_ids", true)
	addTags := b.IntList("add_tag_ids", false)
	removeTags := b.IntList("remove_tag_ids", false)
	addGenres := b.IntList("add_genre_ids", false)
	removeGenres := b.IntList("remove_genre_ids", false)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	var results []bulkResult
	for _, id := range bookIDs {
		err := func() error {
			for _, t := range addTags {
				if err := assignLink(ctx, s.DB, "tag", id, t); err != nil {
					return err
				}
			}
			for _, t := range removeTags {
				if err := removeLink(ctx, s.DB, "tag", id, t); err != nil && !isNotFound(err) {
					return err
				}
			}
			for _, g := range addGenres {
				if err := assignLink(ctx, s.DB, "genre", id, g); err != nil {
					return err
				}
			}
			for _, g := range removeGenres {
				if err := removeLink(ctx, s.DB, "genre", id, g); err != nil && !isNotFound(err) {
					return err
				}
			}
			return nil
		}()
		if err != nil {
			if !isNotFound(err) {
				return err
			}
			msg := err.Error()
			results = append(results, bulkResult{BookID: id, Error: &msg})
			continue
		}
		results = append(results, bulkResult{BookID: id, Success: true})
	}
	return ok(w, newBulkResponse(results))
}

func (s *Server) bulkMoveHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	bookIDs := b.StrList("book_ids", true)
	target := b.Int("target_shelf_id", true, false)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	var results []bulkResult
	for _, id := range bookIDs {
		if _, err := s.moveBook(ctx, id, *target); err != nil {
			_, isFileErr := err.(*fileOpError)
			if !isNotFound(err) && !isFileErr {
				return err
			}
			msg := err.Error()
			results = append(results, bulkResult{BookID: id, Error: &msg})
			continue
		}
		results = append(results, bulkResult{BookID: id, Success: true})
	}
	return ok(w, newBulkResponse(results))
}

func isNotFound(err error) bool {
	he, isHTTP := err.(*httpError)
	return isHTTP && he.status == http.StatusNotFound
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// serveFile answers with a file from disk, as Starlette's FileResponse does
// (Last-Modified, ETag, ranges). filename sets Content-Disposition.
func serveFile(w http.ResponseWriter, r *http.Request, path, mediaType, filename string) error {
	f, err := os.Open(path)
	if err != nil {
		return notFound("File not found on disk")
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", mediaType)
	w.Header().Set("ETag", fmt.Sprintf(`"%x-%x"`, st.ModTime().UnixNano(), st.Size()))
	if filename != "" {
		w.Header().Set("Content-Disposition", contentDisposition(filename))
	}
	http.ServeContent(w, r, "", st.ModTime(), f)
	return nil
}

// contentDisposition is Starlette's attachment header: the plain filename
// when URL-quoting leaves it unchanged, otherwise RFC 5987 encoding.
func contentDisposition(name string) string {
	if escaped := pathEscape(name); escaped != name {
		return "attachment; filename*=utf-8''" + escaped
	}
	return `attachment; filename="` + name + `"`
}

// pathEscape is urllib.parse.quote(name) with Python's default safe "/".
func pathEscape(s string) string {
	const safe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.-~/"
	var b strings.Builder
	for _, c := range []byte(s) {
		if strings.IndexByte(safe, c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}
