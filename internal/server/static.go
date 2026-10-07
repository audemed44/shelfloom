package server

import (
	"io"
	"mime"
	"net/http"
	"path"
	"strings"
)

func init() {
	// Serve the PWA manifest with its registered media type.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
}

// serveFrontend serves a file from the built frontend, or index.html for
// any other path so the single-page app can route it. Missing files under
// /assets/ are a 404: they are hashed bundles, never app routes.
func (s *Server) serveFrontend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"detail": "Method Not Allowed"})
		return
	}
	if s.Frontend == nil {
		http.NotFound(w, r)
		return
	}
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if name != "" && s.serveFile(w, r, name) {
		return
	}
	if strings.HasPrefix(name, "assets/") {
		http.NotFound(w, r)
		return
	}
	if !s.serveFile(w, r, "index.html") {
		http.NotFound(w, r)
	}
}

// serveFile serves one regular file and reports whether it existed.
func (s *Server) serveFile(w http.ResponseWriter, r *http.Request, name string) bool {
	f, err := s.Frontend.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	content, ok := f.(io.ReadSeeker)
	if !ok {
		return false
	}
	if name == "index.html" {
		// The shell names the current bundles; always revalidate it.
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeContent(w, r, name, info.ModTime(), content)
	return true
}
