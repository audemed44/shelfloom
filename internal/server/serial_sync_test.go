package server

import (
	"context"
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
