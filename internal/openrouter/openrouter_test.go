package openrouter

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChat(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer key" {
			t.Errorf("bad request %s %q", r.URL.Path, r.Header.Get("Authorization"))
		}
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &got)
		io.WriteString(w, `{"model": "m", "choices": [{"message": {"content": "{\"picks\": []}", "annotations": [
			{"type": "url_citation", "url_citation": {"url": "https://www.royalroad.com/fiction/1", "title": "RR"}},
			{"type": "url_citation", "url_citation": {"url": "https://www.royalroad.com/fiction/1", "title": "RR"}}
		]}, "finish_reason": "stop"}],
		"usage": {"prompt_tokens": 100, "completion_tokens": 20, "cost": 0.0012, "server_tool_use": {"web_search_requests": 2}}}`)
	}))
	defer srv.Close()
	c := New("key")
	c.BaseURL = srv.URL
	resp, err := c.Chat(context.Background(), Request{
		Model:     "m",
		Messages:  []Message{{Role: "user", Content: "hi"}},
		Schema:    json.RawMessage(`{"type": "object"}`),
		WebSearch: &WebSearch{Engine: "exa", MaxUses: 3, AllowedDomains: []string{"royalroad.com"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Content != `{"picks": []}` || len(resp.Citations) != 1 {
		t.Errorf("response: %+v", resp)
	}
	if resp.Usage != (Usage{InputTokens: 100, OutputTokens: 20, Cost: 0.0012, WebSearches: 2}) {
		t.Errorf("usage: %+v", resp.Usage)
	}
	rf := got["response_format"].(map[string]any)
	if rf["type"] != "json_schema" || got["provider"].(map[string]any)["require_parameters"] != true {
		t.Errorf("structured output not asked for: %v", got)
	}
	tool := got["tools"].([]any)[0].(map[string]any)
	params := tool["parameters"].(map[string]any)
	if tool["type"] != "openrouter:web_search" || params["engine"] != "exa" || params["max_uses"] != 3.0 {
		t.Errorf("web search tool: %v", tool)
	}
}

func TestChatErrors(t *testing.T) {
	for name, tc := range map[string]struct {
		status int
		body   string
		want   int
	}{
		"http error":   {402, `{"error": {"message": "Insufficient credits", "code": 402}}`, 402},
		"no endpoints": {404, `{"error": {"message": "No endpoints found that support the requested parameters"}}`, 404},
		"choice error": {200, `{"choices": [{"message": {"content": ""}, "error": {"message": "provider failed", "code": 502}}]}`, 502},
		"empty":        {200, `{"choices": [{"message": {"content": ""}, "finish_reason": "length"}]}`, 0},
		"not json":     {500, `oops`, 500},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
			io.WriteString(w, tc.body)
		}))
		c := New("key")
		c.BaseURL = srv.URL
		_, err := c.Chat(context.Background(), Request{Model: "m"})
		srv.Close()
		var apiErr *APIError
		if !errors.As(err, &apiErr) || apiErr.Status != tc.want {
			t.Errorf("%s: got %v", name, err)
		}
	}
}

func TestModels(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"data": [{"id": "google/gemini-3.8-flash", "name": "Gemini", "context_length": 1000000,
			"pricing": {"prompt": "0.00000075", "completion": "0.00000375"}, "supported_parameters": ["tools", "structured_outputs"]}]}`)
	}))
	defer srv.Close()
	c := &Client{BaseURL: srv.URL, HTTP: http.DefaultClient}
	models, err := c.Models(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	m := models[0]
	if m.InputPrice != 0.75 || m.OutputPrice != 3.75 || !m.Tools || !m.StructuredOut {
		t.Errorf("model: %+v", m)
	}
}
