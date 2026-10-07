package server

import (
	"context"
	"math"
	"strconv"
	"strings"
)

// bookFilter holds book_service.list_books' keyword arguments.
type bookFilter struct {
	Page          int64
	PerPage       int64
	Search        *string
	ShelfID       *int64
	Format        *string
	Tag           *string
	Genre         *string
	Author        *string
	SeriesID      *string // comma-separated ids
	HasGenre      *bool
	HasTag        *bool
	HasAuthor     *bool
	HasSeries     *bool
	Status        *string
	MinRating     *float64
	HasRating     *bool
	HasReview     *bool
	Sort          string
	FilterMode    string
	GroupBySeries bool
}

func defaultBookFilter() bookFilter {
	return bookFilter{Page: 1, PerPage: 50, Sort: "created_at", FilterMode: "and"}
}

// splitIDs parses "1, 2,3" into ints, like int(s.strip()) for each part.
func splitIDs(s string) ([]int64, error) {
	var out []int64
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		n, err := strconv.ParseInt(p, 10, 64)
		if err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, nil
}

// listBooks is book_service.list_books: the page of books and the totals.
func listBooks(ctx context.Context, q querier, f bookFilter) ([]*Book, int64, int64, error) {
	var where []string
	var args []any

	if f.Search != nil && *f.Search != "" {
		pattern := "%" + *f.Search + "%"
		where = append(where, `(lower(books.title) LIKE lower(?) OR lower(books.author) LIKE lower(?) OR `+
			`(EXISTS (SELECT book_series.book_id FROM book_series JOIN series ON book_series.series_id = series.id WHERE book_series.book_id = books.id AND lower(series.name) LIKE lower(?))) OR `+
			`(EXISTS (SELECT book_genres.book_id FROM book_genres JOIN genres ON book_genres.genre_id = genres.id WHERE book_genres.book_id = books.id AND lower(genres.name) LIKE lower(?))) OR `+
			`(EXISTS (SELECT book_tags.book_id FROM book_tags JOIN tags ON book_tags.tag_id = tags.id WHERE book_tags.book_id = books.id AND lower(tags.name) LIKE lower(?))))`)
		args = append(args, pattern, pattern, pattern, pattern, pattern)
	}
	if f.ShelfID != nil {
		where = append(where, "books.shelf_id = ?")
		args = append(args, *f.ShelfID)
	}
	if f.Format != nil {
		var formats []any
		for _, p := range strings.Split(*f.Format, ",") {
			if p = strings.TrimSpace(p); p != "" {
				formats = append(formats, p)
			}
		}
		if len(formats) > 0 {
			where = append(where, "books.format IN ("+placeholders(len(formats))+")")
			args = append(args, formats...)
		}
	}

	// Series, tag and genre filters share one shape.
	type linkFilter struct {
		ids     *string
		has     *bool
		table   string
		idCol   string
		present bool
	}
	links := []linkFilter{
		{ids: f.SeriesID, has: f.HasSeries, table: "book_series", idCol: "series_id", present: f.SeriesID != nil || f.HasSeries != nil},
		{ids: f.Tag, has: f.HasTag, table: "book_tags", idCol: "tag_id", present: f.Tag != nil || f.HasTag != nil},
		{ids: f.Genre, has: f.HasGenre, table: "book_genres", idCol: "genre_id", present: f.Genre != nil || f.HasGenre != nil},
	}
	for _, l := range links {
		if !l.present {
			continue
		}
		var ids []int64
		if l.ids != nil && *l.ids != "" {
			var err error
			if ids, err = splitIDs(*l.ids); err != nil {
				return nil, 0, 0, err
			}
		}
		missing := "(EXISTS (SELECT " + l.table + ".book_id FROM " + l.table + " WHERE " + l.table + ".book_id = books.id))"
		hasFalse := l.has != nil && !*l.has
		if len(ids) > 0 {
			if f.FilterMode == "and" {
				for _, id := range ids {
					where = append(where, "(EXISTS (SELECT "+l.table+".book_id FROM "+l.table+" WHERE "+l.table+"."+l.idCol+" = ? AND "+l.table+".book_id = books.id))")
					args = append(args, id)
				}
				if hasFalse {
					where = append(where, "(NOT "+missing+")")
				}
			} else {
				clause := "(EXISTS (SELECT " + l.table + ".book_id FROM " + l.table + " WHERE " + l.table + "." + l.idCol + " IN (" + placeholders(len(ids)) + ") AND " + l.table + ".book_id = books.id))"
				args = append(args, anySlice(ids)...)
				if hasFalse {
					clause = "(" + clause + " OR (NOT " + missing + "))"
				}
				where = append(where, clause)
			}
		} else if l.has != nil && *l.has {
			where = append(where, missing)
		} else if hasFalse {
			where = append(where, "(NOT "+missing+")")
		}
	}

	if f.Author != nil || f.HasAuthor != nil {
		var names []any
		if f.Author != nil {
			for _, p := range strings.Split(*f.Author, ",") {
				if p = strings.TrimSpace(p); p != "" {
					names = append(names, p)
				}
			}
		}
		missingAuthor := "(books.author IS NULL OR trim(books.author) = '')"
		switch {
		case len(names) > 0 && f.HasAuthor != nil && !*f.HasAuthor:
			where = append(where, "(books.author IN ("+placeholders(len(names))+") OR books.author IS NULL OR trim(books.author) = '')")
			args = append(args, names...)
		case len(names) > 0:
			where = append(where, "books.author IN ("+placeholders(len(names))+")")
			args = append(args, names...)
		case f.HasAuthor != nil && *f.HasAuthor:
			where = append(where, "(NOT "+missingAuthor+")")
		case f.HasAuthor != nil:
			where = append(where, missingAuthor)
		}
	}

	if f.MinRating != nil {
		where = append(where, "books.rating IS NOT NULL", "books.rating >= ?")
		args = append(args, *f.MinRating)
	}
	if f.HasRating != nil {
		if *f.HasRating {
			where = append(where, "books.rating IS NOT NULL")
		} else {
			where = append(where, "books.rating IS NULL")
		}
	}
	if f.HasReview != nil {
		if *f.HasReview {
			where = append(where, "books.review IS NOT NULL", "trim(books.review) != ''")
		} else {
			where = append(where, "(books.review IS NULL OR trim(books.review) = '')")
		}
	}
	if f.Status != nil {
		if *f.Status == "dnf" {
			where = append(where, "books.reading_state = 'dnf'")
		} else {
			where = append(where, "(books.reading_state IS NULL OR books.reading_state != 'dnf')")
		}
		progress := "(SELECT max(reading_progress.progress) FROM reading_progress WHERE reading_progress.book_id = books.id)"
		switch *f.Status {
		case "completed":
			where = append(where, progress+" >= 100")
		case "reading":
			where = append(where, progress+" > 0", progress+" < 100")
		case "unread":
			where = append(where, "("+progress+" IS NULL OR "+progress+" = 0)")
		}
	}

	whereSQL := ""
	if len(where) > 0 {
		whereSQL = " WHERE " + strings.Join(where, " AND ")
	}

	var total int64
	if err := q.QueryRowContext(ctx, "SELECT count(*) FROM (SELECT books.id FROM books"+whereSQL+")", args...).Scan(&total); err != nil {
		return nil, 0, 0, err
	}

	from := " FROM books"
	var order string
	switch f.Sort {
	case "title":
		order = "books.title"
	case "author":
		order = "books.author NULLS LAST, books.title"
	case "series":
		from = " FROM books LEFT OUTER JOIN book_series AS bs ON books.id = bs.book_id LEFT OUTER JOIN series AS s ON bs.series_id = s.id"
		order = "s.name NULLS LAST, bs.sequence NULLS LAST, books.title"
	case "last_read":
		order = "(SELECT max(reading_sessions.start_time) FROM reading_sessions WHERE reading_sessions.book_id = books.id AND reading_sessions.dismissed = 0) DESC NULLS LAST, books.date_added DESC"
	default:
		order = "books.date_added DESC"
	}
	base := "SELECT " + bookColumns("books") + from + whereSQL + " ORDER BY " + order

	perPage := f.PerPage
	pages := int64(math.Max(1, math.Ceil(float64(total)/float64(perPage))))

	if f.GroupBySeries {
		ordered, err := queryBooks(ctx, q, base, args...)
		if err != nil {
			return nil, 0, 0, err
		}
		if len(ordered) == 0 {
			return nil, total, pages, nil
		}
		ids := make([]any, len(ordered))
		for i, b := range ordered {
			ids[i] = b.ID
		}
		rows, err := q.QueryContext(ctx, "SELECT book_series.book_id, series.id FROM book_series JOIN series ON book_series.series_id = series.id WHERE book_series.book_id IN ("+placeholders(len(ids))+") ORDER BY book_series.book_id, book_series.sequence NULLS LAST, series.name", ids...)
		if err != nil {
			return nil, 0, 0, err
		}
		seriesOf := map[string]int64{}
		for rows.Next() {
			var bookID string
			var seriesID int64
			if err := rows.Scan(&bookID, &seriesID); err != nil {
				rows.Close()
				return nil, 0, 0, err
			}
			if _, seen := seriesOf[bookID]; !seen {
				seriesOf[bookID] = seriesID
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, 0, 0, err
		}

		var groups [][]*Book
		groupIndex := map[int64]int{}
		for _, b := range ordered {
			sid, inSeries := seriesOf[b.ID]
			if !inSeries {
				groups = append(groups, []*Book{b})
				continue
			}
			if idx, ok := groupIndex[sid]; ok {
				groups[idx] = append(groups[idx], b)
				continue
			}
			groupIndex[sid] = len(groups)
			groups = append(groups, []*Book{b})
		}
		pages = int64(math.Max(1, math.Ceil(float64(len(groups))/float64(perPage))))
		offset := (f.Page - 1) * perPage
		var page []*Book
		for i := offset; i < offset+perPage && i < int64(len(groups)); i++ {
			page = append(page, groups[i]...)
		}
		return page, total, pages, nil
	}

	books, err := queryBooks(ctx, q, base+" LIMIT ? OFFSET ?", append(args, perPage, (f.Page-1)*perPage)...)
	if err != nil {
		return nil, 0, 0, err
	}
	return books, total, pages, nil
}
