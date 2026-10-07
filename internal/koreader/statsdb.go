package koreader

import (
	_ "modernc.org/sqlite" // the statistics database is SQLite too

	"database/sql"
	"fmt"
	"net/url"
	"os"
	"sort"
	"time"
)

// StatsBook is a book in KOReader's statistics database.
type StatsBook struct {
	ID      int64
	Title   string
	Authors *string
	MD5     *string
	// KOPages is the most common total page count across its page records.
	KOPages *int64
	// MaxPage is the furthest page reached.
	MaxPage *int64
}

// ReadStatsDB reads books and their sessions from statistics.sqlite3,
// read-only.
func ReadStatsDB(path string) ([]StatsBook, map[int64][]Session, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, nil, fmt.Errorf("Stats DB not found: %s", path)
	}
	u := url.URL{Scheme: "file", Path: path, RawQuery: "mode=ro&immutable=1"}
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, nil, err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	// The same column list as the Python reader, so SQLite picks the same
	// plan and books come back in the same order.
	rows, err := db.Query("SELECT id, title, authors, md5, series, language, total_read_time, total_read_pages, last_open FROM book")
	if err != nil {
		return nil, nil, err
	}
	var books []StatsBook
	for rows.Next() {
		var b StatsBook
		var title, authors, md5 sql.NullString
		var ignore [5]any
		if err := rows.Scan(&b.ID, &title, &authors, &md5, &ignore[0], &ignore[1], &ignore[2], &ignore[3], &ignore[4]); err != nil {
			rows.Close()
			return nil, nil, err
		}
		b.Title = title.String
		if authors.String != "" {
			b.Authors = &authors.String
		}
		if md5.String != "" {
			b.MD5 = &md5.String
		}
		books = append(books, b)
	}
	rows.Close()
	sessions := map[int64][]Session{}
	if len(books) == 0 {
		return books, sessions, nil
	}
	raw := map[int64][]pageRow{}
	totals := map[int64][]int64{}
	maxPage := map[int64]int64{}
	var order []int64
	prows, err := db.Query("SELECT id_book, page, start_time, duration, total_pages FROM page_stat_data WHERE id_book IN (SELECT id FROM book) ORDER BY id_book, start_time")
	if err != nil {
		return nil, nil, err
	}
	for prows.Next() {
		var bid int64
		var page, start, duration, total sql.NullInt64
		if err := prows.Scan(&bid, &page, &start, &duration, &total); err != nil {
			prows.Close()
			return nil, nil, err
		}
		if _, seen := raw[bid]; !seen {
			order = append(order, bid)
			raw[bid] = nil
		}
		raw[bid] = append(raw[bid], pageRow{page.Int64, start.Int64, duration.Int64})
		if total.Int64 != 0 {
			totals[bid] = append(totals[bid], total.Int64)
		}
		if page.Int64 != 0 {
			if m, ok := maxPage[bid]; !ok || page.Int64 > m {
				maxPage[bid] = page.Int64
			}
		}
	}
	prows.Close()
	md5s := map[int64]*string{}
	for _, b := range books {
		md5s[b.ID] = b.MD5
	}
	for _, bid := range order {
		sessions[bid] = statsSessions(raw[bid], md5s[bid], bid)
	}
	for i := range books {
		id := books[i].ID
		if list := totals[id]; len(list) > 0 {
			mode := modeOf(list)
			books[i].KOPages = &mode
		}
		if m, ok := maxPage[id]; ok {
			books[i].MaxPage = &m
		}
	}
	return books, sessions, nil
}

// modeOf is max(set(list), key=list.count): the most common value. Python
// breaks ties by set order; ties between page counts are rare enough that
// the smallest value is used.
func modeOf(list []int64) int64 {
	counts := map[int64]int{}
	for _, v := range list {
		counts[v]++
	}
	keys := make([]int64, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })
	best := keys[0]
	for _, k := range keys[1:] {
		if counts[k] > counts[best] {
			best = k
		}
	}
	return best
}

type pageRow struct{ page, start, duration int64 }

// statsSessions groups page records into sessions: a gap of more than
// SessionGap after the previous page's end starts a new one.
func statsSessions(rows []pageRow, md5 *string, bookID int64) []Session {
	if len(rows) == 0 {
		return nil
	}
	sorted := append([]pageRow(nil), rows...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].start < sorted[j].start })
	build := func(g []pageRow) Session {
		start := g[0].start
		var duration int64
		pages := map[int64]bool{}
		for _, r := range g {
			duration += r.duration
			pages[r.page] = true
		}
		key := fmt.Sprintf("stats_db:id%d:%d", bookID, start)
		if md5 != nil && *md5 != "" {
			key = fmt.Sprintf("stats_db:%s:%d", *md5, start)
		}
		return Session{Start: time.Unix(start, 0).UTC(), Duration: duration, PagesRead: int64(len(pages)), SourceKey: key}
	}
	var out []Session
	group := []pageRow{sorted[0]}
	for _, r := range sorted[1:] {
		prev := group[len(group)-1]
		if r.start-(prev.start+prev.duration) > SessionGap {
			out = append(out, build(group))
			group = []pageRow{r}
		} else {
			group = append(group, r)
		}
	}
	return append(out, build(group))
}
