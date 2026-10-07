package epub

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"path"
	"strings"
)

// CoverImage returns the cover image stored in an EPUB, or nil when it has
// none. It looks where the Python backend looked: a manifest image with the
// cover-image property, an image with "cover" in its name, then EPUB 2's
// <meta name="cover">. An error means the EPUB couldn't be read.
func CoverImage(file string) ([]byte, error) {
	a, err := Open(file)
	if err != nil {
		return nil, err
	}
	defer a.Close()
	b, err := a.ReadBook()
	if err != nil {
		return nil, err
	}
	for _, it := range b.Items {
		if it.Kind == KindCover && len(it.Content()) > 0 {
			return it.Content(), nil
		}
		if it.Kind == KindCover {
			break // ebooklib stops at the first cover item even when empty
		}
	}
	for _, it := range b.Items {
		isImage := it.Kind == KindImage || (it.Kind == KindOther && imageExtension(it.Href))
		if isImage && strings.Contains(strings.ToLower(it.Href), "cover") {
			if len(it.Content()) > 0 {
				return it.Content(), nil
			}
			break
		}
	}
	return epub2Cover(a), nil
}

// imageExtension is ebooklib's extension-based type for items whose media
// type it doesn't know.
func imageExtension(name string) bool {
	switch strings.ToLower(path.Ext(name)) {
	case ".jpg", ".jpeg", ".gif", ".tiff", ".tif", ".png":
		return true
	}
	return false
}

// strictElement is an element of a strictly parsed document (Python's
// ElementTree refuses malformed XML; so does this).
type strictElement struct {
	XMLName  xml.Name
	Attrs    []xml.Attr      `xml:",any,attr"`
	Children []strictElement `xml:",any"`
}

func parseStrict(data []byte) (*strictElement, error) {
	var root strictElement
	d := xml.NewDecoder(bytes.NewReader(data))
	d.CharsetReader = func(_ string, r io.Reader) (io.Reader, error) { return r, nil }
	if err := d.Decode(&root); err != nil {
		return nil, err
	}
	return &root, nil
}

func (e *strictElement) attr(name string) (string, bool) {
	for _, a := range e.Attrs {
		if a.Name.Space == "" && a.Name.Local == name {
			return a.Value, true
		}
	}
	return "", false
}

func (e *strictElement) walk(fn func(*strictElement) bool) bool {
	if !fn(e) {
		return false
	}
	for i := range e.Children {
		if !e.Children[i].walk(fn) {
			return false
		}
	}
	return true
}

// epub2Cover finds <meta name="cover" content="ID"/> and reads that item.
func epub2Cover(a *Archive) []byte {
	containerData, err := a.ReadRaw("META-INF/container.xml")
	if err != nil {
		return nil
	}
	container, err := parseStrict(containerData)
	if err != nil {
		return nil
	}
	var opfPath string
	found := false
	for i := range container.Children {
		container.Children[i].walk(func(e *strictElement) bool {
			if e.XMLName.Space == nsContainer && e.XMLName.Local == "rootfile" {
				opfPath, _ = e.attr("full-path")
				found = true
				return false
			}
			return true
		})
		if found {
			break
		}
	}
	if !found || opfPath == "" {
		return nil
	}
	opfData, err := a.ReadRaw(opfPath)
	if err != nil {
		return nil
	}
	opf, err := parseStrict(opfData)
	if err != nil {
		return nil
	}
	var coverID *string
	// .//opf:metadata/opf:meta first, then any opf:meta.
	for i := range opf.Children {
		opf.Children[i].walk(func(e *strictElement) bool {
			if coverID != nil {
				return false
			}
			if e.XMLName.Space == nsOPF && e.XMLName.Local == "metadata" {
				for j := range e.Children {
					c := &e.Children[j]
					if c.XMLName.Space == nsOPF && c.XMLName.Local == "meta" {
						if n, _ := c.attr("name"); n == "cover" {
							v, _ := c.attr("content")
							coverID = &v
							return false
						}
					}
				}
			}
			return true
		})
	}
	if coverID == nil {
		for i := range opf.Children {
			opf.Children[i].walk(func(e *strictElement) bool {
				if e.XMLName.Space == nsOPF && e.XMLName.Local == "meta" {
					if n, _ := e.attr("name"); n == "cover" {
						v, _ := e.attr("content")
						coverID = &v
						return false
					}
				}
				return true
			})
			if coverID != nil {
				break
			}
		}
	}
	if coverID == nil {
		return nil
	}
	opfDir := ""
	if i := strings.LastIndex(opfPath, "/"); i >= 0 {
		opfDir = opfPath[:i]
	}
	var data []byte
	done := false
	for i := range opf.Children {
		opf.Children[i].walk(func(e *strictElement) bool {
			if e.XMLName.Space == nsOPF && e.XMLName.Local == "item" {
				if id, _ := e.attr("id"); id == *coverID {
					href, _ := e.attr("href")
					imgPath := href
					if opfDir != "" {
						imgPath = opfDir + "/" + href
					}
					data, _ = a.ReadRaw(imgPath)
					done = true
					return false
				}
			}
			return true
		})
		if done {
			break
		}
	}
	return data
}

// ErrNoOPF is returned when an EPUB has no OPF to edit.
var ErrNoOPF = errors.New("No OPF file listed in META-INF/container.xml")
