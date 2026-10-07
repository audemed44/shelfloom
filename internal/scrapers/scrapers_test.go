package scrapers

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

// The cases below follow the Python backend's tests/test_scrapers.py.

type fakeResponse struct {
	body   string
	status int
	url    string
}

// fakeSite answers requests with the given responses in order (the last one
// repeats), like the Python tests' _mock_client.
type fakeSite struct {
	responses []fakeResponse
	calls     []string
}

func (f *fakeSite) RoundTrip(r *http.Request) (*http.Response, error) {
	f.calls = append(f.calls, r.URL.String())
	i := min(len(f.calls)-1, len(f.responses)-1)
	resp := f.responses[i]
	status := resp.status
	if status == 0 {
		status = 200
	}
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(resp.body)), Header: http.Header{}, Request: r}, nil
}

func serve(t *testing.T, bodies ...string) *fakeSite {
	t.Helper()
	site := &fakeSite{}
	for _, b := range bodies {
		site.responses = append(site.responses, fakeResponse{body: b})
	}
	old, oldWait := Client, RateLimit
	Client = &http.Client{Transport: site}
	RateLimit = 0
	t.Cleanup(func() { Client, RateLimit = old, oldWait })
	return site
}

var ctx = context.Background()

func TestBaseHelpers(t *testing.T) {
	if got := stripEntities("Hello &amp; World"); got != "Hello & World" {
		t.Error(got)
	}
	if got := stripEntities("  spaces  "); got != "spaces" {
		t.Error(got)
	}
	if got := absoluteURL("https://example.com/page", "/chapter/1"); got != "https://example.com/chapter/1" {
		t.Error(got)
	}
	if got := absoluteURL("https://example.com/page", "https://other.com/a"); got != "https://other.com/a" {
		t.Error(got)
	}
	if absoluteURL("https://example.com", "") != "" {
		t.Error("empty href")
	}
	if got := absoluteURL("https://example.com", "/page#section"); strings.Contains(got, "#") {
		t.Error(got)
	}
	if absoluteURL("https://example.com", "ftp://other.com/file") != "" || absoluteURL("https://example.com", "data:text/plain,hello") != "" {
		t.Error("non-http scheme accepted")
	}
	if NormalizeURL("https://example.com/page#anchor") != "https://example.com/page" {
		t.Error("fragment kept")
	}
	for in, want := range map[string]int{"<p>Hello world</p>": 2, "<p></p>": 0, "one two three": 3, "a b\x1cc": 3, "x &amp; y": 3} {
		if got := CountWords(in); got != want {
			t.Errorf("CountWords(%q) = %d, want %d", in, got, want)
		}
	}
	chapters := normalizeChapterList("https://example.com", []link{{href: "/ch/1", text: "Chapter 1"}, {href: "/ch/1", text: "Duplicate"}, {href: "/ch/2", text: "Chapter 2"}})
	if len(chapters) != 2 || chapters[0].Number != 1 || chapters[1].Number != 2 || *chapters[0].Title != "Chapter 1" {
		t.Errorf("%+v", chapters)
	}
	if got := normalizeChapterList("https://example.com", []link{{href: "", text: "Chapter 1"}, {href: "javascript:void(0)", text: "Bad"}}); len(got) != 0 {
		t.Errorf("%+v", got)
	}
}

func TestRegistry(t *testing.T) {
	cases := map[string]string{
		"https://www.royalroad.com/fiction/12345/my-story": "royalroad",
		"https://novelfire.net/novel/12345":                "novelfire",
		"https://wanderinginn.com/table-of-contents/":      "wanderinginn",
		"https://mynovel.wordpress.com/":                   "wordpress-generic",
		"https://example.com/chapter-1-prologue":           "sequential-next-link",
		"https://palewebserial.wordpress.com/toc/":         "wildbow",
		"https://royalroad.com/fiction/1/title":            "royalroad",
		"https://example.com/2019/01/01/my-post":           "sequential-next-link",
	}
	for u, want := range cases {
		a := ForURL(u)
		if a == nil || a.Name() != want {
			t.Errorf("ForURL(%s) = %v, want %s", u, a, want)
		}
	}
	if a := ForURL("https://example.com/"); a != nil {
		t.Errorf("plain root matched %s", a.Name())
	}
	if got := strings.Join(Names(), ","); got != "royalroad,novelfire,wanderinginn,wildbow,wordpress-generic,sequential-next-link" {
		t.Error(got)
	}
}

func TestRoyalRoad(t *testing.T) {
	rr := &RoyalRoad{}
	for _, u := range []string{"https://royalroad.com/fiction/1/story", "https://www.royalroad.com/fiction/1/story", "https://royalroadl.com/fiction/1/story"} {
		if !rr.CanHandle(u) {
			t.Error(u)
		}
	}
	if rr.CanHandle("https://example.com/fiction/1") {
		t.Error("example.com")
	}
	if got := rr.storyURL("https://royalroad.com/fiction/12345/my-story"); got != "https://royalroad.com/fiction/12345/my-story" {
		t.Error(got)
	}
	if got := rr.storyURL("https://royalroad.com/fiction/12345/my-story/chapter/99999/ch"); got != "https://royalroad.com/fiction/12345/my-story" {
		t.Error(got)
	}

	serve(t, rrStoryHtml)
	meta, err := rr.FetchMetadata(ctx, "https://royalroad.com/fiction/1/my-story")
	if err != nil || meta.Title != "My Story" || *meta.Author != "AuthorName" || *meta.CoverURL != "https://cdn.royalroad.com/cover.jpg" || *meta.Description != "Great story" {
		t.Fatalf("%+v %v", meta, err)
	}
	chapters, err := rr.FetchChapterList(ctx, "https://royalroad.com/fiction/1/my-story")
	if err != nil || len(chapters) != 2 || *chapters[0].Title != "Chapter 1" || chapters[1].Number != 2 {
		t.Fatalf("%+v %v", chapters, err)
	}
	if d := chapters[0].PublishDate; d == nil || d.Format("2006-01-02T15:04:05") != "2025-01-15T12:00:00" {
		t.Errorf("date %v", d)
	}
	if chapters[0].SourceURL != "https://royalroad.com/fiction/1/my-story/chapter/100/ch1" {
		t.Error(chapters[0].SourceURL)
	}

	serve(t, rrChapterHtml)
	c, err := rr.FetchChapterContent(ctx, "https://royalroad.com/fiction/1/story/chapter/100/ch1")
	if err != nil || !strings.Contains(*c.Title, "Chapter 1") || !strings.Contains(c.HTML, "Once upon a time") || c.WordCount != 8 {
		t.Fatalf("%+v %v", c, err)
	}

	serve(t, "<html><body><h1>Chapter</h1><div class='page-content-wrapper'><div class='chapter-inner'><p>Text</p></div></div></body></html>")
	if c, _ := rr.FetchChapterContent(ctx, "https://royalroad.com/x"); !strings.Contains(c.HTML, "Text") {
		t.Error(c.HTML)
	}

	serve(t, "<html><body><h1>Chapter 5</h1>"+
		"<style>.cjAxM2JmNmQ5Mzk1YTRmZmZiM2Q2MWQ5YTNlMmQxNTU2{display: none; speak: never;}</style>"+
		"<div class='portlet-body'><div class='chapter-inner chapter-content'>"+
		"<p class='cnM4YmQ2ZGI1OWJlZTRjYzNiMTlkZWU5M2UyNmIzNjEw'>She ordered a book from Amazon.</p>"+
		"<span class='cjAxM2JmNmQ5Mzk1YTRmZmZiM2Q2MWQ5YTNlMmQxNTU2'>Stolen from its original source, this story is not meant to be on Amazon; report any sightings.</span>"+
		"<p style='display:none'>Invisible filler</p>"+
		"<p class='cnM0MmM1OTQ1MWMzNzQwOTNhZGEwMDY3OTUyYTZjNzgw'>The end.</p>"+
		"</div></div></body></html>")
	c, _ = rr.FetchChapterContent(ctx, "https://royalroad.com/x")
	for _, gone := range []string{"report any sightings", "Invisible filler", "cnM4YmQ2"} {
		if strings.Contains(c.HTML, gone) {
			t.Errorf("%q kept: %s", gone, c.HTML)
		}
	}
	for _, kept := range []string{"She ordered a book from Amazon.", "The end."} {
		if !strings.Contains(c.HTML, kept) {
			t.Errorf("%q dropped: %s", kept, c.HTML)
		}
	}
}

func TestRoyalRoadNoticesInStoredShape(t *testing.T) {
	notices := []string{
		"Stolen from its original source, this story is not meant to be on Amazon; report any sightings.",
		"This story originates from a different website. Ensure the author gets the support they deserve by reading it there.",
		"You could be reading stolen content. Head to the original site for the genuine story.",
		"Unauthorized usage: this narrative is on Amazon without the author's consent. Report any sightings.",
	}
	for _, notice := range notices {
		serve(t, "<html><body><div class='portlet-body'><div class='chapter-inner chapter-content'>"+
			"<p>First paragraph.</p>"+
			"<span class='cmMyMjliZTY1NTNmZjQ4YjFiYWZlNzA3OWY1N2FkNzdj'>"+notice+"</span>"+
			"<p>A paragraph about Amazon warehouses and stolen goods.</p></div></div></body></html>")
		c, _ := (&RoyalRoad{}).FetchChapterContent(ctx, "https://royalroad.com/x")
		if strings.Contains(c.HTML, notice[:20]) || !strings.Contains(c.HTML, "First paragraph.") || !strings.Contains(c.HTML, "Amazon warehouses") {
			t.Errorf("%s", c.HTML)
		}
	}
	serve(t, "<html><body><div class='portlet-body'><div class='chapter-inner'><p>Report to the captain.</p><span>An inline aside.</span></div></div></body></html>")
	c, _ := (&RoyalRoad{}).FetchChapterContent(ctx, "https://royalroad.com/x")
	if !strings.Contains(c.HTML, "An inline aside.") {
		t.Error(c.HTML)
	}
}

func TestNovelFire(t *testing.T) {
	nf := &NovelFire{}
	if !nf.CanHandle("https://novelfire.net/novel/123") || !nf.CanHandle("https://www.novelfire.net/novel/123") || nf.CanHandle("https://royalroad.com/fiction/1") {
		t.Error("CanHandle")
	}
	if nf.storyRoot("https://novelfire.net/novel/1/chapters") != "https://novelfire.net/novel/1" || nf.storyRoot("https://novelfire.net/novel/1/") != "https://novelfire.net/novel/1" {
		t.Error("storyRoot")
	}
	serve(t, nfChaptersHtml)
	meta, _ := nf.FetchMetadata(ctx, "https://novelfire.net/novel/1")
	if meta.Title != "Fire Novel" || *meta.Author != "NF Author" || *meta.CoverURL != "https://novelfire.net/cover.jpg" || *meta.Description != "An epic tale" {
		t.Errorf("%+v", meta)
	}
	chapters, err := nf.FetchChapterList(ctx, "https://novelfire.net/novel/1")
	if err != nil || len(chapters) != 2 || *chapters[0].Title != "Chapter 1" || chapters[0].SourceURL != "https://novelfire.net/novel/1/chapter-1" {
		t.Errorf("%+v %v", chapters, err)
	}

	ajaxPage := strings.Replace(nfChaptersHtml, "</body>", "<script>var url='/listChapterDataAjax?novel_id=1';</script><script>var host='https://novelfire.net/';</script></body>", 1)
	site := serve(t, ajaxPage, `{"data":[{"n_sort":1,"title":"Chapter 1"},{"n_sort":2,"title":"Chapter 2"},{"n_sort":3,"title":"Chapter 3"}],"recordsTotal":3}`)
	chapters, err = nf.FetchChapterList(ctx, "https://novelfire.net/novel/1")
	if err != nil || len(chapters) != 3 || chapters[2].SourceURL != "https://novelfire.net/novel/1/chapter-3" {
		t.Errorf("%+v %v", chapters, err)
	}
	if got := site.calls[1]; got != "https://novelfire.net/listChapterDataAjax?novel_id=1&draw=1&start=0&length=100&order%5B0%5D%5Bcolumn%5D=2&order%5B0%5D%5Bdir%5D=asc" {
		t.Error(got)
	}

	serve(t, nfChapterHtml)
	c, _ := nf.FetchChapterContent(ctx, "https://novelfire.net/novel/1/chapter-1")
	if !strings.Contains(*c.Title, "Fire") || !strings.Contains(c.HTML, "fire burned") {
		t.Errorf("%+v", c)
	}
	serve(t, `<html><body><div class="chapter-content"><p class="watermark">ad text</p><p>real text</p>`+
		`<div><dl><dt>Info</dt><dd>Value</dd></dl></div><p><strong><strong>inner</strong></strong>keep</p></div></body></html>`)
	c, _ = nf.FetchChapterContent(ctx, "https://novelfire.net/x")
	for _, gone := range []string{"ad text", "Info", "inner"} {
		if strings.Contains(c.HTML, gone) {
			t.Errorf("%q kept: %s", gone, c.HTML)
		}
	}
	if !strings.Contains(c.HTML, "real text") {
		t.Error(c.HTML)
	}
	if nf.ajaxEndpoint("var x='/listChapterDataAjax';") != "" || nf.ajaxEndpoint("var x='/listChapterDataAjax?novel_id=1 x';") != "" {
		t.Error("ajaxEndpoint")
	}
}

func TestWanderingInn(t *testing.T) {
	wi := &WanderingInn{}
	if !wi.CanHandle("https://www.wanderinginn.com/table-of-contents/") || wi.CanHandle("https://royalroad.com/fiction/1") {
		t.Error("CanHandle")
	}
	if tocURL("https://wanderinginn.com/") != "https://wanderinginn.com/table-of-contents/" {
		t.Error(tocURL("https://wanderinginn.com/"))
	}
	serve(t, wiTocHtml)
	meta, _ := wi.FetchMetadata(ctx, "https://wanderinginn.com/")
	if meta.Title != "The Wandering Inn" || *meta.Author != "pirateaba" || *meta.CoverURL != "https://wanderinginn.com/cover.jpg" {
		t.Errorf("%+v", meta)
	}
	chapters, _ := wi.FetchChapterList(ctx, "https://wanderinginn.com/")
	if len(chapters) != 2 || *chapters[0].Title != "Chapter 1 – The Inn" || chapters[0].PublishDate == nil {
		t.Errorf("%+v", chapters)
	}
	serve(t, "<html><body><div id='table-of-contents'></div></body></html>")
	if _, err := wi.FetchChapterList(ctx, "https://wanderinginn.com/"); err == nil || !strings.Contains(err.Error(), "Could not extract") {
		t.Error(err)
	}
	serve(t, wiChapterHtml)
	c, _ := wi.FetchChapterContent(ctx, "https://wanderinginn.com/2019/01/01/chapter-1")
	if !strings.Contains(*c.Title, "Inn") || !strings.Contains(c.HTML, "Erin") || !strings.Contains(c.HTML, "italic") {
		t.Errorf("%+v", c)
	}
	serve(t, "<html><body><p>no content div</p></body></html>")
	if _, err := wi.FetchChapterContent(ctx, "https://wanderinginn.com/x"); err == nil || !strings.Contains(err.Error(), "Could not find") {
		t.Error(err)
	}
}

func TestWordpress(t *testing.T) {
	wp := &Wordpress{}
	if !wp.CanHandle("https://mynovel.wordpress.com/") || !wp.CanHandle("https://story.blog/chapter-1") || wp.CanHandle("https://royalroad.com/fiction/1") {
		t.Error("CanHandle")
	}
	serve(t, wpTocHtml)
	meta, _ := wp.FetchMetadata(ctx, "https://mynovel.wordpress.com/")
	if meta.Title != "My WP Novel" || *meta.CoverURL != "https://mynovel.wordpress.com/cover.jpg" || *meta.Author != "WP Author" {
		t.Errorf("%+v", meta)
	}
	chapters, _ := wp.FetchChapterList(ctx, "https://mynovel.wordpress.com/")
	if len(chapters) != 2 || !strings.Contains(*chapters[0].Title, "Chapter 1") {
		t.Errorf("%+v", chapters)
	}
	serve(t, `<html><body><h1 class="entry-title">Chapter 1</h1><div class="entry-content"><p>Content</p></div></body></html>`)
	if chapters, _ := wp.FetchChapterList(ctx, "https://mynovel.wordpress.com/chapter-1"); len(chapters) != 1 || *chapters[0].Title != "Chapter 1" {
		t.Errorf("%+v", chapters)
	}
	serve(t, wpChapterHtml)
	c, _ := wp.FetchChapterContent(ctx, "https://mynovel.wordpress.com/chapter-1")
	if *c.Title != "Chapter 1" || !strings.Contains(c.HTML, "story began") || strings.Contains(c.HTML, `rel="next"`) {
		t.Errorf("%+v", c)
	}
	serve(t, "<html><body><p>no content div</p></body></html>")
	if _, err := wp.FetchChapterContent(ctx, "https://mynovel.wordpress.com/ch1"); err == nil || !strings.Contains(err.Error(), "Could not detect") {
		t.Error(err)
	}
}

func TestSequential(t *testing.T) {
	sq := &Sequential{}
	if !sq.CanHandle("https://example.com/2019/01/01/my-post") || !sq.CanHandle("https://example.com/chapter-1-prologue") || sq.CanHandle("https://example.com/") {
		t.Error("CanHandle")
	}
	serve(t, seqCh1Html)
	meta, _ := sq.FetchMetadata(ctx, "https://example.com/chapter-1")
	if meta.Title != "My Blog Novel" {
		t.Error(meta.Title)
	}
	serve(t, seqCh1Html, seqCh2Html)
	chapters, err := sq.FetchChapterList(ctx, "https://example.com/chapter-1")
	if err != nil || len(chapters) != 2 || !strings.Contains(*chapters[0].Title, "Chapter 1") || !strings.Contains(*chapters[1].Title, "Chapter 2") || chapters[1].SourceURL != "https://example.com/chapter-2-the-journey" {
		t.Errorf("%+v %v", chapters, err)
	}
	serve(t, seqCh1Html)
	c, _ := sq.FetchChapterContent(ctx, "https://example.com/chapter-1")
	if !strings.Contains(*c.Title, "Chapter 1") || !strings.Contains(c.HTML, "First chapter") || strings.Contains(c.HTML, `rel="next"`) {
		t.Errorf("%+v", c)
	}
	if got := titleFromSlug("https://example.com/chapter-1-the-journey"); got != "Chapter 1 The Journey" {
		t.Error(got)
	}
	if got := titleFromSlug("https://example.com/chapter-1-2"); !strings.Contains(got, "1.2") {
		t.Error(got)
	}
	if sq.resolveOnHost("https://example.com/ch1", "/ch2", "example.com") != "https://example.com/ch2" || sq.resolveOnHost("https://example.com/ch1", "https://other.com/ch2", "example.com") != "" {
		t.Error("resolveOnHost")
	}
}

func TestWildbow(t *testing.T) {
	wb := &Wildbow{}
	for _, u := range []string{"https://palewebserial.wordpress.com/table-of-contents/", "https://pactwebserial.wordpress.com/table-of-contents/", "https://parahumans.wordpress.com/table-of-contents/", "https://twigserial.wordpress.com/2015/01/01/ch1/"} {
		if !wb.CanHandle(u) {
			t.Error(u)
		}
	}
	if wb.CanHandle("https://example.wordpress.com/") {
		t.Error("example.wordpress.com")
	}
	if tocURL("https://palewebserial.wordpress.com/2020/05/05/blood-0-0/") != "https://palewebserial.wordpress.com/table-of-contents/" {
		t.Error("tocURL")
	}
	serve(t, wildbowTocHtml)
	meta, _ := wb.FetchMetadata(ctx, "https://palewebserial.wordpress.com/table-of-contents/")
	if meta.Title != "Pale" || *meta.Author != "Wildbow" || *meta.Description != "A web serial by Wildbow" || *meta.CoverURL != "https://example.com/cover.jpg" {
		t.Errorf("%+v", meta)
	}
	pact := strings.ReplaceAll(wildbowTocHtml, "palewebserial.wordpress.com", "pactwebserial.wordpress.com")
	serve(t, pact)
	chapters, err := wb.FetchChapterList(ctx, "https://pactwebserial.wordpress.com/table-of-contents/")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"0.0 – Prologue.", "1.1 – Verona", "1.2 – Lucy", "1.z – Interlude"}
	if len(chapters) != len(want) {
		t.Fatalf("%+v", chapters)
	}
	for i, w := range want {
		if *chapters[i].Title != w || chapters[i].Number != i+1 {
			t.Errorf("%d: %q", i, *chapters[i].Title)
		}
	}
	if d := chapters[0].PublishDate; d == nil || d.Format("2006-01-02") != "2020-05-05" {
		t.Errorf("date %v", d)
	}

	serve(t, wildbowTocHtml, wildbowExtrasHtml)
	chapters, _ = wb.FetchChapterList(ctx, "https://palewebserial.wordpress.com/table-of-contents/")
	want = []string{"0.0 – Prologue.", "Extra: The Brochure", "1.1 – Verona", "1.2 – Lucy", "Extra: Notes on Others", "1.z – Interlude"}
	if len(chapters) != len(want) {
		t.Fatalf("%+v", chapters)
	}
	for i, w := range want {
		if *chapters[i].Title != w || chapters[i].Number != i+1 {
			t.Errorf("%d: %q", i, *chapters[i].Title)
		}
	}

	serve(t, wildbowChapterHtml)
	c, _ := wb.FetchChapterContent(ctx, "https://palewebserial.wordpress.com/2020/05/05/blood-0-0/")
	if *c.Title != "Blood Run Cold 0.0" || !strings.Contains(c.HTML, "The world was ending.") || strings.Contains(c.HTML, "sharedaddy") || strings.Contains(c.HTML, `rel="next"`) || c.WordCount == 0 {
		t.Errorf("%+v", c)
	}
	for _, code := range []string{"0.0", "1.01", "16.12", "E.6", "1.z", "1.0x", "1.x (Interlude; Danny)"} {
		if !chapterCode.MatchString(code) {
			t.Error(code)
		}
	}
	for _, code := range []string{"About", "Arc 1", "Table of Contents"} {
		if chapterCode.MatchString(code) {
			t.Error(code)
		}
	}
}
