package epub

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// LibraryMetadata is what Shelfloom knows about a book that readers working
// from the file alone (KOReader and its plugins) should see too.
type LibraryMetadata struct {
	// Series the book is in, the main one first. KOReader shows only the
	// first; EPUB 3 files list them all.
	Series []SeriesEntry
	// Subjects are written as <dc:subject>, which KOReader reads as the
	// book's keywords (Bookshelf's genres).
	Subjects []string
}

// SeriesEntry is a series and the book's position in it.
type SeriesEntry struct {
	Name  string
	Index *float64
}

// MetadataError is a failure to write library metadata into an EPUB.
type MetadataError struct{ msg string }

func (e *MetadataError) Error() string { return e.msg }

const dcNamespace = "http://purl.org/dc/elements/1.1/"

var (
	metadataOpen   = regexp.MustCompile(`<((?:\w+:)?)metadata\b[^>]*>`)
	dcPrefixDecl   = regexp.MustCompile(`xmlns:([\w.-]+)\s*=\s*["']` + regexp.QuoteMeta(dcNamespace) + `["']`)
	epub3Package   = regexp.MustCompile(`<(?:\w+:)?package\b[^>]*\bversion\s*=\s*["']3`)
	subjectElement = regexp.MustCompile(`\s*<(?:[\w.-]+:)?subject\b[^>]*?(?:/>|>[\s\S]*?</(?:[\w.-]+:)?subject\s*>)`)
	metaElement    = regexp.MustCompile(`\s*<(?:\w+:)?meta\b([^>]*?)(?:/>|>[\s\S]*?</(?:\w+:)?meta\s*>)`)
	xmlAttr        = regexp.MustCompile(`([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')`)
)

func attrsOf(tag string) map[string]string {
	out := map[string]string{}
	for _, m := range xmlAttr.FindAllStringSubmatch(tag, -1) {
		out[m[1]] = m[2] + m[3]
	}
	return out
}

func formatIndex(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// setLibraryMetadataInOPF replaces the OPF's series (calibre:series and
// EPUB 3 collections) and subjects with m, leaving everything else as it is.
func setLibraryMetadataInOPF(opf string, m LibraryMetadata) (string, error) {
	open := metadataOpen.FindStringSubmatchIndex(opf)
	if open == nil {
		return "", &MetadataError{"OPF has no metadata"}
	}
	metaPrefix := opf[open[2]:open[3]]
	end := closeMetadata.FindStringIndex(opf[open[1]:])
	if end == nil {
		return "", &MetadataError{"OPF has no </metadata>"}
	}
	head, body, tail := opf[:open[1]], opf[open[1]:open[1]+end[0]], opf[open[1]+end[0]:]

	dc := "dc"
	if d := dcPrefixDecl.FindStringSubmatch(opf); d != nil {
		dc = d[1]
	} else if len(m.Subjects) > 0 {
		head = head[:len(head)-1] + ` xmlns:dc="` + dcNamespace + `">`
	}

	// Drop what this replaces: subjects, calibre's series, and EPUB 3
	// collections with the metas that refine them.
	original := body
	body = subjectElement.ReplaceAllString(body, "")
	collections := map[string]bool{}
	for _, mm := range metaElement.FindAllStringSubmatch(body, -1) {
		a := attrsOf(mm[1])
		if a["property"] == "belongs-to-collection" && a["id"] != "" {
			collections["#"+a["id"]] = true
		}
	}
	body = metaElement.ReplaceAllStringFunc(body, func(el string) string {
		a := attrsOf(metaElement.FindStringSubmatch(el)[1])
		switch {
		case a["name"] == "calibre:series", a["name"] == "calibre:series_index",
			a["property"] == "belongs-to-collection", collections[a["refines"]]:
			return ""
		}
		return el
	})

	var add []string
	for _, s := range m.Subjects {
		add = append(add, fmt.Sprintf("<%s:subject>%s</%s:subject>", dc, xmlEscape(s), dc))
	}
	meta := metaPrefix + "meta"
	if len(m.Series) > 0 {
		// calibre:series has to come before calibre:series_index.
		s := m.Series[0]
		add = append(add, fmt.Sprintf(`<%s name="calibre:series" content="%s"/>`, meta, attrEscape(s.Name)))
		if s.Index != nil {
			add = append(add, fmt.Sprintf(`<%s name="calibre:series_index" content="%s"/>`, meta, formatIndex(*s.Index)))
		}
	}
	if epub3Package.MatchString(opf) {
		for i, s := range m.Series {
			id := fmt.Sprintf("shelfloom-series-%d", i+1)
			add = append(add,
				fmt.Sprintf(`<%s property="belongs-to-collection" id="%s">%s</%s>`, meta, id, xmlEscape(s.Name), meta),
				fmt.Sprintf(`<%s refines="#%s" property="collection-type">series</%s>`, meta, id, meta))
			if s.Index != nil {
				add = append(add, fmt.Sprintf(`<%s refines="#%s" property="group-position">%s</%s>`, meta, id, formatIndex(*s.Index), meta))
			}
		}
	}

	if len(add) == 0 && body == original {
		return opf, nil
	}
	body = strings.TrimRight(body, " \t\r\n")
	for _, el := range add {
		body += "\n    " + el
	}
	return head + body + "\n  " + tail, nil
}

// SetLibraryMetadata writes m into the EPUB's OPF, replacing its series and
// subjects. It reports whether the file changed; an OPF that already says
// the same thing is left alone.
func SetLibraryMetadata(file string, m LibraryMetadata) (bool, error) {
	p, err := openPackage(file)
	if err != nil {
		var me *missingOPF
		if errors.As(err, &me) {
			return false, &MetadataError{me.Error()}
		}
		return false, err
	}
	defer p.zr.Close()
	if !utf8Valid(p.opf) {
		return false, &MetadataError{"OPF is not UTF-8"}
	}
	opf := string(p.opf)
	newOPF, err := setLibraryMetadataInOPF(opf, m)
	if err != nil {
		return false, err
	}
	if newOPF == opf {
		return false, nil
	}
	if err := p.rewrite(file, []byte(newOPF), "", nil); err != nil {
		return false, err
	}
	return true, nil
}
