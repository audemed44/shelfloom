package server

import (
	"archive/zip"
	"context"
	"crypto/md5"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"path"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/audemed44/shelfloom/internal/hashing"
	"github.com/audemed44/shelfloom/internal/store"
)

// Positions the web reader saves are stored under this username, so every
// KOReader account sees them.
const (
	webReaderUsername = ""
	webReaderDevice   = "Shelfloom Web"
	webReaderDeviceID = "shelfloom-web"
	rebuildDevice     = "Shelfloom"
	rebuildDeviceID   = "shelfloom-rebuild"
	// Not the hash of a file Shelfloom has read: a KOReader digest learned
	// from elsewhere, marked so it is never matched as file content.
	linkedDigestSHAPrefix = "kosync:"
)

var md5Hex = regexp.MustCompile(`^[0-9a-f]{32}$`)

// KOReader sends md5(password) as the "userkey"; it is stored as
// sha256(userkey). Older accounts stored sha256(password) and are upgraded
// on their next Basic-auth login.
func hashKey(userkey string) string {
	h := sha256.Sum256([]byte(userkey))
	return hex.EncodeToString(h[:])
}

func userkeyForPassword(password string) string {
	h := md5.Sum([]byte(password))
	return hex.EncodeToString(h[:])
}

func asUserkey(secret string) string {
	if md5Hex.MatchString(secret) {
		return secret
	}
	return userkeyForPassword(secret)
}

func kosyncPasswordHash(ctx context.Context, q querier, username string) (string, bool, error) {
	var h string
	err := q.QueryRowContext(ctx, "SELECT password_hash FROM kosync_users WHERE username = ?", username).Scan(&h)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	return h, err == nil, err
}

// registerKosyncUser adds a user; false when the name is taken.
func registerKosyncUser(ctx context.Context, q querier, username, password string) (bool, error) {
	_, exists, err := kosyncPasswordHash(ctx, q, username)
	if err != nil || exists {
		return false, err
	}
	if _, err := q.ExecContext(ctx, "INSERT INTO kosync_users (username, password_hash) VALUES (?, ?)", username, hashKey(asUserkey(password))); err != nil {
		return false, err
	}
	return true, nil
}

func authenticateKey(ctx context.Context, q querier, username, userkey string) (bool, error) {
	h, exists, err := kosyncPasswordHash(ctx, q, username)
	if err != nil || !exists {
		return false, err
	}
	return h == hashKey(userkey), nil
}

func authenticateUser(ctx context.Context, q querier, username, password string) (bool, error) {
	h, exists, err := kosyncPasswordHash(ctx, q, username)
	if err != nil || !exists {
		return false, err
	}
	if h == hashKey(asUserkey(password)) {
		return true, nil
	}
	if h == hashKey(password) {
		_, err := q.ExecContext(ctx, "UPDATE kosync_users SET password_hash = ? WHERE username = ?", hashKey(userkeyForPassword(password)), username)
		return err == nil, err
	}
	return false, nil
}

// kosyncRecord is a row of kosync_progress.
type kosyncRecord struct {
	ID         int64
	Username   string
	Document   string
	Progress   string
	Percentage float64
	Device     string
	DeviceID   *string
	BookID     *string
	Locator    *string
	Timestamp  int64
}

const kosyncColumns = "id, username, document, progress, percentage, device, device_id, book_id, locator, timestamp"

func scanKosync(row scanner, extra ...any) (*kosyncRecord, error) {
	var k kosyncRecord
	dest := []any{&k.ID, &k.Username, &k.Document, &k.Progress, &k.Percentage, &k.Device, &k.DeviceID, &k.BookID, &k.Locator, &k.Timestamp}
	err := row.Scan(append(dest, extra...)...)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &k, err
}

// filenameDigest is KOReader's "filename" matching: md5 of the file name.
func filenameDigest(filePath string) string {
	h := md5.Sum([]byte(path.Base(filepath.ToSlash(filePath))))
	return hex.EncodeToString(h[:])
}

// resolveBookID finds the library book a KOReader document digest refers
// to: its current partial MD5, any partial MD5 it has had, its filename
// digest, and last the books never fingerprinted.
func resolveBookID(ctx context.Context, db *store.DB, document string) (*string, error) {
	if document == "" {
		return nil, nil
	}
	var id string
	err := db.QueryRowContext(ctx, "SELECT id FROM books WHERE file_hash_md5_ko = ? LIMIT 1", document).Scan(&id)
	if err == nil {
		return &id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	err = db.QueryRowContext(ctx, "SELECT book_id FROM book_hashes WHERE hash_md5_ko = ? ORDER BY recorded_at DESC LIMIT 1", document).Scan(&id)
	if err == nil {
		return &id, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	rows, err := db.QueryContext(ctx, "SELECT id, file_path FROM books")
	if err != nil {
		return nil, err
	}
	var found *string
	for rows.Next() {
		var bid, fp string
		if err := rows.Scan(&bid, &fp); err != nil {
			rows.Close()
			return nil, err
		}
		if found == nil && filenameDigest(fp) == document {
			found = &bid
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if found != nil {
		return found, nil
	}
	return matchUnfingerprinted(ctx, db, document)
}

// matchUnfingerprinted records the KOReader digest of books that never had
// one, and returns the one matching document.
func matchUnfingerprinted(ctx context.Context, db *store.DB, document string) (*string, error) {
	rows, err := db.QueryContext(ctx, "SELECT books.id, books.file_path, shelves.path FROM books JOIN shelves ON shelves.id = books.shelf_id WHERE books.file_hash_md5_ko IS NULL")
	if err != nil {
		return nil, err
	}
	type candidate struct{ id, file, shelf string }
	var cands []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.id, &c.file, &c.shelf); err != nil {
			rows.Close()
			return nil, err
		}
		cands = append(cands, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var found *string
	for _, c := range cands {
		if strings.HasPrefix(c.file, "manual://") {
			continue
		}
		digest, good := hashing.KOReaderPartialMD5(filepath.Join(c.shelf, c.file))
		if !good {
			continue
		}
		if _, err := db.ExecContext(ctx, "UPDATE books SET file_hash_md5_ko = ? WHERE id = ?", digest, c.id); err != nil {
			return nil, err
		}
		if digest == document {
			id := c.id
			found = &id
		}
	}
	return found, nil
}

// mirrorToReadingProgress keeps the book page's per-device progress in step
// with a synced position.
func mirrorToReadingProgress(ctx context.Context, q querier, bookID, device string, percentage float64, position string) error {
	progress := pyRound(percentage*100, 2)
	now := store.Now()
	res, err := q.ExecContext(ctx, "UPDATE reading_progress SET progress = ?, position = ?, updated_at = ? WHERE id = (SELECT id FROM reading_progress WHERE book_id = ? AND device = ? LIMIT 1)", progress, position, now, bookID, device)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		_, err = q.ExecContext(ctx, "INSERT INTO reading_progress (book_id, device, progress, position, updated_at) VALUES (?, ?, ?, ?, ?)", bookID, device, progress, position, now)
	}
	return err
}

// linkRecords points every synced position for document at bookID.
func linkRecords(ctx context.Context, q querier, document, bookID string) error {
	rows, err := q.QueryContext(ctx, "SELECT "+kosyncColumns+" FROM kosync_progress WHERE document = ?", document)
	if err != nil {
		return err
	}
	var recs []*kosyncRecord
	for rows.Next() {
		k, err := scanKosync(rows)
		if err != nil {
			rows.Close()
			return err
		}
		recs = append(recs, k)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, rec := range recs {
		if _, err := q.ExecContext(ctx, "UPDATE kosync_progress SET book_id = ? WHERE id = ?", bookID, rec.ID); err != nil {
			return err
		}
		if rec.Username != webReaderUsername {
			if err := mirrorToReadingProgress(ctx, q, bookID, rec.Device, rec.Percentage, rec.Progress); err != nil {
				return err
			}
		}
	}
	return nil
}

// rememberDigest keeps document as one of the book's KOReader digests for
// good, and links positions already synced under it.
func rememberDigest(ctx context.Context, q querier, bookID string, pageCount *int64, document *string) error {
	if document == nil || *document == "" {
		return nil
	}
	var existing int64
	err := q.QueryRowContext(ctx, "SELECT id FROM book_hashes WHERE book_id = ? AND hash_md5_ko = ? LIMIT 1", bookID, *document).Scan(&existing)
	if errors.Is(err, sql.ErrNoRows) {
		if _, err := q.ExecContext(ctx, "INSERT INTO book_hashes (book_id, hash_sha, hash_md5, hash_md5_ko, page_count) VALUES (?, ?, '', ?, ?)",
			bookID, linkedDigestSHAPrefix+*document, *document, pageCount); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	var stale int64
	err = q.QueryRowContext(ctx, "SELECT id FROM kosync_progress WHERE document = ? AND book_id IS NULL LIMIT 1", *document).Scan(&stale)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return linkRecords(ctx, q, *document, bookID)
}

func normalisePercentage(v float64) float64 {
	if v > 1 {
		v = v / 100
	}
	return math.Max(0, math.Min(1, v))
}

type saveArgs struct {
	username, document, progress string
	percentage                   float64
	device                       string
	deviceID                     *string
	bookID                       *string
	locator                      *string
}

// saveProgress stores a device's latest position for a document.
func saveProgress(ctx context.Context, db *store.DB, a saveArgs) (*kosyncRecord, error) {
	a.percentage = normalisePercentage(a.percentage)
	if a.bookID == nil {
		var err error
		if a.bookID, err = resolveBookID(ctx, db, a.document); err != nil {
			return nil, err
		}
	}
	var id int64
	err := db.Tx(ctx, func(tx *sql.Tx) error {
		key, keyArg := "device = ?", any(a.device)
		if a.deviceID != nil && *a.deviceID != "" {
			key, keyArg = "device_id = ?", *a.deviceID
		}
		err := tx.QueryRowContext(ctx, "SELECT id FROM kosync_progress WHERE username = ? AND document = ? AND "+key+" LIMIT 1", a.username, a.document, keyArg).Scan(&id)
		ts := time.Now().Unix()
		if errors.Is(err, sql.ErrNoRows) {
			res, err := tx.ExecContext(ctx, "INSERT INTO kosync_progress (username, document, progress, percentage, device, device_id, book_id, locator, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
				a.username, a.document, a.progress, a.percentage, a.device, a.deviceID, a.bookID, a.locator, ts)
			if err != nil {
				return err
			}
			id, _ = res.LastInsertId()
		} else if err != nil {
			return err
		} else if _, err := tx.ExecContext(ctx, "UPDATE kosync_progress SET progress = ?, percentage = ?, device = ?, device_id = ?, book_id = ?, locator = ?, timestamp = ? WHERE id = ?",
			a.progress, a.percentage, a.device, a.deviceID, a.bookID, a.locator, ts, id); err != nil {
			return err
		}
		if a.bookID != nil {
			return mirrorToReadingProgress(ctx, tx, *a.bookID, a.device, a.percentage, a.progress)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return scanKosync(db.QueryRowContext(ctx, "SELECT "+kosyncColumns+" FROM kosync_progress WHERE id = ?", id))
}

// latestProgressForBook is the most recent position for a book across all
// its digests; with a username, only that account's and the web reader's.
func latestProgressForBook(ctx context.Context, q querier, bookID string, username *string) (*kosyncRecord, error) {
	query := "SELECT " + kosyncColumns + " FROM kosync_progress WHERE book_id = ?"
	args := []any{bookID}
	if username != nil {
		query += " AND (username = ? OR username = ?)"
		args = append(args, *username, webReaderUsername)
	}
	return scanKosync(q.QueryRowContext(ctx, query+" ORDER BY timestamp DESC, id DESC LIMIT 1", args...))
}

func progressDict(rec *kosyncRecord, document string) map[string]any {
	if document == "" {
		document = rec.Document
	}
	return map[string]any{
		"document": document, "progress": rec.Progress, "percentage": rec.Percentage,
		"device": rec.Device, "device_id": rec.DeviceID, "timestamp": rec.Timestamp,
	}
}

// pullProgress is the newest position for a document as KOReader asks for it.
func pullProgress(ctx context.Context, db *store.DB, username, document string) (map[string]any, error) {
	bookID, err := resolveBookID(ctx, db, document)
	if err != nil {
		return nil, err
	}
	var rec *kosyncRecord
	if bookID != nil {
		rec, err = latestProgressForBook(ctx, db, *bookID, &username)
	} else {
		rec, err = scanKosync(db.QueryRowContext(ctx, "SELECT "+kosyncColumns+" FROM kosync_progress WHERE username = ? AND document = ? ORDER BY timestamp DESC, id DESC LIMIT 1", username, document))
	}
	if err != nil || rec == nil {
		return nil, err
	}
	return progressDict(rec, document), nil
}

func webDocument(b *Book) string {
	if b.FileHashMD5KO != nil && *b.FileHashMD5KO != "" {
		return *b.FileHashMD5KO
	}
	return "book:" + b.ID
}

func saveWebProgress(ctx context.Context, db *store.DB, b *Book, progress string, percentage float64, locator *string) (*kosyncRecord, error) {
	return saveProgress(ctx, db, saveArgs{
		username: webReaderUsername, document: webDocument(b), progress: progress, percentage: percentage,
		device: webReaderDevice, deviceID: ptr(webReaderDeviceID), bookID: &b.ID, locator: locator,
	})
}

// ── carrying a position across a rebuilt file ─────────────────────────────────

type spineItem struct {
	href string
	size int64
}

// epubSpine is the spine of an EPUB as (href, uncompressed size), in reading
// order. KOReader numbers these DocFragment[1], [2], ….
func epubSpine(file string) ([]spineItem, error) {
	z, err := zip.OpenReader(file)
	if err != nil {
		return nil, err
	}
	defer z.Close()
	sizes := map[string]int64{}
	files := map[string]*zip.File{}
	for _, f := range z.File {
		sizes[f.Name] = int64(f.UncompressedSize64)
		files[f.Name] = f
	}
	read := func(name string) ([]byte, error) {
		f, found := files[name]
		if !found {
			return nil, fmt.Errorf("%s not in archive", name)
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		var buf strings.Builder
		_, err = copyLimited(&buf, rc, 64<<20)
		return []byte(buf.String()), err
	}
	container, err := read("META-INF/container.xml")
	if err != nil {
		return nil, err
	}
	var opfPath string
	walkXML(container, func(el xmlElement) bool {
		if el.local == "rootfile" {
			opfPath = el.attr("full-path")
			return false
		}
		return true
	})
	if opfPath == "" {
		return nil, errors.New("no rootfile")
	}
	opf, err := read(opfPath)
	if err != nil {
		return nil, err
	}
	base := path.Dir(opfPath)
	if base == "." {
		base = ""
	}
	hrefs := map[string]string{}
	var refs []string
	walkXML(opf, func(el xmlElement) bool {
		switch {
		case strings.HasSuffix(el.local, "item") && el.local != "itemref":
			if id, href := el.attr("id"), el.attr("href"); el.has("id") && el.has("href") {
				hrefs[id] = href
			}
		case el.local == "itemref" || strings.HasSuffix(el.local, "itemref"):
			refs = append(refs, el.attr("idref"))
		}
		return true
	})
	var spine []spineItem
	for _, ref := range refs {
		href := hrefs[ref]
		full := href
		if base != "" {
			full = path.Clean(path.Join(base, href))
		}
		spine = append(spine, spineItem{href: href, size: sizes[full]})
	}
	return spine, nil
}

var docFragment = regexp.MustCompile(`^/body(?:\[1\])?/DocFragment\[(\d+)\]`)
var chapterFile = regexp.MustCompile(`chapter_(\d+)\.xhtml$`)

func chapterNumberOf(href string) (int, bool) {
	m := chapterFile.FindStringSubmatch(href)
	if m == nil {
		return 0, false
	}
	n, err := strconv.Atoi(m[1])
	return n, err == nil
}

// remapPosition moves a KOReader position from an old build of a book to a
// new one; ok is false when it doesn't need to change or can't be mapped.
func remapPosition(progress string, percentage float64, oldSpine, newSpine []spineItem) (string, float64, bool) {
	m := docFragment.FindStringSubmatchIndex(progress)
	if m == nil || len(oldSpine) == 0 || len(newSpine) == 0 {
		return "", 0, false
	}
	n, _ := strconv.Atoi(progress[m[2]:m[3]])
	oldIndex := n - 1
	if oldIndex < 0 || oldIndex >= len(oldSpine) {
		return "", 0, false
	}
	href := oldSpine[oldIndex].href
	rest := progress[m[1]:]
	newIndex := -1
	for i, it := range newSpine {
		if it.href == href {
			newIndex = i
			break
		}
	}
	inNew := newIndex >= 0
	if !inNew {
		number, hasNumber := chapterNumberOf(href)
		newIndex = len(newSpine) - 1
		if hasNumber {
			for i, it := range newSpine {
				c, ok := chapterNumberOf(it.href)
				if !ok {
					c = -1
				}
				if c > number {
					newIndex = i
					break
				}
			}
		}
		rest = "/body"
	}
	newProgress := fmt.Sprintf("/body/DocFragment[%d]%s", newIndex+1, rest)

	sum := func(items []spineItem) int64 {
		var t int64
		for _, it := range items {
			t += it.size
		}
		return t
	}
	oldTotal := sum(oldSpine)
	if oldTotal == 0 {
		oldTotal = 1
	}
	oldBefore := sum(oldSpine[:oldIndex])
	oldSize := oldSpine[oldIndex].size
	if oldSize == 0 {
		oldSize = 1
	}
	within := (percentage*float64(oldTotal) - float64(oldBefore)) / float64(oldSize)
	if inNew {
		within = math.Max(0, math.Min(1, within))
	} else {
		within = 0
	}
	newTotal := sum(newSpine)
	if newTotal == 0 {
		newTotal = 1
	}
	newBefore := sum(newSpine[:newIndex])
	newPct := (float64(newBefore) + within*float64(newSpine[newIndex].size)) / float64(newTotal)
	if newProgress == progress && math.Abs(newPct-percentage) < 0.001 {
		return "", 0, false
	}
	return newProgress, math.Max(0, math.Min(1, newPct)), true
}

func spinesEqual(a, b []spineItem) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// carryPositionAcrossRebuild re-saves a book's latest position for the
// layout of its rebuilt file, as a newer record from "Shelfloom" (KOReader
// ignores records from its own device but follows newer ones from others).
func carryPositionAcrossRebuild(ctx context.Context, db *store.DB, b *Book, oldSpine, newSpine []spineItem) error {
	if spinesEqual(oldSpine, newSpine) {
		return nil
	}
	latest, err := latestProgressForBook(ctx, db, b.ID, nil)
	if err != nil || latest == nil {
		return err
	}
	progress, pct, mapped := remapPosition(latest.Progress, latest.Percentage, oldSpine, newSpine)
	if !mapped {
		return nil
	}
	slog.Info(fmt.Sprintf("Moved %s position %s -> %s after rebuild of book %s", latest.Device, latest.Progress, progress, b.ID))
	_, err = saveProgress(ctx, db, saveArgs{
		username: webReaderUsername, document: webDocument(b), progress: progress, percentage: pct,
		device: rebuildDevice, deviceID: ptr(rebuildDeviceID), bookID: &b.ID,
	})
	return err
}

// ── a small XML walker (namespace-agnostic, like ElementTree's iter()) ─────────

type xmlElement struct {
	local string
	attrs []xml.Attr
	text  *string
}

func (e xmlElement) attr(name string) string {
	for _, a := range e.attrs {
		if a.Name.Local == name && a.Name.Space == "" {
			return a.Value
		}
	}
	return ""
}

func (e xmlElement) has(name string) bool {
	for _, a := range e.attrs {
		if a.Name.Local == name && a.Name.Space == "" {
			return true
		}
	}
	return false
}

// walkXML calls fn for every start element in document order until it
// returns false.
func walkXML(data []byte, fn func(el xmlElement) bool) error {
	d := xml.NewDecoder(strings.NewReader(string(data)))
	d.Strict = false
	d.AutoClose = xml.HTMLAutoClose
	d.Entity = xml.HTMLEntity
	for {
		tok, err := d.Token()
		if err != nil {
			return nil
		}
		if se, isStart := tok.(xml.StartElement); isStart {
			if !fn(xmlElement{local: se.Name.Local, attrs: se.Attr}) {
				return nil
			}
		}
	}
}
