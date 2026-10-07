package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/audemed44/shelfloom/internal/store"
)

// httpError is an error with the status and detail FastAPI would answer with.
type httpError struct {
	status int
	detail any
	header http.Header
}

func (e *httpError) Error() string { return fmt.Sprint(e.detail) }

func errStatus(status int, detail any) error { return &httpError{status: status, detail: detail} }

func notFound(format string, args ...any) error {
	return errStatus(http.StatusNotFound, fmt.Sprintf(format, args...))
}

func badRequest(format string, args ...any) error {
	return errStatus(http.StatusBadRequest, fmt.Sprintf(format, args...))
}

func conflict(format string, args ...any) error {
	return errStatus(http.StatusConflict, fmt.Sprintf(format, args...))
}

func unprocessable(format string, args ...any) error {
	return errStatus(http.StatusUnprocessableEntity, fmt.Sprintf(format, args...))
}

// handlerFunc is a handler that can fail with an *httpError (or any error,
// which becomes a 500).
type handlerFunc func(w http.ResponseWriter, r *http.Request) error

func (s *Server) wrap(h handlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		err := h(rec, r)
		if err != nil {
			var he *httpError
			if errors.As(err, &he) {
				for k, v := range he.header {
					rec.Header()[k] = v
				}
				writeJSON(rec, he.status, map[string]any{"detail": he.detail})
			} else {
				slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
				writeJSON(rec, http.StatusInternalServerError, map[string]any{"detail": "Internal Server Error"})
			}
		}
		slog.Info(fmt.Sprintf("%s %s %d %.0fms", r.Method, r.URL.Path, rec.status, float64(time.Since(start).Microseconds())/1000))
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
	wrote  bool
}

func (r *statusRecorder) WriteHeader(code int) {
	if !r.wrote {
		r.status = code
		r.wrote = true
	}
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	r.wrote = true
	return r.ResponseWriter.Write(b)
}

func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

func writeJSON(w http.ResponseWriter, status int, v any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		slog.Error("encoding response", "err", err)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		io.WriteString(w, `{"detail":"Internal Server Error"}`)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(bytes.TrimRight(buf.Bytes(), "\n"))
}

// ok answers 200 with v as JSON.
func ok(w http.ResponseWriter, v any) error {
	writeJSON(w, http.StatusOK, v)
	return nil
}

func created(w http.ResponseWriter, v any) error {
	writeJSON(w, http.StatusCreated, v)
	return nil
}

func noContent(w http.ResponseWriter) error {
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ── request validation, shaped like FastAPI's 422 answers ─────────────────────

type validationIssue struct {
	Type  string         `json:"type"`
	Loc   []any          `json:"loc"`
	Msg   string         `json:"msg"`
	Input any            `json:"input"`
	Ctx   map[string]any `json:"ctx,omitempty"`
}

var boundInMsg = regexp.MustCompile(`(?:than or equal to|at least|at most) (-?[0-9.]+)`)

func invalid(issues ...validationIssue) error {
	for i, is := range issues {
		if is.Ctx != nil {
			continue
		}
		var bound any
		if m := boundInMsg.FindStringSubmatch(is.Msg); m != nil {
			if n, err := strconv.ParseInt(m[1], 10, 64); err == nil {
				bound = n
			} else if f, err := strconv.ParseFloat(m[1], 64); err == nil {
				bound = f
			}
		}
		switch is.Type {
		case "value_error":
			issues[i].Ctx = map[string]any{"error": map[string]any{}}
		case "greater_than_equal":
			issues[i].Ctx = map[string]any{"ge": bound}
		case "less_than_equal":
			issues[i].Ctx = map[string]any{"le": bound}
		case "string_too_short":
			issues[i].Ctx = map[string]any{"min_length": bound}
		case "string_too_long":
			issues[i].Ctx = map[string]any{"max_length": bound}
		case "literal_error":
			issues[i].Ctx = map[string]any{"expected": strings.TrimPrefix(is.Msg, "Input should be ")}
		}
	}
	return &httpError{status: http.StatusUnprocessableEntity, detail: issues}
}

func invalidField(where, name, typ, msg string, input any) error {
	loc := []any{where}
	if name != "" {
		loc = append(loc, name)
	}
	return invalid(validationIssue{Type: typ, Loc: loc, Msg: msg, Input: input})
}

// query reads query parameters the way FastAPI's Query() does.
type query struct {
	r    *http.Request
	errs []validationIssue
}

func newQuery(r *http.Request) *query { return &query{r: r} }

func (q *query) fail(name, typ, msg string, input any) {
	q.errs = append(q.errs, validationIssue{Type: typ, Loc: []any{"query", name}, Msg: msg, Input: input})
}

// err returns the collected validation errors, if any.
func (q *query) err() error {
	if len(q.errs) == 0 {
		return nil
	}
	return invalid(q.errs...)
}

func (q *query) raw(name string) (string, bool) {
	vals, ok := q.r.URL.Query()[name]
	if !ok || len(vals) == 0 {
		return "", false
	}
	return vals[len(vals)-1], true
}

// Str returns an optional string parameter.
func (q *query) Str(name string) *string {
	v, ok := q.raw(name)
	if !ok {
		return nil
	}
	return &v
}

// StrDefault returns a string parameter or its default.
func (q *query) StrDefault(name, def string) string {
	if v := q.Str(name); v != nil {
		return *v
	}
	return def
}

// Required returns a required string parameter.
func (q *query) Required(name string) string {
	v, ok := q.raw(name)
	if !ok {
		q.errs = append(q.errs, validationIssue{Type: "missing", Loc: []any{"query", name}, Msg: "Field required", Input: nil})
	}
	return v
}

func parseInt(s string) (int64, bool) {
	s = strings.TrimSpace(s)
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		return n, true
	}
	if f, err := strconv.ParseFloat(s, 64); err == nil && f == math.Trunc(f) && !math.IsInf(f, 0) {
		return int64(f), true
	}
	return 0, false
}

// Int returns an optional integer parameter.
func (q *query) Int(name string) *int64 {
	v, ok := q.raw(name)
	if !ok {
		return nil
	}
	n, good := parseInt(v)
	if !good {
		q.fail(name, "int_parsing", "Input should be a valid integer, unable to parse string as an integer", v)
		return nil
	}
	return &n
}

// IntRange returns an integer parameter with a default and inclusive bounds
// (math.MinInt64/MaxInt64 for none).
func (q *query) IntRange(name string, def, lo, hi int64) int64 {
	p := q.Int(name)
	if p == nil {
		return def
	}
	raw, _ := q.raw(name)
	if *p < lo {
		q.errs = append(q.errs, validationIssue{Type: "greater_than_equal", Loc: []any{"query", name}, Msg: fmt.Sprintf("Input should be greater than or equal to %d", lo), Input: raw, Ctx: map[string]any{"ge": lo}})
		return def
	}
	if *p > hi {
		q.errs = append(q.errs, validationIssue{Type: "less_than_equal", Loc: []any{"query", name}, Msg: fmt.Sprintf("Input should be less than or equal to %d", hi), Input: raw, Ctx: map[string]any{"le": hi}})
		return def
	}
	return *p
}

// Float returns an optional number parameter.
func (q *query) Float(name string) *float64 {
	v, ok := q.raw(name)
	if !ok {
		return nil
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil {
		q.fail(name, "float_parsing", "Input should be a valid number, unable to parse string as a number", v)
		return nil
	}
	return &f
}

// Bool returns an optional boolean parameter (Pydantic's accepted spellings).
func (q *query) Bool(name string) *bool {
	v, ok := q.raw(name)
	if !ok {
		return nil
	}
	b, good := parseBool(v)
	if !good {
		q.fail(name, "bool_parsing", "Input should be a valid boolean, unable to interpret input", v)
		return nil
	}
	return &b
}

// BoolDefault returns a boolean parameter or its default.
func (q *query) BoolDefault(name string, def bool) bool {
	if b := q.Bool(name); b != nil {
		return *b
	}
	return def
}

func parseBool(v string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "t", "yes", "y", "on":
		return true, true
	case "0", "false", "f", "no", "n", "off":
		return false, true
	}
	return false, false
}

// Datetime returns an optional datetime parameter as naive UTC (aware
// values are converted, naive ones are taken as UTC), like the stats
// router's _naive().
func (q *query) Datetime(name string) store.Time {
	v, ok := q.raw(name)
	if !ok {
		return store.Time{}
	}
	t, good := parseDatetime(v)
	if !good {
		q.fail(name, "datetime_from_date_parsing", "Input should be a valid datetime or date", v)
		return store.Time{}
	}
	return store.T(t)
}

// parseDatetime accepts what Pydantic accepts for a datetime: ISO 8601 with
// "T" or a space, optional fraction and offset, a bare date, or a Unix
// timestamp.
func parseDatetime(v string) (time.Time, bool) {
	v = strings.TrimSpace(v)
	if f, err := strconv.ParseFloat(v, 64); err == nil {
		sec, frac := math.Modf(f)
		if math.Abs(f) > 2e10 { // milliseconds, as Pydantic guesses
			sec, frac = math.Modf(f / 1000)
		}
		return time.Unix(int64(sec), int64(frac*1e9)).UTC(), true
	}
	s := strings.Replace(v, " ", "T", 1)
	if strings.HasSuffix(s, "z") {
		s = s[:len(s)-1] + "Z"
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.999999999Z0700", "2006-01-02T15:04Z07:00", "2006-01-02T15:04Z0700"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), true
		}
	}
	for _, layout := range []string{"2006-01-02T15:04:05.999999999", "2006-01-02T15:04", "2006-01-02"} {
		if t, err := time.ParseInLocation(layout, s, time.UTC); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// ── request bodies ────────────────────────────────────────────────────────────

// body is a decoded JSON object with the keys the client sent.
type body struct {
	raw  map[string]json.RawMessage
	errs []validationIssue
	null bool // the body was absent or JSON null
}

// readBody decodes a JSON object body. With optional, an empty body is
// allowed (FastAPI's "Body = None").
func readBody(r *http.Request, optional bool) (*body, error) {
	data, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
	if err != nil {
		return nil, err
	}
	b := &body{raw: map[string]json.RawMessage{}}
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		if optional {
			b.null = true
			return b, nil
		}
		return nil, invalid(validationIssue{Type: "missing", Loc: []any{"body"}, Msg: "Field required", Input: nil})
	}
	if err := json.Unmarshal(trimmed, &b.raw); err != nil {
		var anyVal any
		if json.Unmarshal(trimmed, &anyVal) == nil {
			return nil, invalid(validationIssue{Type: "model_attributes_type", Loc: []any{"body"}, Msg: "Input should be a valid dictionary or object to extract fields from", Input: anyVal})
		}
		return nil, invalid(validationIssue{Type: "json_invalid", Loc: []any{"body", 0}, Msg: "JSON decode error", Input: map[string]any{}})
	}
	return b, nil
}

// Has reports whether the client sent the key (even as null).
func (b *body) Has(key string) bool {
	_, ok := b.raw[key]
	return ok
}

// isNull reports whether the key was sent as null.
func (b *body) isNull(key string) bool {
	v, ok := b.raw[key]
	return ok && bytes.Equal(bytes.TrimSpace(v), []byte("null"))
}

func (b *body) fail(key, typ, msg string) {
	var input any
	json.Unmarshal(b.raw[key], &input)
	b.errs = append(b.errs, validationIssue{Type: typ, Loc: []any{"body", key}, Msg: msg, Input: input})
}

func (b *body) missing(key string) {
	b.errs = append(b.errs, validationIssue{Type: "missing", Loc: []any{"body", key}, Msg: "Field required", Input: b.input()})
}

func (b *body) input() map[string]any {
	out := map[string]any{}
	for k, v := range b.raw {
		var x any
		json.Unmarshal(v, &x)
		out[k] = x
	}
	return out
}

// err returns the collected validation errors, if any.
func (b *body) err() error {
	if len(b.errs) == 0 {
		return nil
	}
	return invalid(b.errs...)
}

// Str reads a string field. required: absent is an error; nullable: null
// is allowed (returns nil).
func (b *body) Str(key string, required, nullable bool) *string {
	if !b.Has(key) {
		if required {
			b.missing(key)
		}
		return nil
	}
	if b.isNull(key) {
		if !nullable {
			b.fail(key, "string_type", "Input should be a valid string")
		}
		return nil
	}
	var s string
	if err := json.Unmarshal(b.raw[key], &s); err != nil {
		b.fail(key, "string_type", "Input should be a valid string")
		return nil
	}
	return &s
}

// Int reads an integer field (whole floats and numeric strings are accepted,
// as Pydantic's lax mode does).
func (b *body) Int(key string, required, nullable bool) *int64 {
	if !b.Has(key) {
		if required {
			b.missing(key)
		}
		return nil
	}
	if b.isNull(key) {
		if !nullable {
			b.fail(key, "int_type", "Input should be a valid integer")
		}
		return nil
	}
	var n json.Number
	dec := json.NewDecoder(bytes.NewReader(b.raw[key]))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		b.fail(key, "int_type", "Input should be a valid integer")
		return nil
	}
	switch x := v.(type) {
	case json.Number:
		n = x
	case string:
		n = json.Number(strings.TrimSpace(x))
	default:
		b.fail(key, "int_type", "Input should be a valid integer")
		return nil
	}
	i, good := parseInt(n.String())
	if !good {
		b.fail(key, "int_parsing", "Input should be a valid integer")
		return nil
	}
	return &i
}

// Float reads a number field.
func (b *body) Float(key string, required, nullable bool) *float64 {
	if !b.Has(key) {
		if required {
			b.missing(key)
		}
		return nil
	}
	if b.isNull(key) {
		if !nullable {
			b.fail(key, "float_type", "Input should be a valid number")
		}
		return nil
	}
	var v any
	if err := json.Unmarshal(b.raw[key], &v); err != nil {
		b.fail(key, "float_type", "Input should be a valid number")
		return nil
	}
	switch x := v.(type) {
	case float64:
		return &x
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(x), 64); err == nil {
			return &f
		}
	}
	b.fail(key, "float_parsing", "Input should be a valid number")
	return nil
}

// Bool reads a boolean field.
func (b *body) Bool(key string, required, nullable bool) *bool {
	if !b.Has(key) {
		if required {
			b.missing(key)
		}
		return nil
	}
	if b.isNull(key) {
		if !nullable {
			b.fail(key, "bool_type", "Input should be a valid boolean")
		}
		return nil
	}
	var v any
	json.Unmarshal(b.raw[key], &v)
	switch x := v.(type) {
	case bool:
		return &x
	case float64:
		if x == 0 || x == 1 {
			r := x == 1
			return &r
		}
	case string:
		if r, good := parseBool(x); good {
			return &r
		}
	}
	b.fail(key, "bool_parsing", "Input should be a valid boolean")
	return nil
}

// Datetime reads a datetime field, converted to naive UTC when it carries
// an offset; aware reports whether it did.
func (b *body) Datetime(key string, required bool) (t time.Time, aware bool, okv bool) {
	if !b.Has(key) {
		if required {
			b.missing(key)
		}
		return
	}
	var v any
	json.Unmarshal(b.raw[key], &v)
	switch x := v.(type) {
	case string:
		if p, a, good := parseDatetimeAware(x); good {
			return p, a, true
		}
	case float64:
		if p, good := parseDatetime(strconv.FormatFloat(x, 'f', -1, 64)); good {
			return p, true, true
		}
	}
	b.fail(key, "datetime_from_date_parsing", "Input should be a valid datetime")
	return
}

// parseDatetimeAware is parseDatetime that also says whether the input had
// an offset. Naive inputs are returned as the same wall time.
func parseDatetimeAware(v string) (time.Time, bool, bool) {
	s := strings.Replace(strings.TrimSpace(v), " ", "T", 1)
	for _, layout := range []string{"2006-01-02T15:04:05.999999999", "2006-01-02T15:04", "2006-01-02"} {
		if t, err := time.ParseInLocation(layout, s, time.UTC); err == nil {
			return t, false, true
		}
	}
	if t, good := parseDatetime(v); good {
		return t, true, true
	}
	return time.Time{}, false, false
}

// IntList reads a list of integers.
func (b *body) IntList(key string, required bool) []int64 {
	if !b.Has(key) {
		if required {
			b.missing(key)
		}
		return nil
	}
	var raw []json.RawMessage
	if err := json.Unmarshal(b.raw[key], &raw); err != nil {
		b.fail(key, "list_type", "Input should be a valid list")
		return nil
	}
	out := make([]int64, 0, len(raw))
	for _, r := range raw {
		var v any
		json.Unmarshal(r, &v)
		switch x := v.(type) {
		case float64:
			if x == math.Trunc(x) {
				out = append(out, int64(x))
				continue
			}
		case string:
			if n, good := parseInt(x); good {
				out = append(out, n)
				continue
			}
		}
		b.fail(key, "int_type", "Input should be a valid integer")
		return nil
	}
	return out
}

// StrList reads a list of strings.
func (b *body) StrList(key string, required bool) []string {
	if !b.Has(key) {
		if required {
			b.missing(key)
		}
		return nil
	}
	var out []string
	if err := json.Unmarshal(b.raw[key], &out); err != nil {
		b.fail(key, "list_type", "Input should be a valid list")
		return nil
	}
	if out == nil {
		out = []string{}
	}
	return out
}

// Raw returns the raw JSON of a field.
func (b *body) Raw(key string) json.RawMessage { return b.raw[key] }

// pathInt reads an integer path parameter.
func pathInt(r *http.Request, name string) (int64, error) {
	v := r.PathValue(name)
	n, good := parseInt(v)
	if !good {
		return 0, invalidField("path", name, "int_parsing", "Input should be a valid integer, unable to parse string as an integer", v)
	}
	return n, nil
}

// ── Python number formatting ─────────────────────────────────────────────────

// pyRound is Python's round(x, ndigits) for floats: the correctly rounded
// decimal, ties to even.
func pyRound(x float64, ndigits int) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	f, _ := strconv.ParseFloat(strconv.FormatFloat(x, 'f', ndigits, 64), 64)
	return f
}

// pyRoundInt is Python's round(x) (ties to even).
func pyRoundInt(x float64) int64 {
	return int64(math.RoundToEven(x))
}

func jsonUnmarshalString(raw json.RawMessage, s *string) error { return json.Unmarshal(raw, s) }

// parseWallClock parses an ISO datetime and keeps its wall clock, dropping
// any offset (Python's dt.replace(tzinfo=None)).
func parseWallClock(v string) (time.Time, bool) {
	s := strings.Replace(strings.TrimSpace(v), " ", "T", 1)
	if strings.HasSuffix(s, "z") {
		s = s[:len(s)-1] + "Z"
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.999999999Z0700", "2006-01-02T15:04Z07:00"} {
		if t, err := time.Parse(layout, s); err == nil {
			return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), time.UTC), true
		}
	}
	for _, layout := range []string{"2006-01-02T15:04:05.999999999", "2006-01-02T15:04", "2006-01-02"} {
		if t, err := time.ParseInLocation(layout, s, time.UTC); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
