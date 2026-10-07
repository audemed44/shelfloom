package epub

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"net/url"
	"path"
	"strings"
)

const (
	nsOPF       = "http://www.idpf.org/2007/opf"
	nsDC        = "http://purl.org/dc/elements/1.1/"
	nsContainer = "urn:oasis:names:tc:opendocument:xmlns:container"
	nsDaisy     = "http://www.daisy.org/z3986/2005/ncx/"
	// ShelfloomURNPrefix marks the dc:identifier that carries a book's ID.
	ShelfloomURNPrefix = "urn:shelfloom:"
)

// Archive is an opened EPUB.
type Archive struct {
	zr    *zip.ReadCloser
	files map[string]*zip.File
}

// Open opens an EPUB (a zip archive).
func Open(file string) (*Archive, error) {
	zr, err := zip.OpenReader(file)
	if err != nil {
		return nil, fmt.Errorf("Bad Zip file")
	}
	a := &Archive{zr: zr, files: map[string]*zip.File{}}
	for _, f := range zr.File {
		a.files[f.Name] = f
	}
	return a, nil
}

// Close closes the archive.
func (a *Archive) Close() error { return a.zr.Close() }

// Read returns an entry's bytes; the name is normalised as ebooklib's
// read_file does. A missing entry is an error (ebooklib's KeyError).
func (a *Archive) Read(name string) ([]byte, error) {
	return a.ReadRaw(normpath(name))
}

// ReadRaw reads an entry by its exact name.
func (a *Archive) ReadRaw(name string) ([]byte, error) {
	f, ok := a.files[name]
	if !ok {
		return nil, fmt.Errorf("There is no item named %q in the archive", name)
	}
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(io.LimitReader(rc, 512<<20))
}

// Has reports whether the archive has an entry with this exact name.
func (a *Archive) Has(name string) bool {
	_, ok := a.files[name]
	return ok
}

// Files lists the entries in archive order.
func (a *Archive) Files() []*zip.File { return a.zr.File }

// normpath is posixpath.normpath ("" becomes ".").
func normpath(p string) string {
	if p == "" {
		return "."
	}
	c := path.Clean(p)
	if strings.HasPrefix(p, "//") && !strings.HasPrefix(p, "///") {
		c = "/" + c
	}
	return c
}

func joinZip(dir, name string) string {
	if dir == "" {
		return name
	}
	if strings.HasPrefix(name, "/") {
		return name
	}
	if strings.HasSuffix(dir, "/") {
		return dir + name
	}
	return dir + "/" + name
}

func unquote(s string) string {
	u, err := url.PathUnescape(s)
	if err != nil {
		return s
	}
	return u
}

// Item is a manifest item as ebooklib loads it.
type Item struct {
	ID         string
	Href       string // unquoted, relative to the OPF
	MediaType  string
	Properties []string
	Kind       ItemKind
	path       string
	archive    *Archive
	content    []byte
	loaded     bool
}

// Content reads the item's bytes (once).
func (it *Item) Content() []byte {
	if !it.loaded {
		it.content, _ = it.archive.Read(it.path)
		it.loaded = true
	}
	return it.content
}

// ItemKind mirrors ebooklib's item classes.
type ItemKind int

const (
	KindOther ItemKind = iota
	KindNcx
	KindNav
	KindCoverHTML
	KindDocument
	KindCover // image with the cover-image property
	KindImage
)

// Book is what ebooklib.read_epub(…, ignore_ncx=True) gives: the OPF's
// Dublin Core metadata and manifest.
type Book struct {
	OPFPath string
	OPF     *Node
	// DC holds Dublin Core values by element name, in document order. A
	// value is nil when the element has no text.
	DC    map[string][]DCValue
	Items []*Item
}

// DCValue is one Dublin Core element.
type DCValue struct {
	Value *string
	Attrs [][2]string // attribute name ({ns}local for namespaced ones) and value
}

var imageMediaTypes = map[string]bool{"image/jpeg": true, "image/jpg": true, "image/png": true, "image/svg+xml": true}

// ReadBook loads an EPUB as ebooklib does, failing where it fails.
func (a *Archive) ReadBook() (*Book, error) {
	containerData, err := a.Read("META-INF/container.xml")
	if err != nil {
		return nil, err
	}
	container := ParseXML(containerData)
	if container == nil {
		return nil, errors.New("container.xml is empty")
	}
	var opfPath string
	found := false
	container.Walk(func(n *Node) {
		if n.Space == nsContainer && n.Local == "rootfile" {
			if mt, ok := n.Attr("media-type"); ok && mt == "application/oebps-package+xml" {
				opfPath = n.AttrValue("full-path")
				found = true
			}
		}
	})
	if !found {
		return nil, errors.New("'EpubReader' object has no attribute 'opf_file'")
	}
	opfData, err := a.Read(opfPath)
	if err != nil {
		return nil, errors.New("Can not find container file")
	}
	opf := ParseXML(opfData)
	if opf == nil {
		return nil, errors.New("OPF is empty")
	}
	b := &Book{OPFPath: opfPath, OPF: opf, DC: map[string][]DCValue{}}
	opfDir := path.Dir(opfPath)
	if opfDir == "." {
		opfDir = ""
	}

	metadata := opf.Child(nsOPF, "metadata")
	if metadata == nil {
		return nil, errors.New("'NoneType' object has no attribute 'nsmap'")
	}
	for _, t := range metadata.Children {
		if t.Space != nsDC {
			continue
		}
		v := DCValue{}
		if t.HasText && t.Text != "" {
			s := t.Text
			v.Value = &s
		}
		for _, at := range t.Attrs {
			name := at.Name.Local
			if at.Name.Space != "" {
				name = "{" + at.Name.Space + "}" + name
			}
			v.Attrs = append(v.Attrs, [2]string{name, at.Value})
		}
		b.DC[t.Local] = append(b.DC[t.Local], v)
	}

	manifest := opf.Child(nsOPF, "manifest")
	if manifest == nil {
		return nil, errors.New("'NoneType' object is not iterable")
	}
	for _, r := range manifest.Children {
		if r.Space != nsOPF || r.Local != "item" {
			continue
		}
		mediaType := r.AttrValue("media-type")
		var props []string
		if p := r.AttrValue("properties"); p != "" {
			props = strings.Split(p, " ")
		}
		if mediaType == "image/jpg" {
			mediaType = "image/jpeg"
		}
		href, hasHref := r.Attr("href")
		if !hasHref {
			return nil, errors.New("manifest item without href")
		}
		it := &Item{ID: r.AttrValue("id"), Href: unquote(href), MediaType: mediaType, Properties: props}
		readPath := joinZip(opfDir, it.Href)
		switch {
		case mediaType == "application/x-dtbncx+xml":
			it.Kind = KindNcx
		case mediaType == "application/smil+xml":
			it.Kind = KindOther
		case mediaType == "application/xhtml+xml":
			switch {
			case contains(props, "nav"):
				it.Kind = KindNav
				readPath = joinZip(opfDir, href)
			case contains(props, "cover"):
				it.Kind = KindCoverHTML
			default:
				it.Kind = KindDocument
			}
		case imageMediaTypes[mediaType]:
			if contains(props, "cover-image") {
				it.Kind = KindCover
			} else {
				it.Kind = KindImage
			}
		}
		// ebooklib reads every item, so a missing file fails the whole book;
		// checking the archive's directory is enough for that.
		it.path, it.archive = normpath(readPath), a
		if !a.Has(it.path) {
			return nil, fmt.Errorf("There is no item named %q in the archive", it.path)
		}
		b.Items = append(b.Items, it)
	}

	spine := opf.Child(nsOPF, "spine")
	if spine == nil {
		return nil, errors.New("'NoneType' object is not iterable")
	}
	var nav *Item
	for _, it := range b.Items {
		if it.Kind == KindNav {
			nav = it
			break
		}
	}
	if toc := spine.AttrValue("toc"); toc != "" && nav == nil {
		var ncx *Item
		for _, it := range b.Items {
			if it.ID == toc {
				ncx = it
				break
			}
		}
		if ncx == nil {
			return nil, errors.New("'NoneType' object has no attribute 'get_name'")
		}
		data, err := a.Read(joinZip(opfDir, ncx.Href))
		if err != nil {
			return nil, errors.New("Can not find ncx file.")
		}
		if err := checkNCX(data); err != nil {
			return nil, err
		}
	}
	if nav != nil {
		if err := checkNav(nav.Content()); err != nil {
			return nil, err
		}
	}
	return b, nil
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

// checkNCX fails where ebooklib's _parse_ncx would.
func checkNCX(data []byte) error {
	root := ParseXML(data)
	if root == nil {
		return errors.New("empty NCX")
	}
	navMap := root.Child(nsDaisy, "navMap")
	if navMap == nil {
		return errors.New("'NoneType' object has no attribute 'getchildren'")
	}
	var check func(n *Node) error
	check = func(n *Node) error {
		for _, c := range n.Children {
			if c.Space == nsDaisy && c.Local == "navLabel" && len(c.Children) == 0 {
				return errors.New("list index out of range")
			}
			if c.Space == nsDaisy && c.Local == "navPoint" {
				if err := check(c); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return check(navMap)
}

// checkNav fails where ebooklib's _parse_nav would: the navigation document
// needs a <nav> marked toc with an <ol> directly inside.
func checkNav(data []byte) error {
	doc := parseHTMLDoc(data)
	if doc == nil {
		return errors.New("Document is empty")
	}
	var tocNav *htmlNode
	doc.walk(func(n *htmlNode) bool {
		if n.isElement("nav") {
			for _, a := range n.Attr {
				if a.Val == "toc" {
					tocNav = n
					return false
				}
			}
		}
		return true
	})
	if tocNav == nil {
		return errors.New("list index out of range")
	}
	if tocNav.firstChild("ol") == nil {
		return errors.New("'NoneType' object has no attribute 'findall'")
	}
	return nil
}
