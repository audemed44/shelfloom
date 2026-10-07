package server

import (
	"archive/zip"
	"context"
	"fmt"
	"hash/crc32"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/audemed44/shelfloom/internal/covergen"
	"github.com/audemed44/shelfloom/internal/epub"
	"github.com/audemed44/shelfloom/internal/hashing"
	"github.com/audemed44/shelfloom/internal/store"
)

// Generated covers are saved under a recognisable name.
const generatedSuffix = "-generated.jpg"
const maxListed = 200

func (s *Server) appHandler(w http.ResponseWriter, r *http.Request) error {
	url := strings.TrimSpace(s.Config.FoyerURL)
	var out *string
	if strings.HasPrefix(url, "https://") || strings.HasPrefix(url, "http://") {
		out = &url
	}
	return ok(w, map[string]any{"foyer_url": out})
}

func (s *Server) healthHandler(w http.ResponseWriter, r *http.Request) error {
	return ok(w, map[string]string{"status": "ok"})
}

// fileProblem says why a book file can't be read, or "".
func fileProblem(path string, format string) string {
	switch format {
	case "epub":
		z, err := zip.OpenReader(path)
		if err != nil {
			if _, statErr := os.Stat(path); statErr != nil {
				return fmt.Sprintf("Could not be read: %v", statErr)
			}
			return "Not a valid EPUB (not a zip archive)"
		}
		defer z.Close()
		has := false
		for _, f := range z.File {
			if f.Name == "META-INF/container.xml" {
				has = true
			}
		}
		if !has {
			return "Not a valid EPUB (no META-INF/container.xml)"
		}
		for _, f := range z.File {
			rc, err := f.Open()
			if err != nil {
				return "Corrupt entry in the archive: " + f.Name
			}
			h := crc32.NewIEEE()
			_, err = io.Copy(h, rc)
			rc.Close()
			if err != nil || h.Sum32() != f.CRC32 {
				return "Corrupt entry in the archive: " + f.Name
			}
		}
	case "pdf":
		f, err := os.Open(path)
		if err != nil {
			return fmt.Sprintf("Could not be read: %v", err)
		}
		defer f.Close()
		head := make([]byte, 5)
		n, _ := io.ReadFull(f, head)
		if string(head[:n]) != "%PDF-" {
			return "Not a valid PDF"
		}
	}
	return ""
}

type healthBook struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Author    *string `json:"author"`
	Format    *string `json:"format"`
	CoverPath *string `json:"cover_path"`
	Detail    *string `json:"detail"`
}

func healthRow(b *Book, detail string) healthBook {
	return healthBook{ID: b.ID, Title: b.Title, Author: b.Author, Format: &b.Format, CoverPath: b.CoverPath, Detail: strOrNil(detail)}
}

func issue(key, severity, title, description string, rows []healthBook, okTitle string) map[string]any {
	listed := rows
	if len(listed) > maxListed {
		listed = listed[:maxListed]
	}
	if listed == nil {
		listed = []healthBook{}
	}
	return map[string]any{"key": key, "severity": severity, "title": title, "ok_title": okTitle, "description": description, "count": len(rows), "books": listed}
}

func (s *Server) libraryHealthHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	rows, err := s.DB.QueryContext(ctx, "SELECT "+bookColumns("books")+", shelves.path FROM books JOIN shelves ON shelves.id = books.shelf_id")
	if err != nil {
		return err
	}
	type entry struct {
		book  *Book
		shelf string
	}
	var all []entry
	for rows.Next() {
		var shelf string
		b, err := scanBook(rows, &shelf)
		if err != nil {
			rows.Close()
			return err
		}
		all = append(all, entry{b, shelf})
	}
	rows.Close()
	sort.SliceStable(all, func(i, j int) bool {
		return strings.ToLower(all[i].book.Title) < strings.ToLower(all[j].book.Title)
	})
	// Checking a file decompresses all of it, so files are checked in
	// parallel; the lists below keep the title order.
	exists := make([]bool, len(all))
	problems := make([]string, len(all))
	work := make(chan int)
	var wg sync.WaitGroup
	for range min(4, runtime.NumCPU()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range work {
				p := filepath.Join(all[i].shelf, all[i].book.FilePath)
				if exists[i] = fileExists(p); exists[i] {
					problems[i] = fileProblem(p, all[i].book.Format)
				}
			}
		}()
	}
	for i, e := range all {
		if !e.book.isManual() && ctx.Err() == nil {
			work <- i
		}
	}
	close(work)
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return err
	}
	var missing, unreadable, noCover, generated, noAuthor, noFingerprint []healthBook
	for i, e := range all {
		b := e.book
		if b.Author == nil || strings.TrimSpace(*b.Author) == "" {
			noAuthor = append(noAuthor, healthRow(b, ""))
		}
		if b.CoverPath == nil || *b.CoverPath == "" || !fileExists(*b.CoverPath) {
			noCover = append(noCover, healthRow(b, ""))
		} else if strings.HasSuffix(*b.CoverPath, generatedSuffix) {
			generated = append(generated, healthRow(b, ""))
		}
		if b.isManual() {
			continue
		}
		if !exists[i] {
			missing = append(missing, healthRow(b, filepath.Join(e.shelf, b.FilePath)))
			continue
		}
		if problem := problems[i]; problem != "" {
			unreadable = append(unreadable, healthRow(b, problem))
		} else if b.FileHashMD5KO == nil || *b.FileHashMD5KO == "" {
			noFingerprint = append(noFingerprint, healthRow(b, ""))
		}
	}
	groups, err := duplicateBookGroups(ctx, s.DB)
	if err != nil {
		return err
	}
	dupes := 0
	for _, g := range groups {
		dupes += len(g)
	}
	var unmatched int64
	s.DB.QueryRowContext(ctx, "SELECT count(*) FROM unmatched_koreader_entries WHERE dismissed = 0 AND linked_book_id IS NULL").Scan(&unmatched)
	return ok(w, map[string]any{
		"checked_at":  store.Now(),
		"total_books": len(all),
		"issues": []map[string]any{
			issue("missing_file", "error", "Missing files", "The book is in the library but its file is gone from disk.", missing, "Every book's file is on disk"),
			issue("unreadable_file", "error", "Unreadable files", "The file exists but isn't a valid EPUB or PDF.", unreadable, "Every file opens"),
			issue("no_cover", "warning", "No cover", "No cover could be found in the file. Shelfloom can make one.", noCover, "Every book has a cover"),
			issue("no_fingerprint", "warning", "Not ready for KOReader sync", "The KOReader fingerprint was never recorded, so reading progress from KOReader can't be matched to these books.", noFingerprint, "Every book is ready for KOReader sync"),
			issue("no_author", "info", "No author", "Add the author so the book sorts and groups properly.", noAuthor, "Every book has an author"),
			issue("generated_cover", "info", "Generated covers", "These books use a cover made by Shelfloom. Regenerate after changing the title, author or series.", generated, "No generated covers"),
		},
		"links": []map[string]any{
			{"key": "duplicate_books", "severity": "warning", "title": "Possible duplicates", "count": dupes, "tab": "duplicate-books"},
			{"key": "unmatched", "severity": "warning", "title": "Unmatched KOReader data", "count": unmatched, "tab": "unmatched"},
		},
	})
}

func (s *Server) removeMissingHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	ids := b.StrList("book_ids", true)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	removed := 0
	if len(ids) > 0 {
		rows, err := s.DB.QueryContext(ctx, "SELECT books.id, books.file_path, shelves.path FROM books JOIN shelves ON shelves.id = books.shelf_id WHERE books.id IN ("+placeholders(len(ids))+")", anySlice(ids)...)
		if err != nil {
			return err
		}
		type gone struct{ id, file, shelf string }
		var list []gone
		for rows.Next() {
			var g gone
			rows.Scan(&g.id, &g.file, &g.shelf)
			list = append(list, g)
		}
		rows.Close()
		for _, g := range list {
			if strings.HasPrefix(g.file, "manual://") || fileExists(filepath.Join(g.shelf, g.file)) {
				continue
			}
			if _, err := s.DB.ExecContext(ctx, "DELETE FROM books WHERE id = ?", g.id); err != nil {
				return err
			}
			removed++
		}
	}
	return ok(w, map[string]int{"removed": removed})
}

func (s *Server) fingerprintsHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	rows, err := s.DB.QueryContext(ctx, "SELECT books.id, books.file_path, shelves.path FROM books JOIN shelves ON shelves.id = books.shelf_id WHERE books.file_hash_md5_ko IS NULL")
	if err != nil {
		return err
	}
	type cand struct{ id, file, shelf string }
	var list []cand
	for rows.Next() {
		var c cand
		rows.Scan(&c.id, &c.file, &c.shelf)
		list = append(list, c)
	}
	rows.Close()
	updated := 0
	for _, c := range list {
		if strings.HasPrefix(c.file, "manual://") {
			continue
		}
		p := filepath.Join(c.shelf, c.file)
		if !fileExists(p) {
			continue
		}
		var ko *string
		if d, good := hashing.KOReaderPartialMD5(p); good {
			ko = &d
			updated++
		}
		if _, err := s.DB.ExecContext(ctx, "UPDATE books SET file_hash_md5_ko = ? WHERE id = ?", ko, c.id); err != nil {
			return err
		}
	}
	return ok(w, map[string]int{"updated": updated})
}

// coverInputs picks the series for a generated cover: one where the book
// has a number wins, and a sub-series over its parent.
func coverInputs(ctx context.Context, q querier, b *Book) (*string, *float64, error) {
	rows, err := q.QueryContext(ctx, "SELECT series.name, series.parent_id, book_series.sequence FROM series JOIN book_series ON book_series.series_id = series.id WHERE book_series.book_id = ?", b.ID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	type cand struct {
		name   string
		parent *int64
		seq    *float64
	}
	var list []cand
	for rows.Next() {
		var c cand
		rows.Scan(&c.name, &c.parent, &c.seq)
		list = append(list, c)
	}
	if len(list) == 0 {
		return nil, nil, rows.Err()
	}
	sort.SliceStable(list, func(i, j int) bool {
		ki := [2]bool{list[i].seq == nil, list[i].parent == nil}
		kj := [2]bool{list[j].seq == nil, list[j].parent == nil}
		if ki[0] != kj[0] {
			return !ki[0]
		}
		return !ki[1] && kj[1]
	})
	return &list[0].name, list[0].seq, nil
}

func (s *Server) renderCover(ctx context.Context, b *Book, quality int) ([]byte, error) {
	series, seq, err := coverInputs(ctx, s.DB, b)
	if err != nil {
		return nil, err
	}
	return covergen.JPEG(covergen.Render(b.Title, b.Author, series, seq), quality)
}

func (s *Server) generatedCoverPreviewHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	b, err := mustGetBook(ctx, s.DB, r.PathValue("book_id"))
	if err != nil {
		return err
	}
	data, err := s.renderCover(ctx, b, 85)
	if err != nil {
		return err
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(data)
	return nil
}

// generateCover makes a cover for a book and uses it, optionally writing it
// into the EPUB (the old KOReader fingerprint is kept, so sync continues).
func (s *Server) generateCover(ctx context.Context, bookID string, embed bool) (*Book, error) {
	b, err := mustGetBook(ctx, s.DB, bookID)
	if err != nil {
		return nil, err
	}
	data, err := s.renderCover(ctx, b, 90)
	if err != nil {
		return nil, err
	}
	out := filepath.Join(s.Config.CoversDir, b.ID+generatedSuffix)
	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		return nil, err
	}
	if err := os.WriteFile(out, data, 0o644); err != nil {
		return nil, err
	}
	if _, err := s.DB.ExecContext(ctx, "UPDATE books SET cover_path = ? WHERE id = ?", out, b.ID); err != nil {
		return nil, err
	}
	if embed && b.Format == "epub" && !b.isManual() {
		if shelf, err := getShelf(ctx, s.DB, b.ShelfID); err == nil && shelf != nil {
			p := filepath.Join(shelf.Path, b.FilePath)
			if fileExists(p) {
				if err := epub.EmbedCover(p, out); err != nil {
					slog.Warn(fmt.Sprintf("Could not write the cover into %s: %v", filepath.Base(p), err))
				} else if err := refreshBookHashes(ctx, s.DB, b, p); err != nil {
					return nil, err
				}
			}
		}
	}
	return mustGetBook(ctx, s.DB, b.ID)
}

func (s *Server) generateCoverHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, true)
	if err != nil {
		return err
	}
	embed := true
	if !b.null {
		if e := b.Bool("embed", false, false); e != nil {
			embed = *e
		}
		if err := b.err(); err != nil {
			return err
		}
	}
	book, err := s.generateCover(r.Context(), r.PathValue("book_id"), embed)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"id": book.ID, "cover_path": book.CoverPath})
}

func (s *Server) generateCoversHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	var ids []string
	explicit := b.Has("book_ids") && !b.isNull("book_ids")
	if explicit {
		ids = b.StrList("book_ids", false)
	}
	embed := true
	if e := b.Bool("embed", false, false); e != nil {
		embed = *e
	}
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if !explicit {
		books, err := queryBooks(ctx, s.DB, "SELECT "+bookColumns("books")+" FROM books")
		if err != nil {
			return err
		}
		for _, bk := range books {
			if bk.CoverPath == nil || *bk.CoverPath == "" || !fileExists(*bk.CoverPath) {
				ids = append(ids, bk.ID)
			}
		}
	}
	done, failed := 0, 0
	for _, id := range ids {
		if _, err := s.generateCover(ctx, id, embed); err != nil {
			slog.Error(fmt.Sprintf("Could not generate a cover for %s: %v", id, err))
			failed++
			continue
		}
		done++
	}
	return ok(w, map[string]int{"generated": done, "failed": failed})
}

// ── Foyer widget ──────────────────────────────────────────────────────────────

func plural(n int64, word string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, word)
	}
	return fmt.Sprintf("%d %ss", n, word)
}

func (s *Server) foyerWidgetHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	now := today()
	year := now.Year()
	goal, err := goalProgress(ctx, s.DB, year)
	if err != nil {
		return err
	}
	dates, err := readingDates(ctx, s.DB)
	if err != nil {
		return err
	}
	st := streaksFrom(dates)
	library, err := getOverview(ctx, s.DB, store.Time{}, store.Time{})
	if err != nil {
		return err
	}
	week, err := getOverview(ctx, s.DB, store.T(time.Now().Add(-7*24*time.Hour)), store.Time{})
	if err != nil {
		return err
	}
	hours := func(seconds int64) string {
		h := float64(seconds) / 3600
		if h < 10 {
			return fmt.Sprintf("%.1f", h)
		}
		return fmt.Sprintf("%.0f", h)
	}
	yearStat := map[string]any{"label": fmt.Sprintf("Read in %d", year), "value": fmt.Sprint(goal.Completed)}
	if goal.Target != nil && *goal.Target != 0 {
		yearStat["unit"] = fmt.Sprintf("/%d", *goal.Target)
		if goal.Status != nil && (*goal.Status == "done" || *goal.Status == "ahead") {
			yearStat["tone"] = "good"
		}
	}
	unit := "days"
	if st.Current == 1 {
		unit = "day"
	}
	stats := []map[string]any{
		yearStat,
		{"label": "Streak", "value": fmt.Sprint(st.Current), "unit": unit, "caption": fmt.Sprintf("best %d", st.Longest)},
		{"label": "This week", "value": hours(week.TotalSeconds), "unit": "h", "caption": plural(week.TotalPages, "page")},
		{"label": "Library", "value": fmt.Sprint(library.BooksRead), "unit": fmt.Sprintf("/%d", library.BooksOwned), "caption": "books read"},
	}
	progress := []map[string]any{}
	if goal.Target != nil && *goal.Target != 0 {
		p := map[string]any{"label": fmt.Sprintf("%d goal", year), "value": goal.Completed, "max": *goal.Target}
		if c := goalCaption(goal); c != nil {
			p["caption"] = *c
		}
		progress = append(progress, p)
	}
	f := defaultBookFilter()
	f.Status, f.Sort, f.PerPage = ptr("reading"), "last_read", 8
	books, _, _, err := listBooks(ctx, s.DB, f)
	if err != nil {
		return err
	}
	ids := make([]string, len(books))
	for i, b := range books {
		ids[i] = b.ID
	}
	pct, err := maxProgress(ctx, s.DB, ids)
	if err != nil {
		return err
	}
	items := []map[string]any{}
	for _, b := range books {
		item := map[string]any{"title": b.Title, "url": "/books/" + b.ID}
		if b.Author != nil && *b.Author != "" {
			item["subtitle"] = *b.Author
		}
		if b.CoverPath != nil && *b.CoverPath != "" {
			item["image"] = "/api/books/" + b.ID + "/cover"
		}
		if p := pct[b.ID]; p != nil {
			item["progress"] = pyRound(*p, 1)
			item["caption"] = fmt.Sprintf("%.0f%%", *p)
		}
		items = append(items, item)
	}
	return ok(w, map[string]any{
		"version": 1, "stats": stats, "progress": progress, "items_title": "Currently reading", "items_layout": "covers",
		"items": items, "accepts": map[string]any{"url": "/api/foyer/upload", "types": []string{".epub", ".pdf"}, "label": "Add to library"},
	})
}

func goalCaption(g *goalProgressOut) *string {
	if g.Status == nil {
		return nil
	}
	switch *g.Status {
	case "ahead", "behind":
		gap := pyRoundInt(absf(float64(g.Completed) - *g.ExpectedByNow))
		where := "ahead of"
		if *g.Status == "behind" {
			where = "behind"
		}
		return ptr(fmt.Sprintf("%s %s pace", plural(gap, "book"), where))
	case "done":
		return ptr("Goal reached")
	case "on_track":
		return ptr("On track")
	case "missed":
		return ptr("Goal missed")
	}
	return nil
}

func absf(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

func (s *Server) foyerUploadHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := s.uploadBook(r)
	if err != nil {
		return err
	}
	msg := "Added “" + b.Title + "”"
	if b.Author != nil && *b.Author != "" {
		msg += " by " + *b.Author
	}
	return created(w, map[string]string{"message": msg, "url": "/books/" + b.ID})
}

// ── folder picker ─────────────────────────────────────────────────────────────

func (s *Server) listDirsHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	p := q.StrDefault("path", "")
	if p == "" {
		p = "/"
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return err
	}
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		abs = resolved
	}
	st, err := os.Stat(abs)
	if err != nil {
		return notFound("Path not found: %s", p)
	}
	if !st.IsDir() {
		return badRequest("Not a directory: %s", p)
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return errStatus(http.StatusForbidden, "Permission denied: "+p)
	}
	type dirEntry struct {
		Name        string `json:"name"`
		Path        string `json:"path"`
		HasChildren bool   `json:"has_children"`
	}
	sort.SliceStable(entries, func(i, j int) bool { return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name()) })
	out := []dirEntry{}
	for _, e := range entries {
		child := filepath.Join(abs, e.Name())
		if cst, err := os.Stat(child); err != nil || !cst.IsDir() {
			continue
		}
		has := false
		if kids, err := os.ReadDir(child); err == nil {
			for _, k := range kids {
				if kst, err := os.Stat(filepath.Join(child, k.Name())); err == nil && kst.IsDir() {
					has = true
					break
				}
			}
		}
		out = append(out, dirEntry{Name: e.Name(), Path: child, HasChildren: has})
	}
	var parent *string
	if dir := filepath.Dir(abs); dir != abs {
		parent = &dir
	}
	return ok(w, map[string]any{"path": abs, "parent": parent, "entries": out})
}
