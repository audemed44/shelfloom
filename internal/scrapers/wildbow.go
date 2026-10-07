package scrapers

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"
	"golang.org/x/net/html"
)

// ── The Wandering Inn ─────────────────────────────────────────────────────────

// WanderingInn scrapes wanderinginn.com.
type WanderingInn struct{}

func (*WanderingInn) Name() string { return "wanderinginn" }

func (*WanderingInn) CanHandle(u string) bool { return bareHost(u) == "wanderinginn.com" }

func tocURL(u string) string {
	s := urlsplit(u)
	if strings.Contains(s.path, "table-of-contents") {
		return u
	}
	return s.scheme + "://" + s.netloc + "/table-of-contents/"
}

func (*WanderingInn) FetchMetadata(ctx context.Context, u string) (*Metadata, error) {
	doc, _, err := getDoc(ctx, tocURL(u))
	if err != nil {
		return nil, err
	}
	return &Metadata{
		Title:       "The Wandering Inn",
		Author:      strOrNil("pirateaba"),
		Description: strOrNil(metaContent(doc, "meta[name='description']")),
		CoverURL:    coverURL(doc),
		Status:      "ongoing",
	}, nil
}

func (*WanderingInn) FetchChapterList(ctx context.Context, u string) ([]ChapterInfo, error) {
	toc := tocURL(u)
	doc, _, err := getDoc(ctx, toc)
	if err != nil {
		return nil, err
	}
	var links []link
	doc.Find("#table-of-contents a").Each(func(_ int, a *goquery.Selection) {
		for _, c := range classes(a.Nodes[0]) {
			if c == "book-title-num" || c == "volume-book-card" {
				return
			}
		}
		href := attr(a, "href")
		links = append(links, link{href: href, text: stripEntities(a.Text()), date: dateFromURL(href)})
	})
	chapters := normalizeChapterList(toc, links)
	if len(chapters) == 0 {
		return nil, errors.New("Could not extract chapter list from Wandering Inn table of contents")
	}
	return chapters, nil
}

var italic = regexp.MustCompile(`(?i)font-style\s*:\s*italic`)

func (*WanderingInn) FetchChapterContent(ctx context.Context, u string) (*ChapterContent, error) {
	doc, _, err := getDoc(ctx, u)
	if err != nil {
		return nil, err
	}
	if err := sleep(ctx); err != nil {
		return nil, err
	}
	body := doc.Find("div#reader-content").First()
	if body.Length() == 0 {
		return nil, errors.New("Could not find Wandering Inn chapter content at " + u)
	}
	body.Find(".mrsha-write").Each(func(_ int, el *goquery.Selection) {
		n := el.Nodes[0]
		style := pyStrip(attr(el, "style"))
		if !italic.MatchString(style) {
			sep := ""
			if style != "" && !strings.HasSuffix(style, ";") {
				sep = ";"
			}
			style = style + sep + "font-style: italic;"
		}
		setAttr(n, "style", style)
	})
	body.Find("span[style*='color:']").Each(func(_ int, el *goquery.Selection) {
		n := el.Nodes[0]
		cls := classes(n)
		has := false
		for _, c := range cls {
			if c == "ibooks-dark-theme-use-custom-text-color" {
				has = true
			}
		}
		if !has {
			cls = append(cls, "ibooks-dark-theme-use-custom-text-color")
		}
		setAttr(n, "class", strings.Join(cls, " "))
	})
	body.Find("a[href*='https://wanderinginn.com/']").Remove()
	title := "Chapter"
	doc.Find("h2.elementor-heading-title").EachWithBreak(func(_ int, h *goquery.Selection) bool {
		if t := stripEntities(h.Text()); t != "" && strings.ToLower(t) != "loading..." {
			title = t
			return false
		}
		return true
	})
	return content(wrapDiv(body), title), nil
}

// ── Wildbow (Worm, Pact, Twig, Pale) ──────────────────────────────────────────

// Wildbow scrapes Wildbow's WordPress serials.
type Wildbow struct{}

var wildbowHosts = map[string]bool{
	"pactwebserial.wordpress.com": true, "palewebserial.wordpress.com": true,
	"parahumans.wordpress.com": true, "twigserial.wordpress.com": true,
}

var (
	// Link text that looks like a chapter code: "1.01", "E.6", "1.x (Interlude; Danny)".
	chapterCode = regexp.MustCompile(`^\s*[A-Za-z]?\d*\.[\da-z]+(?:\s*\(.*\))?\s*$`)
	extraRef    = regexp.MustCompile(`\[(\S+)\]`)
	wsRun       = regexp.MustCompile(`\s+`)
)

func (*Wildbow) Name() string { return "wildbow" }

func (*Wildbow) CanHandle(u string) bool { return wildbowHosts[bareHost(u)] }

func wpContent(doc *goquery.Document, selectors ...string) *goquery.Selection {
	return first(doc.Selection, selectors...)
}

func wpTitle(doc *goquery.Document, selectors ...string) string {
	if el := first(doc.Selection, selectors...); el != nil {
		return stripEntities(el.Text())
	}
	t := stripEntities(textOf(first(doc.Selection, "title")))
	if t == "" {
		return "Untitled"
	}
	return t
}

var wildbowContent = []string{"div.entry-content", "div.post-content"}
var wildbowTitle = []string{".entry-title", ".page-title", "header.post-title h1", ".post-title", "h1"}

func (*Wildbow) FetchMetadata(ctx context.Context, u string) (*Metadata, error) {
	doc, _, err := getDoc(ctx, tocURL(u))
	if err != nil {
		return nil, err
	}
	title := metaContent(doc, "meta[property='og:site_name']")
	if title == "" {
		title = wpTitle(doc, wildbowTitle...)
	}
	return &Metadata{
		Title: title, Author: strOrNil("Wildbow"),
		Description: strOrNil(metaContent(doc, "meta[name='description']")),
		CoverURL:    coverURL(doc), Status: "ongoing",
	}, nil
}

func (wb *Wildbow) FetchChapterList(ctx context.Context, u string) ([]ChapterInfo, error) {
	toc := tocURL(u)
	doc, _, err := getDoc(ctx, toc)
	if err != nil {
		return nil, err
	}
	var extras *goquery.Document
	if bareHost(toc) == "palewebserial.wordpress.com" {
		s := urlsplit(toc)
		if d, _, err := getDoc(ctx, s.scheme+"://"+s.netloc+"/extra-material/"); err == nil {
			extras = d
		}
	}
	chapters, err := wb.parseTOC(doc, toc)
	if err != nil {
		return nil, err
	}
	if extras != nil {
		if ex := wb.parseExtras(extras, toc); len(ex) > 0 {
			chapters = interleaveExtras(chapters, ex)
		}
	}
	return chapters, nil
}

func (wb *Wildbow) parseTOC(doc *goquery.Document, toc string) ([]ChapterInfo, error) {
	body := wpContent(doc, wildbowContent...)
	if body == nil {
		return nil, errors.New("Could not find content area on Wildbow table of contents")
	}
	host := bareHost(toc)
	var links []link
	body.Find("a[href]").Each(func(_ int, a *goquery.Selection) {
		href := attr(a, "href")
		text := stripEntities(a.Text())
		if href == "" || text == "" {
			return
		}
		abs := absoluteURL(toc, href)
		if abs == "" || bareHost(abs) != host || !chapterCode.MatchString(text) {
			return
		}
		links = append(links, link{href: abs, text: titleFromContext(a.Nodes[0], text), date: dateFromURL(abs)})
	})
	chapters := normalizeChapterList(toc, links)
	if len(chapters) == 0 {
		return nil, errors.New("Could not extract chapter list from Wildbow table of contents")
	}
	return chapters, nil
}

// titleFromContext builds "Code – Description" from the text right after
// the link (the parent often holds every link of an arc).
func titleFromContext(a *html.Node, linkText string) string {
	sib := a.NextSibling
	if sib == nil {
		return linkText
	}
	switch {
	case sib.Type == html.TextNode:
		if suffix := pyStrip(wsRun.ReplaceAllString(sib.Data, " ")); suffix != "" {
			return linkText + " " + suffix
		}
	case sib.Type == html.ElementNode && sib.Data != "a" && sib.Data != "br":
		for c := sib.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.TextNode {
				if suffix := pyStrip(wsRun.ReplaceAllString(c.Data, " ")); suffix != "" {
					return linkText + " " + suffix
				}
				break
			}
		}
	}
	return linkText
}

type extra struct {
	after   string
	chapter ChapterInfo
}

func (*Wildbow) parseExtras(doc *goquery.Document, base string) []extra {
	body := wpContent(doc, wildbowContent...)
	if body == nil {
		return nil
	}
	host := bareHost(base)
	var out []extra
	body.Find("a[href]").Each(func(_ int, a *goquery.Selection) {
		href := attr(a, "href")
		text := stripEntities(a.Text())
		if href == "" || text == "" {
			return
		}
		abs := absoluteURL(base, href)
		if abs == "" || bareHost(abs) != host {
			return
		}
		parent := a.Parent()
		if parent.Length() == 0 {
			return
		}
		m := extraRef.FindStringSubmatch(stripEntities(parent.Text()))
		if m == nil {
			return
		}
		title := "Extra: " + text
		out = append(out, extra{after: m[1], chapter: ChapterInfo{Title: &title, SourceURL: abs, PublishDate: dateFromURL(abs)}})
	})
	return out
}

// interleaveExtras inserts extra material after the chapter it follows and
// renumbers everything.
func interleaveExtras(chapters []ChapterInfo, extras []extra) []ChapterInfo {
	codeIndex := map[string]int{}
	for i, ch := range chapters {
		if ch.Title != nil && *ch.Title != "" {
			fields := strings.FieldsFunc(*ch.Title, isPySpace)
			if len(fields) > 0 {
				codeIndex[strings.TrimRight(fields[0], "–—-")] = i
			}
		}
	}
	inserts := map[int][]ChapterInfo{}
	for _, e := range extras {
		if i, ok := codeIndex[e.after]; ok {
			inserts[i] = append(inserts[i], e.chapter)
		}
	}
	var merged []ChapterInfo
	for i, ch := range chapters {
		merged = append(merged, ch)
		merged = append(merged, inserts[i]...)
	}
	for i := range merged {
		merged[i].Number = i + 1
	}
	return merged
}

// cleanWordpressContent drops sharing widgets and next/previous links.
func cleanWordpressContent(body *goquery.Selection, extraSelectors []string, alsoStartsWith bool) {
	for _, sel := range append([]string{"script", "style", "nav"}, extraSelectors...) {
		body.Find(sel).Remove()
	}
	body.Find("a[rel='next'], a[rel='prev']").Remove()
	root := body.Nodes[0]
	body.Find("a").Each(func(_ int, a *goquery.Selection) {
		if !attachedTo(a.Nodes[0], root) {
			return
		}
		txt := strings.ToLower(a.Text())
		if strings.Contains(txt, "next chapter") || strings.Contains(txt, "previous chapter") ||
			(alsoStartsWith && (strings.HasPrefix(txt, "next ") || strings.HasPrefix(txt, "previous "))) {
			a.Remove()
		}
	})
}

func (*Wildbow) FetchChapterContent(ctx context.Context, u string) (*ChapterContent, error) {
	doc, _, err := getDoc(ctx, u)
	if err != nil {
		return nil, err
	}
	if err := sleep(ctx); err != nil {
		return nil, err
	}
	title := wpTitle(doc, wildbowTitle...)
	if title == "" {
		title = "Chapter"
	}
	body := wpContent(doc, wildbowContent...)
	if body == nil {
		return nil, errors.New("Could not find chapter content at " + u)
	}
	cleanWordpressContent(body, []string{".sharedaddy", ".jp-relatedposts"}, false)
	return content(wrapDiv(body), title), nil
}
