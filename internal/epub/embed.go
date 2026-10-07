package epub

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/audemed44/shelfloom/internal/hashing"
)

var (
	containerOPF = regexp.MustCompile(`(?i)full-path=["']([^"']+\.opf)["']`)
	closeMeta    = regexp.MustCompile(`(?i)(</(?:opf:)?metadata>)`)
	identifierEl = regexp.MustCompile(`(?i)<dc:identifier([^>]*)>([^<]*)</dc:identifier>`)
)

// EmbedError is a failure to write the Shelfloom ID into an EPUB.
type EmbedError struct{ msg string }

func (e *EmbedError) Error() string { return e.msg }

// existingShelfloomID returns the Shelfloom ID already in an OPF.
func existingShelfloomID(opf string) (string, bool) {
	exact := regexp.MustCompile(`(?i)<dc:identifier[^>]*id="shelfloom-id"[^>]*>\s*` + regexp.QuoteMeta(ShelfloomURNPrefix) + `([^<]+)\s*</dc:identifier>`)
	if m := exact.FindStringSubmatch(opf); m != nil {
		return strings.TrimSpace(m[1]), true
	}
	for _, m := range identifierEl.FindAllStringSubmatch(opf, -1) {
		value := strings.TrimSpace(m[2])
		if strings.Contains(m[1], "shelfloom-id") && strings.HasPrefix(value, ShelfloomURNPrefix) {
			return value[len(ShelfloomURNPrefix):], true
		}
	}
	return "", false
}

// EmbedResult is the ID in the file and its hashes before and after.
type EmbedResult struct {
	ID               string
	PreSHA, PreMD5   string
	PostSHA, PostMD5 string
}

// EmbedShelfloomID writes <dc:identifier id="shelfloom-id">urn:shelfloom:ID
// into the EPUB's OPF, unless it already has one, and rewrites the file.
func EmbedShelfloomID(file, id string) (*EmbedResult, error) {
	original, err := os.ReadFile(file)
	if err != nil {
		return nil, &EmbedError{fmt.Sprintf("File not found: %s", file)}
	}
	res := &EmbedResult{ID: id}
	res.PreSHA, res.PreMD5 = hashing.Bytes(original)
	zr, err := zip.NewReader(bytes.NewReader(original), int64(len(original)))
	if err != nil {
		return nil, &EmbedError{fmt.Sprintf("Cannot read EPUB zip: %v", err)}
	}
	read := func(name string) ([]byte, error) {
		for _, f := range zr.File {
			if f.Name == name {
				rc, err := f.Open()
				if err != nil {
					return nil, err
				}
				defer rc.Close()
				return io.ReadAll(rc)
			}
		}
		return nil, fmt.Errorf("There is no item named %q in the archive", name)
	}
	container, err := read("META-INF/container.xml")
	if err != nil {
		return nil, &EmbedError{"Missing META-INF/container.xml"}
	}
	m := containerOPF.FindStringSubmatch(strings.ToValidUTF8(string(container), "�"))
	if m == nil {
		return nil, &EmbedError{"Could not find OPF path in container.xml"}
	}
	opfPath := m[1]
	opfBytes, err := read(opfPath)
	if err != nil {
		return nil, &EmbedError{fmt.Sprintf("Cannot read EPUB zip: %v", err)}
	}
	opf := strings.ToValidUTF8(string(opfBytes), "�")
	if existing, found := existingShelfloomID(opf); found {
		res.ID = existing
		res.PostSHA, res.PostMD5 = res.PreSHA, res.PreMD5
		return res, nil
	}
	loc := closeMeta.FindStringIndex(opf)
	if loc == nil {
		return nil, &EmbedError{"Could not find </metadata> tag in OPF"}
	}
	tag := "\n    <dc:identifier id=\"shelfloom-id\">" + ShelfloomURNPrefix + id + "</dc:identifier>"
	newOPF := opf[:loc[0]] + tag + "\n    " + opf[loc[0]:]

	var out bytes.Buffer
	zw := zip.NewWriter(&out)
	for _, f := range zr.File {
		if f.Name == opfPath {
			if err := writeEntry(zw, f, []byte(newOPF), f.Method); err != nil {
				return nil, err
			}
			continue
		}
		if err := zw.Copy(f); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	res.PostSHA, res.PostMD5 = hashing.Bytes(out.Bytes())
	if err := os.WriteFile(file, out.Bytes(), 0o644); err != nil {
		return nil, err
	}
	return res, nil
}

// writeEntry writes data as a new entry with f's name, time and attributes.
func writeEntry(zw *zip.Writer, f *zip.File, data []byte, method uint16) error {
	h := &zip.FileHeader{
		Name:           f.Name,
		Comment:        f.Comment,
		Method:         method,
		Modified:       f.Modified,
		ExternalAttrs:  f.ExternalAttrs,
		CreatorVersion: f.CreatorVersion,
	}
	w, err := zw.CreateHeader(h)
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

// ── covers ────────────────────────────────────────────────────────────────────

const (
	coverID   = "shelfloom-cover"
	coverName = "shelfloom-cover.jpg"
)

// CoverError is a failure to write a cover into an EPUB.
type CoverError struct{ msg string }

func (e *CoverError) Error() string { return e.msg }

var (
	itemWithProps  = regexp.MustCompile(`<(?:\w+:)?item\b[^>]*\bproperties="[^"]*"[^>]*>`)
	coverImageProp = regexp.MustCompile(`\s*\bcover-image\b`)
	emptyProps     = regexp.MustCompile(`\sproperties="\s*"`)
	closeManifest  = regexp.MustCompile(`(</(?:\w+:)?manifest>)`)
	coverMeta      = regexp.MustCompile(`<(?:\w+:)?meta\b[^>]*\bname="cover"[^>]*/?>(?:\s*</(?:\w+:)?meta>)?`)
	closeMetadata  = regexp.MustCompile(`(</(?:\w+:)?metadata>)`)
)

// setCoverInOPF points the OPF's cover entries at our image and leaves the
// rest alone.
func setCoverInOPF(opf, href string) (string, error) {
	opf = itemWithProps.ReplaceAllStringFunc(opf, func(tag string) string {
		if strings.Contains(tag, `id="`+coverID+`"`) {
			return tag
		}
		tag = coverImageProp.ReplaceAllString(tag, "")
		return emptyProps.ReplaceAllString(tag, "")
	})
	if !strings.Contains(opf, `id="`+coverID+`"`) {
		item := `<item id="` + coverID + `" href="` + href + `" media-type="image/jpeg" properties="cover-image"/>`
		loc := closeManifest.FindStringIndex(opf)
		if loc == nil {
			return "", &CoverError{"OPF has no manifest"}
		}
		opf = opf[:loc[0]] + item + opf[loc[0]:]
	}
	meta := `<meta name="cover" content="` + coverID + `"/>`
	if coverMeta.MatchString(opf) {
		opf = coverMeta.ReplaceAllLiteralString(opf, meta)
	} else {
		loc := closeMetadata.FindStringIndex(opf)
		if loc == nil {
			return "", &CoverError{"OPF has no metadata"}
		}
		opf = opf[:loc[0]] + meta + opf[loc[0]:]
	}
	return opf, nil
}

// EmbedCover makes an image the EPUB's cover, changing as little of the file
// as possible. The new file replaces the old one only once it is complete.
func EmbedCover(file, coverPath string) error {
	cover, err := os.ReadFile(coverPath)
	if err != nil {
		return &CoverError{fmt.Sprintf("Failed to write the cover into the EPUB: %v", err)}
	}
	fail := func(err error) error {
		var ce *CoverError
		if errors.As(err, &ce) {
			return err
		}
		return &CoverError{fmt.Sprintf("Failed to write the cover into the EPUB: %v", err)}
	}
	zr, err := zip.OpenReader(file)
	if err != nil {
		return fail(err)
	}
	defer zr.Close()
	byName := map[string]*zip.File{}
	for _, f := range zr.File {
		byName[f.Name] = f
	}
	readEntry := func(name string) ([]byte, error) {
		f, ok := byName[name]
		if !ok {
			return nil, fmt.Errorf("There is no item named %q in the archive", name)
		}
		rc, err := f.Open()
		if err != nil {
			return nil, err
		}
		defer rc.Close()
		return io.ReadAll(rc)
	}
	containerData, err := readEntry("META-INF/container.xml")
	if err != nil {
		return fail(err)
	}
	container, err := parseStrict(containerData)
	if err != nil {
		return fail(err)
	}
	var opfPath string
	container.walk(func(e *strictElement) bool {
		if strings.HasSuffix(e.XMLName.Local, "rootfile") {
			if p, ok := e.attr("full-path"); ok && p != "" {
				opfPath = p
				return false
			}
		}
		return true
	})
	if opfPath == "" {
		return &CoverError{"No OPF file listed in META-INF/container.xml"}
	}
	opfDir := path.Dir(opfPath)
	imagePath := coverName
	if opfDir != "." && opfDir != "" {
		imagePath = path.Join(opfDir, coverName)
	}
	opfBytes, err := readEntry(opfPath)
	if err != nil {
		return fail(err)
	}
	if !utf8Valid(opfBytes) {
		return &CoverError{"Failed to write the cover into the EPUB: 'utf-8' codec can't decode the OPF"}
	}
	newOPF, err := setCoverInOPF(string(opfBytes), coverName)
	if err != nil {
		return err
	}

	tmp, err := os.CreateTemp(filepath.Dir(file), "*.epub.tmp")
	if err != nil {
		return fail(err)
	}
	tmpName := tmp.Name()
	ok := false
	defer func() {
		if !ok {
			tmp.Close()
			os.Remove(tmpName)
		}
	}()
	zw := zip.NewWriter(tmp)
	if f, has := byName["mimetype"]; has {
		data, err := readEntry("mimetype")
		if err != nil {
			return fail(err)
		}
		if err := writeEntry(zw, f, data, zip.Store); err != nil {
			return fail(err)
		}
	}
	for _, f := range zr.File {
		if f.Name == "mimetype" || f.Name == imagePath {
			continue
		}
		if f.Name == opfPath {
			if err := writeEntry(zw, f, []byte(newOPF), f.Method); err != nil {
				return fail(err)
			}
			continue
		}
		if err := zw.Copy(f); err != nil {
			return fail(err)
		}
	}
	w, err := zw.CreateHeader(&zip.FileHeader{Name: imagePath, Method: zip.Store, Modified: nowForZip()})
	if err != nil {
		return fail(err)
	}
	if _, err := w.Write(cover); err != nil {
		return fail(err)
	}
	if err := zw.Close(); err != nil {
		return fail(err)
	}
	if err := tmp.Close(); err != nil {
		return fail(err)
	}
	if err := os.Rename(tmpName, file); err != nil {
		return fail(err)
	}
	ok = true
	return nil
}
