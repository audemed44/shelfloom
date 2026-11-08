package server

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/audemed44/shelfloom/internal/scrapers"
)

type pageTransport string

func (p pageTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(p))), Header: http.Header{}, Request: r}, nil
}

// A chapter list page the scraper can't read (a bot check, a redesign) is an
// error, not every stored chapter gone upstream.
func TestCheckSerialKeepsChaptersOnEmptyList(t *testing.T) {
	ts := newTestServer(t)
	ctx := context.Background()
	db := ts.app.DB
	if _, err := db.ExecContext(ctx, "INSERT INTO web_serials (id, url, source, title, status, total_chapters, live_chapter_count) VALUES (1, 'https://www.royalroad.com/fiction/1/x', 'royalroad', 'Serial', 'ongoing', 2, 2)"); err != nil {
		t.Fatal(err)
	}
	for i, key := range []string{"a", "b"} {
		if _, err := db.ExecContext(ctx, "INSERT INTO serial_chapters (serial_id, chapter_number, source_url, source_key) VALUES (1, ?, ?, ?)", i+1, "https://www.royalroad.com/fiction/1/x/chapter/"+key, key); err != nil {
			t.Fatal(err)
		}
	}
	old := scrapers.Client
	scrapers.Client = &http.Client{Transport: pageTransport("<html><body><h1>Serial</h1></body></html>")}
	t.Cleanup(func() { scrapers.Client = old })

	sr, err := getSerial(ctx, db, 1)
	if err != nil {
		t.Fatal(err)
	}
	ts.app.checkSerial(ctx, sr)

	var stubbed int
	db.QueryRowContext(ctx, "SELECT count(*) FROM serial_chapters WHERE is_stubbed = 1").Scan(&stubbed)
	if stubbed != 0 {
		t.Fatalf("%d chapters stubbed, want 0", stubbed)
	}
	if sr, _ = getSerial(ctx, db, 1); sr.Status != "error" || sr.LastError == nil || !strings.Contains(*sr.LastError, "no chapters found") {
		t.Fatalf("status %q, error %v", sr.Status, sr.LastError)
	}
}

func rrChapter(story, id, slug string) string {
	return "https://www.royalroad.com/fiction/1/" + story + "/chapter/" + id + "/" + slug
}

// A chapter whose URL changed upstream is the same chapter: it keeps its
// place, and is fetched again only when the chapter itself was retitled.
func TestSyncMatchesChaptersByID(t *testing.T) {
	ts := newTestServer(t)
	ctx := context.Background()
	db := ts.app.DB
	if _, err := db.ExecContext(ctx, "INSERT INTO web_serials (id, url, source, title, status, total_chapters, live_chapter_count) VALUES (1, 'https://www.royalroad.com/fiction/1/x', 'royalroad', 'Serial', 'ongoing', 2, 2)"); err != nil {
		t.Fatal(err)
	}
	for i, u := range []string{rrChapter("x", "10", "one"), rrChapter("x", "11", "two")} {
		if _, err := db.ExecContext(ctx, "INSERT INTO serial_chapters (serial_id, chapter_number, source_url, source_key, content, word_count) VALUES (1, ?, ?, ?, 'text', 1)", i+1, u, u); err != nil {
			t.Fatal(err)
		}
	}
	sr, err := getSerial(ctx, db, 1)
	if err != nil {
		t.Fatal(err)
	}
	// The story renamed and chapter 2 retitled.
	remote := []scrapers.ChapterInfo{{SourceURL: rrChapter("y", "10", "one")}, {SourceURL: rrChapter("y", "11", "two-7")}}
	var added int64
	if err := db.Tx(ctx, func(tx *sql.Tx) error {
		added, _, err = syncChapterList(ctx, tx, sr, remote)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if added != 0 {
		t.Fatalf("%d chapters added, want 0", added)
	}
	rows, err := db.QueryContext(ctx, "SELECT chapter_number, source_key, is_stubbed, content IS NOT NULL FROM serial_chapters ORDER BY chapter_number")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var n int
		var key string
		var stubbed, content bool
		rows.Scan(&n, &key, &stubbed, &content)
		got = append(got, fmt.Sprint(n, key, stubbed, content))
	}
	want := []string{
		fmt.Sprint(1, rrChapter("y", "10", "one"), false, true),
		fmt.Sprint(2, rrChapter("y", "11", "two-7"), false, false),
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("chapters:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
}

// Chapters stored twice before the sync matched by id are merged back into
// their first place, later chapters renumbered and volumes moved with them.
func TestMergeDuplicateChapters(t *testing.T) {
	ts := newTestServer(t)
	ctx := context.Background()
	db := ts.app.DB
	if _, err := db.ExecContext(ctx, "INSERT INTO web_serials (id, url, source, title, status, total_chapters, live_chapter_count) VALUES (1, 'https://www.royalroad.com/fiction/1/x', 'royalroad', 'Serial', 'ongoing', 5, 4)"); err != nil {
		t.Fatal(err)
	}
	// 2 was retitled and came back as 4; 5 is new.
	chapters := []struct {
		n       int
		url     string
		stubbed bool
		content string
	}{
		{1, rrChapter("x", "10", "one"), false, "one"},
		{2, rrChapter("x", "11", "two"), true, "old two"},
		{3, rrChapter("x", "12", "three"), false, "three"},
		{4, rrChapter("x", "11", "two-7"), false, "new two"},
		{5, rrChapter("x", "13", "four"), false, "four"},
	}
	for _, c := range chapters {
		if _, err := db.ExecContext(ctx, "INSERT INTO serial_chapters (serial_id, chapter_number, source_url, source_key, is_stubbed, content, word_count, fetched_at) VALUES (1, ?, ?, ?, ?, ?, 1, ?)", c.n, c.url, c.url, c.stubbed, c.content, fmt.Sprintf("2026-01-0%d 00:00:00.000000", c.n)); err != nil {
			t.Fatal(err)
		}
	}
	for i, r := range [][2]int{{1, 3}, {4, 5}} {
		if _, err := db.ExecContext(ctx, "INSERT INTO serial_volumes (serial_id, volume_number, chapter_start, chapter_end, generated_at, is_stale, kind) VALUES (1, ?, ?, ?, '2026-01-01 00:00:00.000000', 0, 'generated')", i+1, r[0], r[1]); err != nil {
			t.Fatal(err)
		}
	}
	ts.app.mergeAllDuplicateChapters(ctx)

	rows, err := db.QueryContext(ctx, "SELECT chapter_number, source_key, is_stubbed, content FROM serial_chapters ORDER BY chapter_number")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var n int
		var key, content string
		var stubbed bool
		rows.Scan(&n, &key, &stubbed, &content)
		got = append(got, fmt.Sprint(n, key, stubbed, content))
	}
	want := []string{
		fmt.Sprint(1, rrChapter("x", "10", "one"), false, "one"),
		fmt.Sprint(2, rrChapter("x", "11", "two-7"), false, "new two"),
		fmt.Sprint(3, rrChapter("x", "12", "three"), false, "three"),
		fmt.Sprint(4, rrChapter("x", "13", "four"), false, "four"),
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("chapters:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	vrows, err := db.QueryContext(ctx, "SELECT chapter_start, chapter_end, is_stale FROM serial_volumes ORDER BY volume_number")
	if err != nil {
		t.Fatal(err)
	}
	defer vrows.Close()
	var vols []string
	for vrows.Next() {
		var lo, hi int
		var stale bool
		vrows.Scan(&lo, &hi, &stale)
		vols = append(vols, fmt.Sprint(lo, hi, stale))
	}
	// Volume 1 now has the new text of 2; volume 2 covered the copy, which
	// volume 1 has, and 5.
	if w := []string{"1 3 true", "4 4 false"}; strings.Join(vols, ",") != strings.Join(w, ",") {
		t.Fatalf("volumes %v, want %v", vols, w)
	}
	var total, live int
	db.QueryRowContext(ctx, "SELECT total_chapters, live_chapter_count FROM web_serials WHERE id = 1").Scan(&total, &live)
	if total != 4 || live != 4 {
		t.Fatalf("total %d live %d, want 4 4", total, live)
	}
}
