package scrapers

import (
	"context"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"golang.org/x/net/html"
)

// RoyalRoad scrapes royalroad.com.
type RoyalRoad struct{}

func (*RoyalRoad) Name() string { return "royalroad" }

func (*RoyalRoad) CanHandle(u string) bool {
	h := bareHost(u)
	return h == "royalroad.com" || h == "royalroadl.com"
}

// storyURL turns any fiction or chapter URL into the fiction page.
func (*RoyalRoad) storyURL(u string) string {
	s := urlsplit(u)
	var parts []string
	for _, p := range strings.Split(s.path, "/") {
		if p != "" {
			parts = append(parts, p)
		}
	}
	for i, p := range parts {
		if p != "fiction" {
			continue
		}
		if len(parts) >= i+2 {
			slug := ""
			if len(parts) > i+2 {
				slug = parts[i+2]
			}
			path := strings.TrimRight("/fiction/"+parts[i+1]+"/"+slug, "/")
			return s.scheme + "://" + s.netloc + path
		}
		break
	}
	return strings.TrimRight(u, "/")
}

func (rr *RoyalRoad) FetchMetadata(ctx context.Context, u string) (*Metadata, error) {
	doc, _, err := getDoc(ctx, rr.storyURL(u))
	if err != nil {
		return nil, err
	}
	title := stripEntities(textOf(first(doc.Selection, "div.fic-header div.col h1", "h1")))
	if title == "" {
		title = "Untitled"
	}
	m := &Metadata{
		Title:       title,
		Author:      strOrNil(stripEntities(textOf(first(doc.Selection, "div.fic-header h4 span a")))),
		Description: strOrNil(stripEntities(textOf(first(doc.Selection, "div.fiction-info div.description")))),
		Status:      "ongoing",
	}
	if img := first(doc.Selection, "img.thumbnail"); img != nil {
		m.CoverURL = strOrNil(attr(img, "src"))
	}
	return m, nil
}

func (rr *RoyalRoad) FetchChapterList(ctx context.Context, u string) ([]ChapterInfo, error) {
	story := rr.storyURL(u)
	doc, _, err := getDoc(ctx, story)
	if err != nil {
		return nil, err
	}
	var links []link
	doc.Find("table#chapters tr").Each(func(_ int, row *goquery.Selection) {
		a := row.Find("a[href*='/chapter/']").First()
		if a.Length() == 0 {
			return
		}
		l := link{href: attr(a, "href"), text: stripEntities(a.Text())}
		if t := row.Find("time[datetime]").First(); t.Length() > 0 {
			l.date = parseISOWall(attr(t, "datetime"))
		}
		links = append(links, l)
	})
	return normalizeChapterList(story, links), nil
}

// parseISOWall parses an ISO 8601 time and keeps its wall clock (the Python
// backend stored aware times without converting them).
func parseISOWall(s string) *time.Time {
	s = strings.Replace(strings.TrimSpace(s), "Z", "+00:00", 1)
	for _, layout := range []string{"2006-01-02T15:04:05.999999999-07:00", "2006-01-02T15:04:05-07:00", "2006-01-02T15:04:05.999999999", "2006-01-02T15:04-07:00", "2006-01-02T15:04", "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			w := time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond()/1000*1000, time.UTC)
			return &w
		}
	}
	return nil
}

var (
	hidingDeclaration = regexp.MustCompile(`(?i)display\s*:\s*none|visibility\s*:\s*hidden|speak\s*:\s*never`)
	classRule         = regexp.MustCompile(`([^{}]+)\{([^}]*)\}`)
	className         = regexp.MustCompile(`\.([A-Za-z_][\w-]*)`)
	inlineHidden      = regexp.MustCompile(`(?i)display\s*:\s*none`)
	noticeText        = regexp.MustCompile(`(?i)\bamazon\b|royal\s*road|stolen|unauthori[sz]ed|without (?:the author'?s? )?(?:consent|permission|approval)|original (?:site|source|website)|(?:different|another) website|genuine (?:story|version)`)
	cnClass           = regexp.MustCompile(`^cn[A-Z][A-Za-z0-9]{41}$`)
	borderStyle       = regexp.MustCompile(`(?i)border(-left|-right|-inline-start|-inline-end)?\s*:[^;]+;?`)
	outlineStyle      = regexp.MustCompile(`(?i)outline\s*:[^;]+;?`)
	shadowStyle       = regexp.MustCompile(`(?i)box-shadow\s*:[^;]+;?`)
	multiSpace        = regexp.MustCompile(`\s{2,}`)
)

const noticeMaxChars = 250

// randomNoticeClass is RoyalRoad's random notice class: "c" + 40 or more
// letters and digits, not starting "cn" (paragraph classes do).
func randomNoticeClass(c string) bool {
	if len(c) < 41 || c[0] != 'c' || c[1] == 'n' {
		return false
	}
	for _, r := range c[1:] {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

func classes(n *html.Node) []string {
	for _, a := range n.Attr {
		if a.Key == "class" {
			return strings.Fields(a.Val)
		}
	}
	return nil
}

func getAttr(n *html.Node, key string) (string, bool) {
	for _, a := range n.Attr {
		if a.Key == key {
			return a.Val, true
		}
	}
	return "", false
}

func setAttr(n *html.Node, key, val string) {
	for i, a := range n.Attr {
		if a.Key == key {
			n.Attr[i].Val = val
			return
		}
	}
	n.Attr = append(n.Attr, html.Attribute{Key: key, Val: val})
}

func delAttr(n *html.Node, key string) {
	out := n.Attr[:0]
	for _, a := range n.Attr {
		if a.Key != key {
			out = append(out, a)
		}
	}
	n.Attr = out
}

func remove(n *html.Node) {
	if n.Parent != nil {
		n.Parent.RemoveChild(n)
	}
}

// attachedTo reports whether n is still in the tree under root.
func attachedTo(n, root *html.Node) bool {
	for p := n; p != nil; p = p.Parent {
		if p == root {
			return true
		}
	}
	return false
}

// hiddenClasses are classes the page's own <style> rules hide.
func hiddenClasses(doc *goquery.Document) map[string]bool {
	hidden := map[string]bool{}
	doc.Find("style").Each(func(_ int, st *goquery.Selection) {
		for _, m := range classRule.FindAllStringSubmatch(st.Text(), -1) {
			if hidingDeclaration.MatchString(m[2]) {
				for _, c := range className.FindAllStringSubmatch(m[1], -1) {
					hidden[c[1]] = true
				}
			}
		}
	})
	return hidden
}

// removeHiddenElements drops elements hidden by the page's CSS or an inline
// display:none, as a browser would hide them.
func removeHiddenElements(doc *goquery.Document) {
	hidden := hiddenClasses(doc)
	root := doc.Nodes[0]
	for _, n := range doc.Find("*").Nodes {
		if !attachedTo(n, root) {
			continue
		}
		hide := false
		for _, c := range classes(n) {
			if hidden[c] {
				hide = true
			}
		}
		if style, _ := getAttr(n, "style"); inlineHidden.MatchString(style) {
			hide = true
		}
		if hide {
			remove(n)
		}
	}
}

// textStripped is get_text(" ", strip=True).
func textStripped(n *html.Node) string {
	var parts []string
	var walk func(*html.Node)
	walk = func(x *html.Node) {
		if x.Type == html.TextNode {
			if t := pyStrip(x.Data); t != "" {
				parts = append(parts, t)
			}
		}
		for c := x.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return strings.Join(parts, " ")
}

// stripAntipiracyNotices removes RoyalRoad's anti-piracy sentence: a short
// bare <span> directly inside the chapter body that carries a random notice
// class or reads like a notice.
func stripAntipiracyNotices(container *goquery.Selection) int {
	removed := 0
	container.Find("div.chapter-inner").Each(func(_ int, body *goquery.Selection) {
		for c := body.Nodes[0].FirstChild; c != nil; {
			next := c.NextSibling
			if c.Type == html.ElementNode && c.Data == "span" {
				text := textStripped(c)
				if text != "" && len([]rune(text)) <= noticeMaxChars {
					isNotice := noticeText.MatchString(text)
					for _, cl := range classes(c) {
						if randomNoticeClass(cl) {
							isNotice = true
						}
					}
					if isNotice {
						remove(c)
						removed++
					}
				}
			}
			c = next
		}
	})
	return removed
}

func (rr *RoyalRoad) FetchChapterContent(ctx context.Context, u string) (*ChapterContent, error) {
	doc, _, err := getDoc(ctx, u)
	if err != nil {
		return nil, err
	}
	if err := sleep(ctx); err != nil {
		return nil, err
	}
	title := stripEntities(textOf(first(doc.Selection, "h1", "h2")))
	if title == "" {
		title = "Chapter"
	}

	// Must run before <style> tags are stripped: the hiding rules live there.
	removeHiddenElements(doc)
	doc.Find("img").Each(func(_ int, img *goquery.Selection) {
		if pyStrip(attr(img, "src")) == "" {
			img.Remove()
		}
	})
	doc.Find("p").Each(func(_ int, p *goquery.Selection) {
		n := p.Nodes[0]
		var kept []string
		for _, c := range classes(n) {
			if !cnClass.MatchString(c) {
				kept = append(kept, c)
			}
		}
		if len(kept) == 0 {
			delAttr(n, "class")
		} else {
			setAttr(n, "class", strings.Join(kept, " "))
		}
	})

	var container *goquery.Selection
	doc.Find("div.portlet-body").EachWithBreak(func(_ int, p *goquery.Selection) bool {
		if p.Find("div.chapter-inner").Length() > 0 {
			container = p
			return false
		}
		return true
	})
	if container == nil {
		if w := doc.Find(".page-content-wrapper").First(); w.Length() > 0 {
			container = w
		}
	}
	if container == nil {
		return content("<div></div>", title), nil
	}
	for _, sel := range []string{"script", "style", "nav", ".btn", ".chapter-nav"} {
		container.Find(sel).Remove()
	}
	container.Find("a[href*='royalroadl.com'], a[href*='royalroad.com']").Each(func(_ int, a *goquery.Selection) {
		txt := strings.ToLower(a.Text())
		if strings.Contains(txt, "next") || strings.Contains(txt, "previous") {
			a.Remove()
		}
	})
	rr.removeAdBlocks(container)
	rr.keepWantedTopLevel(container)
	container.Find("[style]").Each(func(_ int, el *goquery.Selection) {
		n := el.Nodes[0]
		style, _ := getAttr(n, "style")
		style = borderStyle.ReplaceAllString(style, "")
		style = outlineStyle.ReplaceAllString(style, "")
		style = shadowStyle.ReplaceAllString(style, "")
		style = pyStrip(multiSpace.ReplaceAllString(style, " "))
		if style != "" {
			setAttr(n, "style", style)
		} else {
			delAttr(n, "style")
		}
	})
	stripAntipiracyNotices(container)
	return content(wrapDiv(container), title), nil
}

func prevElement(n *html.Node) *html.Node {
	for p := n.PrevSibling; p != nil; p = p.PrevSibling {
		if p.Type == html.ElementNode {
			return p
		}
	}
	return nil
}

func nextElement(n *html.Node) *html.Node {
	for p := n.NextSibling; p != nil; p = p.NextSibling {
		if p.Type == html.ElementNode {
			return p
		}
	}
	return nil
}

func (*RoyalRoad) removeAdBlocks(container *goquery.Selection) {
	container.Find("div.portlet").Each(func(_ int, portlet *goquery.Selection) {
		text := strings.ToLower(pyStrip(portlet.Text()))
		hasAdID := portlet.Find("[id^='Chapter_'], [id^='chapter_']").Length() > 0
		if text == "advertisement" || strings.HasPrefix(text, "advertisement") || hasAdID {
			n := portlet.Nodes[0]
			if p := prevElement(n); p != nil && p.Data == "hr" {
				remove(p)
			}
			if nx := nextElement(n); nx != nil && nx.Data == "hr" {
				remove(nx)
			}
			remove(n)
		}
	})
}

func (*RoyalRoad) keepWantedTopLevel(container *goquery.Selection) {
	n := container.Nodes[0]
	for c := n.FirstChild; c != nil; {
		next := c.NextSibling
		if c.Type == html.ElementNode {
			cls := strings.Join(classes(c), " ")
			wanted := c.Data == "h1" || (c.Data == "div" && (strings.HasPrefix(cls, "chapter-inner") ||
				strings.Contains(cls, "author-note-portlet") || strings.Contains(cls, "page-content")))
			if !wanted {
				remove(c)
			}
		}
		c = next
	}
}
