package server

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/audemed44/shelfloom/internal/store"
)

// manualShelfPath is the virtual shelf that holds books without a file.
const manualShelfPath = "__manual__"

type shelfResponse struct {
	ID                  int64      `json:"id"`
	Name                string     `json:"name"`
	Path                string     `json:"path"`
	IsDefault           bool       `json:"is_default"`
	IsSyncTarget        bool       `json:"is_sync_target"`
	DeviceName          *string    `json:"device_name"`
	KoreaderStatsDBPath *string    `json:"koreader_stats_db_path"`
	AutoOrganize        bool       `json:"auto_organize"`
	CreatedAt           store.Time `json:"created_at"`
	BookCount           int64      `json:"book_count"`
	OrganizeTemplate    *string    `json:"organize_template"`
	SeqPad              int64      `json:"seq_pad"`
}

type shelfTemplate struct {
	Template string
	SeqPad   int64
}

func shelfTemplates(ctx context.Context, q querier, ids []int64) (map[int64]shelfTemplate, error) {
	out := map[int64]shelfTemplate{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.QueryContext(ctx, "SELECT shelf_id, template, seq_pad FROM shelf_templates WHERE shelf_id IN ("+placeholders(len(ids))+")", anySlice(ids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var t shelfTemplate
		if err := rows.Scan(&id, &t.Template, &t.SeqPad); err != nil {
			return nil, err
		}
		out[id] = t
	}
	return out, rows.Err()
}

func newShelfResponse(s *Shelf, count int64, t *shelfTemplate) shelfResponse {
	r := shelfResponse{ID: s.ID, Name: s.Name, Path: s.Path, IsDefault: s.IsDefault, IsSyncTarget: s.IsSyncTarget,
		DeviceName: s.DeviceName, KoreaderStatsDBPath: s.KoreaderStatsDBPath, AutoOrganize: s.AutoOrganize,
		CreatedAt: s.CreatedAt, BookCount: count, SeqPad: 2}
	if t != nil {
		r.OrganizeTemplate = &t.Template
		r.SeqPad = t.SeqPad
	}
	return r
}

// shelvesWithCounts lists shelves (all, or one) with their book counts.
func shelvesWithCounts(ctx context.Context, q querier, id *int64) ([]*Shelf, []int64, error) {
	query := "SELECT " + prefixed("shelves", shelfColumns) + ", count(books.id) AS book_count FROM shelves LEFT OUTER JOIN books ON books.shelf_id = shelves.id"
	var args []any
	if id != nil {
		query += " WHERE shelves.id = ?"
		args = append(args, *id)
	}
	query += " GROUP BY shelves.id"
	if id == nil {
		query += " ORDER BY shelves.id"
	}
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var shelves []*Shelf
	var counts []int64
	for rows.Next() {
		var n int64
		sh, err := scanShelf(rows, &n)
		if err != nil {
			return nil, nil, err
		}
		shelves = append(shelves, sh)
		counts = append(counts, n)
	}
	return shelves, counts, rows.Err()
}

func prefixed(alias, cols string) string {
	parts := strings.Split(cols, ", ")
	for i, p := range parts {
		parts[i] = alias + "." + p
	}
	return strings.Join(parts, ", ")
}

func (s *Server) shelfResponseByID(ctx context.Context, id int64) (*shelfResponse, error) {
	shelves, counts, err := shelvesWithCounts(ctx, s.DB, &id)
	if err != nil {
		return nil, err
	}
	if len(shelves) == 0 {
		return nil, notFound("Shelf %d not found", id)
	}
	tmpl, err := shelfTemplates(ctx, s.DB, []int64{id})
	if err != nil {
		return nil, err
	}
	var t *shelfTemplate
	if v, has := tmpl[id]; has {
		t = &v
	}
	resp := newShelfResponse(shelves[0], counts[0], t)
	return &resp, nil
}

func (s *Server) listShelvesHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	shelves, counts, err := shelvesWithCounts(ctx, s.DB, nil)
	if err != nil {
		return err
	}
	ids := make([]int64, len(shelves))
	for i, sh := range shelves {
		ids[i] = sh.ID
	}
	tmpl, err := shelfTemplates(ctx, s.DB, ids)
	if err != nil {
		return err
	}
	out := []shelfResponse{}
	for i, sh := range shelves {
		var t *shelfTemplate
		if v, has := tmpl[sh.ID]; has {
			t = &v
		}
		out = append(out, newShelfResponse(sh, counts[i], t))
	}
	return ok(w, out)
}

func (s *Server) getShelfHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "shelf_id")
	if err != nil {
		return err
	}
	resp, err := s.shelfResponseByID(r.Context(), id)
	if err != nil {
		return err
	}
	return ok(w, resp)
}

func (s *Server) createShelfHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	name := b.Str("name", true, false)
	path := b.Str("path", true, false)
	isDefault := b.Bool("is_default", false, false)
	isSync := b.Bool("is_sync_target", false, false)
	deviceName := b.Str("device_name", false, true)
	statsDB := b.Str("koreader_stats_db_path", false, true)
	autoOrganize := b.Bool("auto_organize", false, false)
	template := b.Str("organize_template", false, true)
	seqPad := b.Int("seq_pad", false, false)
	if name != nil && strings.TrimSpace(*name) == "" {
		b.errs = append(b.errs, validationIssue{Type: "value_error", Loc: []any{"body", "name"}, Msg: "Value error, name must not be empty", Input: *name})
	}
	if path != nil && strings.TrimSpace(*path) == "" {
		b.errs = append(b.errs, validationIssue{Type: "value_error", Loc: []any{"body", "path"}, Msg: "Value error, path must not be empty", Input: *path})
	}
	if err := b.err(); err != nil {
		return err
	}
	n, p := strings.TrimSpace(*name), strings.TrimSpace(*path)
	if st, err := os.Stat(p); err != nil || !st.IsDir() {
		return unprocessable("Directory does not exist: %s", p)
	}
	ctx := r.Context()
	var id int64
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if deref(isDefault) {
			if _, err := tx.ExecContext(ctx, "UPDATE shelves SET is_default = 0 WHERE is_default = 1"); err != nil {
				return err
			}
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO shelves (name, path, is_default, is_sync_target, device_name, koreader_stats_db_path, auto_organize)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, n, p, deref(isDefault), deref(isSync), deviceName, statsDB, deref(autoOrganize))
		if err != nil {
			if isUniqueViolation(err) {
				return conflict("A shelf named '%s' already exists", n)
			}
			return err
		}
		id, _ = res.LastInsertId()
		return nil
	})
	if err != nil {
		return err
	}
	if template != nil {
		pad := int64(2)
		if seqPad != nil {
			pad = *seqPad
		}
		if _, err := s.DB.ExecContext(ctx, "INSERT INTO shelf_templates (shelf_id, template, seq_pad) VALUES (?, ?, ?)", id, *template, pad); err != nil {
			return err
		}
	}
	resp, err := s.shelfResponseByID(ctx, id)
	if err != nil {
		return err
	}
	resp.BookCount = 0
	return created(w, resp)
}

func (s *Server) updateShelfHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "shelf_id")
	if err != nil {
		return err
	}
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	name := b.Str("name", false, true)
	isDefault := b.Bool("is_default", false, true)
	isSync := b.Bool("is_sync_target", false, true)
	deviceName := b.Str("device_name", false, true)
	statsDB := b.Str("koreader_stats_db_path", false, true)
	autoOrganize := b.Bool("auto_organize", false, true)
	template := b.Str("organize_template", false, true)
	seqPad := b.Int("seq_pad", false, true)
	if err := b.err(); err != nil {
		return err
	}
	ctx := r.Context()
	shelf, err := getShelf(ctx, s.DB, id)
	if err != nil {
		return err
	}
	if shelf == nil {
		return notFound("Shelf %d not found", id)
	}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		var sets []string
		var args []any
		if name != nil {
			sets, args = append(sets, "name = ?"), append(args, strings.TrimSpace(*name))
		}
		if isDefault != nil {
			if *isDefault {
				if _, err := tx.ExecContext(ctx, "UPDATE shelves SET is_default = 0 WHERE is_default = 1"); err != nil {
					return err
				}
			}
			sets, args = append(sets, "is_default = ?"), append(args, *isDefault)
		}
		if isSync != nil {
			sets, args = append(sets, "is_sync_target = ?"), append(args, *isSync)
		}
		if deviceName != nil {
			sets, args = append(sets, "device_name = ?"), append(args, *deviceName)
		}
		if statsDB != nil {
			sets, args = append(sets, "koreader_stats_db_path = ?"), append(args, strOrNil(*statsDB))
		}
		if autoOrganize != nil {
			sets, args = append(sets, "auto_organize = ?"), append(args, *autoOrganize)
		}
		if len(sets) > 0 {
			if _, err := tx.ExecContext(ctx, "UPDATE shelves SET "+strings.Join(sets, ", ")+" WHERE id = ?", append(args, id)...); err != nil {
				if isUniqueViolation(err) {
					return conflict("A shelf named '%s' already exists", deref(name))
				}
				return err
			}
		}
		if template != nil {
			var existingPad int64
			err := tx.QueryRowContext(ctx, "SELECT seq_pad FROM shelf_templates WHERE shelf_id = ?", id).Scan(&existingPad)
			switch {
			case errors.Is(err, sql.ErrNoRows):
				pad := int64(2)
				if seqPad != nil {
					pad = *seqPad
				}
				_, err = tx.ExecContext(ctx, "INSERT INTO shelf_templates (shelf_id, template, seq_pad) VALUES (?, ?, ?)", id, *template, pad)
				return err
			case err != nil:
				return err
			}
			pad := existingPad
			if seqPad != nil {
				pad = *seqPad
			}
			_, err = tx.ExecContext(ctx, "UPDATE shelf_templates SET template = ?, seq_pad = ? WHERE shelf_id = ?", *template, pad, id)
			return err
		}
		return nil
	})
	if err != nil {
		return err
	}
	resp, err := s.shelfResponseByID(ctx, id)
	if err != nil {
		return err
	}
	return ok(w, resp)
}

func (s *Server) deleteShelfHandler(w http.ResponseWriter, r *http.Request) error {
	id, err := pathInt(r, "shelf_id")
	if err != nil {
		return err
	}
	ctx := r.Context()
	shelves, counts, err := shelvesWithCounts(ctx, s.DB, &id)
	if err != nil {
		return err
	}
	if len(shelves) == 0 {
		return notFound("Shelf %d not found", id)
	}
	if counts[0] > 0 {
		return conflict("Cannot delete shelf '%s': it contains %d book(s)", shelves[0].Name, counts[0])
	}
	if _, err := s.DB.ExecContext(ctx, "DELETE FROM shelves WHERE id = ?", id); err != nil {
		return err
	}
	return noContent(w)
}

// ensureManualShelf returns the virtual shelf for manual books, creating it.
func ensureManualShelf(ctx context.Context, q querier) (*Shelf, error) {
	sh, err := scanShelf(q.QueryRowContext(ctx, "SELECT "+shelfColumns+" FROM shelves WHERE path = ?", manualShelfPath))
	if err == nil {
		return sh, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	res, err := q.ExecContext(ctx, "INSERT INTO shelves (name, path, is_default, is_sync_target, auto_organize) VALUES ('Manual', ?, 0, 0, 0)", manualShelfPath)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	return getShelf(ctx, q, id)
}
