package scrapers

import "testing"

// Cases checked against CPython's urllib.parse.urljoin.
func TestURLJoin(t *testing.T) {
	cases := []struct{ base, href, want string }{
		{"https://www.royalroad.com/fiction/81002/the-years", "/fiction/81002/the-years/chapter/1/one", "https://www.royalroad.com/fiction/81002/the-years/chapter/1/one"},
		{"https://a.com/b/c/d", "e", "https://a.com/b/c/e"},
		{"https://a.com/b/c/d", "../e", "https://a.com/b/e"},
		{"https://a.com/b/c/", "./e/", "https://a.com/b/c/e/"},
		{"https://a.com/b/c/d", "//x.com/y", "https://x.com/y"},
		{"https://a.com/b/c/d?q=1", "?p=2", "https://a.com/b/c/d?p=2"},
		{"https://a.com/b/c/d?q=1", "#f", "https://a.com/b/c/d?q=1#f"},
		{"https://a.com/b", "http://other.com/z/../w", "http://other.com/z/../w"},
		{"https://a.com/b/c", "mailto:x@y", "mailto:x@y"},
		{"https://a.com", "x", "https://a.com/x"},
		{"https://a.com/a//b/c", "d", "https://a.com/a/b/d"},
		{"https://a.com/b/c", "..", "https://a.com/"},
	}
	for _, c := range cases {
		if got := urljoin(c.base, c.href); got != c.want {
			t.Errorf("urljoin(%q, %q) = %q, want %q", c.base, c.href, got, c.want)
		}
	}
}
