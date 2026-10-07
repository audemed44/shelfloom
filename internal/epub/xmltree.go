// Package epub reads and changes EPUB files the way the Python backend did
// with ebooklib: metadata, covers, the embedded Shelfloom ID, and building
// serial volumes.
package epub

import (
	"bytes"
	"encoding/xml"
	"io"
	"strings"
)

// Node is a parsed XML element (comments and processing instructions are
// skipped), close enough to an lxml element for reading OPF and container
// files: Text is the text before the first child, Tail the text after the
// element up to its next sibling.
type Node struct {
	Space, Local string
	Attrs        []xml.Attr
	Children     []*Node
	Text, Tail   string
	HasText      bool
	// Prefix is the prefix the element was written with ("dc" for dc:title).
	Prefix string
	Parent *Node
}

// Attr returns an attribute without a namespace.
func (n *Node) Attr(name string) (string, bool) {
	for _, a := range n.Attrs {
		if a.Name.Space == "" && a.Name.Local == name {
			return a.Value, true
		}
	}
	return "", false
}

// AttrValue is Attr without the found flag.
func (n *Node) AttrValue(name string) string {
	v, _ := n.Attr(name)
	return v
}

// Child returns the first direct child with this namespace and local name.
func (n *Node) Child(space, local string) *Node {
	for _, c := range n.Children {
		if c.Space == space && c.Local == local {
			return c
		}
	}
	return nil
}

// Walk calls fn for n and every descendant in document order.
func (n *Node) Walk(fn func(*Node)) {
	fn(n)
	for _, c := range n.Children {
		c.Walk(fn)
	}
}

// ParseXML parses a document leniently (like lxml's recover=True) and
// returns its root element, or nil when there is none.
func ParseXML(data []byte) *Node {
	data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))
	d := xml.NewDecoder(bytes.NewReader(data))
	d.Strict = false
	d.AutoClose = xml.HTMLAutoClose
	d.Entity = xml.HTMLEntity
	d.CharsetReader = func(_ string, r io.Reader) (io.Reader, error) { return r, nil }
	var root *Node
	var stack []*Node
	var last *Node // last closed element, whose tail receives text
	prefixes := []map[string]string{{}}
	for {
		tok, err := d.RawToken()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			scope := map[string]string{}
			for k, v := range prefixes[len(prefixes)-1] {
				scope[k] = v
			}
			for _, a := range t.Attr {
				if a.Name.Space == "xmlns" {
					scope[a.Name.Local] = a.Value
				} else if a.Name.Space == "" && a.Name.Local == "xmlns" {
					scope[""] = a.Value
				}
			}
			prefixes = append(prefixes, scope)
			n := &Node{Local: t.Name.Local, Prefix: t.Name.Space, Space: scope[t.Name.Space]}
			for _, a := range t.Attr {
				if a.Name.Space == "xmlns" || (a.Name.Space == "" && a.Name.Local == "xmlns") {
					continue
				}
				attr := a
				if a.Name.Space != "" {
					if a.Name.Space == "xml" {
						attr.Name.Space = "http://www.w3.org/XML/1998/namespace"
					} else if ns, ok := scope[a.Name.Space]; ok {
						attr.Name.Space = ns
					}
				}
				n.Attrs = append(n.Attrs, attr)
			}
			if len(stack) > 0 {
				n.Parent = stack[len(stack)-1]
				n.Parent.Children = append(n.Parent.Children, n)
			} else if root == nil {
				root = n
			}
			stack = append(stack, n)
			last = nil
		case xml.EndElement:
			if len(stack) == 0 {
				continue
			}
			last = stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			prefixes = prefixes[:len(prefixes)-1]
		case xml.CharData:
			s := string(t)
			if last != nil {
				last.Tail += s
			} else if len(stack) > 0 {
				top := stack[len(stack)-1]
				if len(top.Children) == 0 {
					top.Text += s
					top.HasText = true
				}
			}
		}
	}
	return root
}

// TextContent is all the text inside a node (lxml's text_content()).
func (n *Node) TextContent() string {
	var b strings.Builder
	var walk func(*Node)
	walk = func(x *Node) {
		b.WriteString(x.Text)
		for _, c := range x.Children {
			walk(c)
			b.WriteString(c.Tail)
		}
	}
	walk(n)
	return b.String()
}
