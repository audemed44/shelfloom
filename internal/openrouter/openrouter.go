// Package openrouter is a small client for OpenRouter's chat completions
// API (OpenAI-compatible), with its web search server tool and model list.
package openrouter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// DefaultBaseURL is OpenRouter's API.
const DefaultBaseURL = "https://openrouter.ai/api/v1"

// Client talks to OpenRouter with one API key.
type Client struct {
	// BaseURL defaults to DefaultBaseURL.
	BaseURL string
	APIKey  string
	HTTP    *http.Client
}

// New returns a client with a default HTTP client (which honours
// HTTPS_PROXY). A run with web search can take minutes.
func New(apiKey string) *Client {
	return &Client{APIKey: apiKey, HTTP: &http.Client{Timeout: 10 * time.Minute}}
}

func (c *Client) base() string {
	if c.BaseURL != "" {
		return strings.TrimRight(c.BaseURL, "/")
	}
	return DefaultBaseURL
}

// APIError is an error answer from OpenRouter or the model's provider.
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string {
	if e.Status > 0 {
		return fmt.Sprintf("OpenRouter: %s (HTTP %d)", e.Message, e.Status)
	}
	return "OpenRouter: " + e.Message
}

// Message is one chat message.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// WebSearch turns on OpenRouter's web search server tool: the model decides
// when to search, and OpenRouter runs the searches within the request.
type WebSearch struct {
	// Engine is "exa", "native", "auto"…; native search (e.g. Google's)
	// ignores AllowedDomains.
	Engine         string   `json:"engine,omitempty"`
	MaxResults     int      `json:"max_results,omitempty"`
	MaxUses        int      `json:"max_uses,omitempty"`
	AllowedDomains []string `json:"allowed_domains,omitempty"`
}

// Request is a chat completion request.
type Request struct {
	Model    string
	Messages []Message
	// Schema, when set, asks for JSON output matching it (structured
	// outputs), and only from providers that support that.
	SchemaName string
	Schema     json.RawMessage
	WebSearch  *WebSearch
	MaxTokens  int
}

// Usage is what a request used. Cost is in OpenRouter credits (US dollars).
type Usage struct {
	InputTokens  int     `json:"input_tokens"`
	OutputTokens int     `json:"output_tokens"`
	Cost         float64 `json:"cost"`
	WebSearches  int     `json:"web_searches"`
}

// Citation is a web page the model's answer drew on.
type Citation struct {
	URL   string `json:"url"`
	Title string `json:"title"`
}

// Response is the model's answer.
type Response struct {
	Model     string
	Content   string
	Citations []Citation
	Usage     Usage
}

type wireRequest struct {
	Model          string        `json:"model"`
	Messages       []Message     `json:"messages"`
	ResponseFormat any           `json:"response_format,omitempty"`
	Tools          []any         `json:"tools,omitempty"`
	MaxTokens      int           `json:"max_tokens,omitempty"`
	Provider       *wireProvider `json:"provider,omitempty"`
}

type wireProvider struct {
	RequireParameters bool `json:"require_parameters"`
}

type wireError struct {
	Message  string          `json:"message"`
	Code     json.RawMessage `json:"code"`
	Metadata struct {
		Raw          json.RawMessage `json:"raw"`
		ProviderName string          `json:"provider_name"`
	} `json:"metadata"`
}

func (e *wireError) text() string {
	msg := strings.TrimSpace(e.Message)
	if len(e.Metadata.Raw) > 0 {
		var raw string
		if json.Unmarshal(e.Metadata.Raw, &raw) != nil {
			raw = string(e.Metadata.Raw)
		}
		if raw = strings.TrimSpace(raw); raw != "" && len(raw) < 500 {
			msg += ": " + raw
		}
	}
	if msg == "" {
		msg = "unknown error"
	}
	return msg
}

type wireResponse struct {
	Model   string     `json:"model"`
	Error   *wireError `json:"error"`
	Choices []struct {
		Message struct {
			Content     json.RawMessage `json:"content"`
			Annotations []struct {
				Type        string `json:"type"`
				URLCitation struct {
					URL   string `json:"url"`
					Title string `json:"title"`
				} `json:"url_citation"`
			} `json:"annotations"`
		} `json:"message"`
		FinishReason string     `json:"finish_reason"`
		Error        *wireError `json:"error"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int     `json:"prompt_tokens"`
		CompletionTokens int     `json:"completion_tokens"`
		InputTokens      int     `json:"input_tokens"`
		OutputTokens     int     `json:"output_tokens"`
		Cost             float64 `json:"cost"`
		// Chat completions report searches in server_tool_use_details;
		// server_tool_use is the Responses API's name, kept just in case.
		ServerToolUseDetails struct {
			WebSearchRequests int `json:"web_search_requests"`
		} `json:"server_tool_use_details"`
		ServerToolUse struct {
			WebSearchRequests int `json:"web_search_requests"`
		} `json:"server_tool_use"`
	} `json:"usage"`
}

// Chat sends one chat completion request.
func (c *Client) Chat(ctx context.Context, req Request) (*Response, error) {
	w := wireRequest{Model: req.Model, Messages: req.Messages, MaxTokens: req.MaxTokens}
	if len(req.Schema) > 0 {
		name := req.SchemaName
		if name == "" {
			name = "answer"
		}
		w.ResponseFormat = map[string]any{
			"type":        "json_schema",
			"json_schema": map[string]any{"name": name, "strict": true, "schema": req.Schema},
		}
		w.Provider = &wireProvider{RequireParameters: true}
	}
	if req.WebSearch != nil {
		w.Tools = []any{map[string]any{"type": "openrouter:web_search", "parameters": req.WebSearch}}
	}
	body, err := json.Marshal(w)
	if err != nil {
		return nil, err
	}
	hr, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base()+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	hr.Header.Set("Content-Type", "application/json")
	hr.Header.Set("Authorization", "Bearer "+c.APIKey)
	hr.Header.Set("X-Title", "Shelfloom")
	resp, err := c.HTTP.Do(hr)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, err
	}
	var out wireResponse
	if jerr := json.Unmarshal(data, &out); jerr != nil {
		if resp.StatusCode >= 400 {
			return nil, &APIError{Status: resp.StatusCode, Message: snippet(data)}
		}
		return nil, fmt.Errorf("OpenRouter: unreadable answer: %w", jerr)
	}
	if out.Error != nil {
		return nil, &APIError{Status: statusOf(resp.StatusCode, out.Error.Code), Message: out.Error.text()}
	}
	if resp.StatusCode >= 400 {
		return nil, &APIError{Status: resp.StatusCode, Message: snippet(data)}
	}
	if len(out.Choices) == 0 {
		return nil, &APIError{Message: "the model sent no answer"}
	}
	ch := out.Choices[0]
	if ch.Error != nil {
		return nil, &APIError{Status: statusOf(0, ch.Error.Code), Message: ch.Error.text()}
	}
	r := &Response{Model: out.Model, Content: contentText(ch.Message.Content)}
	seen := map[string]bool{}
	for _, a := range ch.Message.Annotations {
		if a.Type == "url_citation" && a.URLCitation.URL != "" && !seen[a.URLCitation.URL] {
			seen[a.URLCitation.URL] = true
			r.Citations = append(r.Citations, Citation{URL: a.URLCitation.URL, Title: a.URLCitation.Title})
		}
	}
	u := out.Usage
	r.Usage = Usage{
		InputTokens:  max(u.PromptTokens, u.InputTokens),
		OutputTokens: max(u.CompletionTokens, u.OutputTokens),
		Cost:         u.Cost,
		WebSearches:  max(u.ServerToolUseDetails.WebSearchRequests, u.ServerToolUse.WebSearchRequests),
	}
	if strings.TrimSpace(r.Content) == "" {
		reason := ch.FinishReason
		if reason == "" {
			reason = "none given"
		}
		return r, &APIError{Message: "the model's answer was empty (finish reason: " + reason + ")"}
	}
	return r, nil
}

// contentText reads a message's content, a string or a list of parts.
func contentText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var parts []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &parts) == nil {
		var b strings.Builder
		for _, p := range parts {
			b.WriteString(p.Text)
		}
		return b.String()
	}
	return ""
}

func statusOf(status int, code json.RawMessage) int {
	if n, err := strconv.Atoi(strings.Trim(string(code), `"`)); err == nil && n >= 100 && n < 600 {
		return n
	}
	return status
}

func snippet(data []byte) string {
	s := strings.TrimSpace(string(data))
	if len(s) > 300 {
		s = s[:300] + "…"
	}
	if s == "" {
		s = "empty answer"
	}
	return s
}

// Model is one entry of OpenRouter's model list. Prices are US dollars per
// million tokens.
type Model struct {
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	ContextLength   int      `json:"context_length"`
	InputPrice      float64  `json:"input_price"`
	OutputPrice     float64  `json:"output_price"`
	StructuredOut   bool     `json:"structured_outputs"`
	Tools           bool     `json:"tools"`
	SupportedParams []string `json:"-"`
}

// Models lists the models OpenRouter offers. It needs no key.
func (c *Client) Models(ctx context.Context) ([]Model, error) {
	hr, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base()+"/models", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.HTTP.Do(hr)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return nil, &APIError{Status: resp.StatusCode, Message: snippet(data)}
	}
	var out struct {
		Data []struct {
			ID            string `json:"id"`
			Name          string `json:"name"`
			ContextLength int    `json:"context_length"`
			Pricing       struct {
				Prompt     string `json:"prompt"`
				Completion string `json:"completion"`
			} `json:"pricing"`
			SupportedParameters []string `json:"supported_parameters"`
		} `json:"data"`
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, fmt.Errorf("OpenRouter: unreadable model list: %w", err)
	}
	if len(out.Data) == 0 {
		return nil, errors.New("OpenRouter: empty model list")
	}
	models := make([]Model, 0, len(out.Data))
	for _, d := range out.Data {
		m := Model{ID: d.ID, Name: d.Name, ContextLength: d.ContextLength, SupportedParams: d.SupportedParameters}
		m.InputPrice = perMillion(d.Pricing.Prompt)
		m.OutputPrice = perMillion(d.Pricing.Completion)
		for _, p := range d.SupportedParameters {
			switch p {
			case "structured_outputs":
				m.StructuredOut = true
			case "tools":
				m.Tools = true
			}
		}
		models = append(models, m)
	}
	return models, nil
}

func perMillion(perToken string) float64 {
	f, err := strconv.ParseFloat(perToken, 64)
	if err != nil || f < 0 {
		return 0
	}
	// Round away float noise ("0.00000075" → 0.75).
	return float64(int64(f*1e6*1e4+0.5)) / 1e4
}
