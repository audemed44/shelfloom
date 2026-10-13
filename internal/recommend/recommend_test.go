package recommend

import (
	"strings"
	"testing"
	"time"
)

func TestParseReadNext(t *testing.T) {
	for name, content := range map[string]string{
		"plain":  `{"picks": [{"id": "b2", "reason": "Because."}, {"id": " ", "reason": "x"}]}`,
		"fenced": "```json\n{\"picks\": [{\"id\": \"b2\", \"reason\": \"Because.\"}]}\n```",
		"chatty": "Here you go:\n{\"picks\": [{\"id\": \"b2\", \"reason\": \"Because.\"}]}\nEnjoy!",
		"bare":   `[{"id": "b2", "reason": "Because."}]`,
	} {
		picks, err := ParseReadNext(content)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if len(picks) != 1 || picks[0].ID != "b2" || picks[0].Reason != "Because." {
			t.Errorf("%s: got %+v", name, picks)
		}
	}
	if _, err := ParseReadNext("I can't help with that."); err == nil {
		t.Error("prose should not parse")
	}
}

func TestParseDiscover(t *testing.T) {
	picks, err := ParseDiscover(`{"picks": [
		{"title": " Mother of Learning ", "author": "nobody103", "kind": "web_serial", "site": "Royal Road", "reason": "Time loops.", "source_url": "https://www.royalroad.com/fiction/21220"},
		{"title": "Cradle", "author": "Will Wight", "kind": "novel", "site": "", "reason": "Progression.", "source_url": "not a url"},
		{"title": "", "author": "x", "kind": "book", "site": "", "reason": "", "source_url": ""}
	]}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(picks) != 2 {
		t.Fatalf("got %d picks", len(picks))
	}
	if picks[0].Title != "Mother of Learning" || picks[0].Kind != "web_serial" || picks[0].SourceURL == "" {
		t.Errorf("first pick: %+v", picks[0])
	}
	if picks[1].Kind != "book" || picks[1].SourceURL != "" {
		t.Errorf("unknown kinds become books and bad links are dropped: %+v", picks[1])
	}
}

func TestOwned(t *testing.T) {
	o := NewOwned([]string{"The Hundred Reigns [Timeloop LitRPG]", "Reverend Insanity: The Demon Leaves the Mountain", "Pact", "Mother of Learning"})
	for title, want := range map[string]bool{
		"The Hundred Reigns":                   true,
		"hundred reigns":                       true,
		"Reverend Insanity":                    true,
		"Reverend Insanity: Volume 4":          true,
		"Pact":                                 true,
		"Pact: Something Else":                 false, // short main titles don't match loosely
		"Mother of Learning: Arc 1":            true,
		"The Wandering Inn":                    false,
		"Mother of Learning Fan Companion Two": false,
	} {
		if got := o.Has(title); got != want {
			t.Errorf("Has(%q) = %v, want %v", title, got, want)
		}
	}
	if Key("The Wandering Inn", "pirateaba") != Key("Wandering Inn!", "PirateAba") {
		t.Error("keys should ignore case, articles and punctuation")
	}
}

func TestProfileText(t *testing.T) {
	p := Profile{
		Today: time.Date(2026, 10, 13, 0, 0, 0, 0, time.UTC),
		Works: []Work{
			{Title: "Light Read", Author: "A", Kind: "book", BooksFinished: 1, Books: 1, Hours: 1},
			{Title: "Big Series", Author: "B", Kind: "series", Books: 5, BooksFinished: 3, BooksStarted: 1, Hours: 30, Ratings: []float64{4, 5}, LastRead: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), Genres: []string{"Fantasy"}},
			{Title: "Dropped", Author: "C", Kind: "web serial", Site: "Royal Road", DNF: true, Hours: 0.5},
		},
		Genres:   []Count{{Name: "Fantasy", Hours: 30, Books: 4}},
		Feedback: []Feedback{{Title: "Fake Book", Author: "Nobody", Verdict: "not_found"}},
	}
	text := p.Text()
	for _, want := range []string{
		"Today is 2026-10-13.",
		"- Big Series — B | series, 3 of 5 books finished, 1 in progress | 30h read | rated 4.5 on average (2 books) | last read 2026-09 | Fantasy",
		"- Dropped — C | web serial (Royal Road) | DNF | 0.5h read",
		"- Fantasy: 30h, 4 books",
		"- Fake Book — Nobody",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("profile lacks %q:\n%s", want, text)
		}
	}
	// Most time first; the DNF outranks the hour-long read.
	if strings.Index(text, "Big Series") > strings.Index(text, "Dropped") || strings.Index(text, "Dropped") > strings.Index(text, "Light Read") {
		t.Errorf("works out of order:\n%s", text)
	}
}

func TestPrompts(t *testing.T) {
	seq := 2.0
	_, user := ReadNextPrompt("PROFILE", []Candidate{{Key: "b1", Title: "Book Two", Author: "A", Series: "Saga", Sequence: &seq, Description: "A long\n\ndescription"}}, 12)
	if !strings.Contains(user, "b1 | Book Two — A | Saga #2 | A long description") || !strings.Contains(user, "up to 12") {
		t.Errorf("read next prompt:\n%s", user)
	}
	_, user = DiscoverPrompt("PROFILE", []string{"Owned — X"}, KindWebSerials, 20, false)
	if !strings.Contains(user, "- Owned — X") || !strings.Contains(user, "Only web serials") || strings.Contains(user, "search the web") {
		t.Errorf("discover prompt:\n%s", user)
	}
	_, user = DiscoverPrompt("PROFILE", nil, KindBoth, 20, true)
	if !strings.Contains(user, "search the web") {
		t.Errorf("discover prompt with search:\n%s", user)
	}
}
