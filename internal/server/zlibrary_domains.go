package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/audemed44/shelfloom/internal/zlibrary"
)

// zlibBuiltinDomains are Z-Library's published main domains and mirror
// (October 2026). Lookalike domains phish for accounts: only official
// ones belong here.
var zlibBuiltinDomains = []string{
	"z-lib.sk",
	"z-library.im",
	"z-library.sk",
	"z-library.hn",
	"libb.la",
}

const (
	settingZLibDomain     = "zlibrary_domain"
	settingZLibDomains    = "zlibrary_custom_domains"
	settingZLibAPIDomains = "zlibrary_api_domains"
)

// Where a domain in the list comes from.
const (
	domainOfficial = "official" // built in
	domainZLibrary = "zlibrary" // from Z-Library's own domain list
	domainCustom   = "custom"   // added in Settings
)

// zlibAPIDomains is the last domain list fetched from Z-Library.
type zlibAPIDomains struct {
	Domains   []string  `json:"domains"`
	From      string    `json:"from"`
	FetchedAt time.Time `json:"fetched_at"`
}

func (s *Server) apiZLibDomains(ctx context.Context) (zlibAPIDomains, error) {
	var out zlibAPIDomains
	_, err := s.getSetting(ctx, settingZLibAPIDomains, &out)
	return out, err
}

// getSetting decodes a setting into out; false when it isn't set.
func (s *Server) getSetting(ctx context.Context, key string, out any) (bool, error) {
	var raw string
	err := s.DB.QueryRowContext(ctx, "SELECT value FROM settings WHERE key = ?", key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, json.Unmarshal([]byte(raw), out)
}

func (s *Server) putSetting(ctx context.Context, key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, string(raw))
	return err
}

// defaultZLibDomain is the domain from the environment, or the first
// built-in one.
func (s *Server) defaultZLibDomain() string {
	if d, err := normalizeDomain(s.Config.ZLibraryDomain); err == nil {
		return d
	}
	return zlibBuiltinDomains[0]
}

// zlibDomain is the domain picked in Settings, else the default.
func (s *Server) zlibDomain(ctx context.Context) string {
	var d string
	if found, err := s.getSetting(ctx, settingZLibDomain, &d); err == nil && found && d != "" {
		return d
	}
	return s.defaultZLibDomain()
}

func (s *Server) customZLibDomains(ctx context.Context) ([]string, error) {
	var out []string
	if _, err := s.getSetting(ctx, settingZLibDomains, &out); err != nil {
		return nil, err
	}
	return out, nil
}

var domainPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$`)

// normalizeDomain turns "https://Z-Library.hn/" into "z-library.hn". A
// plain-http address keeps its scheme.
func normalizeDomain(in string) (string, error) {
	in = strings.TrimSpace(in)
	if in == "" {
		return "", errors.New("empty")
	}
	scheme := "https"
	if strings.Contains(in, "://") {
		u, err := url.Parse(in)
		if err != nil || u.Host == "" {
			return "", errors.New("not a domain")
		}
		scheme, in = strings.ToLower(u.Scheme), u.Host
	} else if i := strings.IndexAny(in, "/?#"); i >= 0 {
		in = in[:i]
	}
	in = strings.ToLower(strings.TrimSuffix(in, "."))
	if !domainPattern.MatchString(in) || (!strings.Contains(in, ".") && !strings.Contains(in, ":")) {
		return "", errors.New("not a domain")
	}
	switch scheme {
	case "https":
		return in, nil
	case "http":
		return "http://" + in, nil
	}
	return "", errors.New("only http and https addresses work")
}

type zlibDomainOut struct {
	Domain string `json:"domain"`
	Source string `json:"source"`
}

// zlibDomainList is every domain on offer: official ones, then Z-Library's
// own list, then the user's.
func (s *Server) zlibDomainList(ctx context.Context) ([]zlibDomainOut, zlibAPIDomains, error) {
	custom, err := s.customZLibDomains(ctx)
	if err != nil {
		return nil, zlibAPIDomains{}, err
	}
	fetched, err := s.apiZLibDomains(ctx)
	if err != nil {
		return nil, zlibAPIDomains{}, err
	}
	domains := []zlibDomainOut{}
	seen := map[string]bool{}
	add := func(d, source string) {
		if !seen[d] {
			seen[d] = true
			domains = append(domains, zlibDomainOut{Domain: d, Source: source})
		}
	}
	for _, d := range zlibBuiltinDomains {
		add(d, domainOfficial)
	}
	add(s.defaultZLibDomain(), domainOfficial)
	for _, d := range fetched.Domains {
		add(d, domainZLibrary)
	}
	for _, d := range custom {
		add(d, domainCustom)
	}
	return domains, fetched, nil
}

func (s *Server) zlibDomainsResponse(ctx context.Context) (map[string]any, error) {
	domains, fetched, err := s.zlibDomainList(ctx)
	if err != nil {
		return nil, err
	}
	out := map[string]any{
		"selected":     s.zlibDomain(ctx),
		"default":      s.defaultZLibDomain(),
		"enabled":      s.zlib() != nil,
		"domains":      domains,
		"fetched_from": nil,
		"fetched_at":   nil,
	}
	if fetched.From != "" {
		out["fetched_from"] = fetched.From
		out["fetched_at"] = fetched.FetchedAt.Unix()
	}
	return out, nil
}

// zlibRefreshDomainsHandler fetches Z-Library's current domain list, asking
// the domain in use first and then the others until one answers.
func (s *Server) zlibRefreshDomainsHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	domains, _, err := s.zlibDomainList(ctx)
	if err != nil {
		return err
	}
	order := []string{s.zlibDomain(ctx)}
	for _, d := range domains {
		if d.Domain != order[0] {
			order = append(order, d.Domain)
		}
	}
	var lastErr error
	for _, from := range order {
		tctx, cancel := context.WithTimeout(ctx, 10*time.Second)
		list, err := zlibrary.New(from, "", "").Domains(tctx)
		cancel()
		if err != nil {
			lastErr = err
			continue
		}
		var clean []string
		for _, d := range list {
			if n, err := normalizeDomain(d); err == nil && !slices.Contains(clean, n) {
				clean = append(clean, n)
			}
		}
		if err := s.putSetting(ctx, settingZLibAPIDomains, zlibAPIDomains{Domains: clean, From: from, FetchedAt: time.Now().UTC()}); err != nil {
			return err
		}
		return s.zlibDomainsHandler(w, r)
	}
	return errStatus(http.StatusBadGateway, "No Z-Library domain answered: "+lastErr.Error())
}

func (s *Server) zlibDomainsHandler(w http.ResponseWriter, r *http.Request) error {
	out, err := s.zlibDomainsResponse(r.Context())
	if err != nil {
		return err
	}
	return ok(w, out)
}

// zlibKnownDomain reports whether d is in the list.
func (s *Server) zlibKnownDomain(ctx context.Context, d string) (bool, error) {
	domains, _, err := s.zlibDomainList(ctx)
	if err != nil {
		return false, err
	}
	return slices.ContainsFunc(domains, func(x zlibDomainOut) bool { return x.Domain == d }), nil
}

func (s *Server) selectZLibDomain(ctx context.Context, d string) error {
	if err := s.putSetting(ctx, settingZLibDomain, d); err != nil {
		return err
	}
	if c := s.zlib(); c != nil {
		c.SetDomain(d)
	}
	return nil
}

func (s *Server) zlibSelectDomainHandler(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r, false)
	if err != nil {
		return err
	}
	raw := body.Str("domain", true, false)
	if err := body.err(); err != nil {
		return err
	}
	ctx := r.Context()
	d, err := normalizeDomain(*raw)
	if err != nil {
		return badRequest("“%s” is not a domain", *raw)
	}
	if known, err := s.zlibKnownDomain(ctx, d); err != nil {
		return err
	} else if !known {
		return notFound("%s is not in the list; add it first", d)
	}
	if err := s.selectZLibDomain(ctx, d); err != nil {
		return err
	}
	return s.zlibDomainsHandler(w, r)
}

func (s *Server) zlibAddDomainHandler(w http.ResponseWriter, r *http.Request) error {
	body, err := readBody(r, false)
	if err != nil {
		return err
	}
	raw := body.Str("domain", true, false)
	if err := body.err(); err != nil {
		return err
	}
	ctx := r.Context()
	d, err := normalizeDomain(*raw)
	if err != nil {
		return badRequest("“%s” is not a domain", *raw)
	}
	if known, err := s.zlibKnownDomain(ctx, d); err != nil {
		return err
	} else if known {
		return conflict("%s is already in the list", d)
	}
	custom, err := s.customZLibDomains(ctx)
	if err != nil {
		return err
	}
	if err := s.putSetting(ctx, settingZLibDomains, append(custom, d)); err != nil {
		return err
	}
	out, err := s.zlibDomainsResponse(ctx)
	if err != nil {
		return err
	}
	return created(w, out)
}

func (s *Server) zlibRemoveDomainHandler(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	d, err := normalizeDomain(r.PathValue("domain"))
	if err != nil {
		return notFound("Domain not found")
	}
	custom, err := s.customZLibDomains(ctx)
	if err != nil {
		return err
	}
	i := slices.Index(custom, d)
	if i < 0 {
		return notFound("%s is not one of your domains", d)
	}
	if err := s.putSetting(ctx, settingZLibDomains, slices.Delete(custom, i, i+1)); err != nil {
		return err
	}
	if s.zlibDomain(ctx) == d {
		if err := s.selectZLibDomain(ctx, s.defaultZLibDomain()); err != nil {
			return err
		}
	}
	return s.zlibDomainsHandler(w, r)
}

// zlibCheckDomainHandler runs a one-result search on a domain to see whether
// its app API answers from this server.
func (s *Server) zlibCheckDomainHandler(w http.ResponseWriter, r *http.Request) error {
	q := newQuery(r)
	raw := q.Required("domain")
	if err := q.err(); err != nil {
		return err
	}
	d, err := normalizeDomain(raw)
	if err != nil {
		return badRequest("“%s” is not a domain", raw)
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	probe := zlibrary.New(d, "", "")
	start := time.Now()
	_, err = probe.Search(ctx, zlibrary.Query{Text: "dune", Limit: 1})
	// Any reply from the API itself (even an error) means it answers.
	var apiErr *zlibrary.APIError
	if errors.As(err, &apiErr) {
		err = nil
	}
	out := map[string]any{"domain": d, "ok": err == nil, "ms": time.Since(start).Milliseconds(), "error": nil}
	if err != nil {
		msg := err.Error()
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			msg = "No answer within 15 seconds"
		case strings.Contains(msg, "bot check"):
			msg = "Behind a bot check"
		case strings.Contains(msg, "could not reach"):
			msg = "Can't reach it from this server"
		case strings.Contains(msg, "unexpected reply"):
			msg = "Doesn't answer like Z-Library"
		}
		out["error"] = msg
	}
	return ok(w, out)
}
