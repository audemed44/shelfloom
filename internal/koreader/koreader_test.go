package koreader

import (
	"os"
	"path/filepath"
	"testing"
)

func mustParse(t *testing.T, src string) any {
	t.Helper()
	v, err := ParseLua(src)
	if err != nil {
		t.Fatalf("ParseLua(%q): %v", src, err)
	}
	return v
}

func get(t *testing.T, v any, keys ...any) any {
	t.Helper()
	for _, k := range keys {
		tbl, ok := v.(*Table)
		if !ok {
			t.Fatalf("not a table at %v", k)
		}
		v, _ = tbl.Get(k)
	}
	return v
}

// Cases follow the Python backend's tests/test_lua_parser.py.
func TestParseLua(t *testing.T) {
	v := mustParse(t, `{a = 1, ["b"] = "two", [3] = true, "pos"}`)
	if get(t, v, "a") != int64(1) || get(t, v, "b") != "two" || get(t, v, int64(3)) != true || get(t, v, int64(1)) != "pos" {
		t.Errorf("%+v", v)
	}
	v = mustParse(t, `return { x = { y = { z = -1.5e2 } }, list = { 10, 20, 30 }, h = 0x1F, n = nil, f = false }`)
	if get(t, v, "x", "y", "z") != -150.0 || get(t, v, "list", int64(3)) != int64(30) || get(t, v, "h") != int64(31) || get(t, v, "f") != false {
		t.Errorf("%+v", v)
	}
	v = mustParse(t, `{ s = "a\nb\t\\\"\65", q = 'it''s'}`)
	_ = v
	v = mustParse(t, "{ s = \"a\\nb\\t\\\\\\\"\\65\" }")
	if get(t, v, "s") != "a\nb\t\\\"A" {
		t.Errorf("%q", get(t, v, "s"))
	}
	v = mustParse(t, "{ l = [==[\nline ]] still]==], c = 1 -- comment\n --[[ long\ncomment ]] ; d = 2 }")
	if get(t, v, "l") != "line ]] still" || get(t, v, "d") != int64(2) {
		t.Errorf("%+v", v)
	}
	v = mustParse(t, "local Page = { a = 1 }\nreturn Page")
	if get(t, v, "a") != int64(1) {
		t.Error(v)
	}
	for _, bad := range []string{"local A = {} return B", "{ a = 1", `{ a = "x }`, "{ a = }"} {
		if _, err := ParseLua(bad); err == nil {
			t.Errorf("ParseLua(%q) should fail", bad)
		}
	}
}

func TestReadSDR(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "The Way of Kings.epub.sdr")
	os.MkdirAll(dir, 0o755)
	data, _ := os.ReadFile("testdata/metadata.epub.lua")
	os.WriteFile(filepath.Join(dir, "metadata.epub.lua"), data, 0o644)
	s := ReadSDR(dir)
	if s == nil {
		t.Fatal("nil")
	}
	if *s.Title != "The Way of Kings" || *s.Authors != "Brandon Sanderson" || len(s.Annotations) != 2 {
		t.Fatalf("%+v", s)
	}
	a := s.Annotations[0]
	if a.Text != "Life before death." || *a.Note != "Interesting motto" || *a.Page != 5 || a.Created.Format("2006-01-02 15:04:05") != "2024-01-15 20:30:00" {
		t.Errorf("%+v", a)
	}
	if s.Annotations[1].Note != nil {
		t.Error("empty note should be nil")
	}
	if ReadSDR(filepath.Join(t.TempDir(), "missing.sdr")) != nil {
		t.Error("missing folder")
	}
}

func TestSessionsFromPerformance(t *testing.T) {
	md5 := "abc"
	perf := map[int64]int64{1000: 1, 1100: 2, 1300: 1, 5000: 3}
	got := SDRSessions(perf, &md5, nil)
	if len(got) != 2 {
		t.Fatalf("%+v", got)
	}
	if got[0].Duration != 360 || got[0].PagesRead != 4 || got[0].SourceKey != "sdr:abc:1000" {
		t.Errorf("%+v", got[0])
	}
	if got[1].Duration != 180 || got[1].SourceKey != "sdr:abc:5000" {
		t.Errorf("%+v", got[1])
	}
	rows := []pageRow{{1, 100, 30}, {2, 140, 30}, {2, 900, 10}}
	ss := statsSessions(rows, nil, 7)
	if len(ss) != 2 || ss[0].Duration != 60 || ss[0].PagesRead != 2 || ss[1].SourceKey != "stats_db:id7:900" {
		t.Errorf("%+v", ss)
	}
}
