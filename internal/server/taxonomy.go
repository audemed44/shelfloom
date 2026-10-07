package server

import (
	"context"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// newUUID returns a random (version 4) UUID, like str(uuid.uuid4()).
func newUUID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ── tags and genres ───────────────────────────────────────────────────────────

// linkKind describes the tag or genre tables, which work the same way.
type linkKind struct {
	table, joinTable, idCol, label string
}

var linkKinds = map[string]linkKind{
	"tag":   {table: "tags", joinTable: "book_tags", idCol: "tag_id", label: "Tag"},
	"genre": {table: "genres", joinTable: "book_genres", idCol: "genre_id", label: "Genre"},
}

func listNames(ctx context.Context, q querier, table string) ([]idName, error) {
	rows, err := q.QueryContext(ctx, "SELECT id, name FROM "+table+" ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []idName{}
	for rows.Next() {
		var v idName
		if err := rows.Scan(&v.ID, &v.Name); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func linkExists(ctx context.Context, q querier, table string, id int64) (bool, error) {
	var n int
	err := q.QueryRowContext(ctx, "SELECT 1 FROM "+table+" WHERE id = ?", id).Scan(&n)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// assignLink is tag_service.assign_tag / genre_service.assign_genre.
func assignLink(ctx context.Context, q querier, kind, bookID string, id int64) error {
	k := linkKinds[kind]
	b, err := getBook(ctx, q, bookID)
	if err != nil {
		return err
	}
	if b == nil {
		return notFound("Book %s not found", bookID)
	}
	found, err := linkExists(ctx, q, k.table, id)
	if err != nil {
		return err
	}
	if !found {
		return notFound("%s %d not found", k.label, id)
	}
	_, err = q.ExecContext(ctx, "INSERT OR IGNORE INTO "+k.joinTable+" (book_id, "+k.idCol+") VALUES (?, ?)", bookID, id)
	return err
}

// removeLink is tag_service.remove_tag / genre_service.remove_genre.
func removeLink(ctx context.Context, q querier, kind, bookID string, id int64) error {
	k := linkKinds[kind]
	res, err := q.ExecContext(ctx, "DELETE FROM "+k.joinTable+" WHERE book_id = ? AND "+k.idCol+" = ?", bookID, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return notFound("%s %d not assigned to book %s", k.label, id, bookID)
	}
	return nil
}

func (s *Server) listLinksHandler(kind string) handlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		out, err := listNames(r.Context(), s.DB, linkKinds[kind].table)
		if err != nil {
			return err
		}
		return ok(w, out)
	}
}

// nameBody reads {"name": ...}, trimmed and not empty (TagCreate/GenreCreate).
func nameBody(r *http.Request) (string, error) {
	b, err := readBody(r, false)
	if err != nil {
		return "", err
	}
	name := b.Str("name", true, false)
	if err := b.err(); err != nil {
		return "", err
	}
	trimmed := strings.TrimSpace(*name)
	if trimmed == "" {
		return "", invalid(validationIssue{Type: "value_error", Loc: []any{"body", "name"}, Msg: "Value error, name must not be empty", Input: *name})
	}
	return trimmed, nil
}

func (s *Server) createTagHandler(w http.ResponseWriter, r *http.Request) error {
	name, err := nameBody(r)
	if err != nil {
		return err
	}
	res, err := s.DB.ExecContext(r.Context(), "INSERT INTO tags (name) VALUES (?)", name)
	if err != nil {
		if isUniqueViolation(err) {
			return conflict("Tag '%s' already exists", name)
		}
		return err
	}
	id, _ := res.LastInsertId()
	return created(w, idName{ID: id, Name: name})
}

func (s *Server) createGenreHandler(w http.ResponseWriter, r *http.Request) error {
	name, err := nameBody(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	var existing int64
	err = s.DB.QueryRowContext(ctx, "SELECT id FROM genres WHERE lower(name) = ?", strings.ToLower(name)).Scan(&existing)
	if err == nil {
		return conflict("Genre '%s' already exists", name)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	res, err := s.DB.ExecContext(ctx, "INSERT INTO genres (name) VALUES (?)", name)
	if err != nil {
		return err
	}
	id, _ := res.LastInsertId()
	return created(w, idName{ID: id, Name: name})
}

func (s *Server) deleteLinkHandler(kind string) handlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		k := linkKinds[kind]
		id, err := pathInt(r, k.idCol)
		if err != nil {
			return err
		}
		res, err := s.DB.ExecContext(r.Context(), "DELETE FROM "+k.table+" WHERE id = ?", id)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return notFound("%s %d not found", k.label, id)
		}
		return noContent(w)
	}
}

func (s *Server) assignLinkHandler(kind string) handlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		id, err := pathInt(r, linkKinds[kind].idCol)
		if err != nil {
			return err
		}
		if err := assignLink(r.Context(), s.DB, kind, r.PathValue("book_id"), id); err != nil {
			return err
		}
		return noContent(w)
	}
}

func (s *Server) removeLinkHandler(kind string) handlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		id, err := pathInt(r, linkKinds[kind].idCol)
		if err != nil {
			return err
		}
		if err := removeLink(r.Context(), s.DB, kind, r.PathValue("book_id"), id); err != nil {
			return err
		}
		return noContent(w)
	}
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

// ── authors ───────────────────────────────────────────────────────────────────

func (s *Server) listAuthorsHandler(w http.ResponseWriter, r *http.Request) error {
	rows, err := s.DB.QueryContext(r.Context(), "SELECT DISTINCT books.author FROM books WHERE books.author IS NOT NULL AND books.author != '' ORDER BY books.author")
	if err != nil {
		return err
	}
	defer rows.Close()
	type author struct {
		Name string `json:"name"`
	}
	out := []author{}
	for rows.Next() {
		var a author
		if err := rows.Scan(&a.Name); err != nil {
			return err
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return ok(w, out)
}
