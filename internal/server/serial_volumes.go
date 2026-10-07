package server

import (
	"context"
	"crypto/md5"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/audemed44/shelfloom/internal/epub"
	"github.com/audemed44/shelfloom/internal/store"
)

func (s *Server) volumeResponses(ctx context.Context, serialID int64, vols []*Volume) ([]*Volume, error) {
	if vols == nil {
		vols = []*Volume{}
	}
	return vols, withMetrics(ctx, s.DB, serialID, vols)
}

func (s *Server) listVolumesHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	if err := requireSerial(ctx, s.DB, id); err != nil {
		return err
	}
	vols, err := listVolumes(ctx, s.DB, id)
	if err != nil {
		return err
	}
	out, err := s.volumeResponses(ctx, id, vols)
	if err != nil {
		return err
	}
	return ok(w, out)
}

type volumeRange struct {
	start, end int64
	name       *string
}

func readSplits(b *body) []volumeRange {
	if !b.Has("splits") {
		b.missing("splits")
		return nil
	}
	var raw []json.RawMessage
	if err := json.Unmarshal(b.Raw("splits"), &raw); err != nil {
		b.fail("splits", "list_type", "Input should be a valid list")
		return nil
	}
	var out []volumeRange
	for i, r := range raw {
		item := &body{raw: map[string]json.RawMessage{}}
		if err := json.Unmarshal(r, &item.raw); err != nil {
			b.errs = append(b.errs, validationIssue{Type: "model_type", Loc: []any{"body", "splits", i}, Msg: "Input should be a valid dictionary or instance of VolumeRange", Input: nil})
			continue
		}
		start := item.Int("start", true, false)
		end := item.Int("end", true, false)
		name := item.Str("name", false, true)
		for _, e := range item.errs {
			e.Loc = append([]any{"body", "splits", i}, e.Loc[1:]...)
			b.errs = append(b.errs, e)
		}
		if start != nil && end != nil {
			out = append(out, volumeRange{*start, *end, name})
		}
	}
	return out
}

// configureVolumes replaces the unbuilt volumes with the given splits,
// numbered after the built ones.
func configureVolumes(ctx context.Context, db *store.DB, serialID int64, splits []volumeRange) ([]*Volume, error) {
	var ids []int64
	err := db.Tx(ctx, func(tx *sql.Tx) error {
		var maxExisting int64
		if err := tx.QueryRowContext(ctx, "SELECT coalesce(max(volume_number), 0) FROM serial_volumes WHERE serial_id = ? AND book_id IS NOT NULL", serialID).Scan(&maxExisting); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM serial_volumes WHERE serial_id = ? AND book_id IS NULL", serialID); err != nil {
			return err
		}
		for i, sp := range splits {
			res, err := tx.ExecContext(ctx, "INSERT INTO serial_volumes (serial_id, volume_number, name, chapter_start, chapter_end, kind, is_stale) VALUES (?, ?, ?, ?, ?, 'generated', 0)",
				serialID, maxExisting+int64(i)+1, sp.name, sp.start, sp.end)
			if err != nil {
				return err
			}
			id, _ := res.LastInsertId()
			ids = append(ids, id)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	out := []*Volume{}
	for _, id := range ids {
		v, err := getVolume(ctx, db, serialID, id)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

func (s *Server) configureVolumesHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	splits := readSplits(b)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if err := requireSerial(ctx, s.DB, id); err != nil {
		return err
	}
	vols, err := configureVolumes(ctx, s.DB, id, splits)
	if err != nil {
		slog.Error(fmt.Sprintf("Failed to configure volumes for serial %d: %v", id, err))
		return errStatus(http.StatusInternalServerError, err.Error())
	}
	out, err := s.volumeResponses(ctx, id, vols)
	if err != nil {
		return err
	}
	return created(w, out)
}

func (s *Server) autoSplitHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	n := b.Int("chapters_per_volume", true, false)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	sr, err := getSerial(ctx, s.DB, id)
	if err != nil {
		return err
	}
	vols := []*Volume{}
	if sr.TotalChapters > 0 {
		existing, err := listVolumes(ctx, s.DB, id)
		if err != nil {
			return err
		}
		var ebookEnd int64
		for _, v := range existing {
			if v.Kind == "ebook" && v.ChapterEnd != nil {
				ebookEnd = max(ebookEnd, *v.ChapterEnd)
			}
		}
		var splits []volumeRange
		for start := ebookEnd + 1; start <= sr.TotalChapters; {
			end := min(start+*n-1, sr.TotalChapters)
			splits = append(splits, volumeRange{start: start, end: end})
			start = end + 1
		}
		if vols, err = configureVolumes(ctx, s.DB, id, splits); err != nil {
			return err
		}
	}
	out, err := s.volumeResponses(ctx, id, vols)
	if err != nil {
		return err
	}
	return created(w, out)
}

func (s *Server) addVolumeHandler(w http.ResponseWriter, r *http.Request) error {
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
	name := b.Str("name", false, true)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if err := requireSerial(ctx, s.DB, id); err != nil {
		return err
	}
	var maxNum int64
	s.DB.QueryRowContext(ctx, "SELECT coalesce(max(volume_number), 0) FROM serial_volumes WHERE serial_id = ?", id).Scan(&maxNum)
	res, err := s.DB.ExecContext(ctx, "INSERT INTO serial_volumes (serial_id, volume_number, name, chapter_start, chapter_end, kind, is_stale) VALUES (?, ?, ?, ?, ?, 'generated', 0)", id, maxNum+1, name, *start, *end)
	if err != nil {
		return err
	}
	vid, _ := res.LastInsertId()
	return s.writeVolume(w, ctx, id, vid, http.StatusCreated)
}

func (s *Server) writeVolume(w http.ResponseWriter, ctx context.Context, serialID, volumeID int64, status int) error {
	v, err := getVolume(ctx, s.DB, serialID, volumeID)
	if err != nil {
		return err
	}
	if err := withMetrics(ctx, s.DB, serialID, []*Volume{v}); err != nil {
		return err
	}
	writeJSON(w, status, v)
	return nil
}

// linkEbookVolume attaches a library book as a volume at a position,
// shifting the run of volumes from there down by one.
func linkEbookVolume(ctx context.Context, db *store.DB, serialID int64, bookID string, number *int64, name *string, chStart, chEnd *int64) (int64, error) {
	sr, err := getSerial(ctx, db, serialID)
	if err != nil {
		return 0, err
	}
	book, err := getBook(ctx, db, bookID)
	if err != nil {
		return 0, err
	}
	if book == nil {
		return 0, notFound("Book %s not found", bookID)
	}
	vols, err := listVolumes(ctx, db, serialID)
	if err != nil {
		return 0, err
	}
	var maxNumber int64
	taken := map[int64]bool{}
	for _, v := range vols {
		if v.BookID != nil && *v.BookID == bookID {
			return 0, conflict("This book is already a volume of this serial")
		}
		maxNumber = max(maxNumber, v.VolumeNumber)
		taken[v.VolumeNumber] = true
	}
	position := maxNumber + 1
	if number != nil && *number != 0 {
		position = *number
	}
	position = min(position, maxNumber+1)
	runEnd := position
	for taken[runEnd] {
		runEnd++
	}
	var vid int64
	err = db.Tx(ctx, func(tx *sql.Tx) error {
		type shifted struct {
			id, number int64
			bookID     *string
			retitle    bool
		}
		var moved []shifted
		for _, v := range vols {
			if position <= v.VolumeNumber && v.VolumeNumber < runEnd {
				moved = append(moved, shifted{v.ID, v.VolumeNumber, v.BookID, v.Kind == "generated" && v.GeneratedAt.Valid && v.Name == nil})
			}
		}
		if len(moved) > 0 {
			if _, err := tx.ExecContext(ctx, "UPDATE serial_volumes SET volume_number = -(volume_number + 1) WHERE serial_id = ? AND volume_number >= ? AND volume_number < ?", serialID, position, runEnd); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "UPDATE serial_volumes SET volume_number = -volume_number WHERE serial_id = ? AND volume_number < 0", serialID); err != nil {
				return err
			}
			for _, m := range moved {
				if m.retitle {
					if _, err := tx.ExecContext(ctx, "UPDATE serial_volumes SET is_stale = 1 WHERE id = ?", m.id); err != nil {
						return err
					}
				}
				if sr.SeriesID != nil && m.bookID != nil {
					if _, err := tx.ExecContext(ctx, "UPDATE book_series SET sequence = ? WHERE book_id = ? AND series_id = ? AND sequence = ?", float64(m.number+1), *m.bookID, *sr.SeriesID, float64(m.number)); err != nil {
						return err
					}
				}
			}
		}
		volName := name
		if volName == nil || *volName == "" {
			volName = &book.Title
		}
		res, err := tx.ExecContext(ctx, "INSERT INTO serial_volumes (serial_id, volume_number, kind, book_id, name, chapter_start, chapter_end, is_stale) VALUES (?, ?, 'ebook', ?, ?, ?, ?, 0)",
			serialID, position, bookID, *volName, chStart, chEnd)
		if err != nil {
			return err
		}
		vid, _ = res.LastInsertId()
		if sr.SeriesID != nil {
			_, err := tx.ExecContext(ctx, "INSERT INTO book_series (book_id, series_id, sequence) VALUES (?, ?, ?) ON CONFLICT(book_id, series_id) DO UPDATE SET sequence = excluded.sequence", bookID, *sr.SeriesID, float64(position))
			return err
		}
		return nil
	})
	return vid, err
}

func (s *Server) linkEbookHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	bookID := b.Str("book_id", true, false)
	number := b.Int("volume_number", false, true)
	name := b.Str("name", false, true)
	chStart := b.Int("chapter_start", false, true)
	chEnd := b.Int("chapter_end", false, true)
	for key, v := range map[string]*int64{"volume_number": number, "chapter_start": chStart, "chapter_end": chEnd} {
		if v != nil && *v < 1 {
			b.errs = append(b.errs, validationIssue{Type: "greater_than_equal", Loc: []any{"body", key}, Msg: "Input should be greater than or equal to 1", Input: *v})
		}
	}
	if len(b.errs) == 0 {
		if (chStart == nil) != (chEnd == nil) {
			b.errs = append(b.errs, validationIssue{Type: "value_error", Loc: []any{"body"}, Msg: "Value error, Give both chapter_start and chapter_end, or neither", Input: b.input()})
		} else if chStart != nil && *chEnd < *chStart {
			b.errs = append(b.errs, validationIssue{Type: "value_error", Loc: []any{"body"}, Msg: "Value error, chapter_end must be >= chapter_start", Input: b.input()})
		}
	}
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	vid, err := linkEbookVolume(ctx, s.DB, id, *bookID, number, name, chStart, chEnd)
	if err != nil {
		return err
	}
	return s.writeVolume(w, ctx, id, vid, http.StatusCreated)
}

func (s *Server) updateVolumeHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	vid, err := pathInt(r, "volume_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	name := b.Str("name", false, true)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := getVolume(ctx, s.DB, id, vid); err != nil {
		return err
	}
	if name != nil {
		if _, err := s.DB.ExecContext(ctx, "UPDATE serial_volumes SET name = ? WHERE id = ?", *name, vid); err != nil {
			return err
		}
	}
	return s.writeVolume(w, ctx, id, vid, http.StatusOK)
}

func (s *Server) deleteVolumeHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	vid, err := pathInt(r, "volume_id")
	if err != nil {
		return err
	}
	q := newQuery(r)
	deleteBook := q.BoolDefault("delete_book", false)
	if err := q.err(); err != nil {
		return err
	}
	ctx := r.Context()
	v, err := getVolume(ctx, s.DB, id, vid)
	if err != nil {
		return err
	}
	// A linked ebook is the user's own file: deleting the volume only unlinks it.
	if deleteBook && v.BookID != nil && v.Kind == "generated" {
		if book, err := getBook(ctx, s.DB, *v.BookID); err == nil && book != nil {
			if shelf, err := getShelf(ctx, s.DB, book.ShelfID); err == nil && shelf != nil && book.FilePath != "" {
				os.Remove(filepath.Join(shelf.Path, book.FilePath))
			}
			if _, err := s.DB.ExecContext(ctx, "DELETE FROM books WHERE id = ?", book.ID); err != nil {
				return err
			}
		}
	}
	if _, err := s.DB.ExecContext(ctx, "DELETE FROM serial_volumes WHERE id = ?", vid); err != nil {
		return err
	}
	return noContent(w)
}

func (s *Server) uploadVolumeCoverHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	vid, err := pathInt(r, "volume_id")
	if err != nil {
		return err
	}
	name, _, data, err := readUpload(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := getVolume(ctx, s.DB, id, vid); err != nil {
		return err
	}
	dest := filepath.Join(s.Config.CoversDir, "serial_vol_"+strconv.FormatInt(vid, 10)+uploadSuffix(name))
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		return err
	}
	if _, err := s.DB.ExecContext(ctx, "UPDATE serial_volumes SET cover_path = ? WHERE id = ?", dest, vid); err != nil {
		return err
	}
	return s.writeVolume(w, ctx, id, vid, http.StatusOK)
}

// ── previews and suggestions ──────────────────────────────────────────────────

func (s *Server) previewVolumesHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	splits := readSplits(b)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if err := requireSerial(ctx, s.DB, id); err != nil {
		return err
	}
	type preview struct {
		Start          int64   `json:"start"`
		End            int64   `json:"end"`
		Name           *string `json:"name"`
		ChapterCount   int64   `json:"chapter_count"`
		FetchedCount   int64   `json:"fetched_chapter_count"`
		TotalWords     int64   `json:"total_words"`
		EstimatedPages *int64  `json:"estimated_pages"`
		IsPartial      bool    `json:"is_partial"`
		StubbedMissing int64   `json:"stubbed_missing_count"`
	}
	out := []preview{}
	if len(splits) == 0 {
		return ok(w, out)
	}
	lo, hi := splits[0].start, splits[0].end
	for _, sp := range splits {
		lo, hi = min(lo, sp.start), max(hi, sp.end)
	}
	stats, err := chapterStats(ctx, s.DB, id, lo, hi)
	if err != nil {
		return err
	}
	for _, sp := range splits {
		words, fetched, partial, stubbed := rangeMetrics(stats, sp.start, sp.end)
		out = append(out, preview{Start: sp.start, End: sp.end, Name: sp.name, ChapterCount: max(0, sp.end-sp.start+1),
			FetchedCount: fetched, TotalWords: words, EstimatedPages: estimatePages(&words), IsPartial: partial, StubbedMissing: stubbed})
	}
	return ok(w, out)
}

type chapterLength struct {
	number    int64
	words     int64
	estimated bool
}

type suggestion struct {
	Start          int64 `json:"start"`
	End            int64 `json:"end"`
	ChapterCount   int   `json:"chapter_count"`
	TotalWords     int64 `json:"total_words"`
	EstimatedPages int64 `json:"estimated_pages"`
	EstimatedCount int   `json:"estimated_chapter_count"`
	InProgress     bool  `json:"in_progress"`
}

// suggestSplits cuts chapters into volumes of roughly book length (see the
// Python backend's suggest_volume_splits).
func suggestSplits(chapters []chapterLength, minWords, maxWords int64, ongoing bool) []suggestion {
	target := float64(minWords+maxWords) / 2
	var groups [][]chapterLength
	var current []chapterLength
	var words int64
	for i, c := range chapters {
		current = append(current, c)
		words += c.words
		if i+1 >= len(chapters) {
			break
		}
		next := chapters[i+1].words
		var close bool
		switch {
		case words >= maxWords:
			close = true
		case words >= minWords:
			close = words+next > maxWords || math.Abs(float64(words)-target) <= math.Abs(float64(words+next)-target)
		default:
			close = words+next > maxWords && math.Abs(float64(words)-target) < math.Abs(float64(words+next)-target)
		}
		if close {
			groups = append(groups, current)
			current, words = nil, 0
		}
	}
	if len(current) > 0 {
		if !ongoing && len(groups) > 0 && float64(words) < float64(minWords)/2 {
			groups[len(groups)-1] = append(groups[len(groups)-1], current...)
		} else {
			groups = append(groups, current)
		}
	}
	out := []suggestion{}
	for i, g := range groups {
		var total int64
		estimated := 0
		for _, c := range g {
			total += c.words
			if c.estimated {
				estimated++
			}
		}
		pages := int64(0)
		if total != 0 {
			pages = max(1, pyRoundInt(float64(total)/wordsPerPage))
		}
		out = append(out, suggestion{Start: g[0].number, End: g[len(g)-1].number, ChapterCount: len(g), TotalWords: total,
			EstimatedPages: pages, EstimatedCount: estimated, InProgress: ongoing && i == len(groups)-1 && total < minWords})
	}
	return out
}

func (s *Server) suggestVolumesHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, true)
	if err != nil {
		return err
	}
	minPages, maxPages := int64(500), int64(600)
	if !b.null {
		if v := b.Int("min_pages", false, false); v != nil {
			minPages = *v
		}
		if v := b.Int("max_pages", false, false); v != nil {
			maxPages = *v
		}
		for key, v := range map[string]int64{"min_pages": minPages, "max_pages": maxPages} {
			if v < 50 {
				b.errs = append(b.errs, validationIssue{Type: "greater_than_equal", Loc: []any{"body", key}, Msg: "Input should be greater than or equal to 50", Input: v})
			} else if v > 5000 {
				b.errs = append(b.errs, validationIssue{Type: "less_than_equal", Loc: []any{"body", key}, Msg: "Input should be less than or equal to 5000", Input: v})
			}
		}
		if len(b.errs) == 0 && maxPages < minPages {
			b.errs = append(b.errs, validationIssue{Type: "value_error", Loc: []any{"body"}, Msg: "Value error, max_pages must be >= min_pages", Input: b.input()})
		}
		if err := b.err(); err != nil {
			return err
		}
	}
	ctx := r.Context()
	sr, err := getSerial(ctx, s.DB, id)
	if err != nil {
		return err
	}
	vols, err := listVolumes(ctx, s.DB, id)
	if err != nil {
		return err
	}
	var coveredTo int64
	for _, v := range vols {
		if v.BookID != nil && v.ChapterEnd != nil {
			coveredTo = max(coveredTo, *v.ChapterEnd)
		}
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT chapter_number, word_count, content IS NOT NULL, is_stubbed FROM serial_chapters WHERE serial_id = ? ORDER BY chapter_number", id)
	if err != nil {
		return err
	}
	type row struct {
		number     int64
		words      *int64
		hasContent bool
		stubbed    bool
	}
	var all []row
	for rows.Next() {
		var x row
		rows.Scan(&x.number, &x.words, &x.hasContent, &x.stubbed)
		all = append(all, x)
	}
	rows.Close()
	var knownSum, knownN int64
	for _, x := range all {
		if x.words != nil && *x.words > 0 {
			knownSum += *x.words
			knownN++
		}
	}
	var average *int64
	if knownN > 0 {
		a := pyRoundInt(float64(knownSum) / float64(knownN))
		average = &a
	}
	var remaining []row
	for _, x := range all {
		if x.number > coveredTo {
			remaining = append(remaining, x)
		}
	}
	var start *int64
	if len(remaining) > 0 {
		start = &remaining[0].number
	}
	respond := func(sugg []suggestion, reason *string) error {
		if sugg == nil {
			sugg = []suggestion{}
		}
		return ok(w, map[string]any{"start_chapter": start, "words_per_page": wordsPerPage, "average_chapter_words": average, "suggestions": sugg, "reason": reason})
	}
	if len(remaining) == 0 {
		return respond(nil, ptr("Every chapter is already in a volume."))
	}
	if average == nil {
		return respond(nil, ptr("Fetch some chapters first so their length can be measured."))
	}
	var lengths []chapterLength
	for _, x := range remaining {
		switch {
		case x.words != nil:
			lengths = append(lengths, chapterLength{x.number, *x.words, false})
		case x.stubbed && !x.hasContent:
			lengths = append(lengths, chapterLength{x.number, 0, false})
		default:
			lengths = append(lengths, chapterLength{x.number, *average, true})
		}
	}
	return respond(suggestSplits(lengths, minPages*wordsPerPage, maxPages*wordsPerPage, sr.Status != "completed"), nil)
}

// ── generating volumes ────────────────────────────────────────────────────────

// errVolumeGeneration is a VolumeGenerationError (answered with 422).
func errVolumeGeneration(format string, args ...any) error {
	return unprocessable(format, args...)
}

// downloadImages fetches the chapter images to embed in a volume; failures
// are skipped.
func downloadImages(ctx context.Context, urls []string) []epub.VolumeImage {
	var out []epub.VolumeImage
	client := &http.Client{Timeout: 20 * time.Second}
	for i, u := range urls {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			continue
		}
		req.Header.Set("User-Agent", plainUserAgent)
		resp, err := client.Do(req)
		if err != nil {
			slog.Debug("image download failed", "url", u, "err", err)
			continue
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, 50<<20))
		resp.Body.Close()
		if err != nil || resp.StatusCode >= 400 {
			continue
		}
		sum := md5.Sum([]byte(u))
		out = append(out, epub.VolumeImage{URL: u, FileName: epub.ImageFileName(u, i, hex.EncodeToString(sum[:])), MediaType: epub.ImageMediaType(u, resp.Header.Get("Content-Type")), Data: data})
	}
	return out
}

// generateVolume fetches a volume's missing chapters, builds its EPUB into a
// shelf, imports it and links the book (generate_volume).
func (s *Server) generateVolume(ctx context.Context, serialID, volumeID int64, shelfID *int64, existingBookID *string) (*Volume, error) {
	sr, err := getSerial(ctx, s.DB, serialID)
	if err != nil {
		return nil, err
	}
	v, err := getVolume(ctx, s.DB, serialID, volumeID)
	if err != nil {
		return nil, err
	}
	if v.Kind == "ebook" {
		return nil, errVolumeGeneration("This volume is a linked ebook; it is never generated or rebuilt")
	}
	if v.ChapterStart == nil || v.ChapterEnd == nil {
		return nil, errVolumeGeneration("Volume has no chapter range to generate")
	}
	start, end := *v.ChapterStart, *v.ChapterEnd
	slog.Info(fmt.Sprintf("Generating volume %d (ch %d–%d) for serial %d", v.VolumeNumber, start, end, serialID))
	if err := s.fetchChapterContents(ctx, serialID, start, end, nil, nil); err != nil {
		return nil, err
	}
	if sr, err = getSerial(ctx, s.DB, serialID); err != nil {
		return nil, err
	}
	if v, err = getVolume(ctx, s.DB, serialID, volumeID); err != nil {
		return nil, err
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT chapter_number, title, content FROM serial_chapters WHERE serial_id = ? AND chapter_number >= ? AND chapter_number <= ? AND content IS NOT NULL ORDER BY chapter_number", serialID, start, end)
	if err != nil {
		return nil, err
	}
	var chapters []epub.VolumeChapter
	var imageURLs []string
	seenImage := map[string]bool{}
	for rows.Next() {
		var c epub.VolumeChapter
		var title *string
		if err := rows.Scan(&c.Number, &title, &c.HTML); err != nil {
			rows.Close()
			return nil, err
		}
		c.Title = deref(title)
		for _, u := range epub.ImageURLs(c.HTML) {
			if !seenImage[u] {
				seenImage[u] = true
				imageURLs = append(imageURLs, u)
			}
		}
		chapters = append(chapters, c)
	}
	rows.Close()
	if len(chapters) == 0 {
		return nil, errVolumeGeneration("No fetched chapters in range %d–%d", start, end)
	}

	var shelf *Shelf
	if shelfID != nil {
		if shelf, err = getShelf(ctx, s.DB, *shelfID); err != nil {
			return nil, err
		}
		if shelf == nil {
			return nil, errVolumeGeneration("Shelf %d not found", *shelfID)
		}
	} else {
		shelf, err = scanShelf(s.DB.QueryRowContext(ctx, "SELECT "+shelfColumns+" FROM shelves WHERE name = ?", s.Config.DefaultShelfName))
		if errors.Is(err, sql.ErrNoRows) {
			res, err := s.DB.ExecContext(ctx, "INSERT INTO shelves (name, path, is_default, is_sync_target, auto_organize) VALUES (?, ?, 0, 0, 0)", s.Config.DefaultShelfName, s.Config.DefaultShelfPath)
			if err != nil {
				return nil, err
			}
			nid, _ := res.LastInsertId()
			shelf, err = getShelf(ctx, s.DB, nid)
			if err != nil {
				return nil, err
			}
		} else if err != nil {
			return nil, err
		}
	}
	if err := os.MkdirAll(shelf.Path, 0o755); err != nil {
		return nil, err
	}
	images := downloadImages(ctx, imageURLs)
	if len(images) > 0 {
		slog.Info(fmt.Sprintf("Embedded %d images into EPUB for volume %d", len(images), v.VolumeNumber))
	}
	title := deref(v.Name)
	if title == "" {
		title = fmt.Sprintf("%s - Volume %d", orDefault(sr.Title, "Untitled"), v.VolumeNumber)
	}
	identifier := fmt.Sprintf("serial-%d-vol-%d", sr.ID, v.VolumeNumber)
	if existingBookID != nil {
		identifier = *existingBookID
	}
	cover := deref(v.CoverPath)
	if cover == "" {
		cover = deref(sr.CoverPath)
	}
	slog.Info(fmt.Sprintf("Building EPUB for volume %d (%d chapters) → %s", v.VolumeNumber, len(chapters), shelf.Path))
	epubPath, err := epub.BuildVolume(epub.Volume{
		Identifier: identifier, Title: title, Author: orDefault(sr.Author, "Unknown"), Description: deref(sr.Description),
		CoverPath: cover, Chapters: chapters, Images: images,
	}, shelf.Path)
	if err != nil {
		slog.Error(fmt.Sprintf("EPUB generation failed for volume %d: %v", v.VolumeNumber, err))
		return nil, errVolumeGeneration("EPUB generation failed: %v", err)
	}
	slog.Info("EPUB written: " + epubPath)
	if _, err := s.processFile(ctx, shelf, epubPath); err != nil {
		return nil, err
	}
	rel, _ := relPath(shelf.Path, epubPath)
	books, err := queryBooks(ctx, s.DB, "SELECT "+bookColumns("books")+" FROM books WHERE books.shelf_id = ? AND books.file_path = ? ORDER BY books.date_added DESC", shelf.ID, rel)
	if err != nil {
		return nil, err
	}
	if len(books) == 0 {
		return nil, errVolumeGeneration("Book record was not created after EPUB import")
	}
	book := books[0]
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "UPDATE serial_volumes SET book_id = ?, generated_at = ?, is_stale = 0 WHERE id = ?", book.ID, store.Now(), volumeID); err != nil {
			return err
		}
		if sr.SeriesID != nil {
			_, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO book_series (book_id, series_id, sequence) VALUES (?, ?, ?)", book.ID, *sr.SeriesID, float64(v.VolumeNumber))
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return getVolume(ctx, s.DB, serialID, volumeID)
}

func (s *Server) generateVolumeHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	vid, err := pathInt(r, "volume_id")
	if err != nil {
		return err
	}
	q := newQuery(r)
	shelfID := q.Int("shelf_id")
	if err := q.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := s.generateVolume(ctx, id, vid, shelfID, nil); err != nil {
		var he *httpError
		if errors.As(err, &he) {
			if he.status == http.StatusUnprocessableEntity {
				slog.Error(fmt.Sprintf("Volume generation error: %v", he.detail))
			}
			return err
		}
		slog.Error(fmt.Sprintf("Unexpected error generating volume %d for serial %d: %v", vid, id, err))
		return errStatus(http.StatusInternalServerError, err.Error())
	}
	return s.writeVolume(w, ctx, id, vid, http.StatusOK)
}

func (s *Server) generateAllHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	q := newQuery(r)
	shelfID := q.Int("shelf_id")
	if err := q.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if err := requireSerial(ctx, s.DB, id); err != nil {
		return err
	}
	vols, err := listVolumes(ctx, s.DB, id)
	if err != nil {
		return err
	}
	out := []*Volume{}
	for _, v := range vols {
		if v.Kind != "generated" {
			continue
		}
		gen, err := s.generateVolume(ctx, id, v.ID, shelfID, nil)
		if err != nil {
			var he *httpError
			if errors.As(err, &he) && he.status == http.StatusUnprocessableEntity {
				slog.Warn(fmt.Sprintf("Volume %d generation failed: %v", v.VolumeNumber, he.detail))
				continue
			}
			return err
		}
		out = append(out, gen)
	}
	if err := withMetrics(ctx, s.DB, id, out); err != nil {
		return err
	}
	return ok(w, out)
}

var volumeTitle = func(serial string) *regexp.Regexp {
	return regexp.MustCompile(`^` + regexp.QuoteMeta(serial) + ` - Volume \d+$`)
}

func (s *Server) rebuildVolumeHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	vid, err := pathInt(r, "volume_id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	v, err := getVolume(ctx, s.DB, id, vid)
	if err != nil {
		return err
	}
	var shelfID *int64
	var existing *string
	var oldFile, oldTitle string
	if v.BookID != nil {
		existing = v.BookID
		if book, err := getBook(ctx, s.DB, *v.BookID); err == nil && book != nil {
			shelfID = &book.ShelfID
			oldTitle = book.Title
			if shelf, err := getShelf(ctx, s.DB, book.ShelfID); err == nil && shelf != nil && book.FilePath != "" {
				oldFile = filepath.Join(shelf.Path, book.FilePath)
			}
		}
	}
	var oldSpine []spineItem
	if oldFile != "" && fileExists(oldFile) {
		if oldSpine, err = epubSpine(oldFile); err != nil {
			slog.Warn("Could not read the spine of " + oldFile)
			oldSpine = nil
		}
	}
	nv, err := s.generateVolume(ctx, id, vid, shelfID, existing)
	if err != nil {
		return err
	}
	if nv.BookID != nil {
		book, err := getBook(ctx, s.DB, *nv.BookID)
		if err != nil {
			return err
		}
		if book != nil {
			shelf, _ := getShelf(ctx, s.DB, book.ShelfID)
			if shelf != nil && book.FilePath != "" {
				newFile := filepath.Join(shelf.Path, book.FilePath)
				if oldFile != "" && oldFile != newFile {
					if err := os.Remove(oldFile); err != nil && !os.IsNotExist(err) {
						slog.Warn("Could not remove replaced volume file " + oldFile)
					}
				}
			}
			sr, _ := getSerial(ctx, s.DB, id)
			serialTitle := "Untitled"
			if sr != nil && sr.Title != nil && *sr.Title != "" {
				serialTitle = *sr.Title
			}
			if nv.Name == nil && oldTitle != "" && volumeTitle(serialTitle).MatchString(oldTitle) {
				if _, err := s.DB.ExecContext(ctx, "UPDATE books SET title = ? WHERE id = ?", fmt.Sprintf("%s - Volume %d", serialTitle, nv.VolumeNumber), book.ID); err != nil {
					return err
				}
			}
			if len(oldSpine) > 0 && shelf != nil {
				book, _ = getBook(ctx, s.DB, book.ID)
				newSpine, err := epubSpine(filepath.Join(shelf.Path, book.FilePath))
				if err == nil && len(newSpine) > 0 {
					if err := carryPositionAcrossRebuild(ctx, s.DB, book, oldSpine, newSpine); err != nil {
						return err
					}
				}
			}
		}
	}
	return s.writeVolume(w, ctx, id, vid, http.StatusOK)
}

// ── series that belong to a serial ────────────────────────────────────────────

var (
	seriesKeyNonAlnum = regexp.MustCompile(`[^a-z0-9]+`)
	seriesKeyThe      = regexp.MustCompile(`^the `)
	seriesKeySuffix   = regexp.MustCompile(` (series|saga|books?|novels?)$`)
)

func seriesKey(name *string) string {
	key := strings.TrimSpace(seriesKeyNonAlnum.ReplaceAllString(strings.ToLower(deref(name)), " "))
	key = seriesKeyThe.ReplaceAllString(key, "")
	return seriesKeySuffix.ReplaceAllString(key, "")
}

func otherSerialSeries(ctx context.Context, q querier, serialID int64) (map[int64]bool, error) {
	rows, err := q.QueryContext(ctx, "SELECT series_id FROM web_serials WHERE id != ? AND series_id IS NOT NULL", serialID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]bool{}
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		out[id] = true
	}
	return out, rows.Err()
}

func (s *Server) mergeCandidatesHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	sr, err := getSerial(ctx, s.DB, id)
	if err != nil {
		return err
	}
	var ownName *string
	if sr.SeriesID != nil {
		s.DB.QueryRowContext(ctx, "SELECT name FROM series WHERE id = ?", *sr.SeriesID).Scan(&ownName)
	}
	keys := map[string]bool{}
	for _, k := range []string{seriesKey(sr.Title), seriesKey(ownName)} {
		if k != "" {
			keys[k] = true
		}
	}
	vols, err := listVolumes(ctx, s.DB, id)
	if err != nil {
		return err
	}
	linked := map[string]bool{}
	for _, v := range vols {
		if v.BookID != nil && *v.BookID != "" && v.Kind == "ebook" {
			linked[*v.BookID] = true
		}
	}
	excluded, err := otherSerialSeries(ctx, s.DB, id)
	if err != nil {
		return err
	}
	if sr.SeriesID != nil {
		excluded[*sr.SeriesID] = true
	}
	reasons := map[int64][]string{}
	names := map[int64]string{}
	rows, err := s.DB.QueryContext(ctx, "SELECT id, name FROM series")
	if err != nil {
		return err
	}
	for rows.Next() {
		var sid int64
		var name string
		rows.Scan(&sid, &name)
		names[sid] = name
		if !excluded[sid] && keys[seriesKey(&name)] {
			reasons[sid] = append(reasons[sid], "same_name")
		}
	}
	rows.Close()
	if len(linked) > 0 {
		var ids []any
		for b := range linked {
			ids = append(ids, b)
		}
		rows, err := s.DB.QueryContext(ctx, "SELECT DISTINCT series_id FROM book_series WHERE book_id IN ("+placeholders(len(ids))+")", ids...)
		if err != nil {
			return err
		}
		for rows.Next() {
			var sid int64
			rows.Scan(&sid)
			if !excluded[sid] {
				reasons[sid] = append(reasons[sid], "linked_ebook")
			}
		}
		rows.Close()
	}
	type candBook struct {
		BookID   string   `json:"book_id"`
		Title    string   `json:"title"`
		Sequence *float64 `json:"sequence"`
		Linked   bool     `json:"linked"`
	}
	type candidate struct {
		SeriesID  int64      `json:"series_id"`
		Name      string     `json:"name"`
		BookCount int        `json:"book_count"`
		Reasons   []string   `json:"reasons"`
		Books     []candBook `json:"books"`
	}
	out := []candidate{}
	if len(reasons) == 0 {
		return ok(w, out)
	}
	var sids []any
	for sid := range reasons {
		sids = append(sids, sid)
	}
	books := map[int64][]candBook{}
	brows, err := s.DB.QueryContext(ctx, "SELECT book_series.series_id, book_series.book_id, book_series.sequence, books.title FROM book_series JOIN books ON books.id = book_series.book_id WHERE book_series.series_id IN ("+placeholders(len(sids))+") ORDER BY book_series.sequence NULLS LAST, books.title", sids...)
	if err != nil {
		return err
	}
	for brows.Next() {
		var sid int64
		var cb candBook
		brows.Scan(&sid, &cb.BookID, &cb.Sequence, &cb.Title)
		cb.Linked = linked[cb.BookID]
		books[sid] = append(books[sid], cb)
	}
	brows.Close()
	ordered := make([]int64, 0, len(reasons))
	for sid := range reasons {
		ordered = append(ordered, sid)
	}
	sort.SliceStable(ordered, func(i, j int) bool {
		a, b := strings.ToLower(names[ordered[i]]), strings.ToLower(names[ordered[j]])
		if a != b {
			return a < b
		}
		return ordered[i] < ordered[j]
	})
	for _, sid := range ordered {
		if len(books[sid]) == 0 {
			continue
		}
		out = append(out, candidate{SeriesID: sid, Name: names[sid], BookCount: len(books[sid]), Reasons: reasons[sid], Books: books[sid]})
	}
	return ok(w, out)
}

func (s *Server) mergeIntoSerialHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "serial_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	seriesID := b.Int("series_id", true, false)
	link := b.Bool("link_as_volumes", false, false)
	if err := b.err(); err != nil {
		return err
	}
	linkAsVolumes := link == nil || *link
	ctx := r.Context()
	sr, err := getSerial(ctx, s.DB, id)
	if err != nil {
		return err
	}
	if sr.SeriesID != nil && *seriesID == *sr.SeriesID {
		return conflict("That is already this serial's series")
	}
	source, err := getSeries(ctx, s.DB, *seriesID)
	if err != nil {
		return err
	}
	others, err := otherSerialSeries(ctx, s.DB, id)
	if err != nil {
		return err
	}
	if others[*seriesID] {
		return conflict(`"%s" belongs to another serial`, source.Name)
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT book_id FROM book_series WHERE series_id = ? ORDER BY sequence NULLS LAST, book_id", *seriesID)
	if err != nil {
		return err
	}
	var ordered []string
	for rows.Next() {
		var bid string
		rows.Scan(&bid)
		ordered = append(ordered, bid)
	}
	rows.Close()
	linked := 0
	if linkAsVolumes {
		position := int64(1)
		for _, bid := range ordered {
			var existing int64
			err := s.DB.QueryRowContext(ctx, "SELECT volume_number FROM serial_volumes WHERE serial_id = ? AND book_id = ?", id, bid).Scan(&existing)
			if err == nil {
				position = existing + 1
				continue
			}
			if _, err := linkEbookVolume(ctx, s.DB, id, bid, &position, nil, nil, nil); err != nil {
				return err
			}
			position++
			linked++
		}
	}
	targetID, targetName, moved := *seriesID, source.Name, 0
	if sr.SeriesID == nil {
		if _, err := s.DB.ExecContext(ctx, "UPDATE web_serials SET series_id = ? WHERE id = ?", *seriesID, id); err != nil {
			return err
		}
	} else {
		res, err := mergeSeries(ctx, s.DB, *seriesID, *sr.SeriesID)
		if err != nil {
			var he *httpError
			if errors.As(err, &he) && he.status == http.StatusBadRequest {
				he.status = http.StatusConflict
			}
			return err
		}
		targetID, targetName, moved = res.target.ID, res.target.Name, res.moved
	}
	return ok(w, map[string]any{"series_id": targetID, "series_name": targetName, "merged_from": source.Name, "moved_books": moved, "linked_volumes": linked})
}
