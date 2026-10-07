package server

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"

	"github.com/audemed44/shelfloom/internal/store"
)

type seriesResponse struct {
	ID          int64   `json:"id"`
	Name        string  `json:"name"`
	ParentID    *int64  `json:"parent_id"`
	Description *string `json:"description"`
	SortOrder   int64   `json:"sort_order"`
	CoverPath   *string `json:"cover_path"`
}

const seriesColumns = "id, name, parent_id, description, sort_order, cover_path"

func scanSeries(row scanner, extra ...any) (*seriesResponse, error) {
	var s seriesResponse
	if err := row.Scan(append([]any{&s.ID, &s.Name, &s.ParentID, &s.Description, &s.SortOrder, &s.CoverPath}, extra...)...); err != nil {
		return nil, err
	}
	return &s, nil
}

func getSeries(ctx context.Context, q querier, id int64) (*seriesResponse, error) {
	s, err := scanSeries(q.QueryRowContext(ctx, "SELECT "+seriesColumns+" FROM series WHERE id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("Series %d not found", id)
	}
	return s, err
}

func (s *Server) listSeriesHandler(w http.ResponseWriter, r *http.Request) error {
	rows, err := s.DB.QueryContext(r.Context(), "SELECT "+seriesColumns+" FROM series ORDER BY series.parent_id, series.sort_order")
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []seriesResponse{}
	for rows.Next() {
		sr, err := scanSeries(rows)
		if err != nil {
			return err
		}
		out = append(out, *sr)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return ok(w, out)
}

func (s *Server) seriesTreeHandler(w http.ResponseWriter, r *http.Request) error {
	firstBook := "(SELECT book_series.book_id FROM book_series JOIN books ON books.id = book_series.book_id WHERE book_series.series_id = series.id AND books.cover_path IS NOT NULL ORDER BY book_series.sequence NULLS LAST, book_series.book_id LIMIT 1)"
	firstCover := "(SELECT books.cover_path FROM books JOIN book_series ON books.id = book_series.book_id WHERE book_series.series_id = series.id AND books.cover_path IS NOT NULL ORDER BY book_series.sequence NULLS LAST, book_series.book_id LIMIT 1)"
	rows, err := s.DB.QueryContext(r.Context(), "SELECT "+prefixed("series", seriesColumns)+", count(book_series.book_id) AS book_count, "+firstBook+" AS first_book_id, "+firstCover+" AS first_book_cover_path, series_1.name AS parent_name "+
		"FROM series LEFT OUTER JOIN book_series ON series.id = book_series.series_id LEFT OUTER JOIN series AS series_1 ON series.parent_id = series_1.id "+
		"GROUP BY series.id ORDER BY series.parent_id NULLS LAST, series.sort_order, series.name")
	if err != nil {
		return err
	}
	defer rows.Close()
	type treeRow struct {
		seriesResponse
		BookCount          int64   `json:"book_count"`
		FirstBookID        *string `json:"first_book_id"`
		FirstBookCoverPath *string `json:"first_book_cover_path"`
		ParentName         *string `json:"parent_name"`
	}
	out := []treeRow{}
	for rows.Next() {
		var t treeRow
		sr, err := scanSeries(rows, &t.BookCount, &t.FirstBookID, &t.FirstBookCoverPath, &t.ParentName)
		if err != nil {
			return err
		}
		t.seriesResponse = *sr
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return ok(w, out)
}

func (s *Server) purgeEmptySeriesHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	deleted := []string{}
	for {
		rows, err := s.DB.QueryContext(ctx, "SELECT id, name FROM series WHERE (series.id NOT IN (SELECT DISTINCT book_series.series_id FROM book_series)) AND (series.id NOT IN (SELECT DISTINCT series.parent_id FROM series WHERE series.parent_id IS NOT NULL))")
		if err != nil {
			return err
		}
		var ids []any
		for rows.Next() {
			var id int64
			var name string
			if err := rows.Scan(&id, &name); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
			deleted = append(deleted, name)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if len(ids) == 0 {
			break
		}
		if _, err := s.DB.ExecContext(ctx, "DELETE FROM series WHERE id IN ("+placeholders(len(ids))+")", ids...); err != nil {
			return err
		}
	}
	return ok(w, map[string]any{"deleted": deleted, "count": len(deleted)})
}

func (s *Server) getSeriesHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "series_id")
	if err != nil {
		return err
	}
	sr, err := getSeries(r.Context(), s.DB, id)
	if err != nil {
		return err
	}
	return ok(w, sr)
}

func (s *Server) createSeriesHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	name := b.Str("name", true, false)
	parentID := b.Int("parent_id", false, true)
	description := b.Str("description", false, true)
	sortOrder := b.Int("sort_order", false, false)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if parentID != nil {
		if _, err := getSeries(ctx, s.DB, *parentID); err != nil {
			return err
		}
	}
	res, err := s.DB.ExecContext(ctx, "INSERT INTO series (name, parent_id, description, sort_order) VALUES (?, ?, ?, ?)", *name, parentID, description, deref(sortOrder))
	if err != nil {
		return err
	}
	id, _ := res.LastInsertId()
	sr, err := getSeries(ctx, s.DB, id)
	if err != nil {
		return err
	}
	return created(w, sr)
}

func (s *Server) updateSeriesHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "series_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	name := b.Str("name", false, true)
	parentID := b.Int("parent_id", false, true)
	description := b.Str("description", false, true)
	sortOrder := b.Int("sort_order", false, true)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := getSeries(ctx, s.DB, id); err != nil {
		return err
	}
	var sets []string
	var args []any
	if name != nil {
		sets, args = append(sets, "name = ?"), append(args, *name)
	}
	if b.Has("parent_id") {
		if parentID != nil {
			if _, err := getSeries(ctx, s.DB, *parentID); err != nil {
				return err
			}
		}
		sets, args = append(sets, "parent_id = ?"), append(args, parentID)
	}
	if description != nil {
		sets, args = append(sets, "description = ?"), append(args, *description)
	}
	if sortOrder != nil {
		sets, args = append(sets, "sort_order = ?"), append(args, *sortOrder)
	}
	if len(sets) > 0 {
		if _, err := s.DB.ExecContext(ctx, "UPDATE series SET "+joinComma(sets)+" WHERE id = ?", append(args, id)...); err != nil {
			return err
		}
	}
	sr, err := getSeries(ctx, s.DB, id)
	if err != nil {
		return err
	}
	return ok(w, sr)
}

func joinComma(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += ", "
		}
		out += p
	}
	return out
}

func (s *Server) deleteSeriesHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "series_id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := getSeries(ctx, s.DB, id); err != nil {
		return err
	}
	if _, err := s.DB.ExecContext(ctx, "DELETE FROM series WHERE id = ?", id); err != nil {
		return err
	}
	return noContent(w)
}

type seriesMergeResult struct {
	target     *seriesResponse
	moved      int
	already    int
	sourceName string
}

// mergeSeries moves everything in source into target, then deletes source.
func mergeSeries(ctx context.Context, db *store.DB, sourceID, targetID int64) (*seriesMergeResult, error) {
	if sourceID == targetID {
		return nil, badRequest("A series can't be merged into itself")
	}
	source, err := getSeries(ctx, db, sourceID)
	if err != nil {
		return nil, err
	}
	target, err := getSeries(ctx, db, targetID)
	if err != nil {
		return nil, err
	}
	ancestor := target.ParentID
	for ancestor != nil {
		if *ancestor == sourceID {
			return nil, badRequest(`"%s" is inside "%s"; merge it the other way round`, target.Name, source.Name)
		}
		var next *int64
		err := db.QueryRowContext(ctx, "SELECT parent_id FROM series WHERE id = ?", *ancestor).Scan(&next)
		if errors.Is(err, sql.ErrNoRows) {
			break
		}
		if err != nil {
			return nil, err
		}
		ancestor = next
	}
	result := &seriesMergeResult{sourceName: source.Name}
	err = db.Tx(ctx, func(tx *sql.Tx) error {
		inTarget := map[string]bool{}
		rows, err := tx.QueryContext(ctx, "SELECT book_id FROM book_series WHERE series_id = ?", targetID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var id string
			rows.Scan(&id)
			inTarget[id] = true
		}
		rows.Close()
		type entry struct {
			bookID string
			seq    *float64
		}
		var entries []entry
		rows, err = tx.QueryContext(ctx, "SELECT book_id, sequence FROM book_series WHERE series_id = ?", sourceID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var e entry
			rows.Scan(&e.bookID, &e.seq)
			entries = append(entries, e)
		}
		rows.Close()
		for _, e := range entries {
			if inTarget[e.bookID] {
				continue
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO book_series (book_id, series_id, sequence) VALUES (?, ?, ?)", e.bookID, targetID, e.seq); err != nil {
				return err
			}
			result.moved++
		}
		result.already = len(entries) - result.moved
		if _, err := tx.ExecContext(ctx, "UPDATE series SET parent_id = ? WHERE series.parent_id = ? AND series.id != ?", targetID, sourceID, targetID); err != nil {
			return err
		}
		if target.ParentID != nil && *target.ParentID == sourceID {
			if _, err := tx.ExecContext(ctx, "UPDATE series SET parent_id = ? WHERE id = ?", source.ParentID, targetID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, "UPDATE reading_orders SET series_id = ? WHERE series_id = ?", targetID, sourceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE web_serials SET series_id = ? WHERE series_id = ?", targetID, sourceID); err != nil {
			return err
		}
		if err := replaceSeriesInLenses(ctx, tx, sourceID, targetID); err != nil {
			return err
		}
		if (target.Description == nil || *target.Description == "") && source.Description != nil && *source.Description != "" {
			if _, err := tx.ExecContext(ctx, "UPDATE series SET description = ? WHERE id = ?", *source.Description, targetID); err != nil {
				return err
			}
		}
		if (target.CoverPath == nil || *target.CoverPath == "") && source.CoverPath != nil && *source.CoverPath != "" {
			if _, err := tx.ExecContext(ctx, "UPDATE series SET cover_path = ? WHERE id = ?", *source.CoverPath, targetID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, "DELETE FROM book_series WHERE book_series.series_id = ?", sourceID); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, "DELETE FROM series WHERE series.id = ?", sourceID)
		return err
	})
	if err != nil {
		return nil, err
	}
	if result.target, err = getSeries(ctx, db, targetID); err != nil {
		return nil, err
	}
	return result, nil
}

// replaceSeriesInLenses points lens filters at the merged series.
func replaceSeriesInLenses(ctx context.Context, tx *sql.Tx, sourceID, targetID int64) error {
	rows, err := tx.QueryContext(ctx, "SELECT id, filter_state FROM lenses")
	if err != nil {
		return err
	}
	type lensRow struct {
		id    int64
		state string
	}
	var lenses []lensRow
	for rows.Next() {
		var l lensRow
		rows.Scan(&l.id, &l.state)
		lenses = append(lenses, l)
	}
	rows.Close()
	for _, l := range lenses {
		state, err := decodeOrderedObject([]byte(l.state))
		if err != nil {
			continue
		}
		raw, has := state.get("series_ids")
		if !has {
			continue
		}
		var ids []json.Number
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		if dec.Decode(&ids) != nil {
			continue
		}
		source := strconv.FormatInt(sourceID, 10)
		found := false
		for _, v := range ids {
			if v.String() == source {
				found = true
			}
		}
		if !found {
			continue
		}
		var replaced []json.Number
		for _, v := range ids {
			if v.String() == source {
				v = json.Number(strconv.FormatInt(targetID, 10))
			}
			if !slices.Contains(replaced, v) {
				replaced = append(replaced, v)
			}
		}
		enc, _ := json.Marshal(replaced)
		state.set("series_ids", enc)
		if _, err := tx.ExecContext(ctx, "UPDATE lenses SET filter_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", state.pythonDumps(), l.id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) mergeSeriesHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "series_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	sourceID := b.Int("source_id", true, false)
	if err := b.err(); err != nil {
		return err
	}
	res, err := mergeSeries(r.Context(), s.DB, *sourceID, id)
	if err != nil {
		return err
	}
	return ok(w, map[string]any{"series": res.target, "merged_from": res.sourceName, "moved_books": res.moved, "already_in_target": res.already})
}

func (s *Server) addBookToSeriesHandler(w http.ResponseWriter, r *http.Request) error {
	seriesID, err := pathInt(r, "series_id")
	if err != nil {
		return err
	}
	q := newQuery(r)
	sequence := q.Float("sequence")
	if err := q.err(); err != nil {
		return err
	}
	b, err := readBody(r, true)
	if err != nil {
		return err
	}
	if !b.null {
		if seq := b.Float("sequence", false, true); seq != nil {
			sequence = seq
		}
		if err := b.err(); err != nil {
			return err
		}
	}
	ctx := r.Context()
	bookID := r.PathValue("book_id")
	if _, err := getSeries(ctx, s.DB, seriesID); err != nil {
		return err
	}
	if bk, err := getBook(ctx, s.DB, bookID); err != nil {
		return err
	} else if bk == nil {
		return notFound("Book %s not found", bookID)
	}
	if _, err := s.DB.ExecContext(ctx, "INSERT INTO book_series (book_id, series_id, sequence) VALUES (?, ?, ?) ON CONFLICT(book_id, series_id) DO UPDATE SET sequence = excluded.sequence", bookID, seriesID, sequence); err != nil {
		return err
	}
	return created(w, map[string]any{"series_id": seriesID, "book_id": bookID, "sequence": sequence})
}

func (s *Server) removeBookFromSeriesHandler(w http.ResponseWriter, r *http.Request) error {
	seriesID, err := pathInt(r, "series_id")
	if err != nil {
		return err
	}
	if _, err := s.DB.ExecContext(r.Context(), "DELETE FROM book_series WHERE book_id = ? AND series_id = ?", r.PathValue("book_id"), seriesID); err != nil {
		return err
	}
	return noContent(w)
}

type readingOrderEntry struct {
	ID             int64   `json:"id"`
	ReadingOrderID int64   `json:"reading_order_id"`
	BookID         string  `json:"book_id"`
	Position       int64   `json:"position"`
	Note           *string `json:"note"`
	Title          *string `json:"title"`
	Author         *string `json:"author"`
	Format         *string `json:"format"`
	CoverPath      *string `json:"cover_path"`
}

type readingOrderDetail struct {
	ID       int64               `json:"id"`
	Name     string              `json:"name"`
	SeriesID int64               `json:"series_id"`
	Entries  []readingOrderEntry `json:"entries"`
}

func readingOrderEntries(ctx context.Context, q querier, orderID int64) ([]readingOrderEntry, error) {
	rows, err := q.QueryContext(ctx, "SELECT e.id, e.reading_order_id, e.book_id, e.position, e.note, books.title, books.author, books.format, books.cover_path FROM reading_order_entries AS e LEFT OUTER JOIN books ON books.id = e.book_id WHERE e.reading_order_id = ? ORDER BY e.position", orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []readingOrderEntry{}
	for rows.Next() {
		var e readingOrderEntry
		if err := rows.Scan(&e.ID, &e.ReadingOrderID, &e.BookID, &e.Position, &e.Note, &e.Title, &e.Author, &e.Format, &e.CoverPath); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func getReadingOrder(ctx context.Context, q querier, id int64) (*readingOrderDetail, error) {
	var ro readingOrderDetail
	err := q.QueryRowContext(ctx, "SELECT id, name, series_id FROM reading_orders WHERE id = ?", id).Scan(&ro.ID, &ro.Name, &ro.SeriesID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, notFound("Reading order %d not found", id)
	}
	if err != nil {
		return nil, err
	}
	if ro.Entries, err = readingOrderEntries(ctx, q, id); err != nil {
		return nil, err
	}
	return &ro, nil
}

func (s *Server) seriesReadingOrdersHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "series_id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := getSeries(ctx, s.DB, id); err != nil {
		return err
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT id FROM reading_orders WHERE series_id = ? ORDER BY name", id)
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var oid int64
		rows.Scan(&oid)
		ids = append(ids, oid)
	}
	rows.Close()
	out := []readingOrderDetail{}
	for _, oid := range ids {
		ro, err := getReadingOrder(ctx, s.DB, oid)
		if err != nil {
			return err
		}
		out = append(out, *ro)
	}
	return ok(w, out)
}

func (s *Server) seriesBooksHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "series_id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := getSeries(ctx, s.DB, id); err != nil {
		return err
	}
	rows, err := s.DB.QueryContext(ctx, "SELECT book_series.book_id, book_series.sequence, books.title, books.author, books.format, books.cover_path FROM book_series JOIN books ON books.id = book_series.book_id WHERE book_series.series_id = ? ORDER BY book_series.sequence NULLS FIRST, books.title", id)
	if err != nil {
		return err
	}
	defer rows.Close()
	type item struct {
		BookID    string   `json:"book_id"`
		Sequence  *float64 `json:"sequence"`
		Title     string   `json:"title"`
		Author    *string  `json:"author"`
		Format    *string  `json:"format"`
		CoverPath *string  `json:"cover_path"`
	}
	out := []item{}
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.BookID, &it.Sequence, &it.Title, &it.Author, &it.Format, &it.CoverPath); err != nil {
			return err
		}
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return ok(w, out)
}

// booksInTree is every book reachable from a series: its own books by
// sequence, then each sub-series (by sort order, name) recursively.
func booksInTree(ctx context.Context, q querier, seriesID int64) ([]string, error) {
	rows, err := q.QueryContext(ctx, "SELECT book_id FROM book_series WHERE series_id = ? ORDER BY sequence NULLS LAST, book_id", seriesID)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	crows, err := q.QueryContext(ctx, "SELECT id FROM series WHERE parent_id = ? ORDER BY sort_order, name", seriesID)
	if err != nil {
		return nil, err
	}
	var children []int64
	for crows.Next() {
		var id int64
		crows.Scan(&id)
		children = append(children, id)
	}
	crows.Close()
	for _, c := range children {
		sub, err := booksInTree(ctx, q, c)
		if err != nil {
			return nil, err
		}
		ids = append(ids, sub...)
	}
	return ids, nil
}

func (s *Server) createReadingOrderHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	name := b.Str("name", true, false)
	seriesID := b.Int("series_id", true, false)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := getSeries(ctx, s.DB, *seriesID); err != nil {
		return err
	}
	var id int64
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, "INSERT INTO reading_orders (name, series_id) VALUES (?, ?)", *name, *seriesID)
		if err != nil {
			return err
		}
		id, _ = res.LastInsertId()
		ids, err := booksInTree(ctx, tx, *seriesID)
		if err != nil {
			return err
		}
		seen := map[string]bool{}
		pos := 1
		for _, bid := range ids {
			if seen[bid] {
				continue
			}
			seen[bid] = true
			if _, err := tx.ExecContext(ctx, "INSERT INTO reading_order_entries (reading_order_id, book_id, position) VALUES (?, ?, ?)", id, bid, pos); err != nil {
				return err
			}
			pos++
		}
		return nil
	})
	if err != nil {
		return err
	}
	return created(w, map[string]any{"id": id, "name": *name, "series_id": *seriesID})
}

func (s *Server) getReadingOrderHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "order_id")
	if err != nil {
		return err
	}
	ro, err := getReadingOrder(r.Context(), s.DB, id)
	if err != nil {
		return err
	}
	return ok(w, ro)
}

func (s *Server) deleteReadingOrderHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "order_id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := getReadingOrder(ctx, s.DB, id); err != nil {
		return err
	}
	if _, err := s.DB.ExecContext(ctx, "DELETE FROM reading_orders WHERE id = ?", id); err != nil {
		return err
	}
	return noContent(w)
}

func (s *Server) addReadingOrderEntryHandler(w http.ResponseWriter, r *http.Request) error {
	orderID, err := pathInt(r, "order_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	bookID := b.Str("book_id", true, false)
	position := b.Int("position", true, false)
	note := b.Str("note", false, true)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	if _, err := getReadingOrder(ctx, s.DB, orderID); err != nil {
		return err
	}
	if bk, err := getBook(ctx, s.DB, *bookID); err != nil {
		return err
	} else if bk == nil {
		return notFound("Book %s not found", *bookID)
	}
	res, err := s.DB.ExecContext(ctx, "INSERT INTO reading_order_entries (reading_order_id, book_id, position, note) VALUES (?, ?, ?, ?)", orderID, *bookID, *position, note)
	if err != nil {
		return err
	}
	id, _ := res.LastInsertId()
	return created(w, map[string]any{"id": id, "reading_order_id": orderID, "book_id": *bookID, "position": *position, "note": note})
}

func (s *Server) reorderEntriesHandler(w http.ResponseWriter, r *http.Request) error {
	orderID, err := pathInt(r, "order_id")
	if err != nil {
		return err
	}
	var entries []map[string]any
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&entries); err != nil {
		return invalid(validationIssue{Type: "list_type", Loc: []any{"body"}, Msg: "Input should be a valid list", Input: nil})
	}
	ctx := r.Context()
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		for _, e := range entries {
			id, _ := e["id"].(float64)
			pos, _ := e["position"].(float64)
			if _, hasID := e["id"]; !hasID {
				return errors.New("missing id")
			}
			if _, hasPos := e["position"]; !hasPos {
				return errors.New("missing position")
			}
			if _, err := tx.ExecContext(ctx, "UPDATE reading_order_entries SET position = ? WHERE id = ? AND reading_order_id = ?", int64(pos), int64(id), orderID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	return noContent(w)
}
