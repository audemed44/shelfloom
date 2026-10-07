package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/audemed44/shelfloom/internal/epub"
	"github.com/audemed44/shelfloom/internal/hashing"
	"github.com/audemed44/shelfloom/internal/imaging"
	"github.com/audemed44/shelfloom/internal/koreader"
	"github.com/audemed44/shelfloom/internal/pdf"
	"github.com/audemed44/shelfloom/internal/pyjson"
	"github.com/audemed44/shelfloom/internal/store"
)

// errMultipleRows is SQLAlchemy's error when one row was expected.
var errMultipleRows = errors.New("Multiple rows were found when one or none was required")

// importProgress is ImportProgress.
type importProgress struct {
	Total, Processed, Created, Updated, Skipped int
	Errors                                      []string
	SDRImported                                 int
	SDRErrors                                   []string
}

// discoverBooks lists .epub and .pdf files under root, sorted the way Python
// sorts Path objects (component by component).
func discoverBooks(root string) []string {
	if st, err := os.Stat(root); err != nil || !st.IsDir() {
		return nil
	}
	var found []string
	filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || p == root {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		if ext != ".epub" && ext != ".pdf" {
			return nil
		}
		if st, err := os.Stat(p); err == nil && st.Mode().IsRegular() {
			found = append(found, p)
		}
		return nil
	})
	sort.Slice(found, func(i, j int) bool { return pathLess(found[i], found[j]) })
	return found
}

func pathLess(a, b string) bool {
	pa, pb := strings.Split(a, "/"), strings.Split(b, "/")
	for i := 0; i < len(pa) && i < len(pb); i++ {
		if pa[i] != pb[i] {
			return pa[i] < pb[i]
		}
	}
	return len(pa) < len(pb)
}

// relPath is str(path.relative_to(root)).
func relPath(root, p string) (string, error) {
	rel, err := filepath.Rel(root, p)
	if err != nil || strings.HasPrefix(rel, "..") {
		return "", fmt.Errorf("'%s' is not in the subpath of '%s'", p, root)
	}
	return rel, nil
}

// oneBook runs a query that should match at most one book.
func oneBook(ctx context.Context, q querier, query string, args ...any) (*Book, error) {
	books, err := queryBooks(ctx, q, query, args...)
	if err != nil {
		return nil, err
	}
	switch len(books) {
	case 0:
		return nil, nil
	case 1:
		return books[0], nil
	}
	return nil, errMultipleRows
}

func findByPath(ctx context.Context, q querier, shelfID int64, bookPath, shelfRoot string) (*Book, error) {
	rel, err := relPath(shelfRoot, bookPath)
	if err != nil {
		return nil, err
	}
	return oneBook(ctx, q, "SELECT "+bookColumns("books")+" FROM books WHERE books.shelf_id = ? AND books.file_path = ?", shelfID, rel)
}

func findByHash(ctx context.Context, q querier, sha string) (*Book, error) {
	b, err := oneBook(ctx, q, "SELECT "+bookColumns("books")+" FROM books WHERE books.file_hash = ?", sha)
	if err != nil || b != nil {
		return b, err
	}
	return oneBook(ctx, q, "SELECT "+bookColumns("books")+" FROM books JOIN book_hashes ON books.id = book_hashes.book_id WHERE book_hashes.hash_sha = ?", sha)
}

// recordHash keeps a file version's hashes (once per SHA-256).
func recordHash(ctx context.Context, q querier, bookID, sha, md5 string, pageCount *int64, md5KO *string) error {
	var id int64
	err := q.QueryRowContext(ctx, "SELECT id FROM book_hashes WHERE book_id = ? AND hash_sha = ? LIMIT 1", bookID, sha).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		_, err = q.ExecContext(ctx, "INSERT INTO book_hashes (book_id, hash_sha, hash_md5, hash_md5_ko, page_count) VALUES (?, ?, ?, ?, ?)", bookID, sha, md5, md5KO, pageCount)
	}
	return err
}

// fileMetadata is _extract_metadata: what import takes from a file, falling
// back to the file name.
type fileMetadata struct {
	title                                    string
	author, publisher, language, description *string
	pageCount                                *int64
	epubUID                                  *string
	raw                                      string
}

func parseFilename(p string) (string, *string) {
	stem := strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))
	if m := filenameAuthorTitle.FindStringSubmatch(stem); m != nil {
		author := pyStripSpace(m[1])
		return pyStripSpace(m[2]), &author
	}
	title := pyStripSpace(strings.NewReplacer("_", " ", "-", " ").Replace(stem))
	if title == "" {
		title = "Unknown Title"
	}
	return title, nil
}

func pyStripSpace(s string) string { return strings.TrimSpace(s) }

func extractMetadata(p, format string) fileMetadata {
	return extractMetadataWith(p, format, nil, nil)
}

// extractMetadataWith uses an EPUB parse already done (m or err).
func extractMetadataWith(p, format string, m *epub.Metadata, err error) fileMetadata {
	if format == "epub" {
		if m == nil && err == nil {
			m, err = epub.ParseMetadata(p)
		}
		if err == nil {
			return fileMetadata{title: m.Title, author: m.Author, publisher: m.Publisher, language: m.Language,
				description: m.Description, pageCount: m.PageCount, epubUID: m.EpubUID, raw: m.Raw}
		}
		slog.Warn(fmt.Sprintf("Metadata extraction failed for %s: %v", filepath.Base(p), err))
	} else {
		info, err := pdf.ReadInfo(p)
		if err == nil {
			md := fileMetadata{title: strings.TrimSpace(info.Title)}
			if md.title == "" {
				md.title = "Unknown Title"
			}
			if a := strings.TrimSpace(info.Author); a != "" {
				md.author = &a
			}
			if info.Pages > 0 {
				md.pageCount = &info.Pages
			}
			raw := pyjson.NewMap()
			for _, f := range info.PyMuPDFMetadata() {
				raw.Set(f[0].(string), f[1])
			}
			md.raw = pyjson.Dumps(raw)
			if md.title == "Unknown Title" {
				title, author := parseFilename(p)
				md.title = title
				if author != nil && md.author == nil {
					md.author = author
				}
			}
			return md
		}
		slog.Warn(fmt.Sprintf("Metadata extraction failed for %s: %v", filepath.Base(p), err))
	}
	title, author := parseFilename(p)
	return fileMetadata{title: title, author: author, raw: "{}"}
}

// extractCover saves a book's cover to covers/<id>.jpg and returns its path,
// or "" when the file has none.
func (s *Server) extractCover(p, format, id string) string {
	out := filepath.Join(s.Config.CoversDir, id+".jpg")
	ok, err := s.saveFileCover(p, format, out)
	if err != nil {
		slog.Warn(fmt.Sprintf("Cover extraction failed for %s: %v", filepath.Base(p), err))
		return ""
	}
	if !ok {
		return ""
	}
	return out
}

// saveFileCover extracts the cover of an EPUB or renders a PDF's first page
// into out; false when there is no cover.
func (s *Server) saveFileCover(p, format, out string) (bool, error) {
	var data []byte
	var err error
	if format == "epub" {
		data, err = epub.CoverImage(p)
		if err != nil {
			return false, fmt.Errorf("Failed to open EPUB: %w", err)
		}
		if data == nil {
			return false, nil
		}
	} else {
		if data, err = pdf.RenderCover(p); err != nil {
			return false, err
		}
	}
	if err := imaging.SaveJPEG(data, out, 0); err != nil {
		return false, fmt.Errorf("Failed to save cover image: %w", err)
	}
	return true, nil
}

// bookFile is the full path of a book's file, or "" for manual books and
// books whose shelf is gone.
func (s *Server) bookFile(ctx context.Context, b *Book) (string, error) {
	if b.isManual() {
		return "", nil
	}
	shelf, err := getShelf(ctx, s.DB, b.ShelfID)
	if err != nil || shelf == nil {
		return "", err
	}
	return filepath.Join(shelf.Path, b.FilePath), nil
}

// processFile imports or updates one book file: "created", "updated" or
// "skipped" (import_service._process_file).
func (s *Server) processFile(ctx context.Context, shelf *Shelf, p string) (string, error) {
	format := strings.TrimPrefix(strings.ToLower(filepath.Ext(p)), ".")
	if format != "epub" && format != "pdf" {
		return "skipped", nil
	}
	preSHA, preMD5, err := hashing.Files(p)
	if err != nil {
		return "", err
	}
	var preKO *string
	if d, ok := hashing.KOReaderPartialMD5(p); ok {
		preKO = &d
	}

	var book *Book
	var parsed *epub.Metadata
	var parseErr error
	if format == "epub" {
		parsed, parseErr = epub.ParseMetadata(p)
		if m := parsed; parseErr == nil && m.ShelfloomID != nil {
			if book, err = oneBook(ctx, s.DB, "SELECT "+bookColumns("books")+" FROM books WHERE books.id = ?", *m.ShelfloomID); err != nil {
				return "", err
			}
		}
	}
	if book == nil {
		if book, err = findByHash(ctx, s.DB, preSHA); err != nil {
			return "", err
		}
	}
	if book == nil {
		if book, err = findByPath(ctx, s.DB, shelf.ID, p, shelf.Path); err != nil {
			return "", err
		}
	}

	if book != nil {
		if book.FileHash != nil && *book.FileHash == preSHA {
			return "skipped", nil
		}
		// A second copy of a book whose own file is still there (same
		// embedded ID or an older version's hash) is left alone: moving the
		// book onto it would flip it between the two files on every scan.
		if current, err := s.bookFile(ctx, book); err != nil {
			return "", err
		} else if current != "" && current != p && fileExists(current) {
			slog.Warn(fmt.Sprintf("Skipping %s: it is another copy of %s", p, current))
			return "skipped", nil
		}
		// The file changed: refresh what comes from it, keep UI edits.
		md := extractMetadataWith(p, format, parsed, parseErr)
		coverPath := s.extractCover(p, format, book.ID)
		if coverPath == "" {
			os.Remove(filepath.Join(s.Config.CoversDir, book.ID+".jpg"))
		}
		rel, err := relPath(shelf.Path, p)
		if err != nil {
			return "", err
		}
		st, err := os.Stat(p)
		if err != nil {
			return "", err
		}
		err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
			if err := rememberDigest(ctx, tx, book.ID, book.PageCount, book.FileHashMD5KO); err != nil {
				return err
			}
			if err := recordHash(ctx, tx, book.ID, preSHA, preMD5, book.PageCount, preKO); err != nil {
				return err
			}
			_, err := tx.ExecContext(ctx, "UPDATE books SET file_hash = ?, file_hash_md5 = ?, file_hash_md5_ko = ?, file_path = ?, shelf_id = ?, file_size = ?, epub_uid = ?, metadata_raw = ?, cover_path = ? WHERE id = ?",
				preSHA, preMD5, preKO, rel, shelf.ID, st.Size(), md.epubUID, md.raw, strOrNil(coverPath), book.ID)
			return err
		})
		if err != nil {
			return "", err
		}
		return "updated", nil
	}

	id := newUUID()
	rel, err := relPath(shelf.Path, p)
	if err != nil {
		return "", err
	}
	md := extractMetadataWith(p, format, parsed, parseErr)
	postSHA, postMD5 := preSHA, preMD5
	if format == "epub" {
		res, err := epub.EmbedShelfloomID(p, id)
		if err != nil {
			slog.Warn(fmt.Sprintf("Could not embed Shelfloom ID into %s: %v", filepath.Base(p), err))
		} else {
			id, preSHA, preMD5, postSHA, postMD5 = res.ID, res.PreSHA, res.PreMD5, res.PostSHA, res.PostMD5
		}
	}
	postKO := preKO
	if format == "epub" {
		postKO = nil
		if d, ok := hashing.KOReaderPartialMD5(p); ok {
			postKO = &d
		}
	}
	coverPath := s.extractCover(p, format, id)
	st, err := os.Stat(p)
	if err != nil {
		return "", err
	}
	err = s.DB.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO books (id, title, author, publisher, language, description, page_count, epub_uid, format, file_path, shelf_id, file_hash, file_hash_md5, file_hash_md5_ko, file_size, cover_path, metadata_raw)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, md.title, md.author, md.publisher, md.language, md.description, md.pageCount, md.epubUID, format, rel, shelf.ID,
			postSHA, postMD5, postKO, st.Size(), strOrNil(coverPath), md.raw); err != nil {
			return err
		}
		if err := recordHash(ctx, tx, id, preSHA, preMD5, md.pageCount, preKO); err != nil {
			return err
		}
		if preSHA != postSHA {
			return recordHash(ctx, tx, id, postSHA, postMD5, md.pageCount, postKO)
		}
		return nil
	})
	if err != nil {
		if isUniqueViolation(err) {
			// A concurrent scan already added this file.
			return "skipped", nil
		}
		return "", err
	}
	return "created", nil
}

// importShelf scans a shelf and imports or updates every book in it.
func (s *Server) importShelf(ctx context.Context, shelf *Shelf, mtimes map[string]time.Time, statsDB string) *importProgress {
	prog := &importProgress{}
	paths := discoverBooks(shelf.Path)
	prog.Total = len(paths)
	for _, p := range paths {
		if ctx.Err() != nil {
			break
		}
		err := func() error {
			if mtimes != nil {
				if st, err := os.Stat(p); err == nil {
					if last, seen := mtimes[p]; seen && last.Equal(st.ModTime()) {
						existing, err := findByPath(ctx, s.DB, shelf.ID, p, shelf.Path)
						if err != nil {
							return err
						}
						if existing != nil {
							prog.Skipped++
							return errSkip
						}
					}
				}
			}
			action, err := s.processFile(ctx, shelf, p)
			if err != nil {
				return err
			}
			if mtimes != nil {
				if st, err := os.Stat(p); err == nil {
					mtimes[p] = st.ModTime()
				}
			}
			switch action {
			case "created":
				prog.Created++
			case "updated":
				prog.Updated++
			default:
				prog.Skipped++
			}
			if st, err := os.Stat(p + ".sdr"); err == nil && st.IsDir() {
				s.ingestSDR(ctx, shelf, p, p+".sdr", prog)
			}
			return nil
		}()
		if err != nil && err != errSkip {
			slog.Error(fmt.Sprintf("Failed to import %s: %v", p, err))
			prog.Errors = append(prog.Errors, fmt.Sprintf("%s: %v", filepath.Base(p), err))
		}
		prog.Processed++
	}
	if statsDB != "" {
		s.ingestStatsDB(ctx, statsDB, prog)
		books, err := queryBooks(ctx, s.DB, "SELECT "+bookColumns("books")+" FROM books WHERE books.shelf_id = ?", shelf.ID)
		if err == nil {
			for _, b := range books {
				if _, err := dedupSessions(ctx, s.DB, b.ID); err != nil {
					slog.Error("dedup failed", "book", b.ID, "err", err)
				}
			}
		}
	}
	return prog
}

var errSkip = errors.New("skip")

// ── KOReader .sdr folders ─────────────────────────────────────────────────────

func (s *Server) ingestSDR(ctx context.Context, shelf *Shelf, bookPath, sdrDir string, prog *importProgress) {
	err := func() error {
		data := koreader.ReadSDR(sdrDir)
		if data == nil {
			return nil
		}
		book, err := findByPath(ctx, s.DB, shelf.ID, bookPath, shelf.Path)
		if err != nil {
			return err
		}
		if book == nil {
			if book, err = findBookForSDR(ctx, s.DB, data, sdrDir); err != nil {
				return err
			}
		}
		if book == nil {
			return nil
		}
		n, err := importSDR(ctx, s.DB, book, data)
		prog.SDRImported += n
		return err
	}()
	if err != nil {
		slog.Error(fmt.Sprintf("Failed to import .sdr %s: %v", sdrDir, err))
		prog.SDRErrors = append(prog.SDRErrors, fmt.Sprintf("%s: %v", filepath.Base(sdrDir), err))
	}
}

// likeEscapeless builds the LIKE pattern SQLAlchemy's startswith/endswith
// make (special characters are not escaped, as there).
func findBookForSDR(ctx context.Context, db *store.DB, data *koreader.SDR, sdrDir string) (*Book, error) {
	name := strings.TrimSuffix(filepath.Base(sdrDir), ".sdr")
	if fileExists(filepath.Join(filepath.Dir(sdrDir), name)) {
		b, err := oneBook(ctx, db, "SELECT "+bookColumns("books")+" FROM books WHERE (books.file_path LIKE '%' || ?)", name)
		if err != nil || b != nil {
			return b, err
		}
	}
	if data.PartialMD5 != nil {
		b, err := oneBook(ctx, db, "SELECT "+bookColumns("books")+" FROM books WHERE (books.file_hash_md5 LIKE ? || '%')", *data.PartialMD5)
		if err != nil || b != nil {
			return b, err
		}
		b, err = oneBook(ctx, db, "SELECT "+bookColumns("books")+" FROM books JOIN book_hashes ON books.id = book_hashes.book_id WHERE (book_hashes.hash_md5 LIKE ? || '%')", *data.PartialMD5)
		if err != nil || b != nil {
			return b, err
		}
	}
	if data.Title != nil && data.Authors != nil {
		return oneBook(ctx, db, "SELECT "+bookColumns("books")+" FROM books WHERE books.title = ? AND books.author = ?", *data.Title, *data.Authors)
	}
	return nil, nil
}

// importSDR stores a .sdr's progress, sessions and highlights; it returns the
// number of sessions added.
func importSDR(ctx context.Context, db *store.DB, book *Book, data *koreader.SDR) (int, error) {
	added := 0
	err := db.Tx(ctx, func(tx *sql.Tx) error {
		ko := book.FileHashMD5KO
		if data.PartialMD5 != nil && (ko == nil || *ko != *data.PartialMD5) {
			if ko != nil && *ko != "" && book.FileHash != nil && *book.FileHash != "" && book.FileHashMD5 != nil && *book.FileHashMD5 != "" {
				var id int64
				err := tx.QueryRowContext(ctx, "SELECT id FROM book_hashes WHERE book_id = ? AND hash_md5_ko = ? LIMIT 1", book.ID, *ko).Scan(&id)
				if errors.Is(err, sql.ErrNoRows) {
					if _, err := tx.ExecContext(ctx, "INSERT INTO book_hashes (book_id, hash_sha, hash_md5, hash_md5_ko, page_count) VALUES (?, ?, ?, ?, ?)",
						book.ID, *book.FileHash, *book.FileHashMD5, *ko, book.PageCount); err != nil {
						return err
					}
				} else if err != nil {
					return err
				}
			}
			if _, err := tx.ExecContext(ctx, "UPDATE books SET file_hash_md5_ko = ? WHERE id = ?", *data.PartialMD5, book.ID); err != nil {
				return err
			}
		}
		if data.PartialMD5 != nil {
			if err := rememberDigest(ctx, tx, book.ID, book.PageCount, data.PartialMD5); err != nil {
				return err
			}
		}

		var progID int64
		err := tx.QueryRowContext(ctx, "SELECT id FROM reading_progress WHERE book_id = ? AND device = 'sdr' LIMIT 1", book.ID).Scan(&progID)
		if errors.Is(err, sql.ErrNoRows) {
			res, err := tx.ExecContext(ctx, "INSERT INTO reading_progress (book_id, device) VALUES (?, 'sdr')", book.ID)
			if err != nil {
				return err
			}
			progID, _ = res.LastInsertId()
		} else if err != nil {
			return err
		}
		if data.PercentFinished != nil {
			if _, err := tx.ExecContext(ctx, "UPDATE reading_progress SET progress = ? WHERE id = ?", pyRound(*data.PercentFinished*100, 2), progID); err != nil {
				return err
			}
		}
		if data.LastXPointer != nil {
			if _, err := tx.ExecContext(ctx, "UPDATE reading_progress SET position = ? WHERE id = ?", *data.LastXPointer, progID); err != nil {
				return err
			}
		}
		sessions := koreader.SDRSessions(data.PerformanceInPages, data.PartialMD5, data.DocPath)
		if len(sessions) > 0 {
			last := sessions[0]
			for _, ss := range sessions[1:] {
				if ss.Start.After(last.Start) {
					last = ss
				}
			}
			end := store.T(last.Start.Add(time.Duration(last.Duration) * time.Second))
			if _, err := tx.ExecContext(ctx, "UPDATE reading_progress SET updated_at = ? WHERE id = ?", end, progID); err != nil {
				return err
			}
		}
		for _, ss := range sessions {
			var id int64
			err := tx.QueryRowContext(ctx, "SELECT id FROM reading_sessions WHERE source_key = ?", ss.SourceKey).Scan(&id)
			if err == nil {
				continue
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO reading_sessions (book_id, start_time, duration, pages_read, source, source_key, dismissed) VALUES (?, ?, ?, ?, 'sdr', ?, 0)",
				book.ID, store.T(ss.Start), ss.Duration, ss.PagesRead, ss.SourceKey); err != nil {
				return err
			}
			added++
		}
		for _, a := range data.Annotations {
			var id int64
			var err error
			if a.Page == nil {
				err = tx.QueryRowContext(ctx, "SELECT id FROM highlights WHERE book_id = ? AND text = ? AND page IS NULL", book.ID, a.Text).Scan(&id)
			} else {
				err = tx.QueryRowContext(ctx, "SELECT id FROM highlights WHERE book_id = ? AND text = ? AND page = ?", book.ID, a.Text, *a.Page).Scan(&id)
			}
			if err == nil {
				continue
			}
			if !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			var created store.Time
			if a.Created != nil {
				created = store.T(*a.Created)
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO highlights (book_id, text, note, chapter, page, created) VALUES (?, ?, ?, ?, ?, ?)",
				book.ID, a.Text, a.Note, a.Chapter, a.Page, created); err != nil {
				return err
			}
		}
		return nil
	})
	return added, err
}

// ── KOReader statistics database ──────────────────────────────────────────────

func (s *Server) ingestStatsDB(ctx context.Context, path string, prog *importProgress) {
	n, err := importStatsDB(ctx, s.DB, path)
	prog.SDRImported += n
	if err != nil {
		slog.Error(fmt.Sprintf("Failed to import stats DB %s: %v", path, err))
		prog.SDRErrors = append(prog.SDRErrors, fmt.Sprintf("stats_db: %v", err))
	}
}

func findBookForStats(ctx context.Context, q querier, sb koreader.StatsBook) (*Book, error) {
	if sb.MD5 != nil {
		b, err := oneBook(ctx, q, "SELECT "+bookColumns("books")+" FROM books WHERE books.file_hash_md5_ko = ?", *sb.MD5)
		if err != nil || b != nil {
			return b, err
		}
		b, err = oneBook(ctx, q, "SELECT "+bookColumns("books")+" FROM books JOIN book_hashes ON books.id = book_hashes.book_id WHERE book_hashes.hash_md5_ko = ?", *sb.MD5)
		if err != nil || b != nil {
			return b, err
		}
	}
	if sb.Title != "" && sb.Authors != nil {
		return oneBook(ctx, q, "SELECT "+bookColumns("books")+" FROM books WHERE books.title = ? AND books.author = ?", sb.Title, *sb.Authors)
	}
	return nil, nil
}

// importStatsDB imports sessions from KOReader's statistics database and
// records the books it couldn't match. It returns the sessions added.
func importStatsDB(ctx context.Context, db *store.DB, path string) (int, error) {
	books, sessions, err := koreader.ReadStatsDB(path)
	if err != nil {
		return 0, err
	}
	imported := 0
	err = db.Tx(ctx, func(tx *sql.Tx) error {
		for _, sb := range books {
			book, err := findBookForStats(ctx, tx, sb)
			if err != nil {
				return err
			}
			list := sessions[sb.ID]
			if book == nil {
				if err := recordUnmatched(ctx, tx, sb, list, path); err != nil {
					return err
				}
				continue
			}
			if sb.KOPages != nil && *sb.KOPages != 0 {
				if _, err := tx.ExecContext(ctx, "UPDATE books SET page_count = ? WHERE id = ?", *sb.KOPages, book.ID); err != nil {
					return err
				}
			}
			if len(list) > 0 && sb.KOPages != nil && *sb.KOPages != 0 && sb.MaxPage != nil && *sb.MaxPage != 0 {
				last := list[0]
				for _, ss := range list[1:] {
					if ss.Start.After(last.Start) {
						last = ss
					}
				}
				end := store.T(last.Start.Add(time.Duration(last.Duration) * time.Second))
				pct := pyRound(float64(*sb.MaxPage)/float64(*sb.KOPages)*100, 2)
				res, err := tx.ExecContext(ctx, "UPDATE reading_progress SET progress = ?, updated_at = ? WHERE id = (SELECT id FROM reading_progress WHERE book_id = ? AND device = 'stats_db' LIMIT 1)", pct, end, book.ID)
				if err != nil {
					return err
				}
				if n, _ := res.RowsAffected(); n == 0 {
					if _, err := tx.ExecContext(ctx, "INSERT INTO reading_progress (book_id, device, progress, updated_at) VALUES (?, 'stats_db', ?, ?)", book.ID, pct, end); err != nil {
						return err
					}
				}
			}
			for _, ss := range list {
				var id int64
				var source string
				err := tx.QueryRowContext(ctx, "SELECT id, source FROM reading_sessions WHERE source_key = ?", ss.SourceKey).Scan(&id, &source)
				if err == nil {
					// Repair imports from older logic that rescaled KOReader pages.
					if source == "stats_db" {
						if _, err := tx.ExecContext(ctx, "UPDATE reading_sessions SET start_time = ?, duration = ?, pages_read = ? WHERE id = ?", store.T(ss.Start), ss.Duration, ss.PagesRead, id); err != nil {
							return err
						}
					}
					continue
				}
				if !errors.Is(err, sql.ErrNoRows) {
					return err
				}
				if _, err := tx.ExecContext(ctx, "INSERT INTO reading_sessions (book_id, start_time, duration, pages_read, source, source_key, dismissed) VALUES (?, ?, ?, ?, 'stats_db', ?, 0)",
					book.ID, store.T(ss.Start), ss.Duration, ss.PagesRead, ss.SourceKey); err != nil {
					return err
				}
				imported++
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return imported, nil
}

func recordUnmatched(ctx context.Context, tx *sql.Tx, sb koreader.StatsBook, list []koreader.Session, path string) error {
	rows, err := tx.QueryContext(ctx, "SELECT id FROM unmatched_koreader_entries WHERE title = ? AND source = 'stats_db'", sb.Title)
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) > 1 {
		return errMultipleRows
	}
	if len(ids) == 0 {
		var total int64
		for _, ss := range list {
			total += ss.Duration
		}
		res, err := tx.ExecContext(ctx, "INSERT INTO unmatched_koreader_entries (title, author, source, source_path, session_count, total_duration_seconds, dismissed) VALUES (?, ?, 'stats_db', ?, ?, ?, 0)",
			sb.Title, sb.Authors, path, len(list), total)
		if err != nil {
			return err
		}
		id, _ := res.LastInsertId()
		for _, ss := range list {
			if _, err := tx.ExecContext(ctx, "INSERT INTO unmatched_sessions (unmatched_entry_id, start_time, duration, pages_read, source_key) VALUES (?, ?, ?, ?, ?)",
				id, store.T(ss.Start), ss.Duration, ss.PagesRead, ss.SourceKey); err != nil {
				return err
			}
		}
		return nil
	}
	existing := map[string]bool{}
	krows, err := tx.QueryContext(ctx, "SELECT source_key FROM unmatched_sessions WHERE unmatched_entry_id = ?", ids[0])
	if err != nil {
		return err
	}
	for krows.Next() {
		var k sql.NullString
		krows.Scan(&k)
		existing[k.String] = true
	}
	krows.Close()
	for _, ss := range list {
		if existing[ss.SourceKey] {
			continue
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO unmatched_sessions (unmatched_entry_id, start_time, duration, pages_read, source_key) VALUES (?, ?, ?, ?, ?)",
			ids[0], store.T(ss.Start), ss.Duration, ss.PagesRead, ss.SourceKey); err != nil {
			return err
		}
	}
	return nil
}

// dedupSessions dismisses .sdr sessions that a statistics-database session
// (within five minutes) already covers; it returns how many.
func dedupSessions(ctx context.Context, db *store.DB, bookID string) (int, error) {
	rows, err := db.QueryContext(ctx, "SELECT id, start_time, source FROM reading_sessions WHERE book_id = ? AND dismissed = 0", bookID)
	if err != nil {
		return 0, err
	}
	type sess struct {
		id     int64
		start  store.Time
		source string
	}
	var stats, sdr []sess
	for rows.Next() {
		var x sess
		if err := rows.Scan(&x.id, &x.start, &x.source); err != nil {
			rows.Close()
			return 0, err
		}
		switch x.source {
		case "stats_db":
			stats = append(stats, x)
		case "sdr":
			sdr = append(sdr, x)
		}
	}
	rows.Close()
	var dismiss []any
	for _, s := range sdr {
		if !s.start.Valid {
			continue
		}
		for _, st := range stats {
			if !st.start.Valid {
				continue
			}
			d := s.start.Sub(st.start.Time)
			if d < 0 {
				d = -d
			}
			if d <= 300*time.Second {
				dismiss = append(dismiss, s.id)
				break
			}
		}
	}
	if len(dismiss) > 0 {
		if _, err := db.ExecContext(ctx, "UPDATE reading_sessions SET dismissed = 1 WHERE id IN ("+placeholders(len(dismiss))+")", dismiss...); err != nil {
			return 0, err
		}
	}
	return len(dismiss), nil
}
