// Package pdf reads PDF metadata and renders covers with poppler-utils
// (pdfinfo, pdftoppm), which the runtime image installs.
package pdf

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Info is a PDF's document information and page count.
type Info struct {
	Title, Author string
	Pages         int64
	// Fields are pdfinfo's lines (Title, Author, Producer, …) in order.
	Fields [][2]string
}

const timeout = time.Minute

// ReadInfo runs pdfinfo on a file.
func ReadInfo(path string) (*Info, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "pdfinfo", "-enc", "UTF-8", "-rawdates", path).Output()
	if err != nil {
		var ee *exec.ExitError
		if errors.As(err, &ee) {
			return nil, fmt.Errorf("Failed to open PDF '%s': %s", path, strings.TrimSpace(string(ee.Stderr)))
		}
		return nil, fmt.Errorf("Failed to open PDF '%s': %v", path, err)
	}
	info := &Info{}
	sc := bufio.NewScanner(bytes.NewReader(out))
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		key, val, found := strings.Cut(sc.Text(), ":")
		if !found {
			continue
		}
		key, val = strings.TrimSpace(key), strings.TrimSpace(val)
		info.Fields = append(info.Fields, [2]string{key, val})
		switch key {
		case "Title":
			info.Title = val
		case "Author":
			info.Author = val
		case "Pages":
			info.Pages, _ = strconv.ParseInt(val, 10, 64)
		}
	}
	return info, nil
}

// PyMuPDFMetadata is the document's metadata keyed the way PyMuPDF's
// doc.metadata is (what the Python backend stored as metadata_raw).
func (info *Info) PyMuPDFMetadata() [][2]any {
	get := func(key string) string {
		for _, f := range info.Fields {
			if f[0] == key {
				return f[1]
			}
		}
		return ""
	}
	var encryption any
	if e := get("Encrypted"); e != "" && !strings.HasPrefix(e, "no") {
		encryption = e
	}
	return [][2]any{
		{"format", "PDF " + get("PDF version")}, {"title", get("Title")}, {"author", get("Author")},
		{"subject", get("Subject")}, {"keywords", get("Keywords")}, {"creator", get("Creator")},
		{"producer", get("Producer")}, {"creationDate", get("CreationDate")}, {"modDate", get("ModDate")},
		{"trapped", ""}, {"encryption", encryption},
	}
}

// RenderCover renders the first page at 72 dpi (PyMuPDF's default zoom)
// and returns it as JPEG bytes.
func RenderCover(path string) ([]byte, error) {
	dir, err := os.MkdirTemp("", "shelfloom-pdf-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	prefix := filepath.Join(dir, "cover")
	cmd := exec.CommandContext(ctx, "pdftoppm", "-jpeg", "-r", "72", "-f", "1", "-l", "1", "-singlefile", path, prefix)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("Failed to render PDF page: %s", strings.TrimSpace(string(out)))
	}
	return os.ReadFile(prefix + ".jpg")
}
