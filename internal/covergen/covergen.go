// Package covergen draws covers for books that have none: Swiss-style
// typographic covers with a colour field, the author along the top, a
// geometric motif, a series number and the title set big at the bottom.
// Books in one series share a colour and differ in motif. It is a port of
// the Python backend's cover_generator; the same inputs give the same
// design (not byte-identical pixels).
package covergen

import (
	"bytes"
	"crypto/sha256"
	"embed"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"math"
	"math/big"
	"strconv"
	"strings"
	"sync"
	"unicode"

	"golang.org/x/image/font"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
	"golang.org/x/image/vector"
)

const (
	width, height = 800, 1200
	margin        = 64
)

//go:embed fonts/*.ttf
var fontFiles embed.FS

type palette struct{ background, text, accent color.RGBA }

func hex(s string) color.RGBA {
	n, _ := strconv.ParseUint(strings.TrimPrefix(s, "#"), 16, 32)
	return color.RGBA{uint8(n >> 16), uint8(n >> 8), uint8(n), 255}
}

var palettes = []palette{
	{hex("#2563ff"), hex("#ffffff"), hex("#0b1f66")}, // blue
	{hex("#0b0b0b"), hex("#f4f1ea"), hex("#2563ff")}, // black
	{hex("#e8381c"), hex("#ffffff"), hex("#3a0b03")}, // red
	{hex("#f2eee4"), hex("#111111"), hex("#e8381c")}, // paper
	{hex("#1d4a37"), hex("#f2eee4"), hex("#e3c14a")}, // green
	{hex("#e3c14a"), hex("#111111"), hex("#111111")}, // ochre
	{hex("#3a2c63"), hex("#f2eee4"), hex("#ff8a5b")}, // violet
	{hex("#dfe6ef"), hex("#0b1f66"), hex("#2563ff")}, // pale blue
}

var motifs = []string{"circle", "half", "bars", "grid", "diagonal", "rings"}

func digest(key string) *big.Int {
	h := sha256.Sum256([]byte(key))
	return new(big.Int).SetBytes(h[:])
}

func mod(n *big.Int, m int) int { return int(new(big.Int).Mod(n, big.NewInt(int64(m))).Int64()) }

// pyStrip and pyLower approximate str.strip() and str.lower().
func pyStrip(s string) string { return strings.TrimFunc(s, unicode.IsSpace) }

func chooseStyle(title string, author, series *string) (palette, string) {
	key := title
	if author != nil && *author != "" {
		key = *author
	}
	if series != nil && *series != "" {
		key = *series
	}
	p := palettes[mod(digest(strings.ToLower(pyStrip(key))), len(palettes))]
	m := motifs[mod(digest(strings.ToLower(pyStrip(title))), len(motifs))]
	return p, m
}

func variant(title string) int {
	d := digest(strings.ToLower(pyStrip(title)))
	d.Div(d, big.NewInt(int64(len(motifs))))
	return mod(d, 12)
}

// FormatSequence writes a series number: "03", or "2.5".
func FormatSequence(seq *float64) *string {
	if seq == nil {
		return nil
	}
	var s string
	if *seq == math.Trunc(*seq) {
		s = fmt.Sprintf("%02d", int64(*seq))
	} else {
		s = strconv.FormatFloat(*seq, 'g', 6, 64)
	}
	return &s
}

// ── fonts ─────────────────────────────────────────────────────────────────────

var (
	fontsMu sync.Mutex
	parsed  = map[string]*opentype.Font{}
	faces   = map[string]font.Face{}
)

func face(weight string, size int) font.Face {
	fontsMu.Lock()
	defer fontsMu.Unlock()
	key := fmt.Sprintf("%s/%d", weight, size)
	if f, ok := faces[key]; ok {
		return f
	}
	ft, ok := parsed[weight]
	if !ok {
		data, err := fontFiles.ReadFile("fonts/Inter-" + weight + ".ttf")
		if err != nil {
			panic(err)
		}
		if ft, err = opentype.Parse(data); err != nil {
			panic(err)
		}
		parsed[weight] = ft
	}
	f, err := opentype.NewFace(ft, &opentype.FaceOptions{Size: float64(size), DPI: 72, Hinting: font.HintingNone})
	if err != nil {
		panic(err)
	}
	faces[key] = f
	return f
}

func length(f font.Face, s string) float64 {
	return float64(font.MeasureString(f, s)) / 64
}

// drawText draws s with its top at the font's ascender line (Pillow's "la"
// anchor) at (x, y).
func drawText(img draw.Image, x, y float64, s string, f font.Face, c color.Color) {
	d := &font.Drawer{Dst: img, Src: image.NewUniform(c), Face: f,
		Dot: fixed.Point26_6{X: fixed.Int26_6(x * 64), Y: fixed.Int26_6((y + float64(f.Metrics().Ascent)/64) * 64)}}
	d.DrawString(s)
}

func spaced(img draw.Image, x, y float64, text string, f font.Face, c color.Color, tracking float64) {
	for _, ch := range text {
		drawText(img, x, y, string(ch), f, c)
		x += length(f, string(ch)) + tracking
	}
}

func fitSpaced(text, weight string, size int, tracking float64, w float64) string {
	f := face(weight, size)
	total := func(s string) float64 {
		t := 0.0
		for _, c := range s {
			t += length(f, string(c)) + tracking
		}
		return t
	}
	for text != "" && total(text) > w {
		r := []rune(text)
		if len(r) >= 2 {
			r = r[:len(r)-2]
		} else {
			r = nil
		}
		text = string(r) + "…"
	}
	return text
}

// wrap breaks text greedily; a word longer than a line is broken by letters.
func wrap(text string, f font.Face, w float64) []string {
	var lines []string
	line := ""
	for _, word := range strings.Fields(text) {
		cand := pyStrip(line + " " + word)
		if length(f, cand) <= w {
			line = cand
			continue
		}
		if line != "" {
			lines = append(lines, line)
		}
		r := []rune(word)
		for length(f, string(r)) > w && len(r) > 1 {
			cut := len(r)
			for cut > 1 && length(f, string(r[:cut])+"-") > w {
				cut--
			}
			lines = append(lines, string(r[:cut])+"-")
			r = r[cut:]
		}
		line = string(r)
	}
	if line != "" {
		lines = append(lines, line)
	}
	return lines
}

func fitTitle(title string, w, maxHeight float64) (font.Face, []string, int) {
	const maxLines = 5
	for size := 104; size > 39; size -= 4 {
		f := face("ExtraBold", size)
		lines := wrap(title, f, w)
		leading := int(float64(size) * 1.02)
		if len(lines) <= maxLines && float64(leading*len(lines)) <= maxHeight {
			return f, lines, leading
		}
	}
	f := face("ExtraBold", 40)
	lines := wrap(title, f, w)
	if len(lines) > maxLines {
		lines = lines[:maxLines]
	}
	if len(lines) > 0 {
		lines[len(lines)-1] = strings.TrimRight(lines[len(lines)-1], ".") + "…"
	}
	return f, lines, 40 // int(40 * 1.02)
}

// ── shapes ────────────────────────────────────────────────────────────────────

type canvas struct {
	img *image.RGBA
}

func (c *canvas) fill(path func(r *vector.Rasterizer), col color.Color) {
	b := c.img.Bounds()
	r := vector.NewRasterizer(b.Dx(), b.Dy())
	path(r)
	r.Draw(c.img, b, image.NewUniform(col), image.Point{})
}

func (c *canvas) rect(x0, y0, x1, y1 float64, col color.Color) {
	c.fill(func(r *vector.Rasterizer) {
		r.MoveTo(float32(x0), float32(y0))
		r.LineTo(float32(x1+1), float32(y0))
		r.LineTo(float32(x1+1), float32(y1+1))
		r.LineTo(float32(x0), float32(y1+1))
		r.ClosePath()
	}, col)
}

func ellipsePath(r *vector.Rasterizer, cx, cy, rx, ry float64, reverse bool) {
	const n = 180
	for i := 0; i <= n; i++ {
		a := 2 * math.Pi * float64(i) / n
		if reverse {
			a = -a
		}
		x, y := float32(cx+rx*math.Cos(a)), float32(cy+ry*math.Sin(a))
		if i == 0 {
			r.MoveTo(x, y)
		} else {
			r.LineTo(x, y)
		}
	}
	r.ClosePath()
}

func (c *canvas) disc(x0, y0, x1, y1 float64, col color.Color) {
	c.fill(func(r *vector.Rasterizer) {
		ellipsePath(r, (x0+x1)/2, (y0+y1)/2, (x1-x0)/2, (y1-y0)/2, false)
	}, col)
}

// ring is an ellipse outline of the given width, drawn inside the box (as
// Pillow does).
func (c *canvas) ring(x0, y0, x1, y1, w float64, col color.Color) {
	cx, cy, rx, ry := (x0+x1)/2, (y0+y1)/2, (x1-x0)/2, (y1-y0)/2
	c.fill(func(r *vector.Rasterizer) {
		ellipsePath(r, cx, cy, rx, ry, false)
		ellipsePath(r, cx, cy, rx-w, ry-w, true)
	}, col)
}

func (c *canvas) polygon(pts [][2]float64, col color.Color) {
	c.fill(func(r *vector.Rasterizer) {
		for i, p := range pts {
			if i == 0 {
				r.MoveTo(float32(p[0]), float32(p[1]))
			} else {
				r.LineTo(float32(p[0]), float32(p[1]))
			}
		}
		r.ClosePath()
	}, col)
}

// halfDisc is the upper half of a disc (Pillow's pieslice 180°–360°).
func (c *canvas) halfDisc(cx, base, rad float64, col color.Color) {
	c.fill(func(r *vector.Rasterizer) {
		const n = 90
		for i := 0; i <= n; i++ {
			a := math.Pi + math.Pi*float64(i)/n
			x, y := float32(cx+rad*math.Cos(a)), float32(base+rad*math.Sin(a))
			if i == 0 {
				r.MoveTo(x, y)
			} else {
				r.LineTo(x, y)
			}
		}
		r.ClosePath()
	}, col)
}

func drawMotif(c *canvas, motif string, x0, y0, x1, y1 float64, p palette, v int) {
	w, h := x1-x0, y1-y0
	cx, cy := x0+w/2, y0+h/2
	r := math.Min(w, h) / 2
	fg, accent := p.text, p.accent
	switch motif {
	case "circle":
		c.ring(cx-r, cy-r, cx+r, cy+r, 10, fg)
		c.disc(cx-r*0.18, cy-r*0.18, cx+r*0.18, cy+r*0.18, accent)
	case "half":
		hr := math.Min(w/2, h*0.85)
		base := y1 - 3
		c.halfDisc(cx, base, hr, accent)
		c.rect(x0, base-3, x1, base+2, fg)
	case "bars":
		n := 5 + v%4
		gap := h / float64(n*2-1)
		for i := 0; i < n; i++ {
			y := y0 + float64(i)*gap*2
			l := w * (0.35 + 0.65*float64((i*37)%n)/float64(n-1))
			col := fg
			if i == 2 {
				col = accent
			}
			if v%2 == 1 {
				c.rect(x1-l, y, x1, y+gap, col)
			} else {
				c.rect(x0, y, x0+l, y+gap, col)
			}
		}
	case "grid":
		n := 3 + v%3
		step := math.Min(w, h) / float64(n)
		s := step * 0.34
		ox := cx - step*float64(n)/2 + step/2
		oy := cy - step*float64(n)/2 + step/2
		for i := 0; i < n; i++ {
			for j := 0; j < n; j++ {
				px, py := ox+float64(i)*step, oy+float64(j)*step
				col := fg
				if i == v%n && j == (v/3)%n {
					col = accent
				}
				c.disc(px-s, py-s, px+s, py+s, col)
			}
		}
	case "diagonal":
		count := 2 + v%3
		flip := v%2 == 1
		band := w * 0.15
		switch count {
		case 2:
			band = w * 0.28
		case 3:
			band = w * 0.2
		}
		for k := 0; k < count; k++ {
			off := (float64(k) - float64(count-1)/2) * band * 1.75
			col := fg
			if k == count/2 {
				col = accent
			}
			bottom := [2]float64{x0 + off, x0 + off + band}
			top := [2]float64{x1 + off - band, x1 + off}
			if flip {
				bottom, top = [2]float64{x1 - off - band, x1 - off}, [2]float64{x0 - off, x0 - off + band}
			}
			c.polygon([][2]float64{{bottom[0], y1}, {bottom[1], y1}, {top[1], y0}, {top[0], y0}}, col)
		}
	default: // rings
		for i, frac := range []float64{1.0, 0.72, 0.44} {
			rr := r * frac
			col := fg
			if i == 1 {
				col = accent
			}
			c.ring(cx-rr, cy-rr, cx+rr, cy+rr, 8, col)
		}
	}
}

// inkBounds measures where text ink falls relative to the drawing origin
// (Pillow's textbbox for anchor "la").
func inkBounds(f font.Face, s string) (left, top, right, bottom float64) {
	b, _ := font.BoundString(f, s)
	asc := float64(f.Metrics().Ascent) / 64
	return float64(b.Min.X) / 64, float64(b.Min.Y)/64 + asc, float64(b.Max.X) / 64, float64(b.Max.Y)/64 + asc
}

// Render draws a cover. The same inputs give the same image.
func Render(title string, author, series *string, sequence *float64) image.Image {
	if title == "" {
		title = "Untitled"
	}
	title = strings.Join(strings.Fields(title), " ")
	p, motif := chooseStyle(title, author, series)
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(img, img.Bounds(), image.NewUniform(p.background), image.Point{}, draw.Src)
	c := &canvas{img}
	inner := float64(width - 2*margin)

	top := float64(margin)
	if author != nil && *author != "" {
		name := fitSpaced(strings.ToUpper(*author), "SemiBold", 26, 4, inner)
		spaced(img, margin, top, name, face("SemiBold", 26), p.text, 4)
	}
	c.rect(margin, top+50, width-margin, top+54, p.text)

	number := FormatSequence(sequence)
	var label string
	if series != nil && *series != "" {
		label = strings.ToUpper(*series)
		if number != nil {
			n := strings.TrimLeft(*number, "0")
			if n == "" {
				n = "0"
			}
			label += "  ·  BOOK " + n
		}
	}
	titleFace, lines, leading := fitTitle(title, inner, height*0.36)
	block := leading * len(lines)
	yTitle := float64(height - margin - block)
	yLabel := yTitle - 56
	if label != "" {
		text := fitSpaced(label, "SemiBold", 22, 3, inner)
		spaced(img, margin, yLabel, text, face("SemiBold", 22), p.text, 3)
	}
	for i, line := range lines {
		drawText(img, margin-4, yTitle+float64(i*leading), line, titleFace, p.text)
	}

	motifTop := top + 110
	motifBottom := yTitle - 60
	if label != "" {
		motifBottom = yLabel - 60
	}
	motifRight := float64(width - margin)
	if number != nil {
		size := 220
		if len(*number) > 2 {
			size = 170
		}
		f := face("ExtraBold", size)
		l, t, r, _ := inkBounds(f, *number)
		x := float64(width-margin) - (r - l) - l
		drawText(img, x, motifTop-t, *number, f, p.accent)
		motifRight = x + l - 48
	}
	if motifBottom-motifTop > 120 && motifRight-margin > 120 {
		box := image.Rect(margin, int(motifTop), int(motifRight), int(motifBottom))
		layer := image.NewRGBA(img.Bounds())
		draw.Draw(layer, layer.Bounds(), image.NewUniform(p.background), image.Point{}, draw.Src)
		drawMotif(&canvas{layer}, motif, float64(box.Min.X), float64(box.Min.Y), float64(box.Max.X), float64(box.Max.Y), p, variant(title))
		draw.Draw(img, box, layer, box.Min, draw.Src)
	}
	return img
}

// JPEG encodes a cover.
func JPEG(img image.Image, quality int) ([]byte, error) {
	var buf bytes.Buffer
	err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality})
	return buf.Bytes(), err
}
