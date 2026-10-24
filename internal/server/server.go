// Package server is Shelfloom's HTTP API and the built frontend it serves.
package server

import (
	"context"
	"io/fs"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/audemed44/shelfloom/internal/logging"
	"github.com/audemed44/shelfloom/internal/store"
)

// Config is what the server takes from the environment (SHELFLOOM_*).
type Config struct {
	CoversDir           string
	DefaultShelfName    string
	DefaultShelfPath    string
	ScanInterval        time.Duration
	SerialCheckInterval time.Duration
	// FoyerURL links the sidebar back to the homelab's start page.
	FoyerURL string
	// Z-Library account for searching and adding books; off without an
	// email and password.
	ZLibraryDomain   string
	ZLibraryEmail    string
	ZLibraryPassword string
	// OpenRouter account for AI recommendations; off without a key.
	// OpenRouterURL overrides the API's base URL (tests).
	OpenRouterKey   string
	OpenRouterModel string
	OpenRouterURL   string
}

// Server holds what the handlers need.
type Server struct {
	DB     *store.DB
	Config Config
	// Frontend is the built frontend (frontend/dist). Nil serves no frontend.
	Frontend fs.FS

	mux *http.ServeMux

	scan    scanState
	fetches fetchJobs
	zl      zlibState
	recs    recState

	// epubMetaNudge asks epubMetadataLoop to write library metadata into
	// EPUBs after an edit.
	epubMetaNudge chan struct{}

	// bg tracks background work (scans, chapter fetches) so shutdown can
	// wait for it.
	bg    sync.WaitGroup
	bgCtx context.Context
}

// Handler returns the root handler.
func (s *Server) Handler() http.Handler {
	if s.bgCtx == nil {
		s.bgCtx = context.Background()
	}
	s.epubMetaNudge = make(chan struct{}, 1)
	s.mux = http.NewServeMux()
	for _, r := range s.routes() {
		s.mux.HandleFunc(r.pattern, s.wrap(r.handler))
	}
	// One log line per request (logging.Requests), named by route.
	return logging.Requests(http.HandlerFunc(s.serve))
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	if _, pattern := s.mux.Handler(r); pattern != "" {
		// ServeHTTP (not the handler Handler returns) sets r.PathValue.
		s.mux.ServeHTTP(w, r)
		if changesLibrary(r) {
			s.queueEPUBMetadataSync()
		}
		return
	}
	if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
		writeJSON(w, http.StatusNotFound, map[string]string{"detail": "Not Found"})
		return
	}
	s.serveFrontend(w, r)
}

type route struct {
	pattern string
	handler handlerFunc
}
