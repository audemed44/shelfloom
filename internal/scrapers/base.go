// Package scrapers fetches web serials: metadata, the chapter list and each
// chapter's cleaned HTML. It is a port of the Python backend's adapters
// (app/scrapers), which existing chapter keys and word counts come from.
package scrapers

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/PuerkitoBio/goquery"
	xhtml "golang.org/x/net/html"
)

// Metadata describes a serial.
type Metadata struct {
	Title       string
	Author      *string
	Description *string
	CoverURL    *string
	Status      string
}

// ChapterInfo is one entry of a serial's chapter list.
type ChapterInfo struct {
	Number      int
	Title       *string
	SourceURL   string
	PublishDate *time.Time // naive UTC
}

// ChapterContent is a fetched chapter.
type ChapterContent struct {
	Title     *string
	HTML      string
	WordCount int
}

// Adapter scrapes one kind of site.
type Adapter interface {
	Name() string
	CanHandle(url string) bool
	FetchMetadata(ctx context.Context, url string) (*Metadata, error)
	FetchChapterList(ctx context.Context, url string) ([]ChapterInfo, error)
	FetchChapterContent(ctx context.Context, url string) (*ChapterContent, error)
}

// adapters in order: specific sites first, generic fallbacks last.
var adapters = []Adapter{
	&RoyalRoad{}, &NovelFire{}, &WanderingInn{}, &Wildbow{}, &Wordpress{}, &Sequential{},
}

// ForURL returns the first adapter that can handle url.
func ForURL(url string) Adapter {
	for _, a := range adapters {
		if a.CanHandle(url) {
			return a
		}
	}
	return nil
}

// ByName returns the adapter with this name.
func ByName(name string) Adapter {
	for _, a := range adapters {
		if a.Name() == name {
			return a
		}
	}
	return nil
}

// Names lists the adapters.
func Names() []string {
	out := make([]string, len(adapters))
	for i, a := range adapters {
		out[i] = a.Name()
	}
	return out
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

// RateLimit is the pause after each chapter page, to be polite to the site.
var RateLimit = 1500 * time.Millisecond

// Client is the HTTP client the adapters use (replaced in tests).
var Client = &http.Client{Timeout: 30 * time.Second}

// HTTPError is a non-2xx answer (httpx's raise_for_status).
type HTTPError struct {
	Status int
	URL    string
}

func (e *HTTPError) Error() string {
	reason := http.StatusText(e.Status)
	kind := "Client error"
	if e.Status >= 500 {
		kind = "Server error"
	} else if e.Status < 400 {
		kind = "Redirect response"
	}
	return fmt.Sprintf("%s '%d %s' for url '%s'", kind, e.Status, reason, e.URL)
}

// get fetches a page with browser-like headers and returns its body.
func get(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.5")
	resp, err := Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, &HTTPError{Status: resp.StatusCode, URL: resp.Request.URL.String()}
	}
	return body, nil
}

// getDoc fetches and parses a page.
func getDoc(ctx context.Context, url string) (*goquery.Document, []byte, error) {
	body, err := get(ctx, url)
	if err != nil {
		return nil, nil, err
	}
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(body))
	return doc, body, err
}

func sleep(ctx context.Context) error {
	t := time.NewTimer(RateLimit)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// ── text helpers ──────────────────────────────────────────────────────────────

// pyStrip is str.strip(): Python's whitespace on both ends.
func pyStrip(s string) string { return strings.TrimFunc(s, isPySpace) }

// isPySpace is str.isspace() for one character.
func isPySpace(r rune) bool {
	return unicode.IsSpace(r) || (r >= 0x1c && r <= 0x1f)
}

// stripEntities is strip_html_entities: unescape (again) and strip.
func stripEntities(s string) string { return pyStrip(html.UnescapeString(s)) }

func strOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

var tagRE = regexp.MustCompile(`<[^>]+>`)

// CountWords counts words the way the Python backend did: tags become
// spaces, entities are decoded, then the text is split on whitespace.
func CountWords(htmlContent string) int {
	text := html.UnescapeString(tagRE.ReplaceAllString(htmlContent, " "))
	return len(strings.FieldsFunc(text, isPySpace))
}

var urlDate = regexp.MustCompile(`/(\d{4})/(\d{2})/(\d{2})/`)

// dateFromURL reads a /YYYY/MM/DD/ date in a URL.
func dateFromURL(u string) *time.Time {
	m := urlDate.FindStringSubmatch(u)
	if m == nil {
		return nil
	}
	y, _ := strconv.Atoi(m[1])
	mo, _ := strconv.Atoi(m[2])
	d, _ := strconv.Atoi(m[3])
	t := time.Date(y, time.Month(mo), d, 0, 0, 0, 0, time.UTC)
	if t.Month() != time.Month(mo) || t.Day() != d || mo < 1 || mo > 12 {
		return nil
	}
	return &t
}

// NormalizeURL drops the fragment, as the Python backend's normalize_url
// does; chapter keys are built from it.
func NormalizeURL(u string) string {
	if i := strings.IndexByte(u, '#'); i >= 0 {
		u = u[:i]
	}
	return u
}

// absoluteURL resolves href against base, keeping only http(s) URLs, and
// drops the fragment.
func absoluteURL(base, href string) string {
	if href == "" {
		return ""
	}
	res := urljoin(base, href)
	scheme := strings.ToLower(schemeOf(res))
	if scheme != "http" && scheme != "https" {
		return ""
	}
	return strings.SplitN(res, "#", 2)[0]
}

// normalizeChapterList numbers unique links in order; a link without text is
// titled by its URL.
func normalizeChapterList(base string, links []link) []ChapterInfo {
	seen := map[string]bool{}
	var out []ChapterInfo
	for _, l := range links {
		u := absoluteURL(base, l.href)
		if u == "" || seen[u] {
			continue
		}
		seen[u] = true
		title := stripEntities(l.text)
		if title == "" {
			title = u
		}
		out = append(out, ChapterInfo{Number: len(out) + 1, Title: &title, SourceURL: u, PublishDate: l.date})
	}
	return out
}

type link struct {
	href string
	text string
	date *time.Time
}

// innerHTML is BeautifulSoup's decode_contents() for a selection.
func innerHTML(sel *goquery.Selection) string {
	var b strings.Builder
	for _, n := range sel.Nodes {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			xhtml.Render(&b, c)
		}
	}
	return b.String()
}

// wrapDiv is "<div>" + inner + "</div>", the shape every adapter stores.
func wrapDiv(sel *goquery.Selection) string {
	return "<div>" + innerHTML(sel) + "</div>"
}

func content(htmlContent string, title string) *ChapterContent {
	return &ChapterContent{Title: &title, HTML: htmlContent, WordCount: CountWords(htmlContent)}
}

// attr returns an attribute, or "".
func attr(sel *goquery.Selection, name string) string {
	v, _ := sel.Attr(name)
	return v
}

// first returns the first match of selectors tried in order.
func first(doc *goquery.Selection, selectors ...string) *goquery.Selection {
	for _, s := range selectors {
		if m := doc.Find(s).First(); m.Length() > 0 {
			return m
		}
	}
	return nil
}

// textOf is get_text() of a selection, or "" for nil.
func textOf(sel *goquery.Selection) string {
	if sel == nil {
		return ""
	}
	return sel.Text()
}

// metaContent reads <meta … content> from a selector.
func metaContent(doc *goquery.Document, selector string) string {
	return stripEntities(attr(doc.Find(selector).First(), "content"))
}

// coverURL reads og:image the way the adapters do.
func coverURL(doc *goquery.Document) *string {
	return strOrNil(attr(doc.Find("meta[property='og:image']").First(), "content"))
}

// hostOf is urlparse(u).hostname: lower case, without port or "www.".
func hostOf(u string) string {
	rest := u
	if i := strings.Index(rest, "://"); i >= 0 {
		rest = rest[i+3:]
	} else if strings.HasPrefix(rest, "//") {
		rest = rest[2:]
	} else {
		return ""
	}
	if i := strings.IndexAny(rest, "/?#"); i >= 0 {
		rest = rest[:i]
	}
	if i := strings.LastIndexByte(rest, '@'); i >= 0 {
		rest = rest[i+1:]
	}
	if strings.HasPrefix(rest, "[") {
		if i := strings.IndexByte(rest, ']'); i >= 0 {
			return strings.ToLower(rest[1:i])
		}
	}
	if i := strings.IndexByte(rest, ':'); i >= 0 {
		rest = rest[:i]
	}
	return strings.ToLower(rest)
}

func bareHost(u string) string { return strings.TrimPrefix(hostOf(u), "www.") }

var errNoContent = errors.New("Could not detect chapter content for this page")
