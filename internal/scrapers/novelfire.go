package scrapers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/PuerkitoBio/goquery"
)

// NovelFire scrapes novelfire.net.
type NovelFire struct{}

func (*NovelFire) Name() string { return "novelfire" }

func (*NovelFire) CanHandle(u string) bool { return bareHost(u) == "novelfire.net" }

func (*NovelFire) storyRoot(u string) string {
	if strings.HasSuffix(u, "/chapters") {
		return u[:len(u)-9]
	}
	return strings.TrimRight(u, "/")
}

func (nf *NovelFire) FetchMetadata(ctx context.Context, u string) (*Metadata, error) {
	doc, _, err := getDoc(ctx, nf.storyRoot(u)+"/chapters")
	if err != nil {
		return nil, err
	}
	title := stripEntities(textOf(first(doc.Selection, "div.novel-info h1", "h1")))
	if title == "" {
		title = "Untitled"
	}
	return &Metadata{
		Title:       title,
		Author:      strOrNil(stripEntities(textOf(first(doc.Selection, "span[itemprop='author']")))),
		Description: strOrNil(metaContent(doc, "meta[name='description']")),
		CoverURL:    coverURL(doc),
		Status:      "ongoing",
	}, nil
}

func (nf *NovelFire) FetchChapterList(ctx context.Context, u string) ([]ChapterInfo, error) {
	root := nf.storyRoot(u)
	listing := root + "/chapters"
	doc, body, err := getDoc(ctx, listing)
	if err != nil {
		return nil, err
	}
	ajax := nf.ajaxEndpoint(string(body))
	htmlChapters, err := nf.htmlChapters(ctx, listing, root, doc)
	if err != nil {
		return nil, err
	}
	if ajax == "" {
		return htmlChapters, nil
	}
	ajaxChapters := nf.ajaxChapters(ctx, ajax, root)
	if len(ajaxChapters) >= len(htmlChapters) {
		return ajaxChapters, nil
	}
	return htmlChapters, nil
}

func (*NovelFire) ajaxChapters(ctx context.Context, endpoint, root string) []ChapterInfo {
	const pageSize = 100
	type row map[string]any
	var rows []row
	seen := map[string]bool{}
	for start := 0; ; start += pageSize {
		pageURL := fmt.Sprintf("%s&draw=1&start=%d&length=%d&order%%5B0%%5D%%5Bcolumn%%5D=2&order%%5B0%%5D%%5Bdir%%5D=asc", endpoint, start, pageSize)
		body, err := get(ctx, pageURL)
		if err != nil {
			break
		}
		var payload any
		dec := json.NewDecoder(bytes.NewReader(body))
		dec.UseNumber()
		if dec.Decode(&payload) != nil {
			break
		}
		obj, isObj := payload.(map[string]any)
		var page []any
		if isObj {
			page, _ = obj["data"].([]any)
		}
		if len(page) == 0 {
			break
		}
		for i, item := range page {
			r, _ := item.(map[string]any)
			key := pyStr(r["n_sort"])
			if !truthy(r["n_sort"]) {
				key = pyStr(r["title"])
				if !truthy(r["title"]) {
					key = fmt.Sprintf("row-%d-%d", start, i)
				}
			}
			if !seen[key] {
				seen[key] = true
				rows = append(rows, row(r))
			}
		}
		total := 0
		if truthy(obj["recordsTotal"]) {
			total = pyInt(obj["recordsTotal"])
		} else if truthy(obj["recordsFiltered"]) {
			total = pyInt(obj["recordsFiltered"])
		}
		if total > 0 {
			if len(rows) >= total {
				break
			}
		} else if len(page) < pageSize {
			break
		}
	}
	var out []ChapterInfo
	for i, r := range rows {
		title := ""
		if t, has := r["title"]; has && t != nil {
			title = stripEntities(pyStr(t))
		}
		n := fmt.Sprint(i + 1)
		if v, has := r["n_sort"]; has {
			n = pyStr(v)
		}
		out = append(out, ChapterInfo{Number: i + 1, Title: &title, SourceURL: root + "/chapter-" + n})
	}
	return out
}

// pyStr is str() of a decoded JSON value.
func pyStr(v any) string {
	switch x := v.(type) {
	case nil:
		return "None"
	case string:
		return x
	case json.Number:
		return x.String()
	case bool:
		if x {
			return "True"
		}
		return "False"
	}
	return fmt.Sprint(v)
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case string:
		return x != ""
	case json.Number:
		f, _ := x.Float64()
		return f != 0
	case bool:
		return x
	case []any:
		return len(x) > 0
	case map[string]any:
		return len(x) > 0
	}
	return true
}

func pyInt(v any) int {
	switch x := v.(type) {
	case json.Number:
		n, _ := x.Int64()
		return int(n)
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(x))
		return n
	}
	return 0
}

func (nf *NovelFire) htmlChapters(ctx context.Context, listing, root string, first *goquery.Document) ([]ChapterInfo, error) {
	links := nf.htmlChapterPage(first)
	for _, pageURL := range nf.tocPageURLs(first, listing) {
		doc, _, err := getDoc(ctx, pageURL)
		if err != nil {
			return nil, err
		}
		links = append(links, nf.htmlChapterPage(doc)...)
		if err := sleep(ctx); err != nil {
			return nil, err
		}
	}
	return normalizeChapterList(root, links), nil
}

func (*NovelFire) htmlChapterPage(doc *goquery.Document) []link {
	var links []link
	doc.Find("ul.chapter-list a").Each(func(_ int, a *goquery.Selection) {
		t := a.Find(".chapter-title").First()
		if t.Length() == 0 {
			t = a
		}
		links = append(links, link{href: attr(a, "href"), text: stripEntities(t.Text())})
	})
	return links
}

func (*NovelFire) tocPageURLs(doc *goquery.Document, listing string) []string {
	maxPage := 0
	doc.Find("ul.pagination li a").Each(func(_ int, a *goquery.Selection) {
		href := attr(a, "href")
		if href == "" {
			return
		}
		abs := urljoin(listing, href)
		q, err := url.ParseQuery(urlsplit(abs).query)
		if err != nil {
			return
		}
		page := q.Get("page")
		if page == "" || strings.Trim(page, "0123456789") != "" {
			return
		}
		if n, err := strconv.Atoi(page); err == nil && n > 1 {
			maxPage = max(maxPage, n)
		}
	})
	if maxPage == 0 {
		return nil
	}
	base := urlsplit(listing)
	var out []string
	for page := 2; page <= maxPage; page++ {
		params, _ := url.ParseQuery(base.query)
		keys := make([]string, 0, len(params))
		for k := range params {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		var parts []string
		for _, k := range keys {
			if k == "page" {
				continue
			}
			parts = append(parts, url.QueryEscape(k)+"="+url.QueryEscape(params[k][0]))
		}
		parts = append(parts, "page="+strconv.Itoa(page))
		s := base
		s.query = strings.Join(parts, "&")
		s.fragment = ""
		out = append(out, s.String())
	}
	return out
}

var (
	ajaxFragment = regexp.MustCompile(`^(/listChapterDataAjax[^"']+)`)
	ajaxHost     = regexp.MustCompile(`https?://([^"'\s]+)/`)
)

func (*NovelFire) ajaxEndpoint(page string) string {
	idx := strings.Index(page, "/listChapterDataAjax")
	if idx < 0 {
		return ""
	}
	frag := ajaxFragment.FindStringSubmatch(page[idx:])
	if frag == nil {
		return ""
	}
	host := ajaxHost.FindStringSubmatch(page)
	if host == nil {
		return ""
	}
	return "https://" + host[1] + frag[1]
}

func (nf *NovelFire) FetchChapterContent(ctx context.Context, u string) (*ChapterContent, error) {
	doc, _, err := getDoc(ctx, u)
	if err != nil {
		return nil, err
	}
	if err := sleep(ctx); err != nil {
		return nil, err
	}
	title := stripEntities(textOf(first(doc.Selection, "span.chapter-title", "h1")))
	if title == "" {
		title = "Chapter"
	}
	body := first(doc.Selection, "div.chapter-content", "div#content")
	if body == nil {
		return content("<div></div>", title), nil
	}
	for _, sel := range []string{"script", "style", ".ads", ".advertisement"} {
		body.Find(sel).Remove()
	}
	// Watermark paragraphs carry a class; story paragraphs don't.
	body.Find("p").Each(func(_ int, p *goquery.Selection) {
		if len(classes(p.Nodes[0])) > 0 {
			p.Remove()
		}
	})
	root := body.Nodes[0]
	body.Find("strong strong").Each(func(_ int, s *goquery.Selection) {
		if n := s.Nodes[0]; attachedTo(n, root) && n.Parent != nil && n.Parent != root {
			remove(n.Parent)
		}
	})
	emptied := false
	body.Find("div > dl > dt").Each(func(_ int, dt *goquery.Selection) {
		n := dt.Nodes[0]
		if emptied || !attachedTo(n, root) {
			return
		}
		if dl := n.Parent; dl != nil && dl.Parent != nil {
			if dl.Parent == root {
				// The content div itself goes, as BeautifulSoup decomposed it.
				emptied = true
				return
			}
			remove(dl.Parent)
		}
	})
	if emptied {
		return content("<div></div>", title), nil
	}
	return content(wrapDiv(body), title), nil
}
