// Package zlibrary is a small client for Z-Library's app API (/eapi), the
// JSON API its mobile apps use. There is no official public API: the
// endpoints, field names and domain can change without notice.
package zlibrary

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
)

// MaxFileSize caps a downloaded book.
const MaxFileSize = 200 << 20

const userAgent = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36"

// ErrLogin is returned when the account's email or password is rejected.
var ErrLogin = errors.New("Z-Library rejected the email or password")

// APIError is an error message from Z-Library itself (a daily limit, a
// missing book).
type APIError struct{ Message string }

func (e *APIError) Error() string { return "Z-Library: " + e.Message }

// Client talks to one Z-Library domain with one account. It logs in on first
// use and again when the session expires.
type Client struct {
	// Domain is a host ("z-library.hn") or a base URL ("http://127.0.0.1:1").
	Domain   string
	Email    string
	Password string
	HTTP     *http.Client

	mu      sync.Mutex
	userID  string
	userKey string
}

// New returns a client with a default HTTP client (which honours
// HTTPS_PROXY).
func New(domain, email, password string) *Client {
	return &Client{
		Domain:   domain,
		Email:    email,
		Password: password,
		HTTP:     &http.Client{Timeout: 2 * time.Minute},
	}
}

// Base is the API's base URL.
func (c *Client) Base() string {
	c.mu.Lock()
	d := c.Domain
	c.mu.Unlock()
	return BaseURL(d)
}

// BaseURL turns a domain ("z-library.hn") or base URL into a base URL.
func BaseURL(domain string) string {
	d := strings.TrimRight(strings.TrimSpace(domain), "/")
	if strings.Contains(d, "://") {
		return d
	}
	return "https://" + d
}

// SetDomain switches the client to another domain, logging in afresh there.
func (c *Client) SetDomain(domain string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Domain != domain {
		c.Domain = domain
		c.userID, c.userKey = "", ""
	}
}

// Book is one search result.
type Book struct {
	ID          string `json:"id"`
	Hash        string `json:"hash"`
	Title       string `json:"title"`
	Author      string `json:"author"`
	Publisher   string `json:"publisher"`
	Year        int    `json:"year"`
	Language    string `json:"language"`
	Pages       int    `json:"pages"`
	Series      string `json:"series"`
	Volume      string `json:"volume"`
	Identifier  string `json:"identifier"`
	Extension   string `json:"extension"`
	FileSize    int64  `json:"filesize"`
	FileSizeStr string `json:"filesizeString"`
	MD5         string `json:"md5"`
	Cover       string `json:"cover"`
	Description string `json:"description"`
}

// UnmarshalJSON accepts numbers sent as strings and nulls, which the API
// mixes freely.
func (b *Book) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	str := func(k string) string {
		v, ok := raw[k]
		if !ok {
			return ""
		}
		var s string
		if json.Unmarshal(v, &s) == nil {
			return strings.TrimSpace(s)
		}
		var n json.Number
		if json.Unmarshal(v, &n) == nil {
			return n.String()
		}
		return ""
	}
	num := func(k string) int64 {
		n, _ := strconv.ParseInt(str(k), 10, 64)
		return n
	}
	*b = Book{
		ID: str("id"), Hash: str("hash"), Title: str("title"), Author: str("author"),
		Publisher: str("publisher"), Year: int(num("year")), Language: str("language"),
		Pages: int(num("pages")), Series: str("series"), Volume: str("volume"),
		Identifier: str("identifier"), Extension: strings.ToLower(str("extension")),
		FileSize: num("filesize"), FileSizeStr: str("filesizeString"),
		MD5: strings.ToLower(str("md5")), Cover: str("cover"), Description: str("description"),
	}
	return nil
}

// ISBNs lists the ISBN-13s and ISBN-10s among the book's identifiers (which
// can also hold ASINs).
func (b Book) ISBNs() []string {
	var out []string
	for _, id := range strings.Split(b.Identifier, ",") {
		id = strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(id), "-", ""))
		if isISBN(id) {
			out = append(out, id)
		}
	}
	return out
}

func isISBN(s string) bool {
	if len(s) != 10 && len(s) != 13 {
		return false
	}
	for i, r := range s {
		if r < '0' || r > '9' {
			if !(len(s) == 10 && i == 9 && r == 'X') {
				return false
			}
		}
	}
	return true
}

// Query is a search.
type Query struct {
	Text string
	// Extensions limits the formats ("epub", "pdf"); empty means any.
	Extensions []string
	// Languages limits the languages ("english"); empty means any.
	Languages []string
	Page      int
	Limit     int
}

// Search runs a search. It does not need a login, but uses one when the
// client has it.
func (c *Client) Search(ctx context.Context, q Query) ([]Book, error) {
	form := url.Values{}
	form.Set("message", q.Text)
	if q.Limit <= 0 {
		q.Limit = 20
	}
	form.Set("limit", strconv.Itoa(q.Limit))
	if q.Page > 1 {
		form.Set("page", strconv.Itoa(q.Page))
	}
	for _, e := range q.Extensions {
		form.Add("extensions[]", e)
	}
	for _, l := range q.Languages {
		form.Add("languages[]", l)
	}
	var out struct {
		Books []Book `json:"books"`
	}
	if err := c.call(ctx, http.MethodPost, "/eapi/book/search", form, &out); err != nil {
		return nil, err
	}
	return out.Books, nil
}

// Domains asks Z-Library for its current domains (those with content).
func (c *Client) Domains(ctx context.Context) ([]string, error) {
	var out struct {
		Domains []struct {
			Domain           string `json:"domain"`
			ContentAvailable *bool  `json:"contentAvailable"`
		} `json:"domains"`
	}
	if err := c.call(ctx, http.MethodGet, "/eapi/info/domains", nil, &out); err != nil {
		return nil, err
	}
	var domains []string
	for _, d := range out.Domains {
		if d.Domain != "" && (d.ContentAvailable == nil || *d.ContentAvailable) {
			domains = append(domains, d.Domain)
		}
	}
	return domains, nil
}

// Limits is the account's download allowance.
type Limits struct {
	DownloadsToday int `json:"downloads_today"`
	DownloadsLimit int `json:"downloads_limit"`
}

// Limits returns how many downloads the account has used today.
func (c *Client) Limits(ctx context.Context) (Limits, error) {
	var out struct {
		User struct {
			DownloadsToday json.Number `json:"downloads_today"`
			DownloadsLimit json.Number `json:"downloads_limit"`
		} `json:"user"`
	}
	if err := c.authed(ctx, http.MethodGet, "/eapi/user/profile", nil, &out); err != nil {
		return Limits{}, err
	}
	today, _ := out.User.DownloadsToday.Int64()
	limit, _ := out.User.DownloadsLimit.Int64()
	return Limits{DownloadsToday: int(today), DownloadsLimit: int(limit)}, nil
}

// Download fetches a book's file. It uses one of the account's daily
// downloads.
func (c *Client) Download(ctx context.Context, id, hash string) (name string, data []byte, err error) {
	var out struct {
		File struct {
			DownloadLink string `json:"downloadLink"`
			Extension    string `json:"extension"`
		} `json:"file"`
	}
	p := "/eapi/book/" + url.PathEscape(id) + "/" + url.PathEscape(hash) + "/file"
	if err := c.authed(ctx, http.MethodGet, p, nil, &out); err != nil {
		return "", nil, err
	}
	if out.File.DownloadLink == "" {
		return "", nil, &APIError{Message: "no download link for this book"}
	}
	link, err := url.Parse(out.File.DownloadLink)
	if err != nil {
		return "", nil, fmt.Errorf("Z-Library sent a bad download link: %w", err)
	}
	if !link.IsAbs() {
		base, _ := url.Parse(c.Base())
		link = base.ResolveReference(link)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, link.String(), nil)
	if err != nil {
		return "", nil, err
	}
	c.decorate(req)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", nil, fmt.Errorf("could not reach Z-Library: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("Z-Library download failed: HTTP %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); strings.HasPrefix(ct, "text/html") || strings.HasPrefix(ct, "application/json") {
		// A limit or error page instead of the file.
		return "", nil, &APIError{Message: "the download returned a page instead of the file (daily limit reached?)"}
	}
	data, err = io.ReadAll(io.LimitReader(resp.Body, MaxFileSize+1))
	if err != nil {
		return "", nil, fmt.Errorf("Z-Library download failed: %w", err)
	}
	if len(data) > MaxFileSize {
		return "", nil, fmt.Errorf("the file is larger than %d MB", MaxFileSize>>20)
	}
	if _, params, err := mime.ParseMediaType(resp.Header.Get("Content-Disposition")); err == nil {
		name = params["filename"]
	}
	if name == "" {
		name = path.Base(resp.Request.URL.Path)
	}
	return name, data, nil
}

// Cover fetches a cover image.
func (c *Client) Cover(ctx context.Context, coverURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, coverURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("cover: HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20))
	return data, resp.Header.Get("Content-Type"), err
}

// authed calls an endpoint that needs a login, logging in (again) when the
// session is missing or has expired.
func (c *Client) authed(ctx context.Context, method, p string, form url.Values, out any) error {
	c.mu.Lock()
	loggedIn := c.userKey != ""
	c.mu.Unlock()
	if !loggedIn {
		if err := c.login(ctx); err != nil {
			return err
		}
	}
	err := c.call(ctx, method, p, form, out)
	var apiErr *APIError
	if errors.As(err, &apiErr) && strings.Contains(strings.ToLower(apiErr.Message), "login") {
		if err := c.login(ctx); err != nil {
			return err
		}
		err = c.call(ctx, method, p, form, out)
	}
	return err
}

func (c *Client) login(ctx context.Context) error {
	if c.Email == "" || c.Password == "" {
		return errors.New("Z-Library email and password are not set")
	}
	form := url.Values{"email": {c.Email}, "password": {c.Password}}
	var out struct {
		User struct {
			ID      json.Number `json:"id"`
			UserKey string      `json:"remix_userkey"`
		} `json:"user"`
	}
	err := c.call(ctx, http.MethodPost, "/eapi/user/login", form, &out)
	var apiErr *APIError
	if errors.As(err, &apiErr) && strings.Contains(strings.ToLower(apiErr.Message), "incorrect") {
		return ErrLogin
	}
	if err != nil {
		return err
	}
	if out.User.UserKey == "" {
		return ErrLogin
	}
	c.mu.Lock()
	c.userID, c.userKey = out.User.ID.String(), out.User.UserKey
	c.mu.Unlock()
	return nil
}

// decorate adds the browser-ish headers and the session cookies.
func (c *Client) decorate(req *http.Request) {
	req.Header.Set("User-Agent", userAgent)
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.userKey != "" {
		req.AddCookie(&http.Cookie{Name: "remix_userid", Value: c.userID})
		req.AddCookie(&http.Cookie{Name: "remix_userkey", Value: c.userKey})
	}
}

// call sends a request and decodes a {"success": 1, ...} reply into out.
func (c *Client) call(ctx context.Context, method, p string, form url.Values, out any) error {
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, c.Base()+p, body)
	if err != nil {
		return err
	}
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	req.Header.Set("Accept", "application/json")
	c.decorate(req)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		if strings.Contains(err.Error(), "stopped after") {
			// A bot check that redirects to itself until it gets a cookie.
			return fmt.Errorf("%s is behind a bot check; try another domain", c.Base())
		}
		return fmt.Errorf("could not reach Z-Library at %s: %w", c.Base(), err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return fmt.Errorf("could not read Z-Library's reply: %w", err)
	}
	var head struct {
		Success json.RawMessage `json:"success"`
		Error   string          `json:"error"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return fmt.Errorf("Z-Library at %s sent an unexpected reply (HTTP %d); try another domain", c.Base(), resp.StatusCode)
	}
	if ok := strings.Trim(string(head.Success), `"`); ok != "1" && ok != "true" {
		msg := head.Error
		if msg == "" {
			msg = fmt.Sprintf("request failed (HTTP %d)", resp.StatusCode)
		}
		return &APIError{Message: msg}
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}
