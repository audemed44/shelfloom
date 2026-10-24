package epub

import (
	"archive/zip"
	"bytes"
	"compress/flate"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func f64(v float64) *float64 { return &v }

const epub3OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">x</dc:identifier>
    <dc:title>Book</dc:title>
    <dc:subject>Old Genre</dc:subject>
    <dc:subject/>
    <meta name="calibre:series" content="Old Series"/>
    <meta content="3.0" name="calibre:series_index"></meta>
    <meta property="belongs-to-collection" id="c1">Old Series</meta>
    <meta refines="#c1" property="collection-type">series</meta>
    <meta refines="#c1" property="group-position">3</meta>
    <meta refines="#id" property="identifier-type">uuid</meta>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest/>
</package>`

func TestSetLibraryMetadataEPUB3(t *testing.T) {
	m := LibraryMetadata{
		Series:   []SeriesEntry{{Name: "Mistborn & Co", Index: f64(1.5)}, {Name: "Cosmere"}},
		Subjects: []string{"Fantasy", "To <Read>"},
	}
	got, err := setLibraryMetadataInOPF(epub3OPF, m)
	if err != nil {
		t.Fatal(err)
	}
	for _, gone := range []string{"Old Genre", "Old Series", `"#c1"`, "<dc:subject/>"} {
		if strings.Contains(got, gone) {
			t.Errorf("still has %s:\n%s", gone, got)
		}
	}
	for _, kept := range []string{`refines="#id"`, `name="cover"`, "<dc:title>Book</dc:title>"} {
		if !strings.Contains(got, kept) {
			t.Errorf("lost %s:\n%s", kept, got)
		}
	}
	for _, want := range []string{
		"<dc:subject>Fantasy</dc:subject>",
		"<dc:subject>To &lt;Read&gt;</dc:subject>",
		`<meta name="calibre:series" content="Mistborn &amp; Co"/>`,
		`<meta name="calibre:series_index" content="1.5"/>`,
		`<meta property="belongs-to-collection" id="shelfloom-series-1">Mistborn &amp; Co</meta>`,
		`<meta refines="#shelfloom-series-1" property="group-position">1.5</meta>`,
		`<meta property="belongs-to-collection" id="shelfloom-series-2">Cosmere</meta>`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %s:\n%s", want, got)
		}
	}
	if strings.Contains(got, `refines="#shelfloom-series-2" property="group-position"`) {
		t.Errorf("position for a series without one:\n%s", got)
	}
	if strings.Index(got, "calibre:series\"") > strings.Index(got, "calibre:series_index") {
		t.Errorf("series_index before series:\n%s", got)
	}
	if root := ParseXML([]byte(got)); root == nil || root.Local != "package" {
		t.Fatalf("not XML any more:\n%s", got)
	}

	again, err := setLibraryMetadataInOPF(got, m)
	if err != nil || again != got {
		t.Fatalf("second write changed the OPF (%v):\n%s", err, again)
	}

	cleared, err := setLibraryMetadataInOPF(got, LibraryMetadata{})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(cleared, "subject") || strings.Contains(cleared, "series") {
		t.Fatalf("not cleared:\n%s", cleared)
	}
}

func TestSetLibraryMetadataEPUB2(t *testing.T) {
	opf := `<package version="2.0" xmlns="http://www.idpf.org/2007/opf"><opf:metadata xmlns:opf="http://www.idpf.org/2007/opf" xmlns:purl="http://purl.org/dc/elements/1.1/"><purl:title>B</purl:title></opf:metadata></package>`
	got, err := setLibraryMetadataInOPF(opf, LibraryMetadata{Series: []SeriesEntry{{Name: "S", Index: f64(2)}}, Subjects: []string{"G"}})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"<purl:subject>G</purl:subject>", `<opf:meta name="calibre:series" content="S"/>`, `<opf:meta name="calibre:series_index" content="2"/>`} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %s:\n%s", want, got)
		}
	}
	if strings.Contains(got, "belongs-to-collection") {
		t.Errorf("EPUB 3 collection in an EPUB 2 file:\n%s", got)
	}
}

func TestSetLibraryMetadataDeclaresDC(t *testing.T) {
	opf := `<package version="3.0"><metadata><title>B</title></metadata></package>`
	got, err := setLibraryMetadataInOPF(opf, LibraryMetadata{Subjects: []string{"G"}})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, `<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">`) || !strings.Contains(got, "<dc:subject>G</dc:subject>") {
		t.Fatalf("%s", got)
	}
	same, _ := setLibraryMetadataInOPF(opf, LibraryMetadata{})
	if same != opf {
		t.Fatalf("nothing to write but changed:\n%s", same)
	}
}

func TestSetLibraryMetadataFile(t *testing.T) {
	data, err := os.ReadFile("../server/testdata/test.epub")
	if err != nil {
		t.Fatal(err)
	}
	data = withDeflatedDir(t, data)
	file := filepath.Join(t.TempDir(), "b.epub")
	os.WriteFile(file, data, 0o644)
	m := LibraryMetadata{Series: []SeriesEntry{{Name: "Saga", Index: f64(2)}}, Subjects: []string{"Fantasy"}}
	changed, err := SetLibraryMetadata(file, m)
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	if changed, err = SetLibraryMetadata(file, m); err != nil || changed {
		t.Fatalf("second write: changed=%v err=%v", changed, err)
	}
	zr, err := zip.OpenReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	if zr.File[0].Name != "mimetype" || zr.File[0].Method != zip.Store {
		t.Fatalf("mimetype not first and stored: %+v", zr.File[0].FileHeader)
	}
	var opf string
	for _, f := range zr.File {
		if strings.HasSuffix(f.Name, ".opf") {
			rc, _ := f.Open()
			b, _ := io.ReadAll(rc)
			rc.Close()
			opf = string(b)
		}
	}
	if !strings.Contains(opf, `content="Saga"`) || !strings.Contains(opf, "<dc:subject>Fantasy</dc:subject>") {
		t.Fatalf("%s", opf)
	}
	md, err := ParseMetadata(file)
	if err != nil || md.Title != "Test Book Title" {
		t.Fatalf("%+v %v", md, err)
	}
}

// withDeflatedDir adds a directory entry stored deflated, as some EPUB
// tools write them (zip.Writer.Copy can't copy those).
func withDeflatedDir(t *testing.T, data []byte) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for i, f := range zr.File {
		if err := zw.Copy(f); err != nil {
			t.Fatal(err)
		}
		if i == 0 {
			var dir bytes.Buffer
			w, _ := flate.NewWriter(&dir, flate.DefaultCompression)
			w.Close()
			raw, _ := zw.CreateRaw(&zip.FileHeader{Name: "EXTRA/", Method: zip.Deflate, CompressedSize64: uint64(dir.Len()), CRC32: 0})
			raw.Write(dir.Bytes())
		}
	}
	zw.Close()
	return buf.Bytes()
}
