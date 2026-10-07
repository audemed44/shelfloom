package server

import (
	"encoding/base64"
	"io"
	"net/http"
	"strings"
	"unicode/utf8"
)

// The KOSync protocol, as KOReader's built-in "Progress sync" plugin speaks
// it (koreader/plugins/kosync.koplugin/api.json). In KOReader, the custom
// sync server is http(s)://<shelfloom>/api/kosync. Error bodies follow the
// reference koreader-sync-server.

var (
	kosyncUnauthorized = map[string]any{"code": 2001, "message": "Unauthorized"}
	kosyncUserExists   = map[string]any{"code": 2002, "message": "Username is already registered."}
)

func copyLimited(w io.Writer, r io.Reader, limit int64) (int64, error) {
	return io.Copy(w, io.LimitReader(r, limit))
}

// kosyncUser returns the authenticated username, or "" (and false) for bad
// or missing credentials.
func (s *Server) kosyncUser(r *http.Request) (string, bool, error) {
	ctx := r.Context()
	user, key := r.Header.Get("x-auth-user"), r.Header.Get("x-auth-key")
	if user != "" && key != "" {
		good, err := authenticateKey(ctx, s.DB, user, key)
		return user, good, err
	}
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Basic ") {
		decoded, err := base64.StdEncoding.DecodeString(auth[6:])
		if err != nil || !utf8.Valid(decoded) {
			return "", false, nil
		}
		username, password, _ := strings.Cut(string(decoded), ":")
		good, err := authenticateUser(ctx, s.DB, username, password)
		return username, good, err
	}
	return "", false, nil
}

func kosyncUnauthorizedResponse(w http.ResponseWriter) error {
	w.Header().Set("WWW-Authenticate", "Basic")
	writeJSON(w, http.StatusUnauthorized, kosyncUnauthorized)
	return nil
}

func (s *Server) kosyncCreateUserHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	username := b.Str("username", true, false)
	password := b.Str("password", true, false)
	if err := b.err(); err != nil {
		return err
	}
	added, err := registerKosyncUser(r.Context(), s.DB, *username, *password)
	if err != nil {
		return err
	}
	if !added {
		writeJSON(w, http.StatusPaymentRequired, kosyncUserExists)
		return nil
	}
	return created(w, map[string]string{"username": *username})
}

func (s *Server) kosyncAuthHandler(w http.ResponseWriter, r *http.Request) error {
	user, good, err := s.kosyncUser(r)
	if err != nil {
		return err
	}
	if !good {
		return kosyncUnauthorizedResponse(w)
	}
	return ok(w, map[string]string{"authorized": "OK", "username": user})
}

func (s *Server) kosyncPutProgressHandler(w http.ResponseWriter, r *http.Request) error {
	// FastAPI validates the body before the auth dependency's result is used.
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	document := b.Str("document", true, false)
	progress := b.Str("progress", true, false)
	percentage := b.Float("percentage", true, false)
	device := b.Str("device", true, false)
	deviceID := b.Str("device_id", false, true)
	if err := b.err(); err != nil {
		return err
	}
	user, good, err := s.kosyncUser(r)
	if err != nil {
		return err
	}
	if !good {
		return kosyncUnauthorizedResponse(w)
	}
	rec, err := saveProgress(r.Context(), s.DB, saveArgs{
		username: user, document: *document, progress: *progress, percentage: *percentage,
		device: *device, deviceID: deviceID,
	})
	if err != nil {
		return err
	}
	return ok(w, progressDict(rec, ""))
}

func (s *Server) kosyncGetProgress(w http.ResponseWriter, r *http.Request, document string) error {
	user, good, err := s.kosyncUser(r)
	if err != nil {
		return err
	}
	if !good {
		return kosyncUnauthorizedResponse(w)
	}
	out, err := pullProgress(r.Context(), s.DB, user, document)
	if err != nil {
		return err
	}
	if out == nil {
		// KOReader expects an empty object for an unknown document.
		return ok(w, map[string]any{})
	}
	return ok(w, out)
}

func (s *Server) kosyncGetProgressHandler(w http.ResponseWriter, r *http.Request) error {
	return s.kosyncGetProgress(w, r, r.PathValue("document"))
}

func (s *Server) kosyncGetProgressQueryHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	document := q.Required("document")
	if err := q.err(); err != nil {
		return err
	}
	return s.kosyncGetProgress(w, r, document)
}

// ── account management (Settings) ─────────────────────────────────────────────

type syncAccount struct {
	Username      string  `json:"username"`
	LastSyncedAt  *int64  `json:"last_synced_at"`
	LastDevice    *string `json:"last_device"`
	LastBookTitle *string `json:"last_book_title"`
}

func (s *Server) listSyncAccountsHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	rows, err := s.DB.QueryContext(ctx, "SELECT username FROM kosync_users ORDER BY username")
	if err != nil {
		return err
	}
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return err
		}
		names = append(names, n)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	out := []syncAccount{}
	for _, name := range names {
		var title *string
		rec, err := scanKosync(s.DB.QueryRowContext(ctx, "SELECT "+prefixed("kosync_progress", kosyncColumns)+", books.title FROM kosync_progress LEFT OUTER JOIN books ON books.id = kosync_progress.book_id WHERE kosync_progress.username = ? ORDER BY kosync_progress.timestamp DESC, kosync_progress.id DESC LIMIT 1", name), &title)
		if err != nil {
			return err
		}
		if rec != nil && rec.BookID == nil {
			// The book may have been added or linked since this was synced.
			bookID, err := resolveBookID(ctx, s.DB, rec.Document)
			if err != nil {
				return err
			}
			if bookID != nil {
				if err := linkRecords(ctx, s.DB, rec.Document, *bookID); err != nil {
					return err
				}
				var t string
				if err := s.DB.QueryRowContext(ctx, "SELECT title FROM books WHERE id = ?", *bookID).Scan(&t); err != nil {
					return err
				}
				title = &t
			}
		}
		acc := syncAccount{Username: name, LastBookTitle: title}
		if rec != nil {
			acc.LastSyncedAt = &rec.Timestamp
			acc.LastDevice = &rec.Device
		}
		out = append(out, acc)
	}
	return ok(w, out)
}

func (s *Server) createSyncAccountHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := readBody(r, false)
	if err != nil {
		return err
	}
	username := b.Str("username", true, false)
	password := b.Str("password", true, false)
	if username != nil {
		if n := utf8.RuneCountInString(*username); n < 1 {
			b.errs = append(b.errs, validationIssue{Type: "string_too_short", Loc: []any{"body", "username"}, Msg: "String should have at least 1 character", Input: *username})
		} else if n > 100 {
			b.errs = append(b.errs, validationIssue{Type: "string_too_long", Loc: []any{"body", "username"}, Msg: "String should have at most 100 characters", Input: *username})
		}
	}
	if password != nil && *password == "" {
		b.errs = append(b.errs, validationIssue{Type: "string_too_short", Loc: []any{"body", "password"}, Msg: "String should have at least 1 character", Input: *password})
	}
	if err := b.err(); err != nil {
		return err
	}
	name := strings.TrimSpace(*username)
	added, err := registerKosyncUser(r.Context(), s.DB, name, *password)
	if err != nil {
		return err
	}
	if !added {
		return conflict("That username is already taken")
	}
	return created(w, syncAccount{Username: name})
}

func (s *Server) deleteSyncAccountHandler(w http.ResponseWriter, r *http.Request) error {
	res, err := s.DB.ExecContext(r.Context(), "DELETE FROM kosync_users WHERE username = ?", r.PathValue("username"))
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return notFound("No such account")
	}
	return noContent(w)
}
