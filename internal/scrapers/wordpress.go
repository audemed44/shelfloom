package scrapers

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

// ── generic WordPress ─────────────────────────────────────────────────────────

// Wordpress scrapes WordPress sites whose table of contents links chapters.
type Wordpress struct{}

var (
	wpContentSelectors = []string{"div.entry-content", "div.post-content", "ul.wp-block-post-template", ".wp-block-cover__inner-container"}
	wpTitleSelectors   = []string{".entry-title", ".page-title", "header.post-title h1", ".post-title", "#chapter-heading", ".wp-block-post-title", "h1"}
	wpChapterText      = regexp.MustCompile(`(?i)chapter|prologue|epilogue|part\s+\d+`)
	wpChapterPath      = regexp.MustCompile(`(?i)chapter|prologue|epilogue`)
)

func (*Wordpress) Name() string { return "wordpress-generic" }

func (*Wordpress) CanHandle(u string) bool {
	h := hostOf(u)
	return strings.Contains(h, "wordpress") || strings.HasSuffix(h, ".blog")
}

func (*Wordpress) FetchMetadata(ctx context.Context, u string) (*Metadata, error) {
	doc, _, err := getDoc(ctx, u)
	if err != nil {
		return nil, err
	}
	return &Metadata{
		Title:       wpTitle(doc, wpTitleSelectors...),
		Author:      strOrNil(stripEntities(textOf(first(doc.Selection, "[rel='author'], .author a, .byline a")))),
		Description: strOrNil(metaContent(doc, "meta[name='description']")),
		CoverURL:    coverURL(doc),
		Status:      "ongoing",
	}, nil
}

func (*Wordpress) FetchChapterList(ctx context.Context, u string) ([]ChapterInfo, error) {
	doc, _, err := getDoc(ctx, u)
	if err != nil {
		return nil, err
	}
	body := wpContent(doc, wpContentSelectors...)
	if body == nil {
		return nil, errors.New("Could not detect a supported WordPress chapter page")
	}
	host := hostOf(u)
	var links []link
	body.Find("a[href]").Each(func(_ int, a *goquery.Selection) {
		href := attr(a, "href")
		text := stripEntities(a.Text())
		if href == "" || text == "" {
			return
		}
		abs := absoluteURL(u, href)
		if abs == "" {
			return
		}
		if hostOf(abs) == host && (wpChapterText.MatchString(text) || wpChapterPath.MatchString(urlsplit(abs).path)) {
			links = append(links, link{href: abs, text: text, date: dateFromURL(abs)})
		}
	})
	chapters := normalizeChapterList(u, links)
	if len(chapters) == 0 {
		title := stripEntities(textOf(first(doc.Selection, "h1", "title")))
		if title == "" {
			title = "Chapter 1"
		}
		chapters = []ChapterInfo{{Number: 1, Title: &title, SourceURL: u}}
	}
	return chapters, nil
}

func (*Wordpress) FetchChapterContent(ctx context.Context, u string) (*ChapterContent, error) {
	doc, _, err := getDoc(ctx, u)
	if err != nil {
		return nil, err
	}
	if err := sleep(ctx); err != nil {
		return nil, err
	}
	title := wpTitle(doc, wpTitleSelectors...)
	if title == "" {
		title = "Chapter"
	}
	body := wpContent(doc, wpContentSelectors...)
	if body == nil {
		return nil, errNoContent
	}
	cleanWordpressContent(body, []string{".sharedaddy", ".jp-relatedposts"}, false)
	return content(wrapDiv(body), title), nil
}

// ── following "next chapter" links ────────────────────────────────────────────

// Sequential collects chapters by following each page's next-chapter link.
type Sequential struct{}

var (
	seqContentSelector = "article .entry-content, div.entry-content, div.post-content, article .post-content, article .post-body, div#reader-content, main article, article"
	seqTitleSelector   = "h1.entry-title, h1.post-title, h1.wp-block-post-title, header .entry-title, article h1, h1"
	datePath           = regexp.MustCompile(`/\d{4}/\d{2}/\d{2}/`)
	seqChapterPath     = regexp.MustCompile(`(?i)chapter|arc|interlude|prologue|epilogue`)
	navSelectors       = []string{"#nav-below .nav-next a[rel='next']", "#nav-below .nav-next a", "a[rel='next']", ".post-navigation .nav-next a", ".site-navigation.post-navigation .nav-next a", ".nav-next a", ".navigation .next a"}
	slugDots           = regexp.MustCompile(`-(\d+)-(\d+)$`)
	slugSplit          = regexp.MustCompile(`[-_]+`)
	numberWord         = regexp.MustCompile(`^\d+(?:\.\d+)?$`)
)

const maxSequentialChapters = 2000

func (*Sequential) Name() string { return "sequential-next-link" }

func (*Sequential) CanHandle(u string) bool {
	s := urlsplit(u)
	if s.scheme != "http" && s.scheme != "https" {
		return false
	}
	return datePath.MatchString(s.path) || seqChapterPath.MatchString(strings.ToLower(s.path))
}

func (sq *Sequential) FetchMetadata(ctx context.Context, u string) (*Metadata, error) {
	start := NormalizeURL(u)
	doc, _, err := getDoc(ctx, start)
	if err != nil {
		return nil, err
	}
	title := metaContent(doc, "meta[property='og:site_name']")
	if title == "" {
		title = metaContent(doc, "meta[property='og:title']")
	}
	if title == "" {
		title = sq.chapterTitle(doc, start, nil)
	}
	if title == "" {
		title = "Untitled"
	}
	author := metaContent(doc, "meta[name='author']")
	if author == "" {
		author = stripEntities(textOf(first(doc.Selection, "[rel='author'], .author a, .byline a")))
	}
	return &Metadata{
		Title: title, Author: strOrNil(author),
		Description: strOrNil(metaContent(doc, "meta[name='description']")),
		CoverURL:    coverURL(doc), Status: "ongoing",
	}, nil
}

func (sq *Sequential) FetchChapterList(ctx context.Context, u string) ([]ChapterInfo, error) {
	start := NormalizeURL(u)
	host := bareHost(start)
	seen := map[string]bool{}
	var chapters []ChapterInfo
	current := NormalizeURL(start)
	for current != "" && !seen[current] && len(chapters) < maxSequentialChapters {
		seen[current] = true
		doc, _, err := getDoc(ctx, current)
		if err != nil {
			return nil, err
		}
		empty := ""
		title := sq.chapterTitle(doc, current, &empty)
		if title == "" {
			title = "Chapter " + strconv.Itoa(len(chapters)+1)
		}
		chapters = append(chapters, ChapterInfo{Number: len(chapters) + 1, Title: &title, SourceURL: current, PublishDate: dateFromURL(current)})
		next := sq.nextURL(doc, current, host)
		if next == "" || seen[next] {
			break
		}
		current = next
		if err := sleep(ctx); err != nil {
			return nil, err
		}
	}
	if len(chapters) == 0 {
		return nil, errors.New("Could not discover chapters by traversing next links")
	}
	return chapters, nil
}

func (sq *Sequential) resolveOnHost(current, href, host string) string {
	resolved := NormalizeURL(urljoin(current, href))
	if bareHost(resolved) == host {
		return resolved
	}
	return ""
}

func (sq *Sequential) nextURL(doc *goquery.Document, current, host string) string {
	type cand struct {
		href  string
		score int
	}
	var cands []cand
	push := func(href string, score int) {
		if href == "" {
			return
		}
		if r := sq.resolveOnHost(current, href, host); r != "" {
			cands = append(cands, cand{r, score})
		}
	}
	if l := doc.Find("link[rel='next']").First(); l.Length() > 0 {
		push(attr(l, "href"), 100)
	}
	for _, sel := range navSelectors {
		if el := doc.Find(sel).First(); el.Length() > 0 {
			push(attr(el, "href"), 90)
		}
	}
	doc.Find("a[href]").Each(func(_ int, a *goquery.Selection) {
		text := strings.ToLower(stripEntities(a.Text()))
		if text == "" {
			return
		}
		if strings.HasPrefix(text, "next") || strings.Contains(text, "next chapter") || strings.Contains(text, "next part") || strings.HasSuffix(text, "→") {
			push(attr(a, "href"), 70)
		}
	})
	if len(cands) == 0 {
		return ""
	}
	// Best score per URL, then the highest; ties go to the first seen.
	best := map[string]int{}
	var order []string
	for _, c := range cands {
		if prev, ok := best[c.href]; !ok {
			best[c.href] = c.score
			order = append(order, c.href)
		} else if c.score > prev {
			best[c.href] = c.score
		}
	}
	winner := order[0]
	for _, h := range order[1:] {
		if best[h] > best[winner] {
			winner = h
		}
	}
	return winner
}

// chapterTitle picks the page heading, og:title or <title> (whichever isn't
// just the story's name), else a title made from the URL slug.
func (sq *Sequential) chapterTitle(doc *goquery.Document, pageURL string, storyTitle *string) string {
	heading := stripEntities(textOf(first(doc.Selection, seqTitleSelector)))
	og := metaContent(doc, "meta[property='og:title']")
	docTitle := ""
	if t := first(doc.Selection, "title"); t != nil {
		docTitle = stripEntities(strings.SplitN(t.Text(), "|", 2)[0])
	}
	for _, c := range []string{heading, og, docTitle} {
		if c != "" && (storyTitle == nil || *storyTitle == "" || strings.ToLower(c) != strings.ToLower(*storyTitle)) {
			return c
		}
	}
	return titleFromSlug(pageURL)
}

func titleFromSlug(pageURL string) string {
	var parts []string
	for _, p := range strings.Split(urlsplit(pageURL).path, "/") {
		if p != "" {
			parts = append(parts, p)
		}
	}
	slug := "chapter"
	if len(parts) > 0 {
		slug = parts[len(parts)-1]
	}
	dotted := slugDots.ReplaceAllString(slug, "-$1.$2")
	var words []string
	for _, w := range slugSplit.Split(dotted, -1) {
		if w == "" {
			continue
		}
		if numberWord.MatchString(w) {
			words = append(words, w)
		} else {
			words = append(words, capitalize(w))
		}
	}
	return strings.Join(words, " ")
}

// capitalize is str.capitalize(): first letter upper, the rest lower.
func capitalize(s string) string {
	r := []rune(strings.ToLower(s))
	if len(r) > 0 {
		r[0] = []rune(strings.ToUpper(string(r[0])))[0]
	}
	return string(r)
}

func (sq *Sequential) FetchChapterContent(ctx context.Context, u string) (*ChapterContent, error) {
	doc, _, err := getDoc(ctx, u)
	if err != nil {
		return nil, err
	}
	if err := sleep(ctx); err != nil {
		return nil, err
	}
	story := metaContent(doc, "meta[property='og:site_name']")
	var storyPtr *string
	if story != "" {
		storyPtr = &story
	}
	title := sq.chapterTitle(doc, u, storyPtr)
	if title == "" {
		title = "Chapter"
	}
	body := first(doc.Selection, seqContentSelector)
	if body == nil {
		return nil, errNoContent
	}
	cleanWordpressContent(body, []string{"noscript", ".sharedaddy", ".jp-relatedposts"}, true)
	return content(wrapDiv(body), title), nil
}
