package scrapers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Some sites (RoyalRoad) sit behind bot walls: a Cloudflare challenge and an
// Anubis proof-of-work page. A plain HTTP client can't pass them, and the
// clearance cookies a browser earns don't work from another client, so walled
// pages are fetched through a FlareSolverr instance (a real browser) instead.

// Solver fetches walled pages; nil when no FlareSolverr is configured.
var Solver *FlareSolverr

// BotWallError is a page hidden behind a bot check Shelfloom couldn't pass.
type BotWallError struct {
	URL    string
	Reason string
}

func (e *BotWallError) Error() string {
	return fmt.Sprintf("%s is behind a bot check (Cloudflare/Anubis): %s", bareHost(e.URL), e.Reason)
}

var challengeTitle = regexp.MustCompile(`(?i)<title>\s*(Just a moment\.\.\.|Attention Required!|Making sure you're not a bot!)`)

// isBotWall tells whether a response is a bot check rather than the page.
func isBotWall(status int, header http.Header, body []byte) bool {
	if header.Get("Cf-Mitigated") == "challenge" {
		return true
	}
	if status != http.StatusOK && status != http.StatusForbidden && status != http.StatusServiceUnavailable {
		return false
	}
	return bytes.Contains(body, []byte(`id="anubis_challenge"`)) || challengeTitle.Match(body)
}

// FlareSolverr talks to a FlareSolverr server. It keeps one browser session
// open while pages are being fetched (a session holds the clearance cookies,
// so only its first page waits for the checks) and closes it when idle, since
// an open session costs about a gigabyte of RAM.
type FlareSolverr struct {
	URL         string
	Client      *http.Client
	IdleTimeout time.Duration
	// WallTTL is how long a host is fetched through the solver before a
	// direct request is tried again.
	WallTTL time.Duration

	mu      sync.Mutex // one request at a time; guards the fields below
	session string
	idle    *time.Timer
	walled  map[string]time.Time
}

// NewFlareSolverr returns a solver for the FlareSolverr at url
// (e.g. http://flaresolverr:8191).
func NewFlareSolverr(url string) *FlareSolverr {
	return &FlareSolverr{
		URL:         strings.TrimRight(url, "/") + "/v1",
		Client:      &http.Client{Timeout: 150 * time.Second},
		IdleTimeout: 2 * time.Minute,
		WallTTL:     6 * time.Hour,
		walled:      map[string]time.Time{},
	}
}

// isWalled tells whether host was recently seen behind a bot wall.
func (f *FlareSolverr) isWalled(host string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return time.Since(f.walled[host]) < f.WallTTL
}

type solverResponse struct {
	Status   string `json:"status"`
	Message  string `json:"message"`
	Solution struct {
		URL      string `json:"url"`
		Status   int    `json:"status"`
		Response string `json:"response"`
	} `json:"solution"`
}

func (f *FlareSolverr) call(ctx context.Context, payload map[string]any) (*solverResponse, error) {
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, f.URL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := f.Client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("FlareSolverr: %w", err)
	}
	defer resp.Body.Close()
	var out solverResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("FlareSolverr: %w", err)
	}
	if out.Status != "ok" {
		return &out, fmt.Errorf("FlareSolverr: %s", out.Message)
	}
	return &out, nil
}

// closeSession destroys the open session. Call with f.mu held.
func (f *FlareSolverr) closeSession() {
	if f.session == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if _, err := f.call(ctx, map[string]any{"cmd": "sessions.destroy", "session": f.session}); err != nil {
		slog.Warn("could not close the FlareSolverr session", "err", err)
	}
	f.session = ""
}

// get fetches url through FlareSolverr and marks its host as walled.
func (f *FlareSolverr) get(ctx context.Context, url string) ([]byte, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.walled[bareHost(url)] = time.Now()
	if f.idle != nil {
		f.idle.Stop()
	}
	defer func() {
		f.idle = time.AfterFunc(f.IdleTimeout, func() {
			f.mu.Lock()
			defer f.mu.Unlock()
			f.closeSession()
		})
	}()
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		if f.session == "" {
			name := "shelfloom-" + strconv.FormatInt(time.Now().UnixNano(), 36)
			if _, err := f.call(ctx, map[string]any{"cmd": "sessions.create", "session": name}); err != nil {
				return nil, err
			}
			f.session = name
		}
		// The first answer can still be a check page (Anubis needs its
		// script to finish); ask again, letting the browser wait it out.
		for _, wait := range []int{0, 10} {
			out, err := f.call(ctx, map[string]any{"cmd": "request.get", "url": url, "session": f.session, "maxTimeout": 90000, "waitInSeconds": wait})
			if err != nil {
				if ctx.Err() != nil {
					return nil, ctx.Err()
				}
				// The session may be gone (FlareSolverr restarted): open a new one.
				lastErr = err
				f.session = ""
				break
			}
			page := []byte(out.Solution.Response)
			if isBotWall(out.Solution.Status, http.Header{}, page) {
				lastErr = &BotWallError{URL: url, Reason: "FlareSolverr could not get past it"}
				continue
			}
			if out.Solution.Status >= 400 {
				return nil, &HTTPError{Status: out.Solution.Status, URL: url}
			}
			return page, nil
		}
		var wall *BotWallError
		if errors.As(lastErr, &wall) {
			return nil, lastErr
		}
	}
	return nil, lastErr
}
