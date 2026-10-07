package koreader

import (
	"fmt"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// Annotation is a KOReader highlight or note.
type Annotation struct {
	Text    string
	Note    *string
	Chapter *string
	Page    *int64
	Created *time.Time
}

// SDR is what a .sdr folder's metadata file holds.
type SDR struct {
	PartialMD5      *string
	DocPath         *string
	Title           *string
	Authors         *string
	PercentFinished *float64
	LastXPointer    *string
	// PerformanceInPages maps a Unix time to pages read at that time.
	PerformanceInPages map[int64]int64
	Annotations        []Annotation
}

// truthyString is Python's "x or None" for a value expected to be a string.
func truthyString(v any) *string {
	switch x := v.(type) {
	case string:
		if x != "" {
			return &x
		}
	case nil:
	default:
		if truthy(v) {
			s := fmt.Sprint(v)
			return &s
		}
	}
	return nil
}

func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case int64:
		return x != 0
	case float64:
		return x != 0
	case string:
		return x != ""
	case *Table:
		return len(x.Keys) > 0
	}
	return true
}

func tableOf(v any) *Table {
	t, _ := v.(*Table)
	return t
}

// ReadSDR parses the metadata.*.lua file of a .sdr folder; nil when there
// is none or it can't be read.
func ReadSDR(dir string) *SDR {
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return nil
	}
	matches, _ := filepath.Glob(filepath.Join(globEscape(dir), "metadata.*.lua"))
	if len(matches) == 0 {
		return nil
	}
	sort.Strings(matches)
	file := matches[0]
	data, err := os.ReadFile(file)
	if err != nil {
		return nil
	}
	text := strings.ToValidUTF8(string(data), "�")
	if !utf8.ValidString(text) {
		return nil
	}
	v, err := ParseLua(text)
	if err != nil {
		slog.Warn(fmt.Sprintf("Failed to parse %s: %s", file, err))
		return nil
	}
	raw := tableOf(v)
	if raw == nil {
		slog.Warn(fmt.Sprintf("Expected dict from %s", file))
		return nil
	}
	get := func(t *Table, k string) any {
		x, _ := t.Get(k)
		return x
	}
	docProps := tableOf(get(raw, "doc_props"))
	stats := tableOf(get(raw, "stats"))
	s := &SDR{
		PartialMD5:         truthyString(get(raw, "partial_md5_checksum")),
		DocPath:            truthyString(get(raw, "doc_path")),
		LastXPointer:       truthyString(get(raw, "last_xpointer")),
		PerformanceInPages: map[int64]int64{},
	}
	if docProps != nil {
		s.Title = truthyString(get(docProps, "title"))
		s.Authors = truthyString(get(docProps, "authors"))
	}
	switch pf := get(raw, "percent_finished").(type) {
	case float64:
		if pf != 0 {
			s.PercentFinished = &pf
		}
	case int64:
		if pf != 0 {
			f := float64(pf)
			s.PercentFinished = &f
		}
	}
	if stats != nil {
		if perf := tableOf(get(stats, "performance_in_pages")); perf != nil {
			for _, k := range perf.Keys {
				ts, ok1 := toInt(k)
				pages, ok2 := toInt(perf.Vals[k])
				if ok1 && ok2 {
					s.PerformanceInPages[ts] = pages
				}
			}
		}
	}
	if anns := tableOf(get(raw, "annotations")); anns != nil {
		keys := append([]any(nil), anns.Keys...)
		sort.SliceStable(keys, func(i, j int) bool { return intKey(keys[i]) < intKey(keys[j]) })
		for _, k := range keys {
			ann := tableOf(anns.Vals[k])
			if ann == nil {
				continue
			}
			text := get(ann, "text")
			if !truthy(text) {
				continue
			}
			a := Annotation{Text: fmt.Sprint(text)}
			if note, ok := get(ann, "note").(string); ok && note != "" {
				a.Note = &note
			}
			a.Chapter = truthyString(get(ann, "chapter"))
			if pg, ok := toInt(get(ann, "pageno")); ok && pg != 0 {
				a.Page = &pg
			}
			if dt, ok := get(ann, "datetime").(string); ok && dt != "" {
				if t, err := time.Parse("2006-01-02 15:04:05", dt); err == nil {
					a.Created = &t
				}
			}
			s.Annotations = append(s.Annotations, a)
		}
	}
	return s
}

// intKey sorts like Python's key=lambda k: k if isinstance(k, int) else 0.
func intKey(k any) int64 {
	if n, ok := k.(int64); ok {
		return n
	}
	return 0
}

// toInt is Python's int(v) for numbers and numeric strings.
func toInt(v any) (int64, bool) {
	switch x := v.(type) {
	case int64:
		return x, true
	case float64:
		if math.IsInf(x, 0) || math.IsNaN(x) {
			return 0, false
		}
		return int64(x), true
	case bool:
		if x {
			return 1, true
		}
		return 0, true
	case string:
		var n int64
		if _, err := fmt.Sscan(strings.TrimSpace(x), &n); err == nil {
			return n, true
		}
	}
	return 0, false
}

func globEscape(p string) string {
	r := strings.NewReplacer("[", "[[]", "*", "[*]", "?", "[?]")
	return r.Replace(p)
}

// Session is a reading session built from KOReader data.
type Session struct {
	Start     time.Time // naive UTC
	Duration  int64
	PagesRead int64
	SourceKey string
}

// SessionGap splits sessions: more than this between pages starts a new one.
const SessionGap = 600

// SDRSessions groups performance_in_pages into sessions.
func SDRSessions(perf map[int64]int64, partialMD5, docPath *string) []Session {
	if len(perf) == 0 {
		return nil
	}
	ts := make([]int64, 0, len(perf))
	for t := range perf {
		ts = append(ts, t)
	}
	sort.Slice(ts, func(i, j int) bool { return ts[i] < ts[j] })
	var out []Session
	group := []int64{ts[0]}
	build := func(g []int64) Session {
		start, end := g[0], g[len(g)-1]
		var pages int64
		for _, t := range g {
			pages += perf[t]
		}
		duration := end - start + 60
		if len(g) == 1 {
			duration = max(60, pages*60)
		}
		var key string
		switch {
		case partialMD5 != nil && *partialMD5 != "":
			key = fmt.Sprintf("sdr:%s:%d", *partialMD5, start)
		case docPath != nil && *docPath != "":
			key = fmt.Sprintf("sdr:path:%s:%d", *docPath, start)
		default:
			key = fmt.Sprintf("sdr:unknown:%d", start)
		}
		return Session{Start: time.Unix(start, 0).UTC(), Duration: duration, PagesRead: pages, SourceKey: key}
	}
	for _, t := range ts[1:] {
		if t-group[len(group)-1] > SessionGap {
			out = append(out, build(group))
			group = []int64{t}
		} else {
			group = append(group, t)
		}
	}
	return append(out, build(group))
}
