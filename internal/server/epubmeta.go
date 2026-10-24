package server

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/audemed44/shelfloom/internal/epub"
	"github.com/audemed44/shelfloom/internal/logging"
)

// Shelfloom writes each EPUB's series, genres and tags into the file, so
// KOReader (and plugins such as Bookshelf, which read what KOReader extracts)
// group books the way the library does: calibre:series/series_index plus
// EPUB 3 collections for series, <dc:subject> for genres and tags.

// epubMetaVersion goes into every fingerprint; bump it when what gets
// written changes so every file is written again.
const epubMetaVersion = "1"

// epubMetaDelay lets a burst of edits settle before files are rewritten.
const epubMetaDelay = 5 * time.Second

// libraryMetadata is what Shelfloom wants in each EPUB, by book ID.
func libraryMetadata(ctx context.Context, q querier) (map[string]*epub.LibraryMetadata, error) {
	out := map[string]*epub.LibraryMetadata{}
	get := func(id string) *epub.LibraryMetadata {
		m := out[id]
		if m == nil {
			m = &epub.LibraryMetadata{}
			out[id] = m
		}
		return m
	}
	// The main series is one the book has a number in, then the most
	// specific one (a sub-series over its parent).
	rows, err := q.QueryContext(ctx, `SELECT book_series.book_id, series.name, book_series.sequence FROM book_series
		JOIN series ON series.id = book_series.series_id JOIN books ON books.id = book_series.book_id
		WHERE books.format = 'epub'
		ORDER BY book_series.book_id, book_series.sequence IS NULL, series.parent_id IS NULL, series.name, series.id`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var e epub.SeriesEntry
		if err := rows.Scan(&id, &e.Name, &e.Index); err != nil {
			rows.Close()
			return nil, err
		}
		m := get(id)
		m.Series = append(m.Series, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Genres, then tags; KOReader has one list of subjects for both.
	for _, k := range []linkKind{linkKinds["genre"], linkKinds["tag"]} {
		rows, err := q.QueryContext(ctx, "SELECT j.book_id, t.name FROM "+k.joinTable+" AS j JOIN "+k.table+" AS t ON t.id = j."+k.idCol+
			" JOIN books ON books.id = j.book_id WHERE books.format = 'epub' ORDER BY j.book_id, t.name COLLATE NOCASE, t.id")
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id, name string
			if err := rows.Scan(&id, &name); err != nil {
				rows.Close()
				return nil, err
			}
			m := get(id)
			dup := false
			for _, s := range m.Subjects {
				dup = dup || strings.EqualFold(s, name)
			}
			if !dup {
				m.Subjects = append(m.Subjects, name)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func epubMetaFingerprint(m *epub.LibraryMetadata) string {
	data, _ := json.Marshal(m)
	sum := sha1.Sum(append([]byte(epubMetaVersion+":"), data...))
	return hex.EncodeToString(sum[:])
}

// syncEPUBMetadata writes series, genres and tags into every EPUB whose
// library metadata changed since it was last written, and returns how many
// files it rewrote. A file Shelfloom has never written and has nothing to
// say about is left as it came.
func (s *Server) syncEPUBMetadata(ctx context.Context) (written, failed int, err error) {
	want, err := libraryMetadata(ctx, s.DB)
	if err != nil {
		return 0, 0, err
	}
	have := map[string]string{}
	rows, err := s.DB.QueryContext(ctx, "SELECT book_id, fingerprint FROM epub_metadata")
	if err != nil {
		return 0, 0, err
	}
	for rows.Next() {
		var id, fp string
		if err := rows.Scan(&id, &fp); err != nil {
			rows.Close()
			return 0, 0, err
		}
		have[id] = fp
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}
	rows, err = s.DB.QueryContext(ctx, "SELECT id FROM books WHERE format = 'epub' AND file_path NOT LIKE 'manual://%' ORDER BY id")
	if err != nil {
		return 0, 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, 0, err
	}

	remember := func(id, fp string) error {
		_, err := s.DB.ExecContext(ctx, "INSERT INTO epub_metadata (book_id, fingerprint) VALUES (?, ?) ON CONFLICT(book_id) DO UPDATE SET fingerprint = excluded.fingerprint", id, fp)
		return err
	}
	for _, id := range ids {
		if err := ctx.Err(); err != nil {
			return written, failed, err
		}
		m := want[id]
		if m == nil {
			m = &epub.LibraryMetadata{}
		}
		fp := epubMetaFingerprint(m)
		prev, known := have[id]
		if prev == fp {
			continue
		}
		if !known && len(m.Series) == 0 && len(m.Subjects) == 0 {
			if err := remember(id, fp); err != nil {
				return written, failed, err
			}
			continue
		}
		b, err := getBook(ctx, s.DB, id)
		if err != nil {
			return written, failed, err
		}
		if b == nil {
			continue
		}
		full, err := s.bookFile(ctx, b)
		if err != nil {
			return written, failed, err
		}
		if full == "" || !fileExists(full) {
			continue
		}
		changed, err := epub.SetLibraryMetadata(full, *m)
		if err != nil {
			// Remembered anyway, so a file that can't be written isn't tried
			// on every pass; the next edit to the book tries again.
			slog.WarnContext(ctx, "could not write metadata into an EPUB", "book_id", id, "file", filepath.Base(full), "err", err)
			failed++
		} else if changed {
			if err := refreshBookHashes(ctx, s.DB, b, full); err != nil {
				return written, failed, err
			}
			written++
		}
		if err := remember(id, fp); err != nil {
			return written, failed, err
		}
	}
	return written, failed, nil
}

// runEPUBMetadataSync syncs EPUB metadata once, waiting for a library scan
// to finish first so the two don't hash and rewrite the same files.
func (s *Server) runEPUBMetadataSync(ctx context.Context) {
	for {
		s.scan.mu.Lock()
		if !s.scan.running {
			s.scan.running = true
			s.scan.mu.Unlock()
			break
		}
		s.scan.mu.Unlock()
		if !sleepCtx(ctx, time.Second) {
			return
		}
	}
	defer func() {
		s.scan.mu.Lock()
		s.scan.running = false
		s.scan.mu.Unlock()
	}()
	s.logEPUBMetadataSync(ctx)
}

func (s *Server) logEPUBMetadataSync(ctx context.Context) {
	ctx, run := logging.QuietJob(ctx, "epub.metadata")
	written, failed, err := s.syncEPUBMetadata(ctx)
	run.End(err, "written", written, "failed", failed)
	if written > 0 {
		slog.InfoContext(ctx, "wrote library metadata into EPUBs", "written", written, "failed", failed)
	}
}

// queueEPUBMetadataSync asks for a sync soon; edits arrive through the API.
func (s *Server) queueEPUBMetadataSync() {
	select {
	case s.epubMetaNudge <- struct{}{}:
	default:
	}
}

// epubMetadataLoop runs a sync once edits have been quiet for epubMetaDelay.
func (s *Server) epubMetadataLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.epubMetaNudge:
		}
		t := time.NewTimer(epubMetaDelay)
	settle:
		for {
			select {
			case <-ctx.Done():
				t.Stop()
				return
			case <-s.epubMetaNudge:
				t.Reset(epubMetaDelay)
			case <-t.C:
				break settle
			}
		}
		s.runEPUBMetadataSync(ctx)
	}
}

// changesLibrary is whether a request may have changed what goes into the
// EPUBs. KOReader's progress sync is frequent and never does.
func changesLibrary(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	return strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/api/kosync/")
}
