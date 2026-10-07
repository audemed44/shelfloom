package scrapers

import "strings"

// schemeOf returns a URL's scheme, or "".
func schemeOf(u string) string {
	for i, c := range u {
		switch {
		case c == ':':
			if i == 0 {
				return ""
			}
			return u[:i]
		case (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'):
		case i > 0 && ((c >= '0' && c <= '9') || c == '+' || c == '-' || c == '.'):
		default:
			return ""
		}
	}
	return ""
}

// splitURL splits into scheme, netloc, path, query (with "?" kept as a flag)
// and fragment, the way urllib.parse.urlsplit does.
type splitURL struct {
	scheme, netloc, path, query, fragment string
	hasNetloc, hasQuery, hasFragment      bool
}

func urlsplit(u string) splitURL {
	var s splitURL
	if sc := schemeOf(u); sc != "" {
		s.scheme = strings.ToLower(sc)
		u = u[len(sc)+1:]
	}
	if strings.HasPrefix(u, "//") {
		u = u[2:]
		end := strings.IndexAny(u, "/?#")
		if end < 0 {
			end = len(u)
		}
		s.netloc, s.hasNetloc = u[:end], true
		u = u[end:]
	}
	if i := strings.IndexByte(u, '#'); i >= 0 {
		s.fragment, s.hasFragment = u[i+1:], true
		u = u[:i]
	}
	if i := strings.IndexByte(u, '?'); i >= 0 {
		s.query, s.hasQuery = u[i+1:], true
		u = u[:i]
	}
	s.path = u
	return s
}

func (s splitURL) String() string {
	var b strings.Builder
	if s.scheme != "" {
		b.WriteString(s.scheme + ":")
	}
	if s.hasNetloc || (s.scheme != "" && s.netloc != "") || strings.HasPrefix(s.path, "//") {
		b.WriteString("//" + s.netloc)
	}
	b.WriteString(s.path)
	if s.query != "" {
		b.WriteString("?" + s.query)
	}
	if s.fragment != "" {
		b.WriteString("#" + s.fragment)
	}
	return b.String()
}

// urljoin is urllib.parse.urljoin for http(s) URLs, ported from CPython
// (without re-encoding anything).
func urljoin(base, href string) string {
	if base == "" {
		return href
	}
	if href == "" {
		return base
	}
	b, r := urlsplit(base), urlsplit(href)
	if r.scheme == "" {
		r.scheme = b.scheme
	}
	if r.scheme != b.scheme || (r.scheme != "http" && r.scheme != "https") {
		return href
	}
	if r.hasNetloc && r.netloc != "" {
		return r.String()
	}
	r.netloc, r.hasNetloc = b.netloc, b.hasNetloc
	if r.path == "" {
		r.path = b.path
		if r.query == "" {
			r.query = b.query
		}
		return r.String()
	}
	baseParts := strings.Split(b.path, "/")
	if baseParts[len(baseParts)-1] != "" {
		baseParts = baseParts[:len(baseParts)-1]
	}
	var segments []string
	if strings.HasPrefix(r.path, "/") {
		segments = strings.Split(r.path, "/")
	} else {
		segments = append(append([]string{}, baseParts...), strings.Split(r.path, "/")...)
		if len(segments) > 2 {
			middle := segments[1 : len(segments)-1]
			kept := []string{segments[0]}
			for _, m := range middle {
				if m != "" {
					kept = append(kept, m)
				}
			}
			segments = append(kept, segments[len(segments)-1])
		}
	}
	var resolved []string
	for _, seg := range segments {
		switch seg {
		case "..":
			if len(resolved) > 0 {
				resolved = resolved[:len(resolved)-1]
			}
		case ".":
		default:
			resolved = append(resolved, seg)
		}
	}
	if last := segments[len(segments)-1]; last == "." || last == ".." {
		resolved = append(resolved, "")
	}
	r.path = strings.Join(resolved, "/")
	if r.path == "" {
		r.path = "/"
	}
	return r.String()
}
