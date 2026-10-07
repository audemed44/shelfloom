package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf16"
)

// orderedObject is a JSON object that keeps its key order, so it can be
// rewritten the way Python's json module would (lens filter states are
// stored as JSON text and compared as text by nobody, but kept stable).
type orderedObject struct {
	keys []string
	vals map[string]json.RawMessage
}

func decodeOrderedObject(data []byte) (*orderedObject, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	if d, isDelim := tok.(json.Delim); !isDelim || d != '{' {
		return nil, fmt.Errorf("not an object")
	}
	o := &orderedObject{vals: map[string]json.RawMessage{}}
	for dec.More() {
		kt, err := dec.Token()
		if err != nil {
			return nil, err
		}
		key := kt.(string)
		var raw json.RawMessage
		if err := dec.Decode(&raw); err != nil {
			return nil, err
		}
		if _, seen := o.vals[key]; !seen {
			o.keys = append(o.keys, key)
		}
		o.vals[key] = raw
	}
	return o, nil
}

func (o *orderedObject) get(key string) (json.RawMessage, bool) {
	v, has := o.vals[key]
	return v, has
}

func (o *orderedObject) set(key string, v json.RawMessage) {
	if _, has := o.vals[key]; !has {
		o.keys = append(o.keys, key)
	}
	o.vals[key] = v
}

// pythonDumps writes the object as json.dumps() does: ", " and ": "
// separators, non-ASCII escaped.
func (o *orderedObject) pythonDumps() string {
	var b strings.Builder
	b.WriteString("{")
	for i, k := range o.keys {
		if i > 0 {
			b.WriteString(", ")
		}
		writePyString(&b, k)
		b.WriteString(": ")
		writePyValue(&b, o.vals[k])
	}
	b.WriteString("}")
	return b.String()
}

func writePyValue(b *strings.Builder, raw json.RawMessage) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		b.Write(raw)
		return
	}
	writePyAny(b, v)
}

func writePyAny(b *strings.Builder, v any) {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if x {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case json.Number:
		b.WriteString(x.String())
	case string:
		writePyString(b, x)
	case []any:
		b.WriteString("[")
		for i, e := range x {
			if i > 0 {
				b.WriteString(", ")
			}
			writePyAny(b, e)
		}
		b.WriteString("]")
	case map[string]any:
		// Nested objects don't occur in lens states; key order is lost here.
		b.WriteString("{")
		i := 0
		for k, e := range x {
			if i > 0 {
				b.WriteString(", ")
			}
			writePyString(b, k)
			b.WriteString(": ")
			writePyAny(b, e)
			i++
		}
		b.WriteString("}")
	case int64:
		fmt.Fprintf(b, "%d", x)
	}
}

func writePyString(b *strings.Builder, s string) {
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
