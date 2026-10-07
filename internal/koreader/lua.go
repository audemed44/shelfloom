// Package koreader reads KOReader's data: .sdr metadata (Lua tables) and
// the statistics database.
package koreader

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"
)

// Table is a Lua table: keys (int64, float64, string or bool) in the order
// they appeared.
type Table struct {
	Keys []any
	Vals map[any]any
}

func newTable() *Table { return &Table{Vals: map[any]any{}} }

func normKey(k any) any {
	// Python dict keys: 1 == 1.0 == True.
	switch x := k.(type) {
	case float64:
		if x == math.Trunc(x) && !math.IsInf(x, 0) {
			return int64(x)
		}
	case bool:
		if x {
			return int64(1)
		}
		return int64(0)
	}
	return k
}

func (t *Table) set(k, v any) {
	k = normKey(k)
	if _, ok := t.Vals[k]; !ok {
		t.Keys = append(t.Keys, k)
	}
	t.Vals[k] = v
}

// Get returns a value by key.
func (t *Table) Get(k any) (any, bool) {
	if t == nil {
		return nil, false
	}
	v, ok := t.Vals[normKey(k)]
	return v, ok
}

// ParseError is a Lua syntax error.
type ParseError struct{ msg string }

func (e *ParseError) Error() string { return e.msg }

func perr(format string, args ...any) error { return &ParseError{fmt.Sprintf(format, args...)} }

type parser struct {
	src []rune
	pos int
}

// ParseLua parses a Lua value as KOReader writes it: "return { … }" or
// "local X = { … } return X". It is a port of the Python backend's parser
// and accepts what it accepts.
func ParseLua(text string) (v any, err error) {
	p := &parser{src: []rune(text)}
	defer func() {
		if r := recover(); r != nil {
			if pe, ok := r.(*ParseError); ok {
				v, err = nil, pe
				return
			}
			panic(r)
		}
	}()
	p.skip()
	v = p.topLevel()
	p.skip()
	if p.pos < len(p.src) && strings.TrimSpace(string(p.src[p.pos:])) != "" {
		panic(perr("Unexpected content at position %d", p.pos))
	}
	return v, nil
}

func (p *parser) peek() (rune, bool) {
	if p.pos < len(p.src) {
		return p.src[p.pos], true
	}
	return 0, false
}

func (p *parser) peekAt(off int) (rune, bool) {
	if p.pos+off < len(p.src) {
		return p.src[p.pos+off], true
	}
	return 0, false
}

func isIdentStart(r rune) bool { return unicode.IsLetter(r) || r == '_' }
func isIdentChar(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || isPyNumeric(r) || r == '_'
}

// isPyNumeric approximates str.isalnum()'s numeric part.
func isPyNumeric(r rune) bool { return unicode.IsNumber(r) }

func (p *parser) topLevel() any {
	if p.keyword("local") {
		p.skip()
		ident := p.ident()
		p.skip()
		p.expect('=')
		p.skip()
		v := p.value()
		p.skip()
		if p.keyword("return") {
			p.skip()
			if ret := p.ident(); ret != ident {
				panic(perr("'return' refers to '%s' but bound name is '%s'", ret, ident))
			}
		}
		return v
	}
	if p.keyword("return") {
		p.skip()
		return p.value()
	}
	return p.value()
}

func (p *parser) value() any {
	p.skip()
	ch, ok := p.peek()
	if !ok {
		panic(perr("Unexpected end of input at position %d", p.pos))
	}
	switch {
	case ch == '{':
		return p.table()
	case ch == '"' || ch == '\'':
		return p.shortString()
	case ch == '[' && p.longLevel() >= 0:
		return p.longString()
	}
	if ch == '-' {
		if n, _ := p.peekAt(1); n == '-' {
			panic(perr("Unexpected comment at position %d", p.pos))
		}
	}
	if ch == '-' || (ch >= '0' && ch <= '9') {
		return p.number()
	}
	for _, kw := range []struct {
		word string
		val  any
	}{{"true", true}, {"false", false}, {"nil", nil}} {
		end := p.pos + len(kw.word)
		if end <= len(p.src) && string(p.src[p.pos:end]) == kw.word {
			if end >= len(p.src) || !(isAlnum(p.src[end]) || p.src[end] == '_') {
				p.pos = end
				return kw.val
			}
		}
	}
	if unicode.IsDigit(ch) {
		return p.number()
	}
	panic(perr("Unexpected character %q at position %d", ch, p.pos))
}

func isAlnum(r rune) bool { return unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsNumber(r) }

func (p *parser) table() *Table {
	p.expect('{')
	t := newTable()
	auto := int64(1)
	for {
		p.skip()
		ch, ok := p.peek()
		if !ok {
			panic(perr("Unterminated table (missing '}')"))
		}
		if ch == '}' {
			p.pos++
			return t
		}
		k, v := p.field(auto)
		if ki, isInt := k.(int64); isInt && ki == auto {
			auto++
		}
		t.set(k, v)
		p.skip()
		if sep, ok := p.peek(); ok && (sep == ',' || sep == ';') {
			p.pos++
		}
	}
}

func (p *parser) field(auto int64) (any, any) {
	p.skip()
	ch, _ := p.peek()
	if ch == '[' {
		var key any
		if p.longLevel() >= 0 {
			key = p.longString()
		} else {
			p.pos++
			p.skip()
			key = p.value()
			p.skip()
			p.expect(']')
		}
		p.skip()
		p.expect('=')
		p.skip()
		return key, p.value()
	}
	if isIdentStart(ch) {
		saved := p.pos
		ident := p.ident()
		p.skip()
		if c, ok := p.peek(); ok && c == '=' {
			if n, _ := p.peekAt(1); n != '=' {
				p.pos++
				p.skip()
				return ident, p.value()
			}
		}
		p.pos = saved
	}
	return auto, p.value()
}

func (p *parser) shortString() string {
	quote := p.src[p.pos]
	p.pos++
	var b strings.Builder
	for p.pos < len(p.src) {
		ch := p.src[p.pos]
		switch {
		case ch == quote:
			p.pos++
			return b.String()
		case ch == '\\':
			b.WriteString(p.escape())
		case ch == '\n' || ch == '\r':
			panic(perr("Unescaped newline in short string at position %d", p.pos))
		default:
			b.WriteRune(ch)
			p.pos++
		}
	}
	panic(perr("Unterminated string literal"))
}

func (p *parser) escape() string {
	p.pos++
	if p.pos >= len(p.src) {
		panic(perr("Unexpected end of input after '\\'"))
	}
	ch := p.src[p.pos]
	p.pos++
	simple := map[rune]string{'a': "\a", 'b': "\b", 'f': "\f", 'n': "\n", 'r': "\r", 't': "\t", 'v': "\v", '\\': "\\", '\'': "'", '"': "\"", '\n': "\n", '\r': "\n"}
	if s, ok := simple[ch]; ok {
		return s
	}
	if unicode.IsDigit(ch) {
		digits := string(ch)
		for i := 0; i < 2; i++ {
			if p.pos < len(p.src) && unicode.IsDigit(p.src[p.pos]) {
				digits += string(p.src[p.pos])
				p.pos++
			}
		}
		code, err := strconv.Atoi(digits)
		if err != nil {
			panic(perr("Invalid decimal escape \\%s", digits))
		}
		if code > 255 {
			panic(perr("Decimal escape \\%s out of range", digits))
		}
		return string(rune(code))
	}
	if ch == 'x' {
		hex := ""
		for i := 0; i < 2; i++ {
			if p.pos < len(p.src) && strings.ContainsRune("0123456789abcdefABCDEF", p.src[p.pos]) {
				hex += string(p.src[p.pos])
				p.pos++
			} else {
				panic(perr("Invalid hex escape sequence"))
			}
		}
		n, _ := strconv.ParseInt(hex, 16, 32)
		return string(rune(n))
	}
	if ch == 'z' {
		for p.pos < len(p.src) && strings.ContainsRune(" \t\n\r\f\v", p.src[p.pos]) {
			p.pos++
		}
		return ""
	}
	panic(perr("Unknown escape sequence '\\%c' at position %d", ch, p.pos))
}

// longLevel returns the number of '=' in a long bracket at the current
// position, or -1 when there is none.
func (p *parser) longLevel() int {
	i := p.pos
	if i >= len(p.src) || p.src[i] != '[' {
		return -1
	}
	i++
	level := 0
	for i < len(p.src) && p.src[i] == '=' {
		level++
		i++
	}
	if i < len(p.src) && p.src[i] == '[' {
		return level
	}
	return -1
}

func (p *parser) longString() string {
	level := p.longLevel()
	if level < 0 {
		panic(perr("Expected long string at position %d", p.pos))
	}
	p.pos += 2 + level
	if p.pos < len(p.src) && p.src[p.pos] == '\n' {
		p.pos++
	} else if p.pos+1 < len(p.src) && p.src[p.pos] == '\r' && p.src[p.pos+1] == '\n' {
		p.pos += 2
	} else if p.pos < len(p.src) && p.src[p.pos] == '\r' {
		p.pos++
	}
	closing := []rune("]" + strings.Repeat("=", level) + "]")
	rest := string(p.src[p.pos:])
	idx := strings.Index(rest, string(closing))
	if idx < 0 {
		panic(perr("Unterminated long string (expected %q) starting near position %d", string(closing), p.pos))
	}
	content := rest[:idx]
	p.pos += len([]rune(content)) + len(closing)
	return content
}

func (p *parser) number() any {
	start := p.pos
	src := p.src
	if p.pos < len(src) && src[p.pos] == '-' {
		p.pos++
	}
	if p.pos+1 < len(src) && src[p.pos] == '0' && (src[p.pos+1] == 'x' || src[p.pos+1] == 'X') {
		p.pos += 2
		for p.pos < len(src) && strings.ContainsRune("0123456789abcdefABCDEF_", src[p.pos]) {
			p.pos++
		}
		token := strings.ReplaceAll(string(src[start:p.pos]), "_", "")
		neg := strings.HasPrefix(token, "-")
		body := strings.TrimPrefix(token, "-")
		body = body[2:]
		n, err := strconv.ParseInt(body, 16, 64)
		if err != nil {
			panic(perr("Invalid hex number: %q", token))
		}
		if neg {
			n = -n
		}
		return n
	}
	for p.pos < len(src) && (unicode.IsDigit(src[p.pos]) || src[p.pos] == '_') {
		p.pos++
	}
	isFloat := false
	if p.pos < len(src) && src[p.pos] == '.' {
		if !(p.pos+1 < len(src) && src[p.pos+1] == '.') {
			isFloat = true
			p.pos++
			for p.pos < len(src) && (unicode.IsDigit(src[p.pos]) || src[p.pos] == '_') {
				p.pos++
			}
		}
	}
	if p.pos < len(src) && (src[p.pos] == 'e' || src[p.pos] == 'E') {
		isFloat = true
		p.pos++
		if p.pos < len(src) && (src[p.pos] == '+' || src[p.pos] == '-') {
			p.pos++
		}
		expStart := p.pos
		for p.pos < len(src) && unicode.IsDigit(src[p.pos]) {
			p.pos++
		}
		if p.pos == expStart {
			panic(perr("Invalid exponent in number at position %d", p.pos))
		}
	}
	token := strings.ReplaceAll(string(src[start:p.pos]), "_", "")
	if token == "" || token == "-" || token == "+" {
		panic(perr("Expected number at position %d", start))
	}
	if isFloat {
		f, err := strconv.ParseFloat(token, 64)
		if err != nil {
			panic(perr("Invalid number token: %q", token))
		}
		return f
	}
	n, err := strconv.ParseInt(token, 10, 64)
	if err != nil {
		if f, ferr := strconv.ParseFloat(token, 64); ferr == nil && strings.Trim(token, "-0123456789") == "" {
			// Larger than int64: Python ints are unbounded; keep the value.
			return f
		}
		panic(perr("Invalid number token: %q", token))
	}
	return n
}

func (p *parser) ident() string {
	start := p.pos
	if p.pos >= len(p.src) || !isIdentStart(p.src[p.pos]) {
		panic(perr("Expected identifier at position %d", p.pos))
	}
	for p.pos < len(p.src) && isIdentChar(p.src[p.pos]) {
		p.pos++
	}
	return string(p.src[start:p.pos])
}

func (p *parser) keyword(kw string) bool {
	end := p.pos + len(kw)
	if end > len(p.src) || string(p.src[p.pos:end]) != kw {
		return false
	}
	if end < len(p.src) && (isAlnum(p.src[end]) || p.src[end] == '_') {
		return false
	}
	p.pos = end
	return true
}

func (p *parser) expect(ch rune) {
	if p.pos >= len(p.src) || p.src[p.pos] != ch {
		panic(perr("Expected %q at position %d", ch, p.pos))
	}
	p.pos++
}

func (p *parser) skip() {
	for p.pos < len(p.src) {
		ch := p.src[p.pos]
		if strings.ContainsRune(" \t\n\r\f\v", ch) {
			p.pos++
			continue
		}
		if ch == '-' && p.pos+1 < len(p.src) && p.src[p.pos+1] == '-' {
			p.pos += 2
			if p.longLevel() >= 0 {
				p.longString()
			} else {
				for p.pos < len(p.src) && p.src[p.pos] != '\n' && p.src[p.pos] != '\r' {
					p.pos++
				}
			}
			continue
		}
		return
	}
}
