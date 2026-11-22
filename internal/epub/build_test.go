package epub

import "testing"

// Expected values come from the Python backend's _slugify.
func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"Pact: Awakening":                    "pact-awakening",
		"The Years of Apocalypse - Volume 3": "the-years-of-apocalypse-volume-3",
		"Ölbaum — Über  das_Meer":            "ölbaum-über-das-meer",
		"  --x--  ":                          "x",
		"日本語のタイトル":                           "日本語のタイトル",
		"":                                   "untitled",
	}
	for in, want := range cases {
		if got := Slugify(in); got != want {
			t.Errorf("Slugify(%q) = %q, want %q", in, got, want)
		}
	}
}

// Long titles that differ only after the cut get different slugs.
func TestSlugifyLongTitles(t *testing.T) {
	base := "Surprisingly Enough(NOT), Common Sense Is Overpowered in Cliché Cultivation World - Volume "
	a, b := Slugify(base+"1"), Slugify(base+"2")
	if a == b {
		t.Fatalf("volumes 1 and 2 share slug %q", a)
	}
	if n := len([]rune(a)); n > 80 {
		t.Fatalf("slug %q is %d characters, want at most 80", a, n)
	}
	if Slugify(base+"1") != a {
		t.Fatal("slug is not stable")
	}
}

func TestExpandSelfClosing(t *testing.T) {
	cases := map[string]string{
		`<script src="a.js" type="text/javascript"/>`: `<script src="a.js" type="text/javascript"></script>`,
		`<a id="x"/><br/><img src="a"/>`:              `<a id="x"></a><br/><img src="a"/>`,
		`<p title="a/>b">x</p>`:                       `<p title="a/>b">x</p>`,
		`<div   />`:                                   `<div></div>`,
		`a < b/> c`:                                   `a < b/> c`,
	}
	for in, want := range cases {
		if got := string(expandSelfClosing([]byte(in))); got != want {
			t.Errorf("expandSelfClosing(%q) = %q, want %q", in, got, want)
		}
	}
}
