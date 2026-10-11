package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"html"
	"log/slog"
	"net/http"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/audemed44/shelfloom/internal/imaging"
	"github.com/audemed44/shelfloom/internal/zlibrary"
)

// zlibState is the Z-Library client plus the search results seen lately, so
// adding a book and proxying its cover need only its ID.
type zlibState struct {
	once   sync.Once
	client *zlibrary.Client

	mu    sync.Mutex
	books map[string]zlibrary.Book
}

const zlibCacheSize = 2000

// zlib returns the Z-Library client, or nil when no account is configured.
func (s *Server) zlib() *zlibrary.Client {
	s.zl.once.Do(func() {
		c := s.Config
		if c.ZLibraryEmail != "" && c.ZLibraryPassword != "" {
			s.zl.client = zlibrary.New(s.zlibDomain(context.Background()), c.ZLibraryEmail, c.ZLibraryPassword)
		}
	})
	return s.zl.client
}

func (s *Server) rememberZLib(books []zlibrary.Book) {
	s.zl.mu.Lock()
	defer s.zl.mu.Unlock()
	if s.zl.books == nil || len(s.zl.books)+len(books) > zlibCacheSize {
		s.zl.books = map[string]zlibrary.Book{}
	}
	for _, b := range books {
		s.zl.books[b.ID] = b
	}
}

func (s *Server) cachedZLib(id string) (zlibrary.Book, bool) {
	s.zl.mu.Lock()
	defer s.zl.mu.Unlock()
	b, ok := s.zl.books[id]
	return b, ok
}

func (s *Server) requireZLib() (*zlibrary.Client, error) {
	c := s.zlib()
	if c == nil {
		return nil, notFound("Z-Library is not configured: set SHELFLOOM_ZLIBRARY_EMAIL and SHELFLOOM_ZLIBRARY_PASSWORD")
	}
	return c, nil
}

// zlibError turns a client error into a response.
func zlibError(err error) error {
	var apiErr *zlibrary.APIError
	switch {
	case errors.Is(err, zlibrary.ErrLogin):
		return errStatus(http.StatusBadGateway, err.Error())
	case errors.As(err, &apiErr):
		return errStatus(http.StatusBadGateway, apiErr.Error())
	case errors.Is(err, context.Canceled):
		return err
	}
	return errStatus(http.StatusBadGateway, err.Error())
}

func (s *Server) zlibStatusHandler(w http.ResponseWriter, r *http.Request) error {
	out := map[string]any{"enabled": false, "domain": s.zlibDomain(r.Context()), "downloads_today": nil, "downloads_limit": nil, "error": nil}
	c := s.zlib()
	if c == nil {
		return ok(w, out)
	}
	out["enabled"] = true
	if limits, err := c.Limits(r.Context()); err != nil {
		out["error"] = zlibError(err).Error()
	} else {
		out["downloads_today"] = limits.DownloadsToday
		out["downloads_limit"] = limits.DownloadsLimit
	}
	return ok(w, out)
}

type zlibResult struct {
	ID              string   `json:"id"`
	Hash            string   `json:"hash"`
	Title           string   `json:"title"`
	Author          *string  `json:"author"`
	Publisher       *string  `json:"publisher"`
	Year            *int     `json:"year"`
	Language        *string  `json:"language"`
	Pages           *int     `json:"pages"`
	Series          *string  `json:"series"`
	Extension       string   `json:"extension"`
	Size            *string  `json:"size"`
	ISBNs           []string `json:"isbns"`
	CoverURL        *string  `json:"cover_url"`
	Description     *string  `json:"description"`
	InLibraryBookID *string  `json:"in_library_book_id"`
}

const zlibPageSize = 20

func (s *Server) zlibSearchHandler(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireZLib()
	if err != nil {
		return err
	}
	q := newQuery(r)
	text := strings.TrimSpace(q.Required("q"))
	format := q.StrDefault("format", "any")
	language := strings.ToLower(strings.TrimSpace(q.StrDefault("language", "")))
	page := q.IntRange("page", 1, 1, 50)
	if err := q.err(); err != nil {
		return err
	}
	if text == "" {
		return badRequest("Enter something to search for")
	}
	query := zlibrary.Query{Text: text, Page: int(page), Limit: zlibPageSize}
	switch format {
	case "epub", "pdf":
		query.Extensions = []string{format}
	default:
		query.Extensions = []string{"epub", "pdf"}
	}
	if language != "" && language != "any" {
		query.Languages = []string{language}
	}
	ctx := r.Context()
	books, err := c.Search(ctx, query)
	if err != nil {
		return zlibError(err)
	}
	s.rememberZLib(books)
	results := make([]zlibResult, 0, len(books))
	for _, b := range books {
		// Search can still return formats Shelfloom can't import.
		if b.Extension != "epub" && b.Extension != "pdf" {
			continue
		}
		res := zlibResult{
			ID: b.ID, Hash: b.Hash, Title: b.Title, Author: strOrNil(b.Author),
			Publisher: strOrNil(b.Publisher), Language: strOrNil(b.Language),
			Series: strOrNil(b.Series), Extension: b.Extension, Size: strOrNil(b.FileSizeStr),
			ISBNs: b.ISBNs(), Description: strOrNil(plainText(b.Description)),
		}
		if res.ISBNs == nil {
			res.ISBNs = []string{}
		}
		if b.Year > 0 {
			res.Year = ptr(b.Year)
		}
		if b.Pages > 0 {
			res.Pages = ptr(b.Pages)
		}
		if b.Cover != "" {
			res.CoverURL = ptr("/api/zlibrary/books/" + b.ID + "/cover")
		}
		if res.InLibraryBookID, err = s.zlibMatch(ctx, b); err != nil {
			return err
		}
		results = append(results, res)
	}
	return ok(w, map[string]any{"results": results, "page": page, "has_more": len(books) >= zlibPageSize})
}

// zlibMatch finds a library book that is this result: the same file, the
// same ISBN, or the same title and author.
func (s *Server) zlibMatch(ctx context.Context, b zlibrary.Book) (*string, error) {
	var conds []string
	var args []any
	if b.MD5 != "" {
		conds = append(conds, "lower(file_hash_md5) = ?", "id IN (SELECT book_id FROM book_hashes WHERE lower(hash_md5) = ?)")
		args = append(args, b.MD5, b.MD5)
	}
	for _, isbn := range b.ISBNs() {
		conds = append(conds, "upper(replace(replace(isbn, '-', ''), ' ', '')) = ?")
		args = append(args, isbn)
	}
	if b.Title != "" && b.Author != "" {
		conds = append(conds, "(lower(trim(title)) = ? AND lower(trim(author)) = ?)")
		args = append(args, strings.ToLower(b.Title), strings.ToLower(b.Author))
	}
	if len(conds) == 0 {
		return nil, nil
	}
	var id string
	err := s.DB.QueryRowContext(ctx, "SELECT id FROM books WHERE "+strings.Join(conds, " OR ")+" LIMIT 1", args...).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

// findByMD5 finds the book whose file (now or before) has this MD5.
func findByMD5(ctx context.Context, q querier, md5 string) (*Book, error) {
	return oneBook(ctx, q, "SELECT "+bookColumns("books")+" FROM books WHERE lower(books.file_hash_md5) = ? OR books.id IN (SELECT book_id FROM book_hashes WHERE lower(hash_md5) = ?) LIMIT 1", md5, md5)
}

func (s *Server) zlibCoverHandler(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireZLib()
	if err != nil {
		return err
	}
	b, found := s.cachedZLib(r.PathValue("zlib_id"))
	if !found || b.Cover == "" {
		return notFound("Cover not found")
	}
	data, contentType, err := c.Cover(r.Context(), b.Cover)
	if err != nil {
		return notFound("Cover not found")
	}
	if !strings.HasPrefix(contentType, "image/") {
		contentType = http.DetectContentType(data)
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	_, err = w.Write(data)
	return err
}

func (s *Server) zlibAddHandler(w http.ResponseWriter, r *http.Request) error {
	c, err := s.requireZLib()
	if err != nil {
		return err
	}
	body, err := readBody(r, false)
	if err != nil {
		return err
	}
	id := body.Str("id", true, false)
	hash := body.Str("hash", true, false)
	if err := body.err(); err != nil {
		return err
	}
	ctx := r.Context()
	meta, known := s.cachedZLib(*id)
	if known && meta.MD5 != "" {
		// The very same file is not downloaded again (another edition is).
		if b, err := findByMD5(ctx, s.DB, meta.MD5); err != nil {
			return err
		} else if b != nil {
			return s.zlibAdded(ctx, w, b, meta, true)
		}
	}

	name, data, err := c.Download(ctx, *id, *hash)
	if err != nil {
		return zlibError(err)
	}
	ext := strings.ToLower(filepath.Ext(name))
	if known && (meta.Extension == "epub" || meta.Extension == "pdf") {
		ext = "." + meta.Extension
	}
	if ext != ".epub" && ext != ".pdf" {
		return unprocessable("Z-Library sent a %s file; only EPUB and PDF can be added", strings.TrimPrefix(ext, "."))
	}
	if known && meta.Title != "" {
		name = bookFileName(meta.Author, meta.Title) + ext
	} else {
		name = bookFileName("", strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))) + ext
	}
	b, dup, err := s.addToDefaultShelf(ctx, name, data, true)
	if err != nil {
		return err
	}
	if !dup && known {
		if err := s.fillFromZLib(ctx, c, b, meta); err != nil {
			slog.Warn(fmt.Sprintf("Could not fill in Z-Library metadata for %s: %v", b.Title, err))
		}
		if b, err = mustGetBook(ctx, s.DB, b.ID); err != nil {
			return err
		}
	}
	return s.zlibAdded(ctx, w, b, meta, dup)
}

func (s *Server) zlibAdded(ctx context.Context, w http.ResponseWriter, b *Book, meta zlibrary.Book, dup bool) error {
	resp, err := bookResponseFor(ctx, s.DB, b)
	if err != nil {
		return err
	}
	series, seq := zlibSeries(meta)
	return created(w, map[string]any{
		"book":               resp,
		"already_in_library": dup,
		"series":             strOrNil(series),
		"series_sequence":    strOrNil(seq),
	})
}

var seriesNumber = regexp.MustCompile(`^(.*?)[\s,]*#\s*(\d+(?:\.\d+)?)$`)

// zlibSeries splits Z-Library's series ("Mistborn #2") into a name and a
// sequence, falling back to the volume field for the sequence.
func zlibSeries(b zlibrary.Book) (name, seq string) {
	name = strings.TrimSpace(b.Series)
	if m := seriesNumber.FindStringSubmatch(name); m != nil && strings.TrimSpace(m[1]) != "" {
		return strings.TrimSpace(m[1]), m[2]
	}
	if v := strings.TrimSpace(b.Volume); v != "" && name != "" {
		if _, err := strconv.ParseFloat(v, 64); err == nil {
			seq = v
		}
	}
	return name, seq
}

// fillFromZLib fills in what the file's own metadata left empty, and the
// cover when the file has none.
func (s *Server) fillFromZLib(ctx context.Context, c *zlibrary.Client, b *Book, meta zlibrary.Book) error {
	var sets []string
	var args []any
	fill := func(col string, have *string, value string) {
		if (have == nil || strings.TrimSpace(*have) == "") && value != "" {
			sets = append(sets, col+" = ?")
			args = append(args, value)
		}
	}
	fill("author", b.Author, meta.Author)
	fill("publisher", b.Publisher, meta.Publisher)
	fill("language", b.Language, meta.Language)
	fill("description", b.Description, plainText(meta.Description))
	if isbns := meta.ISBNs(); len(isbns) > 0 {
		best := isbns[0]
		for _, i := range isbns {
			if len(i) == 13 {
				best = i
				break
			}
		}
		fill("isbn", b.ISBN, best)
	}
	if meta.Year > 0 {
		fill("date_published", b.DatePublished, strconv.Itoa(meta.Year))
	}
	if b.PageCount == nil && meta.Pages > 0 {
		sets = append(sets, "page_count = ?")
		args = append(args, meta.Pages)
	}
	if b.CoverPath == nil && meta.Cover != "" {
		if data, _, err := c.Cover(ctx, meta.Cover); err == nil {
			out := filepath.Join(s.Config.CoversDir, b.ID+".jpg")
			if err := imaging.SaveJPEG(data, out, 1200); err == nil {
				sets = append(sets, "cover_path = ?")
				args = append(args, out)
			}
		}
	}
	if len(sets) == 0 {
		return nil
	}
	_, err := s.DB.ExecContext(ctx, "UPDATE books SET "+strings.Join(sets, ", ")+" WHERE id = ?", append(args, b.ID)...)
	return err
}

var (
	unsafeName  = regexp.MustCompile(`[/\\:*?"<>|\x00-\x1f]+`)
	lineBreaks  = regexp.MustCompile(`(?i)<\s*(br|/li)\s*/?>`)
	paraBreaks  = regexp.MustCompile(`(?i)<\s*/(p|div|h[1-6])\s*>`)
	anyTag      = regexp.MustCompile(`<[^>]*>`)
	blankLines  = regexp.MustCompile(`\n\s*\n\s*`)
	innerSpaces = regexp.MustCompile(`[ \t]+`)
)

// bookFileName is "Author - Title", safe as a file name.
func bookFileName(author, title string) string {
	name := strings.TrimSpace(title)
	if a := strings.TrimSpace(author); a != "" {
		name = a + " - " + name
	}
	name = strings.Trim(innerSpaces.ReplaceAllString(unsafeName.ReplaceAllString(name, " "), " "), " .")
	if r := []rune(name); len(r) > 150 {
		name = strings.TrimSpace(string(r[:150]))
	}
	if name == "" {
		name = "book"
	}
	return name
}

// plainText turns an HTML description into text with paragraph breaks.
func plainText(s string) string {
	s = lineBreaks.ReplaceAllString(s, "\n")
	s = paraBreaks.ReplaceAllString(s, "\n\n")
	s = html.UnescapeString(anyTag.ReplaceAllString(s, ""))
	s = innerSpaces.ReplaceAllString(s, " ")
	s = blankLines.ReplaceAllString(s, "\n\n")
	return strings.TrimSpace(s)
}
