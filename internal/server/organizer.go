package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/audemed44/shelfloom/internal/hashing"
	"github.com/audemed44/shelfloom/internal/store"
)

const defaultTemplate = "{author}/{title}"

var (
	illegalChars  = regexp.MustCompile(`[\\/:*?"<>|]`)
	whitespaceRun = regexp.MustCompile(`\s+`)
	formatToken   = regexp.MustCompile(`\.?\{format\}`)
	seqToken      = regexp.MustCompile(`\{sequence\|([^}]*)\}`)
)

// fileOpError is a failed file copy or move (book_service.FileOperationError).
type fileOpError struct{ msg string }

func (e *fileOpError) Error() string { return e.msg }

// sanitizeComponent removes characters that aren't allowed in file names,
// collapses whitespace and truncates to 200 characters.
func sanitizeComponent(name string) string {
	s := strings.TrimSpace(illegalChars.ReplaceAllString(name, ""))
	s = whitespaceRun.ReplaceAllString(s, " ")
	if utf8.RuneCountInString(s) > 200 {
		s = string([]rune(s)[:200])
	}
	return s
}

// formatSequence zero-pads the whole part and keeps any fraction.
func formatSequence(seq float64, pad int64) string {
	zfill := func(s string) string {
		neg := strings.HasPrefix(s, "-")
		if neg {
			s = s[1:]
		}
		for int64(len(s)) < pad-boolInt(neg) {
			s = "0" + s
		}
		if neg {
			s = "-" + s
		}
		return s
	}
	whole := int64(seq)
	if seq == float64(whole) {
		return zfill(strconv.FormatInt(whole, 10))
	}
	frac := strings.TrimRight(strconv.FormatFloat(seq, 'f', 10, 64), "0")
	_, after, _ := strings.Cut(frac, ".")
	return zfill(strconv.FormatInt(whole, 10)) + "." + after
}

func boolInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

// resolveTemplate fills a shelf template into a relative file path.
func resolveTemplate(template string, b *Book, seriesName, seriesPath string, sequence *float64, seqPad int64) string {
	author := sanitizeComponent(orDefault(b.Author, "Unknown Author"))
	title := sanitizeComponent(b.Title)
	seriesClean := sanitizeComponent(seriesName)
	pathClean := ""
	if seriesPath != "" {
		parts := strings.Split(seriesPath, "/")
		for i, p := range parts {
			parts[i] = sanitizeComponent(p)
		}
		pathClean = strings.Join(parts, "/")
	}
	seq := ""
	if sequence != nil {
		seq = formatSequence(*sequence, seqPad)
	}
	raw := formatToken.ReplaceAllString(template, "")
	raw = seqToken.ReplaceAllStringFunc(raw, func(m string) string {
		if sequence == nil {
			return ""
		}
		return seq + seqToken.FindStringSubmatch(m)[1]
	})
	raw = strings.ReplaceAll(raw, "{author}", author)
	raw = strings.ReplaceAll(raw, "{title}", title)
	raw = strings.ReplaceAll(raw, "{series}", seriesClean)
	raw = strings.ReplaceAll(raw, "{series_path}", pathClean)
	raw = strings.ReplaceAll(raw, "{sequence}", seq)
	raw = strings.ReplaceAll(raw, "{isbn}", sanitizeComponent(deref(b.ISBN)))
	raw = strings.ReplaceAll(raw, "{publisher}", sanitizeComponent(deref(b.Publisher)))
	raw = strings.ReplaceAll(raw, "{language}", sanitizeComponent(deref(b.Language)))
	var parts []string
	for _, p := range strings.Split(raw, "/") {
		if p = strings.TrimSpace(p); p != "" {
			parts = append(parts, p)
		}
	}
	if len(parts) == 0 {
		return sanitizeComponent(b.Title) + "." + b.Format
	}
	parts[len(parts)-1] += "." + b.Format
	return strings.Join(parts, "/")
}

func orDefault(p *string, def string) string {
	if p == nil || *p == "" {
		return def
	}
	return *p
}

// seriesInfo is the book's primary series: name, full path ("Parent/Child")
// and the book's number in it.
func seriesInfo(ctx context.Context, q querier, bookID string) (string, string, *float64, error) {
	var seriesID int64
	var name string
	var parent *int64
	var seq *float64
	err := q.QueryRowContext(ctx, "SELECT series.id, series.name, series.parent_id, book_series.sequence FROM book_series JOIN series ON book_series.series_id = series.id WHERE book_series.book_id = ? ORDER BY book_series.sequence ASC NULLS LAST LIMIT 1", bookID).Scan(&seriesID, &name, &parent, &seq)
	if errors.Is(err, sql.ErrNoRows) {
		return "", "", nil, nil
	}
	if err != nil {
		return "", "", nil, err
	}
	parts := []string{name}
	for parent != nil {
		var pname string
		var next *int64
		err := q.QueryRowContext(ctx, "SELECT name, parent_id FROM series WHERE id = ?", *parent).Scan(&pname, &next)
		if errors.Is(err, sql.ErrNoRows) {
			break
		}
		if err != nil {
			return "", "", nil, err
		}
		parts = append(parts, pname)
		parent = next
	}
	for i, j := 0, len(parts)-1; i < j; i, j = i+1, j-1 {
		parts[i], parts[j] = parts[j], parts[i]
	}
	return name, strings.Join(parts, "/"), seq, nil
}

func shelfTemplateOf(ctx context.Context, q querier, shelfID int64) (string, int64, error) {
	var t string
	var pad int64
	err := q.QueryRowContext(ctx, "SELECT template, seq_pad FROM shelf_templates WHERE shelf_id = ?", shelfID).Scan(&t, &pad)
	if errors.Is(err, sql.ErrNoRows) {
		return defaultTemplate, 2, nil
	}
	return t, pad, err
}

// copyFile copies src to dst, keeping the modification time (shutil.copy2).
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	st, err := in.Stat()
	if err != nil {
		return err
	}
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, st.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Chtimes(dst, st.ModTime(), st.ModTime())
}

// copyTree copies a directory recursively (shutil.copytree).
func copyTree(src, dst string) error {
	return filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			if rel != "." {
				if _, err := os.Stat(target); err == nil {
					return fmt.Errorf("[Errno 17] File exists: '%s'", target)
				}
			} else if _, err := os.Stat(target); err == nil {
				return fmt.Errorf("[Errno 17] File exists: '%s'", target)
			}
			return os.MkdirAll(target, info.Mode().Perm())
		}
		return copyFile(p, target)
	})
}

// safeMoveWithSDR copies a book (and its .sdr folder), verifies the copy by
// SHA-256 and removes the original.
func safeMoveWithSDR(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	srcSHA, _, err := hashing.Files(src)
	if err != nil {
		return err
	}
	if err := copyFile(src, dst); err != nil {
		return err
	}
	dstSHA, _, err := hashing.Files(dst)
	if err != nil {
		return err
	}
	if srcSHA != dstSHA {
		os.Remove(dst)
		return &fileOpError{fmt.Sprintf("Hash mismatch after copy: %s → %s", src, dst)}
	}
	if st, err := os.Stat(src + ".sdr"); err == nil && st.IsDir() {
		if err := copyTree(src+".sdr", dst+".sdr"); err != nil {
			return err
		}
		if err := os.RemoveAll(src + ".sdr"); err != nil {
			return err
		}
	}
	return os.Remove(src)
}

// pruneEmptyDirs removes start and any ancestors left empty, up to (never
// including) root.
func pruneEmptyDirs(start, root string) {
	rootAbs, err := filepath.EvalSymlinks(root)
	if err != nil {
		rootAbs, _ = filepath.Abs(root)
	}
	cur, err := filepath.EvalSymlinks(start)
	if err != nil {
		cur, _ = filepath.Abs(start)
	}
	for cur != rootAbs {
		rel, err := filepath.Rel(rootAbs, cur)
		if err != nil || rel == "." || strings.HasPrefix(rel, "..") {
			return
		}
		if err := os.Remove(cur); err != nil {
			return
		}
		cur = filepath.Dir(cur)
	}
}

// moveBook moves a book file to another shelf (copy, verify size, delete),
// applying the shelf's template when it organizes or syncs.
func (s *Server) moveBook(ctx context.Context, bookID string, targetShelfID int64) (*Book, error) {
	book, err := mustGetBook(ctx, s.DB, bookID)
	if err != nil {
		return nil, err
	}
	if book.ShelfID == targetShelfID {
		return book, nil
	}
	src, err := getShelf(ctx, s.DB, book.ShelfID)
	if err != nil {
		return nil, err
	}
	if src == nil {
		return nil, notFound("Source shelf %d not found", book.ShelfID)
	}
	dst, err := getShelf(ctx, s.DB, targetShelfID)
	if err != nil {
		return nil, err
	}
	if dst == nil {
		return nil, notFound("Target shelf %d not found", targetShelfID)
	}
	srcPath := filepath.Join(src.Path, book.FilePath)
	newRel := book.FilePath
	var template string
	organize := dst.AutoOrganize || dst.IsSyncTarget
	if organize {
		var pad int64
		if template, pad, err = shelfTemplateOf(ctx, s.DB, targetShelfID); err != nil {
			return nil, err
		}
		name, path, seq, err := seriesInfo(ctx, s.DB, book.ID)
		if err != nil {
			return nil, err
		}
		newRel = resolveTemplate(template, book, name, path, seq, pad)
	}
	dstPath := filepath.Join(dst.Path, newRel)
	if err := os.MkdirAll(filepath.Dir(dstPath), 0o755); err != nil {
		return nil, err
	}
	if err := copyFile(srcPath, dstPath); err != nil {
		return nil, err
	}
	sst, err1 := os.Stat(srcPath)
	dstSt, err2 := os.Stat(dstPath)
	if err1 != nil || err2 != nil || sst.Size() != dstSt.Size() {
		os.Remove(dstPath)
		return nil, &fileOpError{"File copy verification failed (size mismatch)"}
	}
	if st, err := os.Stat(srcPath + ".sdr"); err == nil && st.IsDir() {
		if err := copyTree(srcPath+".sdr", dstPath+".sdr"); err != nil {
			return nil, err
		}
		if err := os.RemoveAll(srcPath + ".sdr"); err != nil {
			return nil, err
		}
	}
	if err := os.Remove(srcPath); err != nil {
		return nil, err
	}
	pruneEmptyDirs(filepath.Dir(srcPath), src.Path)
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if organize && newRel != book.FilePath {
			if _, err := tx.ExecContext(ctx, "INSERT INTO rename_logs (book_id, shelf_id, template, old_path, new_path) VALUES (?, ?, ?, ?, ?)", book.ID, targetShelfID, template, book.FilePath, newRel); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, "UPDATE books SET shelf_id = ?, file_path = ? WHERE id = ?", targetShelfID, newRel, book.ID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return mustGetBook(ctx, s.DB, book.ID)
}

type organizerResult struct {
	BookID         string  `json:"book_id"`
	BookTitle      string  `json:"book_title"`
	OldPath        string  `json:"old_path"`
	NewPath        string  `json:"new_path"`
	Moved          bool    `json:"moved"`
	AlreadyCorrect bool    `json:"already_correct"`
	Error          *string `json:"error"`
}

func (s *Server) organizeShelf(ctx context.Context, shelfID int64, template *string, seqPad *int64, dryRun bool) ([]organizerResult, error) {
	shelf, err := getShelf(ctx, s.DB, shelfID)
	if err != nil {
		return nil, err
	}
	if shelf == nil {
		return nil, notFound("Shelf %d not found", shelfID)
	}
	tmpl, pad, err := shelfTemplateOf(ctx, s.DB, shelfID)
	if err != nil {
		return nil, err
	}
	if template != nil && *template != "" {
		tmpl = *template
	}
	if seqPad != nil {
		pad = *seqPad
	}
	books, err := queryBooks(ctx, s.DB, "SELECT "+bookColumns("books")+" FROM books WHERE books.shelf_id = ?", shelfID)
	if err != nil {
		return nil, err
	}
	out := []organizerResult{}
	for _, b := range books {
		name, path, seq, err := seriesInfo(ctx, s.DB, b.ID)
		if err != nil {
			return nil, err
		}
		newRel := resolveTemplate(tmpl, b, name, path, seq, pad)
		res := organizerResult{BookID: b.ID, BookTitle: b.Title, OldPath: b.FilePath, NewPath: newRel}
		if newRel == b.FilePath {
			res.AlreadyCorrect = true
			out = append(out, res)
			continue
		}
		if dryRun {
			out = append(out, res)
			continue
		}
		src := filepath.Join(shelf.Path, b.FilePath)
		dst := filepath.Join(shelf.Path, newRel)
		if !fileExists(src) {
			res.Error = ptr("Source file not found: " + src)
			out = append(out, res)
			continue
		}
		err = safeMoveWithSDR(src, dst)
		if err == nil {
			pruneEmptyDirs(filepath.Dir(src), shelf.Path)
			err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
				if _, err := tx.ExecContext(ctx, "INSERT INTO rename_logs (book_id, shelf_id, template, old_path, new_path) VALUES (?, ?, ?, ?, ?)", b.ID, shelf.ID, tmpl, b.FilePath, newRel); err != nil {
					return err
				}
				_, err := tx.ExecContext(ctx, "UPDATE books SET file_path = ? WHERE id = ?", newRel, b.ID)
				return err
			})
		}
		if err != nil {
			res.Error = ptr(err.Error())
		} else {
			res.Moved = true
		}
		out = append(out, res)
	}
	return out, nil
}

func (s *Server) organizePreviewHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	shelfID := q.Required("shelf_id")
	template := q.Str("template")
	pad := q.IntRange("seq_pad", 2, -1<<63, 1<<63-1)
	if err := q.err(); err != nil {
		return err
	}
	id, good := parseInt(shelfID)
	if !good {
		return invalidField("query", "shelf_id", "int_parsing", "Input should be a valid integer, unable to parse string as an integer", shelfID)
	}
	out, err := s.organizeShelf(r.Context(), id, template, &pad, true)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (s *Server) organizeApplyHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	shelfID := b.Int("shelf_id", true, false)
	template := b.Str("template", false, true)
	pad := b.Int("seq_pad", false, false)
	if err := b.err(); err != nil {
		return err
	}
	if pad == nil {
		pad = ptr(int64(2))
	}
	out, err := s.organizeShelf(r.Context(), *shelfID, template, pad, false)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (s *Server) renameLogHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	shelfID := q.Int("shelf_id")
	bookID := q.Str("book_id")
	limit := q.IntRange("limit", 100, -1<<63, 1<<63-1)
	if err := q.err(); err != nil {
		return err
	}
	query := "SELECT id, book_id, shelf_id, template, old_path, new_path, created_at FROM rename_logs"
	var where []string
	var args []any
	if shelfID != nil {
		where, args = append(where, "rename_logs.shelf_id = ?"), append(args, *shelfID)
	}
	if bookID != nil {
		where, args = append(where, "rename_logs.book_id = ?"), append(args, *bookID)
	}
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	rows, err := s.DB.QueryContext(r.Context(), query+" ORDER BY rename_logs.created_at DESC LIMIT ?", append(args, limit)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	type logEntry struct {
		ID        int64      `json:"id"`
		BookID    *string    `json:"book_id"`
		ShelfID   *int64     `json:"shelf_id"`
		Template  string     `json:"template"`
		OldPath   string     `json:"old_path"`
		NewPath   string     `json:"new_path"`
		CreatedAt store.Time `json:"created_at"`
	}
	out := []logEntry{}
	for rows.Next() {
		var l logEntry
		if err := rows.Scan(&l.ID, &l.BookID, &l.ShelfID, &l.Template, &l.OldPath, &l.NewPath, &l.CreatedAt); err != nil {
			return err
		}
		out = append(out, l)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return ok(w, out)
}
