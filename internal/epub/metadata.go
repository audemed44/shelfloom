package epub

import (
	"regexp"
	"strings"

	"github.com/audemed44/shelfloom/internal/pyjson"
)

// Metadata is what import takes from an EPUB (app.services.metadata.epub).
type Metadata struct {
	Title       string
	Author      *string
	ISBN        *string
	Publisher   *string
	Language    *string
	Description *string
	PageCount   *int64
	EpubUID     *string
	ShelfloomID *string
	// Raw is the metadata_raw JSON text.
	Raw string
}

var (
	isbnShape  = regexp.MustCompile(`(?i)^(isbn:?)?(97[89])?\d{9}[\dxX]$`)
	isbnDashes = regexp.MustCompile(`[-\s]`)
	urnISBN    = regexp.MustCompile(`(?i)^urn:isbn:`)
	isbnPrefix = regexp.MustCompile(`(?i)^isbn:`)
)

func looksLikeISBN(v string) bool {
	return isbnShape.MatchString(isbnDashes.ReplaceAllString(v, ""))
}

func normalizeISBN(v string) string {
	v = urnISBN.ReplaceAllString(v, "")
	v = isbnPrefix.ReplaceAllString(v, "")
	return strings.TrimSpace(v)
}

// ParseMetadata reads an EPUB's metadata; it fails where ebooklib fails.
func ParseMetadata(file string) (*Metadata, error) {
	a, err := Open(file)
	if err != nil {
		return nil, err
	}
	defer a.Close()
	b, err := a.ReadBook()
	if err != nil {
		return nil, err
	}
	return metadataOf(b), nil
}

func metadataOf(b *Book) *Metadata {
	m := &Metadata{Title: "Unknown Title"}
	raw := pyjson.NewMap()
	first := func(name string) (*string, bool) {
		vals := b.DC[name]
		if len(vals) == 0 {
			return nil, false
		}
		return vals[0].Value, true
	}
	values := func(name string) []any {
		var out []any
		for _, v := range b.DC[name] {
			out = append(out, v.Value)
		}
		return out
	}
	if t, ok := first("title"); ok {
		if t != nil && *t != "" {
			m.Title = *t
		}
		raw.Set("titles", values("title"))
	}
	if c, ok := first("creator"); ok {
		m.Author = c
		raw.Set("creators", values("creator"))
	}
	if p, ok := first("publisher"); ok {
		m.Publisher = p
	}
	if l, ok := first("language"); ok {
		m.Language = l
	}
	if d, ok := first("description"); ok {
		m.Description = d
	}
	ids := []any{}
	for _, id := range b.DC["identifier"] {
		attrs := pyjson.NewMap()
		for _, a := range id.Attrs {
			attrs.Set(a[0], a[1])
		}
		ids = append(ids, []any{id.Value, attrs})
		if id.Value == nil || *id.Value == "" {
			continue
		}
		v := strings.TrimSpace(*id.Value)
		switch {
		case strings.HasPrefix(v, ShelfloomURNPrefix):
			s := v[len(ShelfloomURNPrefix):]
			m.ShelfloomID = &s
		case looksLikeISBN(v):
			s := normalizeISBN(v)
			m.ISBN = &s
		case m.EpubUID == nil:
			s := v
			m.EpubUID = &s
		}
	}
	raw.Set("identifiers", ids)
	m.Raw = pyjson.Dumps(raw)

	total, docs := 0, 0
	for _, it := range b.Items {
		switch it.Kind {
		case KindDocument, KindNav: // ebooklib's EpubNav is an EpubHtml too
			total += DocumentLength(it.Content())
			docs++
		case KindCoverHTML:
			total += coverHTMLLength
			docs++
		}
	}
	if docs > 0 {
		pages := int64(max(1, total/2000))
		m.PageCount = &pages
	}
	return m
}
