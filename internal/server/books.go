package server

import (
	"context"
	"strings"

	"github.com/audemed44/shelfloom/internal/store"
)

type idName struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// bookResponse is BookResponse (and BookDetailResponse with the review).
type bookResponse struct {
	ID              string     `json:"id"`
	Title           string     `json:"title"`
	Author          *string    `json:"author"`
	ISBN            *string    `json:"isbn"`
	Format          string     `json:"format"`
	FilePath        string     `json:"file_path"`
	ShelfID         int64      `json:"shelf_id"`
	FileHash        *string    `json:"file_hash"`
	FileSize        *int64     `json:"file_size"`
	CoverPath       *string    `json:"cover_path"`
	Publisher       *string    `json:"publisher"`
	Language        *string    `json:"language"`
	Description     *string    `json:"description"`
	PageCount       *int64     `json:"page_count"`
	Rating          *float64   `json:"rating"`
	HasReview       bool       `json:"has_review"`
	Status          string     `json:"status"`
	DateAdded       store.Time `json:"date_added"`
	DatePublished   *string    `json:"date_published"`
	Genres          []idName   `json:"genres"`
	ReadingProgress *float64   `json:"reading_progress"`
	LastRead        store.Time `json:"last_read"`
	SeriesID        *int64     `json:"series_id"`
	SeriesName      *string    `json:"series_name"`
	SeriesSequence  *float64   `json:"series_sequence"`
	Tags            []idName   `json:"tags"`
	*reviewFields              // only in BookDetailResponse
}

type reviewFields struct {
	Review          *string    `json:"review"`
	ReviewUpdatedAt store.Time `json:"review_updated_at"`
}

func computeStatus(progress *float64, readingState *string) string {
	if readingState != nil && *readingState == "dnf" {
		return "dnf"
	}
	if progress != nil && *progress >= 100 {
		return "completed"
	}
	if progress != nil && *progress > 0 {
		return "reading"
	}
	return "unread"
}

type seriesRef struct {
	ID       int64
	Name     string
	Sequence *float64
}

type bookExtras struct {
	progress *float64
	lastRead store.Time
	series   *seriesRef
	tags     []idName
	genres   []idName
	detail   bool
}

func newBookResponse(b *Book, x bookExtras) bookResponse {
	r := bookResponse{
		ID: b.ID, Title: b.Title, Author: b.Author, ISBN: b.ISBN, Format: b.Format,
		FilePath: b.FilePath, ShelfID: b.ShelfID, FileHash: b.FileHash, FileSize: b.FileSize,
		CoverPath: b.CoverPath, Publisher: b.Publisher, Language: b.Language,
		Description: b.Description, PageCount: b.PageCount, Rating: b.Rating,
		HasReview:       b.Review != nil && strings.TrimSpace(*b.Review) != "",
		Status:          computeStatus(x.progress, b.ReadingState),
		DateAdded:       b.DateAdded,
		DatePublished:   b.DatePublished,
		Genres:          x.genres,
		ReadingProgress: x.progress,
		LastRead:        x.lastRead,
		Tags:            x.tags,
	}
	if r.Genres == nil {
		r.Genres = []idName{}
	}
	if r.Tags == nil {
		r.Tags = []idName{}
	}
	if x.series != nil {
		r.SeriesID = &x.series.ID
		r.SeriesName = &x.series.Name
		r.SeriesSequence = x.series.Sequence
	}
	if x.detail {
		r.reviewFields = &reviewFields{Review: b.Review, ReviewUpdatedAt: b.ReviewUpdatedAt}
	}
	return r
}

// bookMetadata loads tags and genres for books (books router's
// _load_book_metadata), each list sorted by name.
func bookMetadata(ctx context.Context, q querier, ids []string) (map[string][]idName, map[string][]idName, error) {
	tags := map[string][]idName{}
	genres := map[string][]idName{}
	if len(ids) == 0 {
		return tags, genres, nil
	}
	load := func(query string, into map[string][]idName) error {
		rows, err := q.QueryContext(ctx, query, anySlice(ids)...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var bookID string
			var v idName
			if err := rows.Scan(&bookID, &v.ID, &v.Name); err != nil {
				return err
			}
			into[bookID] = append(into[bookID], v)
		}
		return rows.Err()
	}
	if err := load("SELECT book_tags.book_id, tags.id, tags.name FROM book_tags JOIN tags ON book_tags.tag_id = tags.id WHERE book_tags.book_id IN ("+placeholders(len(ids))+") ORDER BY tags.name", tags); err != nil {
		return nil, nil, err
	}
	if err := load("SELECT book_genres.book_id, genres.id, genres.name FROM book_genres JOIN genres ON book_genres.genre_id = genres.id WHERE book_genres.book_id IN ("+placeholders(len(ids))+") ORDER BY genres.name", genres); err != nil {
		return nil, nil, err
	}
	return tags, genres, nil
}

// maxProgress is the highest reading progress per book.
func maxProgress(ctx context.Context, q querier, ids []string) (map[string]*float64, error) {
	out := map[string]*float64{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.QueryContext(ctx, "SELECT reading_progress.book_id, max(reading_progress.progress) FROM reading_progress WHERE reading_progress.book_id IN ("+placeholders(len(ids))+") GROUP BY reading_progress.book_id", anySlice(ids)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var p *float64
		if err := rows.Scan(&id, &p); err != nil {
			return nil, err
		}
		out[id] = p
	}
	return out, rows.Err()
}

// bookListItems builds the list responses for a page of books, as the books
// and lenses routers do.
func bookListItems(ctx context.Context, q querier, books []*Book) ([]bookResponse, error) {
	items := []bookResponse{}
	if len(books) == 0 {
		return items, nil
	}
	ids := make([]string, len(books))
	for i, b := range books {
		ids[i] = b.ID
	}
	progress, err := maxProgress(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	series := map[string]*seriesRef{}
	rows, err := q.QueryContext(ctx, "SELECT book_series.book_id, series.id, series.name, book_series.sequence FROM book_series JOIN series ON book_series.series_id = series.id WHERE book_series.book_id IN ("+placeholders(len(ids))+")", anySlice(ids)...)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var s seriesRef
		if err := rows.Scan(&id, &s.ID, &s.Name, &s.Sequence); err != nil {
			rows.Close()
			return nil, err
		}
		series[id] = &s // the last row wins, as in the Python dict
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	tags, genres, err := bookMetadata(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	for _, b := range books {
		items = append(items, newBookResponse(b, bookExtras{
			progress: progress[b.ID], series: series[b.ID], tags: tags[b.ID], genres: genres[b.ID],
		}))
	}
	return items, nil
}

// bookResponseFor builds the response returned after a change to one book
// (tags and genres, no progress or series).
func bookResponseFor(ctx context.Context, q querier, b *Book) (bookResponse, error) {
	tags, genres, err := bookMetadata(ctx, q, []string{b.ID})
	if err != nil {
		return bookResponse{}, err
	}
	return newBookResponse(b, bookExtras{tags: tags[b.ID], genres: genres[b.ID]}), nil
}

type bookListResponse struct {
	Items   []bookResponse `json:"items"`
	Total   int64          `json:"total"`
	Page    int64          `json:"page"`
	PerPage int64          `json:"per_page"`
	Pages   int64          `json:"pages"`
}
