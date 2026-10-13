package server

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/audemed44/shelfloom/internal/epub"
	"github.com/audemed44/shelfloom/internal/hashing"
	"github.com/audemed44/shelfloom/internal/imaging"
	"github.com/audemed44/shelfloom/internal/logging"
	"github.com/audemed44/shelfloom/internal/store"
)

var filenameAuthorTitle = regexp.MustCompile(`^(.+?)\s+-\s+(.+)$`)

// scanState is the scheduler's ScanStatus plus the mtime cache.
type scanState struct {
	mu       sync.Mutex
	running  bool
	lastScan store.UTCTime
	progress *importProgress
	err      *string
	mtimes   map[string]time.Time
}

// Start ties background work to ctx and, with loops, starts the periodic
// library scan and serial update check. Everything stops when ctx ends.
func (s *Server) Start(ctx context.Context, loops bool) {
	s.bgCtx = ctx
	s.failInterruptedRecRuns(ctx)
	if !loops {
		return
	}
	s.bg.Add(3)
	go func() {
		defer s.bg.Done()
		for {
			s.runScan(ctx)
			if !sleepCtx(ctx, s.Config.ScanInterval) {
				return
			}
		}
	}()
	go func() {
		defer s.bg.Done()
		for {
			jctx, run := logging.Job(ctx, "serials.check")
			checked, found, err := s.checkAllSerials(jctx)
			run.End(err, "checked", checked, "new_chapters", found)
			if !sleepCtx(ctx, s.Config.SerialCheckInterval) {
				return
			}
		}
	}()
	go func() {
		defer s.bg.Done()
		for sleepCtx(ctx, time.Hour) {
			s.weeklyRecs(ctx)
		}
	}()
}

// Wait waits for background work to finish (after its context ended).
func (s *Server) Wait() { s.bg.Wait() }

func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// runScan scans every shelf once, unless a scan is already running.
func (s *Server) runScan(ctx context.Context) {
	s.scan.mu.Lock()
	if s.scan.running {
		s.scan.mu.Unlock()
		return
	}
	s.scan.running = true
	s.scan.err = nil
	if s.scan.mtimes == nil {
		s.scan.mtimes = map[string]time.Time{}
	}
	mtimes := s.scan.mtimes
	s.scan.mu.Unlock()
	// Quiet: scans run often; one that changed something says so below.
	ctx, run := logging.QuietJob(ctx, "library.scan")

	combined := &importProgress{Errors: []string{}}
	err := func() error {
		rows, err := s.DB.QueryContext(ctx, "SELECT "+shelfColumns+" FROM shelves")
		if err != nil {
			return err
		}
		var shelves []*Shelf
		for rows.Next() {
			sh, err := scanShelf(rows)
			if err != nil {
				rows.Close()
				return err
			}
			shelves = append(shelves, sh)
		}
		rows.Close()
		for _, sh := range shelves {
			statsDB := ""
			if sh.KoreaderStatsDBPath != nil && *sh.KoreaderStatsDBPath != "" {
				if st, err := os.Stat(*sh.KoreaderStatsDBPath); err == nil && st.Mode().IsRegular() {
					statsDB = *sh.KoreaderStatsDBPath
				}
			}
			p := s.importShelf(ctx, sh, mtimes, statsDB)
			combined.Total += p.Total
			combined.Processed += p.Processed
			combined.Created += p.Created
			combined.Updated += p.Updated
			combined.Skipped += p.Skipped
			combined.Errors = append(combined.Errors, p.Errors...)
		}
		return ctx.Err()
	}()

	s.scan.mu.Lock()
	defer s.scan.mu.Unlock()
	s.scan.running = false
	if err != nil {
		msg := err.Error()
		s.scan.err = &msg
		run.End(err)
		return
	}
	run.End(nil, "created", combined.Created, "updated", combined.Updated, "skipped", combined.Skipped, "errors", len(combined.Errors))
	if combined.Created+combined.Updated > 0 || len(combined.Errors) > 0 {
		slog.InfoContext(ctx, "library scan found changes", "created", combined.Created, "updated", combined.Updated,
			"errors", len(combined.Errors))
	}
	s.scan.progress = combined
	s.scan.lastScan = store.UTCNow()
}

func (s *Server) triggerScanHandler(w http.ResponseWriter, r *http.Request) error {
	s.scan.mu.Lock()
	running := s.scan.running
	s.scan.mu.Unlock()
	if !running {
		s.bg.Add(1)
		go func() {
			defer s.bg.Done()
			s.runScan(s.bgCtx)
		}()
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"message": "Scan triggered"})
	return nil
}

func (s *Server) scanStatusHandler(w http.ResponseWriter, r *http.Request) error {
	s.scan.mu.Lock()
	defer s.scan.mu.Unlock()
	type progress struct {
		Total     int      `json:"total"`
		Processed int      `json:"processed"`
		Created   int      `json:"created"`
		Updated   int      `json:"updated"`
		Skipped   int      `json:"skipped"`
		Errors    []string `json:"errors"`
	}
	var p *progress
	if s.scan.progress != nil {
		sp := s.scan.progress
		errs := sp.Errors
		if errs == nil {
			errs = []string{}
		}
		p = &progress{sp.Total, sp.Processed, sp.Created, sp.Updated, sp.Skipped, errs}
	}
	return ok(w, map[string]any{"is_running": s.scan.running, "last_scan_at": s.scan.lastScan, "progress": p, "error": s.scan.err})
}

// coverFor re-extracts a book's cover into covers/<id>.jpg.
func (s *Server) coverFor(b *Book, full string) (*string, error) {
	out := filepath.Join(s.Config.CoversDir, b.ID+".jpg")
	found, err := s.saveFileCover(full, b.Format, out)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, nil
	}
	return &out, nil
}

func (s *Server) backfillCoversHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	books, err := queryBooks(ctx, s.DB, "SELECT "+bookColumns("books")+" FROM books")
	if err != nil {
		return err
	}
	refreshed, failed, skipped := 0, 0, 0
	for _, b := range books {
		if b.CoverPath != nil && *b.CoverPath != "" && fileExists(*b.CoverPath) {
			skipped++
			continue
		}
		shelf, err := getShelf(ctx, s.DB, b.ShelfID)
		if err != nil {
			return err
		}
		if shelf == nil {
			failed++
			continue
		}
		full := filepath.Join(shelf.Path, b.FilePath)
		if !fileExists(full) {
			failed++
			continue
		}
		cover, err := s.coverFor(b, full)
		if err != nil {
			slog.Warn("cover backfill failed", "book", b.ID, "err", err)
			failed++
			continue
		}
		if _, err := s.DB.ExecContext(ctx, "UPDATE books SET cover_path = ? WHERE id = ?", cover, b.ID); err != nil {
			return err
		}
		refreshed++
	}
	return ok(w, map[string]int{"refreshed": refreshed, "failed": failed, "skipped": skipped})
}

func (s *Server) refreshCoverHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	b, err := mustGetBook(ctx, s.DB, r.PathValue("book_id"))
	if err != nil {
		return err
	}
	if b.isManual() {
		return badRequest("Manual books have no file to extract cover from")
	}
	shelf, err := getShelf(ctx, s.DB, b.ShelfID)
	if err != nil {
		return err
	}
	if shelf == nil {
		return unprocessable("Shelf %d not found", b.ShelfID)
	}
	full := filepath.Join(shelf.Path, b.FilePath)
	if !fileExists(full) {
		return unprocessable("File not found: %s", full)
	}
	cover, err := s.coverFor(b, full)
	if err != nil {
		return unprocessable("Cover extraction failed: %v", err)
	}
	if _, err := s.DB.ExecContext(ctx, "UPDATE books SET cover_path = ? WHERE id = ?", cover, b.ID); err != nil {
		return err
	}
	if b, err = mustGetBook(ctx, s.DB, b.ID); err != nil {
		return err
	}
	resp, err := bookResponseFor(ctx, s.DB, b)
	if err != nil {
		return err
	}
	return ok(w, resp)
}

// refreshBookHashes records a changed file's new hashes, keeping the old
// ones in book_hashes so KOReader keeps matching (refresh_book_hashes).
func refreshBookHashes(ctx context.Context, q querier, b *Book, full string) error {
	sha, md5, err := hashing.Files(full)
	if err != nil {
		return err
	}
	if b.FileHash != nil && sha == *b.FileHash {
		return nil
	}
	var ko *string
	if d, ok := hashing.KOReaderPartialMD5(full); ok {
		ko = &d
	}
	if b.FileHash != nil && *b.FileHash != "" && b.FileHashMD5 != nil && *b.FileHashMD5 != "" {
		if err := recordHash(ctx, q, b.ID, *b.FileHash, *b.FileHashMD5, b.PageCount, b.FileHashMD5KO); err != nil {
			return err
		}
	}
	_, err = q.ExecContext(ctx, "UPDATE books SET file_hash = ?, file_hash_md5 = ?, file_hash_md5_ko = ? WHERE id = ?", sha, md5, ko, b.ID)
	return err
}

// readUpload reads the "file" part of a multipart upload.
func readUpload(r *http.Request) (string, string, []byte, error) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		return "", "", nil, invalid(validationIssue{Type: "missing", Loc: []any{"body", "file"}, Msg: "Field required", Input: nil})
	}
	f, h, err := r.FormFile("file")
	if err != nil {
		return "", "", nil, invalid(validationIssue{Type: "missing", Loc: []any{"body", "file"}, Msg: "Field required", Input: nil})
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	return h.Filename, h.Header.Get("Content-Type"), data, err
}

func (s *Server) uploadCoverHandler(w http.ResponseWriter, r *http.Request) error {
	_, contentType, data, err := readUpload(r)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(contentType, "image/") {
		return badRequest("File must be an image.")
	}
	ctx := r.Context()
	b, err := mustGetBook(ctx, s.DB, r.PathValue("book_id"))
	if err != nil {
		return err
	}
	out := filepath.Join(s.Config.CoversDir, b.ID+".jpg")
	if err := imaging.SaveJPEG(data, out, 1200); err != nil {
		return unprocessable("Failed to save cover image: %v", err)
	}
	if _, err := s.DB.ExecContext(ctx, "UPDATE books SET cover_path = ? WHERE id = ?", out, b.ID); err != nil {
		return err
	}
	if b.Format == "epub" {
		if shelf, err := getShelf(ctx, s.DB, b.ShelfID); err == nil && shelf != nil {
			full := filepath.Join(shelf.Path, b.FilePath)
			if fileExists(full) {
				if err := epub.EmbedCover(full, out); err != nil {
					slog.Warn("could not embed a cover into an EPUB", "file", filepath.Base(full), "err", err)
				} else if err := refreshBookHashes(ctx, s.DB, b, full); err != nil {
					return err
				}
			}
		}
	}
	if b, err = mustGetBook(ctx, s.DB, b.ID); err != nil {
		return err
	}
	resp, err := bookResponseFor(ctx, s.DB, b)
	if err != nil {
		return err
	}
	return ok(w, resp)
}

// uploadBook saves an uploaded book to the default shelf and imports it.
func (s *Server) uploadBook(r *http.Request) (*Book, error) {
	name, _, data, err := readUpload(r)
	if err != nil {
		return nil, err
	}
	b, _, err := s.addToDefaultShelf(r.Context(), name, data, false)
	return b, err
}

// addToDefaultShelf writes a book file into the default shelf and imports
// it. An upload replaces a file of the same name; with keepExisting the new
// file gets a numbered name instead, and a file that is already in the
// library is dropped in favour of that book (dup is true).
func (s *Server) addToDefaultShelf(ctx context.Context, name string, data []byte, keepExisting bool) (b *Book, dup bool, err error) {
	suffix := strings.ToLower(filepath.Ext(name))
	if suffix != ".epub" && suffix != ".pdf" {
		return nil, false, badRequest("Only .epub and .pdf files are supported")
	}
	shelf, err := scanShelf(s.DB.QueryRowContext(ctx, "SELECT "+shelfColumns+" FROM shelves WHERE is_default = 1"))
	if err != nil {
		return nil, false, conflict("No default shelf configured")
	}
	if name == "" {
		name = "upload" + suffix
	}
	dest := filepath.Join(shelf.Path, name)
	if keepExisting {
		stem := strings.TrimSuffix(name, filepath.Ext(name))
		for i := 2; fileExists(dest); i++ {
			dest = filepath.Join(shelf.Path, fmt.Sprintf("%s (%d)%s", stem, i, suffix))
		}
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return nil, false, err
	}
	if err := os.WriteFile(dest, data, 0o644); err != nil {
		return nil, false, err
	}
	if _, err := s.processFile(ctx, shelf, dest); err != nil {
		os.Remove(dest)
		return nil, false, unprocessable("Failed to import file: %v", err)
	}
	rel, _ := relPath(shelf.Path, dest)
	b, err = oneBook(ctx, s.DB, "SELECT "+bookColumns("books")+" FROM books WHERE books.shelf_id = ? AND books.file_path = ?", shelf.ID, rel)
	if err != nil {
		return nil, false, err
	}
	if b == nil && keepExisting {
		// processFile skips a file whose hash is already in the library.
		if sha, _, herr := hashing.Files(dest); herr == nil {
			if b, err = findByHash(ctx, s.DB, sha); err != nil {
				return nil, false, err
			}
			if b != nil {
				os.Remove(dest)
				return b, true, nil
			}
		}
	}
	if b == nil {
		return nil, false, errStatus(http.StatusInternalServerError, "Book was imported but could not be found")
	}
	return b, false, nil
}

func (s *Server) uploadBookHandler(w http.ResponseWriter, r *http.Request) error {
	b, err := s.uploadBook(r)
	if err != nil {
		return err
	}
	resp, err := bookResponseFor(r.Context(), s.DB, b)
	if err != nil {
		return err
	}
	return created(w, resp)
}
