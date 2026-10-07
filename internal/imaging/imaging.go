// Package imaging converts cover images to JPEG.
package imaging

import (
	"bytes"
	"errors"
	"image"
	"image/color"
	_ "image/gif" // decoders for covers in any common format
	"image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"

	_ "golang.org/x/image/bmp"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

// ErrUnreadable means the bytes aren't an image this package can decode.
var ErrUnreadable = errors.New("cannot identify image file")

// ToJPEG converts an image to a JPEG (quality 85), keeping greyscale images
// grey, and shrinks it to fit maxSize×maxSize when maxSize > 0 — what the
// Python backend's _save_as_jpeg did with Pillow.
func ToJPEG(data []byte, maxSize int) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, ErrUnreadable
	}
	b := img.Bounds()
	if maxSize > 0 && (b.Dx() > maxSize || b.Dy() > maxSize) {
		w, h := b.Dx(), b.Dy()
		// Pillow's thumbnail keeps the aspect ratio and rounds.
		if w >= h {
			h = max(1, int(float64(h)*float64(maxSize)/float64(w)+0.5))
			w = maxSize
		} else {
			w = max(1, int(float64(w)*float64(maxSize)/float64(h)+0.5))
			h = maxSize
		}
		dst := image.NewRGBA(image.Rect(0, 0, w, h))
		xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, b, xdraw.Src, nil)
		img = dst
	}
	if !isOpaqueRGB(img) {
		img = flatten(img)
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, img, &jpeg.Options{Quality: 85}); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// isOpaqueRGB reports whether the JPEG encoder can take img as it is
// (Pillow's "RGB" and "L" modes, and CMYK, which it converts).
func isOpaqueRGB(img image.Image) bool {
	switch img.(type) {
	case *image.YCbCr, *image.Gray, *image.CMYK:
		return true
	}
	return false
}

// flatten converts to RGB the way Pillow's convert("RGB") does: alpha is
// dropped, not blended.
func flatten(img image.Image) image.Image {
	b := img.Bounds()
	dst := image.NewRGBA(b)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			c := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
			dst.SetRGBA(x, y, color.RGBA{c.R, c.G, c.B, 255})
		}
	}
	return dst
}

// SaveJPEG converts data and writes it to path, creating the folder.
func SaveJPEG(data []byte, path string, maxSize int) error {
	out, err := ToJPEG(data, maxSize)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, out, 0o644)
}
