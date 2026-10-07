package epub

import (
	"archive/zip"
	"bytes"
	"fmt"
	"mime"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"golang.org/x/net/html"
)

// VolumeChapter is one chapter of a serial volume.
type VolumeChapter struct {
	Number int
	Title  string
	HTML   string
}

// VolumeImage is an image embedded in a volume (downloaded from a chapter).
type VolumeImage struct {
	URL       string
	FileName  string // images/img_0000_<hash>.jpg
	MediaType string
	Data      []byte
}

// Volume is what a serial volume EPUB is built from.
type Volume struct {
	Identifier  string // without the urn:shelfloom: prefix
	Title       string
	Author      string
	Description string
	CoverPath   string // optional
	Chapters    []VolumeChapter
	Images      []VolumeImage
}

var (
	slugDrop  = regexp.MustCompile(`[^\p{L}\p{N}_\s-]`)
	slugJoin  = regexp.MustCompile(`[\s_-]+`)
	pySpaceRE = regexp.MustCompile(`[\v\x1c-\x1f\x85\x{a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}]`)
)

// Slugify turns a title into a file name stem (at most 80 characters), as
// the Python backend's _slugify did.
func Slugify(text string) string {
	text = strings.ToLower(text)
	text = pySpaceRE.ReplaceAllString(text, " ")
	text = slugDrop.ReplaceAllString(text, "")
	text = slugJoin.ReplaceAllString(text, "-")
	text = strings.Trim(text, "-")
	if r := []rune(text); len(r) > 80 {
		text = string(r[:80])
	}
	if text == "" {
		return "untitled"
	}
	return text
}

func xmlEscape(s string) string {
	return xmlTextEscaper.Replace(s)
}

func attrEscape(s string) string {
	return xmlAttrEscaper.Replace(s)
}

// chapterXHTML is a chapter file as ebooklib writes it: the title as an
// <h1> above the cleaned chapter HTML, re-serialised as XHTML.
func chapterXHTML(title, body string) string {
	content := []byte("<h1>" + title + "</h1>\n" + body)
	doc := parseHTMLDoc(content)
	var b strings.Builder
	b.WriteString(`<?xml version='1.0' encoding='utf-8'?>` + "\n" + `<!DOCTYPE html>` + "\n" +
		`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" epub:prefix="z3998: http://www.daisy.org/z3998/2012/vocab/structure/#" lang="en" xml:lang="en">` + "\n")
	b.WriteString("  <head>\n    <title>" + xmlEscape(title) + "</title>\n  </head>\n")
	var children []*html.Node
	if doc != nil {
		dropBlanks(doc.Node)
		if bodyEl := doc.find("body"); bodyEl != nil {
			started := false
			for c := bodyEl.FirstChild; c != nil; c = c.NextSibling {
				if !started && c.Type == html.TextNode {
					continue
				}
				started = true
				children = append(children, c)
			}
		}
	}
	if len(children) == 0 {
		b.WriteString("  <body/>\n</html>\n")
		return b.String()
	}
	format := true
	for _, c := range children {
		if c.Type == html.TextNode {
			format = false
		}
	}
	b.WriteString("  <body>")
	writeChildren(&b, children, 2, format)
	if format {
		b.WriteString("  ")
	}
	b.WriteString("</body>\n</html>\n")
	return b.String()
}

var stripTags = map[string]bool{"script": true, "style": true, "nav": true}

// cleanChapterHTML drops <script>, <style> and <nav> from chapter HTML.
func cleanChapterHTML(raw string) string {
	nodes, err := html.ParseFragment(strings.NewReader(raw), &html.Node{Type: html.ElementNode, Data: "body", DataAtom: 0x2})
	if err != nil {
		return raw
	}
	var b bytes.Buffer
	var prune func(n *html.Node)
	prune = func(n *html.Node) {
		for c := n.FirstChild; c != nil; {
			next := c.NextSibling
			if c.Type == html.ElementNode && stripTags[c.Data] {
				n.RemoveChild(c)
			} else {
				prune(c)
			}
			c = next
		}
	}
	for _, n := range nodes {
		if n.Type == html.ElementNode && stripTags[n.Data] {
			continue
		}
		prune(n)
		html.Render(&b, n)
	}
	return b.String()
}

// ImageURLs lists the external images a chapter's HTML refers to.
func ImageURLs(chapterHTML string) []string {
	nodes, err := html.ParseFragment(strings.NewReader(chapterHTML), &html.Node{Type: html.ElementNode, Data: "body", DataAtom: 0x2})
	if err != nil {
		return nil
	}
	var out []string
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "img" {
			for _, a := range n.Attr {
				if a.Key == "src" && (strings.HasPrefix(a.Val, "http://") || strings.HasPrefix(a.Val, "https://")) {
					out = append(out, a.Val)
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	for _, n := range nodes {
		walk(n)
	}
	return out
}

var mediaTypes = []struct{ ext, mt string }{
	{".jpg", "image/jpeg"}, {".jpeg", "image/jpeg"}, {".png", "image/png"}, {".gif", "image/gif"},
	{".svg", "image/svg+xml"}, {".webp", "image/webp"}, {".bmp", "image/bmp"}, {".ico", "image/x-icon"},
}

// ImageMediaType guesses an image's type from its Content-Type or URL.
func ImageMediaType(url, contentType string) string {
	if contentType != "" {
		ct := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
		if strings.HasPrefix(ct, "image/") {
			return ct
		}
	}
	p := strings.ToLower(urlPath(url))
	for _, m := range mediaTypes {
		if strings.HasSuffix(p, m.ext) {
			return m.mt
		}
	}
	return "image/jpeg"
}

// ImageFileName names a downloaded image inside the EPUB.
func ImageFileName(url string, index int, md5hex string) string {
	p := strings.ToLower(urlPath(url))
	ext := ".jpg"
	for _, m := range mediaTypes {
		if strings.HasSuffix(p, m.ext) {
			ext = m.ext
			break
		}
	}
	return fmt.Sprintf("images/img_%04d_%s%s", index, md5hex[:10], ext)
}

func urlPath(u string) string {
	if i := strings.Index(u, "://"); i >= 0 {
		u = u[i+3:]
		if j := strings.IndexByte(u, '/'); j >= 0 {
			u = u[j:]
		} else {
			u = ""
		}
	}
	if i := strings.IndexAny(u, "?#"); i >= 0 {
		u = u[:i]
	}
	if i := strings.IndexByte(u, ';'); i >= 0 {
		u = u[:i]
	}
	return u
}

func guessType(name string) string {
	if t := mime.TypeByExtension(strings.ToLower(path.Ext(name))); t != "" {
		return strings.SplitN(t, ";", 2)[0]
	}
	return "application/octet-stream"
}

// BuildVolume writes the volume EPUB into dir and returns its path.
func BuildVolume(v Volume, dir string) (string, error) {
	identifier := ShelfloomURNPrefix + v.Identifier
	type item struct {
		href, id, mediaType, props string
		data                       []byte
	}
	var items []item
	hasCover := false
	if v.CoverPath != "" {
		if data, err := os.ReadFile(v.CoverPath); err == nil {
			name := "cover" + strings.ToLower(filepath.Ext(v.CoverPath))
			items = append(items, item{href: name, id: "cover-img", mediaType: guessType(name), props: "cover-image", data: data})
			hasCover = true
		}
	}
	for i, img := range v.Images {
		items = append(items, item{href: img.FileName, id: fmt.Sprintf("image_%d", i), mediaType: img.MediaType, data: img.Data})
	}
	var navItems, ncxPoints strings.Builder
	for i, ch := range v.Chapters {
		fileName := fmt.Sprintf("chapter_%04d.xhtml", ch.Number)
		title := ch.Title
		if title == "" {
			title = fmt.Sprintf("Chapter %d", ch.Number)
		}
		body := cleanChapterHTML(ch.HTML)
		for _, img := range v.Images {
			body = strings.ReplaceAll(body, img.URL, img.FileName)
		}
		items = append(items, item{href: fileName, id: fmt.Sprintf("chapter_%d", i), mediaType: "application/xhtml+xml", data: []byte(chapterXHTML(title, body))})
		navItems.WriteString("        <li>\n          <a href=\"" + attrEscape(fileName) + "\">" + xmlEscape(title) + "</a>\n        </li>\n")
		ncxPoints.WriteString(fmt.Sprintf("    <navPoint id=\"chapter-%d\">\n      <navLabel>\n        <text>%s</text>\n      </navLabel>\n      <content src=\"%s\"/>\n    </navPoint>\n", ch.Number, xmlEscape(title), attrEscape(fileName)))
	}

	ncx := `<?xml version='1.0' encoding='utf-8'?>` + "\n" +
		`<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">` + "\n" +
		"  <head>\n" +
		`    <meta content="` + attrEscape(identifier) + `" name="dtb:uid"/>` + "\n" +
		`    <meta content="0" name="dtb:depth"/>` + "\n" +
		`    <meta content="0" name="dtb:totalPageCount"/>` + "\n" +
		`    <meta content="0" name="dtb:maxPageNumber"/>` + "\n" +
		"  </head>\n  <docTitle>\n    <text>" + xmlEscape(v.Title) + "</text>\n  </docTitle>\n" +
		"  <navMap>\n" + ncxPoints.String() + "  </navMap>\n</ncx>\n"
	nav := `<?xml version='1.0' encoding='utf-8'?>` + "\n<!DOCTYPE html>\n" +
		`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">` + "\n" +
		"  <head>\n    <title>" + xmlEscape(v.Title) + "</title>\n  </head>\n  <body>\n" +
		`    <nav epub:type="toc" id="id" role="doc-toc">` + "\n      <h2>" + xmlEscape(v.Title) + "</h2>\n      <ol>\n" +
		navItems.String() + "      </ol>\n    </nav>\n  </body>\n</html>\n"
	items = append(items,
		item{href: "toc.ncx", id: "ncx", mediaType: "application/x-dtbncx+xml", data: []byte(ncx)},
		item{href: "nav.xhtml", id: "nav", mediaType: "application/xhtml+xml", props: "nav", data: []byte(nav)})

	var opf strings.Builder
	opf.WriteString(`<?xml version='1.0' encoding='utf-8'?>` + "\n")
	opf.WriteString(`<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0" prefix="rendition: http://www.idpf.org/vocab/rendition/#">` + "\n")
	opf.WriteString(`  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">` + "\n")
	opf.WriteString(`    <meta property="dcterms:modified">` + time.Now().Format("2006-01-02T15:04:05") + "Z</meta>\n")
	opf.WriteString(`    <meta name="generator" content="Ebook-lib 0.20.0"/>` + "\n")
	opf.WriteString(`    <dc:identifier id="id">` + xmlEscape(identifier) + "</dc:identifier>\n")
	opf.WriteString("    <dc:title>" + xmlEscape(v.Title) + "</dc:title>\n")
	opf.WriteString("    <dc:language>en</dc:language>\n")
	opf.WriteString(`    <dc:creator id="creator">` + xmlEscape(v.Author) + "</dc:creator>\n")
	if v.Description != "" {
		opf.WriteString("    <dc:description>" + xmlEscape(v.Description) + "</dc:description>\n")
	}
	opf.WriteString("    <dc:publisher>Shelfloom</dc:publisher>\n")
	if hasCover {
		opf.WriteString(`    <meta name="cover" content="cover-img"></meta>` + "\n")
	}
	opf.WriteString("  </metadata>\n  <manifest>\n")
	for _, it := range items {
		opf.WriteString(`    <item href="` + attrEscape(it.href) + `" id="` + it.id + `" media-type="` + it.mediaType + `"`)
		if it.props != "" {
			opf.WriteString(` properties="` + it.props + `"`)
		}
		opf.WriteString("/>\n")
	}
	opf.WriteString("  </manifest>\n  <spine toc=\"ncx\">\n    <itemref idref=\"nav\"/>\n")
	for i := range v.Chapters {
		opf.WriteString(fmt.Sprintf("    <itemref idref=\"chapter_%d\"/>\n", i))
	}
	opf.WriteString("  </spine>\n</package>\n")

	out := filepath.Join(dir, Slugify(v.Title)+".epub")
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	now := time.Now()
	write := func(name string, data []byte, method uint16) error {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: method, Modified: now})
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	}
	if err := write("mimetype", []byte("application/epub+zip"), zip.Store); err != nil {
		return "", err
	}
	container := `<?xml version="1.0" encoding="utf-8"?>` + "\n" +
		`<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">` + "\n" +
		"  <rootfiles>\n" + `    <rootfile media-type="application/oebps-package+xml" full-path="EPUB/content.opf"/>` + "\n" +
		"  </rootfiles>\n</container>\n"
	if err := write("META-INF/container.xml", []byte(container), zip.Deflate); err != nil {
		return "", err
	}
	if err := write("EPUB/content.opf", []byte(opf.String()), zip.Deflate); err != nil {
		return "", err
	}
	for _, it := range items {
		if err := write("EPUB/"+it.href, it.data, zip.Deflate); err != nil {
			return "", err
		}
	}
	if err := zw.Close(); err != nil {
		return "", err
	}
	if err := os.WriteFile(out, buf.Bytes(), 0o644); err != nil {
		return "", err
	}
	return out, nil
}
