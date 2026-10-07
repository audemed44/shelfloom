package pdf

import (
	"os/exec"
	"testing"
)

func TestReadInfoAndCover(t *testing.T) {
	if _, err := exec.LookPath("pdfinfo"); err != nil {
		t.Skip("poppler-utils not installed")
	}
	info, err := ReadInfo("testdata/test.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if info.Pages < 1 {
		t.Errorf("%+v", info)
	}
	meta := info.PyMuPDFMetadata()
	if meta[0][0] != "format" || len(meta) != 11 {
		t.Errorf("%+v", meta)
	}
	jpg, err := RenderCover("testdata/test.pdf")
	if err != nil || len(jpg) < 100 || jpg[0] != 0xFF {
		t.Fatalf("%d bytes, %v", len(jpg), err)
	}
	if _, err := ReadInfo("testdata/missing.pdf"); err == nil {
		t.Error("missing file accepted")
	}
}
