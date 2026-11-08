package server

import (
	"context"
	"database/sql"
	"log/slog"

	"github.com/audemed44/shelfloom/internal/scrapers"
)

// mergeAllDuplicateChapters runs mergeDuplicateChapters on every serial whose
// source gives chapters ids. Run at startup; once merged there is nothing
// left to do, as the sync now matches chapters by id.
func (s *Server) mergeAllDuplicateChapters(ctx context.Context) {
	serials, err := querySerials(ctx, s.DB, "SELECT "+serialColumns+" FROM web_serials")
	if err != nil {
		slog.ErrorContext(ctx, "duplicate chapter merge failed", "err", err)
		return
	}
	for _, sr := range serials {
		adapter := scrapers.ByName(sr.Source)
		if _, ok := adapter.(scrapers.ChapterIdentifier); !ok {
			continue
		}
		var merged int
		err := s.DB.Tx(ctx, func(tx *sql.Tx) error {
			var err error
			merged, err = mergeDuplicateChapters(ctx, tx, sr.ID, adapter)
			return err
		})
		if err != nil {
			slog.ErrorContext(ctx, "duplicate chapter merge failed", "serial", sr.ID, "err", err)
		} else if merged > 0 {
			slog.InfoContext(ctx, "merged duplicate chapters", "serial", sr.ID, "title", deref(sr.Title), "count", merged)
		}
	}
}

// mergeDuplicateChapters folds chapters stored more than once under one id
// into a single row. Before the sync matched chapters by id, a retitled
// chapter or a renamed story came back as new chapters at the end, with the
// old rows stubbed. The first row keeps its place and takes the current
// URL, title and stub state, and the newest content; the copies are deleted,
// the chapters after them renumbered to close the gaps, and volume ranges
// moved with them. Returns how many rows were deleted.
func mergeDuplicateChapters(ctx context.Context, tx *sql.Tx, serialID int64, adapter scrapers.Adapter) (int, error) {
	chapters, err := queryChapters(ctx, tx, "SELECT "+chapterColumns+" FROM serial_chapters WHERE serial_id = ? ORDER BY chapter_number", serialID)
	if err != nil {
		return 0, err
	}
	groups := map[string][]*Chapter{}
	var order []string
	for _, c := range chapters {
		id, _ := scrapers.ChapterID(adapter, c.SourceKey)
		if id == "" {
			continue
		}
		if groups[id] == nil {
			order = append(order, id)
		}
		groups[id] = append(groups[id], c)
	}
	survivorOf := map[int64]int64{} // deleted chapter number → the number it merged into
	var contentChanged []int64      // old numbers
	deleted := 0
	for _, id := range order {
		g := groups[id]
		if len(g) < 2 {
			continue
		}
		keep := g[0]
		// The row the source lists now: the live one, else the latest.
		cur := g[len(g)-1]
		for _, c := range g {
			if !c.IsStubbed {
				cur = c
			}
		}
		// The newest content: the current row's, else the latest fetched.
		var src *Chapter
		if cur.HasContent {
			src = cur
		} else {
			for _, c := range g {
				if c.HasContent && (src == nil || c.FetchedAt.After(src.FetchedAt.Time)) {
					src = c
				}
			}
		}
		var content sql.NullString
		var words sql.NullInt64
		if src != nil && src != keep {
			if err := tx.QueryRowContext(ctx, "SELECT content, word_count FROM serial_chapters WHERE id = ?", src.ID).Scan(&content, &words); err != nil {
				return 0, err
			}
			var old sql.NullString
			if err := tx.QueryRowContext(ctx, "SELECT content FROM serial_chapters WHERE id = ?", keep.ID).Scan(&old); err != nil {
				return 0, err
			}
			if old != content {
				contentChanged = append(contentChanged, keep.ChapterNumber)
			}
		}
		for _, c := range g[1:] {
			if _, err := tx.ExecContext(ctx, "DELETE FROM serial_chapters WHERE id = ?", c.ID); err != nil {
				return 0, err
			}
			survivorOf[c.ChapterNumber] = keep.ChapterNumber
			deleted++
		}
		if _, err := tx.ExecContext(ctx, "UPDATE serial_chapters SET source_key = ?, source_url = ?, title = ?, publish_date = ?, is_stubbed = ?, stubbed_at = ? WHERE id = ?",
			cur.SourceKey, cur.SourceURL, cur.Title, cur.PublishDate, cur.IsStubbed, cur.StubbedAt, keep.ID); err != nil {
			return 0, err
		}
		if src != nil && src != keep {
			if _, err := tx.ExecContext(ctx, "UPDATE serial_chapters SET content = ?, word_count = ?, fetched_at = ? WHERE id = ?", content, words, src.FetchedAt, keep.ID); err != nil {
				return 0, err
			}
		}
	}
	if deleted == 0 {
		return 0, nil
	}

	// Close the gaps: number what's left 1..n in order.
	renumber := map[int64]int64{}
	var n int64
	for _, c := range chapters {
		if _, gone := survivorOf[c.ChapterNumber]; gone {
			continue
		}
		n++
		renumber[c.ChapterNumber] = n
	}
	newNumber := func(old int64) int64 {
		if k, ok := survivorOf[old]; ok {
			old = k
		}
		return renumber[old]
	}
	// Through negatives, so no two rows share a number on the way.
	for old, nw := range renumber {
		if old != nw {
			if _, err := tx.ExecContext(ctx, "UPDATE serial_chapters SET chapter_number = ? WHERE serial_id = ? AND chapter_number = ?", -nw, serialID, old); err != nil {
				return 0, err
			}
		}
	}
	if _, err := tx.ExecContext(ctx, "UPDATE serial_chapters SET chapter_number = -chapter_number WHERE serial_id = ? AND chapter_number < 0", serialID); err != nil {
		return 0, err
	}

	// A volume covers the new numbers of the chapters it covered, leaving
	// out copies whose first row another volume already covers.
	vols, err := listVolumes(ctx, tx, serialID)
	if err != nil {
		return 0, err
	}
	inOther := func(v *Volume, n int64) bool {
		for _, o := range vols {
			if o != v && o.ChapterStart != nil && o.ChapterEnd != nil && *o.ChapterStart <= n && n <= *o.ChapterEnd {
				return true
			}
		}
		return false
	}
	for _, v := range vols {
		if v.ChapterStart == nil || v.ChapterEnd == nil {
			continue
		}
		var lo, hi int64
		for _, c := range chapters {
			if c.ChapterNumber < *v.ChapterStart || c.ChapterNumber > *v.ChapterEnd {
				continue
			}
			if k, ok := survivorOf[c.ChapterNumber]; ok && inOther(v, k) {
				continue
			}
			nw := newNumber(c.ChapterNumber)
			if lo == 0 || nw < lo {
				lo = nw
			}
			hi = max(hi, nw)
		}
		if lo == 0 || (lo == *v.ChapterStart && hi == *v.ChapterEnd) {
			continue
		}
		if _, err := tx.ExecContext(ctx, "UPDATE serial_volumes SET chapter_start = ?, chapter_end = ? WHERE id = ?", lo, hi, v.ID); err != nil {
			return 0, err
		}
	}

	var live int64
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM serial_chapters WHERE serial_id = ? AND is_stubbed IS 0", serialID).Scan(&live); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE web_serials SET total_chapters = ?, live_chapter_count = ? WHERE id = ?", n, live, serialID); err != nil {
		return 0, err
	}
	var changed []int64
	for _, old := range contentChanged {
		changed = append(changed, newNumber(old))
	}
	return deleted, markVolumesStale(ctx, tx, serialID, changed)
}
