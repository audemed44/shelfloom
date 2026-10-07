package server

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/audemed44/shelfloom/internal/store"
)

// querier is what both *sql.DB and *sql.Tx offer.
type querier interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// Book is a row of the books table.
type Book struct {
	ID              string
	Title           string
	Author          *string
	ISBN            *string
	Format          string
	FilePath        string
	ShelfID         int64
	FileHash        *string
	FileHashMD5     *string
	FileHashMD5KO   *string
	EpubUID         *string
	FileSize        *int64
	CoverPath       *string
	Publisher       *string
	Language        *string
	Description     *string
	PageCount       *int64
	Rating          *float64
	Review          *string
	ReviewUpdatedAt store.Time
	ReadingState    *string
	DateAdded       store.Time
	DatePublished   *string
	MetadataRaw     *string
}

// bookColumns lists the columns scanBook reads, prefixed with alias.
func bookColumns(alias string) string {
	cols := []string{"id", "title", "author", "isbn", "format", "file_path", "shelf_id", "file_hash",
		"file_hash_md5", "file_hash_md5_ko", "epub_uid", "file_size", "cover_path", "publisher",
		"language", "description", "page_count", "rating", "review", "review_updated_at",
		"reading_state", "date_added", "date_published", "metadata_raw"}
	if alias != "" {
		for i, c := range cols {
			cols[i] = alias + "." + c
		}
	}
	return strings.Join(cols, ", ")
}

type scanner interface{ Scan(dest ...any) error }

func scanBook(row scanner, extra ...any) (*Book, error) {
	var b Book
	dest := []any{&b.ID, &b.Title, &b.Author, &b.ISBN, &b.Format, &b.FilePath, &b.ShelfID, &b.FileHash,
		&b.FileHashMD5, &b.FileHashMD5KO, &b.EpubUID, &b.FileSize, &b.CoverPath, &b.Publisher,
		&b.Language, &b.Description, &b.PageCount, &b.Rating, &b.Review, &b.ReviewUpdatedAt,
		&b.ReadingState, &b.DateAdded, &b.DatePublished, &b.MetadataRaw}
	if err := row.Scan(append(dest, extra...)...); err != nil {
		return nil, err
	}
	return &b, nil
}

func queryBooks(ctx context.Context, q querier, query string, args ...any) ([]*Book, error) {
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Book
	for rows.Next() {
		b, err := scanBook(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// getBook loads a book or returns nil.
func getBook(ctx context.Context, q querier, id string) (*Book, error) {
	b, err := scanBook(q.QueryRowContext(ctx, "SELECT "+bookColumns("")+" FROM books WHERE id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return b, err
}

// mustGetBook loads a book or fails with book_service's 404.
func mustGetBook(ctx context.Context, q querier, id string) (*Book, error) {
	b, err := getBook(ctx, q, id)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, notFound("Book %s not found", id)
	}
	return b, nil
}

func (b *Book) isManual() bool { return strings.HasPrefix(b.FilePath, "manual://") }

// Shelf is a row of the shelves table.
type Shelf struct {
	ID                  int64
	Name                string
	Path                string
	IsDefault           bool
	IsSyncTarget        bool
	DeviceName          *string
	KoreaderStatsDBPath *string
	AutoOrganize        bool
	CreatedAt           store.Time
}

const shelfColumns = "id, name, path, is_default, is_sync_target, device_name, koreader_stats_db_path, auto_organize, created_at"

func scanShelf(row scanner, extra ...any) (*Shelf, error) {
	var s Shelf
	dest := []any{&s.ID, &s.Name, &s.Path, &s.IsDefault, &s.IsSyncTarget, &s.DeviceName, &s.KoreaderStatsDBPath, &s.AutoOrganize, &s.CreatedAt}
	if err := row.Scan(append(dest, extra...)...); err != nil {
		return nil, err
	}
	return &s, nil
}

func getShelf(ctx context.Context, q querier, id int64) (*Shelf, error) {
	s, err := scanShelf(q.QueryRowContext(ctx, "SELECT "+shelfColumns+" FROM shelves WHERE id = ?", id))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return s, err
}

// strOrNil returns nil for "".
func strOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}

func ptr[T any](v T) *T { return &v }

// placeholders returns "?, ?, ?" for n values.
func placeholders(n int) string {
	if n <= 0 {
		return ""
	}
	return strings.Repeat("?, ", n-1) + "?"
}

func anySlice[T any](vals []T) []any {
	out := make([]any, len(vals))
	for i, v := range vals {
		out[i] = v
	}
	return out
}
