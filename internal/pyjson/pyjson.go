// Package pyjson writes JSON the way Python's json.dumps() does by default
// (", " and ": " separators, non-ASCII escaped as \uXXXX), for values the
// Python backend stored as JSON text.
package pyjson

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode/utf16"
)

// Map is a JSON object that keeps its key order.
type Map struct {
	Keys []string
	Vals map[string]any
}

// NewMap returns an empty ordered object.
func NewMap() *Map { return &Map{Vals: map[string]any{}} }

// Set adds or replaces a key, keeping its first position.
func (m *Map) Set(k string, v any) {
	if _, ok := m.Vals[k]; !ok {
		m.Keys = append(m.Keys, k)
	}
	m.Vals[k] = v
}

// Number is a number written exactly as given.
type Number string

// Dumps encodes v: nil, bool, string, int/int64, float64, Number, []any,
// []string, *Map or map[string]any (keys in Go map order).
func Dumps(v any) string {
	var b strings.Builder
	write(&b, v)
	return b.String()
}

func write(b *strings.Builder, v any) {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		b.WriteString(strconv.FormatBool(x))
	case string:
		WriteString(b, x)
	case *string:
		if x == nil {
			b.WriteString("null")
		} else {
			WriteString(b, *x)
		}
	case int:
		b.WriteString(strconv.Itoa(x))
	case int64:
		b.WriteString(strconv.FormatInt(x, 10))
	case float64:
		b.WriteString(FloatRepr(x))
	case Number:
		b.WriteString(string(x))
	case []any:
		b.WriteString("[")
		for i, e := range x {
			if i > 0 {
				b.WriteString(", ")
			}
			write(b, e)
		}
		b.WriteString("]")
	case []string:
		b.WriteString("[")
		for i, e := range x {
			if i > 0 {
				b.WriteString(", ")
			}
			WriteString(b, e)
		}
		b.WriteString("]")
	case *Map:
		b.WriteString("{")
		for i, k := range x.Keys {
			if i > 0 {
				b.WriteString(", ")
			}
			WriteString(b, k)
			b.WriteString(": ")
			write(b, x.Vals[k])
		}
		b.WriteString("}")
	case map[string]any:
		m := NewMap()
		for k, e := range x {
			m.Set(k, e)
		}
		write(b, m)
	default:
		WriteString(b, fmt.Sprint(x))
	}
}

// FloatRepr is Python's repr() of a float (what json.dumps writes).
func FloatRepr(f float64) string {
	switch {
	case math.IsNaN(f):
		return "NaN"
	case math.IsInf(f, 1):
		return "Infinity"
	case math.IsInf(f, -1):
		return "-Infinity"
	}
	abs := math.Abs(f)
	if abs != 0 && (abs < 1e-4 || abs >= 1e16) {
		return strconv.FormatFloat(f, 'e', -1, 64)
	}
	s := strconv.FormatFloat(f, 'f', -1, 64)
	if !strings.Contains(s, ".") {
		s += ".0"
	}
	return s
}

// WriteString writes a JSON string with non-ASCII escaped.
func WriteString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		default:
			switch {
			case r < 0x20 || (r >= 0x80 && r < 0x10000):
				fmt.Fprintf(b, `\u%04x`, r)
			case r >= 0x10000:
				r1, r2 := utf16.EncodeRune(r)
				fmt.Fprintf(b, `\u%04x\u%04x`, r1, r2)
			default:
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}
