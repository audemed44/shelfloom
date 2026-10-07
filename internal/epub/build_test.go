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
