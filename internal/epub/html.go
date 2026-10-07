package epub

import (
	"bytes"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

type htmlNode struct{ *html.Node }

var voidElements = map[string]bool{
	"area": true, "base": true, "br": true, "col": true, "embed": true, "hr": true, "img": true,
	"input": true, "link": true, "meta": true, "param": true, "source": true, "track": true, "wbr": true,
	"basefont": true, "frame": true, "isindex": true,
}

func isTagChar(c byte) bool {
	return c == ':' || c == '.' || c == '-' || c == '_' || (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c >= 0x80
}

// expandSelfClosing turns <script …/> into <script …></script>. EPUB
// documents are XHTML, and libxml2's HTML parser (which ebooklib used)
// honours "/>" where an HTML5 parser would leave the element open.
func expandSelfClosing(data []byte) []byte {
	var out []byte // nil until something changes
	last := 0
	for i := 0; i < len(data); i++ {
		if data[i] != '<' || i+1 >= len(data) {
			continue
		}
		c := data[i+1]
		if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
			continue
		}
		j := i + 1
		for j < len(data) && isTagChar(data[j]) {
			j++
		}
		name := data[i+1 : j]
		// Find the end of the tag, skipping quoted attribute values.
		k, quote := j, byte(0)
		for k < len(data) {
			ch := data[k]
			if quote != 0 {
				if ch == quote {
					quote = 0
				}
			} else if ch == '"' || ch == '\'' {
				quote = ch
			} else if ch == '>' || ch == '<' {
				break
			}
			k++
		}
		if k >= len(data) || data[k] != '>' {
			continue
		}
		if data[k-1] == '/' && !voidElements[strings.ToLower(string(name))] {
			end := k - 1
			for end > j && (data[end-1] == ' ' || data[end-1] == '\t' || data[end-1] == '\n' || data[end-1] == '\r') {
				end--
			}
			if out == nil {
				out = make([]byte, 0, len(data)+64)
			}
			out = append(out, data[last:end]...)
			out = append(out, '>', '<', '/')
			out = append(out, name...)
			out = append(out, '>')
			last = k + 1
		}
		i = k
	}
	if out == nil {
		return data
	}
	return append(out, data[last:]...)
}

// parseHTMLDoc parses an (X)HTML document; nil when it is empty, as lxml's
// document_fromstring refuses empty input.
func parseHTMLDoc(data []byte) *htmlNode {
	if len(bytes.TrimSpace(data)) == 0 {
		return nil
	}
	doc, err := html.Parse(bytes.NewReader(expandSelfClosing(data)))
	if err != nil {
		return nil
	}
	return &htmlNode{doc}
}

func (n *htmlNode) isElement(tag string) bool {
	return n.Type == html.ElementNode && n.Data == tag
}

// walk visits nodes depth first until fn returns false.
func (n *htmlNode) walk(fn func(*htmlNode) bool) bool {
	if !fn(n) {
		return false
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if !(&htmlNode{c}).walk(fn) {
			return false
		}
	}
	return true
}

func (n *htmlNode) firstChild(tag string) *htmlNode {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode && c.Data == tag {
			return &htmlNode{c}
		}
	}
	return nil
}

func (n *htmlNode) find(tag string) *htmlNode {
	var out *htmlNode
	n.walk(func(x *htmlNode) bool {
		if x.isElement(tag) {
			out = x
			return false
		}
		return true
	})
	return out
}

// chapterTemplateHead and Tail are what ebooklib's EpubHtml.get_content()
// wraps a document's body in (book language "en", no title, metas or links).
const (
	chapterTemplateHead = `<?xml version='1.0' encoding='utf-8'?>` + "\n" + `<!DOCTYPE html>` + "\n" +
		`<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" epub:prefix="z3998: http://www.daisy.org/z3998/2012/vocab/structure/#" lang="en" xml:lang="en">` + "\n" +
		`  <head/>` + "\n"
	coverHTMLLength = 331
)

// documentLength estimates len(EpubHtml.get_content()): the document's body
// children re-serialised as XML inside ebooklib's chapter template. ebooklib
// sums these to estimate a book's page count, so the estimate should land
// within a page or two of it.
func DocumentLength(content []byte) int {
	return len(DocumentXML(content))
}

// crMark stands in for a carriage return while parsing: libxml2 keeps "\r"
// (and writes it as &#13;), an HTML5 parser normalises it away.
const crMark = "\uE000"

var endBody = regexp.MustCompile(`(?i)</body\s*>`)

// DocumentXML is the re-serialised document DocumentLength measures.
func DocumentXML(content []byte) string {
	if locs := endBody.FindAllIndex(content, -1); len(locs) > 0 {
		// Text after </body> would land inside the body in an HTML5 parser.
		last := locs[len(locs)-1]
		content = append(append([]byte{}, content[:last[0]]...), "</body></html>"...)
	}
	doc := parseHTMLDoc(content)
	if doc == nil {
		return ""
	}
	if !bytes.Contains(bytes.ToLower(content), []byte("<tbody")) {
		unwrapImplied(doc.Node, "tbody")
	}
	dropBlanks(doc.Node)
	body := doc.find("body")
	var b strings.Builder
	b.WriteString(chapterTemplateHead)
	var children []*html.Node
	if body != nil {
		started := false
		for c := body.FirstChild; c != nil; c = c.NextSibling {
			// body.text (text before the first child) is dropped.
			if !started && c.Type == html.TextNode {
				continue
			}
			started = true
			children = append(children, c)
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

// allowPCData is libxml2's list of elements whose whitespace-only text is
// kept (HTMLparser.c).
var allowPCData = map[string]bool{
	"a": true, "abbr": true, "acronym": true, "address": true, "applet": true, "b": true, "bdo": true,
	"big": true, "blockquote": true, "body": true, "button": true, "caption": true, "center": true,
	"cite": true, "code": true, "dd": true, "del": true, "dfn": true, "div": true, "dt": true, "em": true,
	"font": true, "form": true, "h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
	"i": true, "iframe": true, "ins": true, "kbd": true, "label": true, "legend": true, "li": true,
	"map": true, "menu": true, "object": true, "ol": true, "p": true, "pre": true, "q": true, "s": true,
	"samp": true, "small": true, "span": true, "strike": true, "strong": true, "td": true, "th": true,
	"tt": true, "u": true, "ul": true, "var": true,
}

func isBlank(s string) bool {
	for _, c := range s {
		if c != ' ' && c != '\t' && c != '\n' && c != '\r' {
			return false
		}
	}
	return true
}

// dropBlanks removes whitespace-only text the way libxml2's HTML parser
// (areBlanks) does: in <html> and <head>, at the start of most block
// elements, and after elements that don't take character data.
func dropBlanks(n *html.Node) {
	for c := n.FirstChild; c != nil; {
		next := c.NextSibling
		if c.Type == html.TextNode && isBlank(c.Data) && n.Type == html.ElementNode {
			prev := c.PrevSibling
			for prev != nil && prev.Type == html.CommentNode {
				prev = prev.PrevSibling
			}
			drop := false
			switch {
			case n.Data == "html" || n.Data == "head":
				drop = true
			case prev == nil:
				drop = !allowPCData[n.Data]
			case prev.Type == html.TextNode:
				drop = false
			case prev.Type == html.ElementNode:
				drop = !allowPCData[prev.Data]
			}
			if drop {
				n.RemoveChild(c)
			}
		} else if c.Type == html.ElementNode {
			dropBlanks(c)
		}
		c = next
	}
}

// unwrapImplied removes elements an HTML5 parser adds on its own (tbody),
// moving their children up.
func unwrapImplied(n *html.Node, tag string) {
	for c := n.FirstChild; c != nil; {
		next := c.NextSibling
		if c.Type == html.ElementNode {
			unwrapImplied(c, tag)
			if c.Data == tag {
				for gc := c.FirstChild; gc != nil; {
					gn := gc.NextSibling
					c.RemoveChild(gc)
					n.InsertBefore(gc, c)
					gc = gn
				}
				n.RemoveChild(c)
			}
		}
		c = next
	}
}

var xmlTextEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\r", "&#13;")
var xmlAttrEscaper = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "\n", "&#10;", "\r", "&#13;", "\t", "&#9;")

func indent(b *strings.Builder, level int) {
	b.WriteString(strings.Repeat("  ", min(level, 30)))
}

// writeChildren writes nodes at an indentation level; with format, each
// element goes on its own indented line (libxml2's pretty printing, which
// only applies to elements that have no text among their children).
func writeChildren(b *strings.Builder, nodes []*html.Node, level int, format bool) {
	if format {
		b.WriteString("\n")
	}
	for _, c := range nodes {
		if format {
			indent(b, level)
		}
		writeXML(b, c, level, format)
		if format {
			b.WriteString("\n")
		}
	}
}

// writeXML serialises a node the way lxml's etree.tostring(pretty_print=True)
// does for elements parsed by its HTML parser.
func writeXML(b *strings.Builder, n *html.Node, level int, format bool) {
	switch n.Type {
	case html.TextNode:
		b.WriteString(xmlTextEscaper.Replace(n.Data))
	case html.CommentNode:
		b.WriteString("<!--" + n.Data + "-->")
	case html.ElementNode:
		b.WriteString("<" + n.Data)
		for _, a := range n.Attr {
			key := a.Key
			if a.Namespace != "" {
				key = a.Namespace + ":" + a.Key
			}
			b.WriteString(" " + key + `="` + xmlAttrEscaper.Replace(a.Val) + `"`)
		}
		if n.FirstChild == nil {
			b.WriteString("/>")
			return
		}
		b.WriteString(">")
		var kids []*html.Node
		childFormat := format
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			kids = append(kids, c)
			if c.Type == html.TextNode {
				childFormat = false
			}
		}
		writeChildren(b, kids, level+1, childFormat)
		if childFormat {
			indent(b, level)
		}
		b.WriteString("</" + n.Data + ">")
	}
}
