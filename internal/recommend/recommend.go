// Package recommend builds the prompts for AI reading recommendations from
// a reader's library and history, and reads the model's answers. It knows
// nothing of the database or the model's API.
package recommend

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Work is something read or started: a series (its books together), a web
// serial, or a standalone book.
type Work struct {
	Title  string
	Author string
	// Kind is "book", "series" or "web serial".
	Kind string
	// Site is where a web serial is published ("Royal Road").
	Site          string
	Books         int // books in the library (series)
	BooksFinished int
	BooksStarted  int
	DNF           bool
	Hours         float64
	Ratings       []float64
	LastRead      time.Time
	Genres        []string
	Tags          []string
	// Notes are reviews and highlights, only when the reader allows them.
	Notes []string
}

// Count is a genre or tag with the reading hours behind it.
type Count struct {
	Name  string
	Hours float64
	Books int
}

// Feedback is the reader's verdict on an earlier recommendation.
type Feedback struct {
	Title   string
	Author  string
	Verdict string // not_interested, already_read, not_found, saved
}

// Profile is what the model is told about the reader's taste.
type Profile struct {
	Today  time.Time
	Works  []Work
	Genres []Count
	Tags   []Count
	// Following are web serials followed in Shelfloom ("Title — Author
	// (Site, status)"), read or not.
	Following []string
	Feedback  []Feedback
}

// MaxWorks caps the works listed in a profile; the rest are summed up in
// the genre and tag counts.
const MaxWorks = 220

// Text renders the profile as compact lines.
func (p Profile) Text() string {
	var b strings.Builder
	fmt.Fprintf(&b, "Today is %s.\n\n", p.Today.Format("2006-01-02"))
	works := slices.Clone(p.Works)
	slices.SortStableFunc(works, func(a, c Work) int {
		return cmpFloat(weight(c), weight(a))
	})
	if len(works) > MaxWorks {
		works = works[:MaxWorks]
	}
	b.WriteString("## Reading history\n")
	b.WriteString("Most reading time first. Ratings are out of 5. \"DNF\" means the reader gave up on it on purpose.\n")
	for _, w := range works {
		b.WriteString("- ")
		b.WriteString(w.line())
		b.WriteByte('\n')
		for _, n := range w.Notes {
			b.WriteString("  > ")
			b.WriteString(oneLine(n, 280))
			b.WriteByte('\n')
		}
	}
	if len(works) == 0 {
		b.WriteString("(nothing read yet)\n")
	}
	if len(p.Genres) > 0 {
		b.WriteString("\n## Genres by reading time\n")
		b.WriteString(counts(p.Genres, 15))
	}
	if len(p.Tags) > 0 {
		b.WriteString("\n## Tags by reading time\n")
		b.WriteString(counts(p.Tags, 25))
	}
	if len(p.Following) > 0 {
		b.WriteString("\n## Web serials the reader follows\n")
		for _, f := range p.Following {
			b.WriteString("- " + f + "\n")
		}
	}
	if fb := feedbackText(p.Feedback); fb != "" {
		b.WriteString("\n## Feedback on earlier recommendations\n")
		b.WriteString(fb)
	}
	return b.String()
}

// weight orders works: time spent counts most; ratings and DNFs are
// strong signals even with little time.
func weight(w Work) float64 {
	x := w.Hours
	if len(w.Ratings) > 0 {
		x += 2
	}
	if w.DNF {
		x += 1.5
	}
	return x
}

func (w Work) line() string {
	parts := []string{}
	title := w.Title
	if w.Author != "" {
		title += " — " + w.Author
	}
	parts = append(parts, title)
	switch w.Kind {
	case "web serial":
		k := "web serial"
		if w.Site != "" {
			k += " (" + w.Site + ")"
		}
		parts = append(parts, k)
	case "series":
		k := fmt.Sprintf("series, %d of %d books finished", w.BooksFinished, w.Books)
		if w.BooksStarted > 0 {
			k += fmt.Sprintf(", %d in progress", w.BooksStarted)
		}
		parts = append(parts, k)
	}
	switch {
	case w.DNF:
		parts = append(parts, "DNF")
	case w.Kind == "book" && w.BooksFinished > 0:
		parts = append(parts, "finished")
	case w.Kind == "book" && w.BooksStarted > 0:
		parts = append(parts, "reading")
	}
	if w.Hours >= 0.05 {
		parts = append(parts, strconv.FormatFloat(round1(w.Hours), 'f', -1, 64)+"h read")
	}
	if len(w.Ratings) == 1 {
		parts = append(parts, "rated "+fmtRating(w.Ratings[0]))
	} else if len(w.Ratings) > 1 {
		sum := 0.0
		for _, r := range w.Ratings {
			sum += r
		}
		parts = append(parts, fmt.Sprintf("rated %s on average (%d books)", fmtRating(sum/float64(len(w.Ratings))), len(w.Ratings)))
	}
	if !w.LastRead.IsZero() {
		parts = append(parts, "last read "+w.LastRead.Format("2006-01"))
	}
	if labels := append(slices.Clone(w.Genres), w.Tags...); len(labels) > 0 {
		parts = append(parts, strings.Join(labels, ", "))
	}
	return strings.Join(parts, " | ")
}

func counts(cs []Count, limit int) string {
	var b strings.Builder
	for i, c := range cs {
		if i == limit {
			break
		}
		fmt.Fprintf(&b, "- %s: %sh, %d books\n", c.Name, strconv.FormatFloat(round1(c.Hours), 'f', -1, 64), c.Books)
	}
	return b.String()
}

var verdictText = map[string]string{
	"not_interested": "Not interested (don't suggest these or close copies of them)",
	"already_read":   "Already read outside Shelfloom (count them as read; don't suggest them)",
	"not_found":      "Could not be found — probably don't exist or had the wrong author (never suggest these)",
	"saved":          "Saved to read later (good picks; don't suggest them again)",
}

func feedbackText(fb []Feedback) string {
	var b strings.Builder
	for _, v := range []string{"saved", "already_read", "not_interested", "not_found"} {
		var lines []string
		for _, f := range fb {
			if f.Verdict == v {
				s := f.Title
				if f.Author != "" {
					s += " — " + f.Author
				}
				lines = append(lines, s)
			}
		}
		if len(lines) == 0 {
			continue
		}
		b.WriteString(verdictText[v] + ":\n")
		for _, l := range lines {
			b.WriteString("- " + l + "\n")
		}
	}
	return b.String()
}

// Candidate is an unread library book that "Read next" can pick.
type Candidate struct {
	Key         string // short ID used in the prompt ("b12")
	Title       string
	Author      string
	Series      string
	Sequence    *float64
	WebSerial   bool
	Genres      []string
	Tags        []string
	Description string
}

func (c Candidate) line() string {
	s := c.Key + " | " + c.Title
	if c.Author != "" {
		s += " — " + c.Author
	}
	if c.Series != "" {
		s += " | " + c.Series
		if c.Sequence != nil {
			s += " #" + strconv.FormatFloat(*c.Sequence, 'f', -1, 64)
		}
	}
	if c.WebSerial {
		s += " | web serial volume"
	}
	if labels := append(slices.Clone(c.Genres), c.Tags...); len(labels) > 0 {
		s += " | " + strings.Join(labels, ", ")
	}
	if d := oneLine(c.Description, 160); d != "" {
		s += " | " + d
	}
	return s
}

const systemPrompt = "You are a well-read librarian who knows published fiction and online web fiction (Royal Road, Scribble Hub, translated web novels) well. You recommend books to one reader based on their reading history. You answer only with JSON."

// ReadNextPrompt asks for up to n picks from the reader's unread books.
func ReadNextPrompt(profile string, candidates []Candidate, n int) (system, user string) {
	var b strings.Builder
	b.WriteString(profile)
	b.WriteString("\n## Unread books in the reader's library\n")
	b.WriteString("One line each: id | title — author | series #number | genres and tags | start of the description.\n")
	for _, c := range candidates {
		b.WriteString(c.line())
		b.WriteByte('\n')
	}
	fmt.Fprintf(&b, `
## Task
Pick up to %d of the unread books above that this reader should read next, best first.
- Only pick ids from the list above.
- Continuing a series or web serial they are reading or finished and liked is a strong pick; skip later books of a series whose earlier books they haven't read, and anything close to what they DNF'd.
- Weigh hours read and ratings over raw counts, and recent reading over old.
- Give each pick a reason of one sentence (under 200 characters) tied to their reading, e.g. naming a book they liked. Talk to the reader as "you".

Answer with JSON: {"picks": [{"id": "b12", "reason": "..."}]}`, n)
	return systemPrompt, b.String()
}

// ReadNextSchema is the JSON schema of a Read next answer.
var ReadNextSchema = json.RawMessage(`{
	"type": "object",
	"properties": {
		"picks": {
			"type": "array",
			"items": {
				"type": "object",
				"properties": {
					"id": {"type": "string"},
					"reason": {"type": "string"}
				},
				"required": ["id", "reason"],
				"additionalProperties": false
			}
		}
	},
	"required": ["picks"],
	"additionalProperties": false
}`)

// Discover kinds.
const (
	KindBoth       = "both"
	KindBooks      = "books"
	KindWebSerials = "web_serials"
)

// DiscoverPrompt asks for n titles the reader doesn't have.
func DiscoverPrompt(profile string, owned []string, kinds string, n int, webSearch bool) (system, user string) {
	var b strings.Builder
	b.WriteString(profile)
	b.WriteString("\n## Already in the reader's library\n")
	for _, o := range owned {
		b.WriteString("- " + o + "\n")
	}
	var what string
	switch kinds {
	case KindBooks:
		what = "Only published books, no web serials."
	case KindWebSerials:
		what = "Only web serials (Royal Road, Scribble Hub, translated web novels, serials on their own sites)."
	default:
		what = "Mix books and web serials in proportion to how much of each the reader reads."
	}
	fmt.Fprintf(&b, `
## Task
Recommend %d titles this reader doesn't have yet and would enjoy, best first. %s
- Nothing already in the library, nothing they follow, and nothing from the feedback lists. Another series by an author they like is fine.
- Only real titles that exist. Give the exact title and author name as published (for web serials, the author's pen name on the site).
- For web serials give the site in "site" ("Royal Road", "Scribble Hub", "Webnovel"…; the domain if it's on its own site). For books leave "site" empty. Stubbed or Kindle-published web serials are fine.
- Weigh hours read and ratings over raw counts, and recent reading over old. Avoid what resembles their DNFs and low ratings.
- Mix well-known picks with lesser-known ones they are unlikely to have found.
- Give each a reason of one or two sentences (under 220 characters) tied to their reading, e.g. naming a book they liked. Talk to the reader as "you".
`, n, what)
	if webSearch {
		b.WriteString(`- You can search the web. Use it to find newer or lesser-known fits (especially on Royal Road and in reader communities like r/ProgressionFantasy and r/royalroad) and to check that titles and authors are right. Put the page you relied on for a pick in "source_url"; otherwise leave it empty.
`)
	} else {
		b.WriteString("- Leave \"source_url\" empty.\n")
	}
	b.WriteString(`
Answer with JSON: {"picks": [{"title": "...", "author": "...", "kind": "book" or "web_serial", "site": "", "reason": "...", "source_url": ""}]}`)
	return systemPrompt, b.String()
}

// DiscoverSchema is the JSON schema of a Discover answer.
var DiscoverSchema = json.RawMessage(`{
	"type": "object",
	"properties": {
		"picks": {
			"type": "array",
			"items": {
				"type": "object",
				"properties": {
					"title": {"type": "string"},
					"author": {"type": "string"},
					"kind": {"type": "string", "enum": ["book", "web_serial"]},
					"site": {"type": "string"},
					"reason": {"type": "string"},
					"source_url": {"type": "string"}
				},
				"required": ["title", "author", "kind", "site", "reason", "source_url"],
				"additionalProperties": false
			}
		}
	},
	"required": ["picks"],
	"additionalProperties": false
}`)

// ReadNextPick is one pick from the reader's unread books.
type ReadNextPick struct {
	ID     string `json:"id"`
	Reason string `json:"reason"`
}

// DiscoverPick is one recommended title.
type DiscoverPick struct {
	Title     string `json:"title"`
	Author    string `json:"author"`
	Kind      string `json:"kind"`
	Site      string `json:"site"`
	Reason    string `json:"reason"`
	SourceURL string `json:"source_url"`
}

// ParseReadNext reads a Read next answer.
func ParseReadNext(content string) ([]ReadNextPick, error) {
	var picks []ReadNextPick
	if err := decodePicks(content, &picks); err != nil {
		return nil, err
	}
	out := picks[:0]
	for _, p := range picks {
		p.ID = strings.TrimSpace(p.ID)
		p.Reason = strings.TrimSpace(p.Reason)
		if p.ID != "" {
			out = append(out, p)
		}
	}
	return out, nil
}

// ParseDiscover reads a Discover answer.
func ParseDiscover(content string) ([]DiscoverPick, error) {
	var picks []DiscoverPick
	if err := decodePicks(content, &picks); err != nil {
		return nil, err
	}
	out := picks[:0]
	for _, p := range picks {
		p.Title = strings.TrimSpace(p.Title)
		p.Author = strings.TrimSpace(p.Author)
		p.Site = strings.TrimSpace(p.Site)
		p.Reason = strings.TrimSpace(p.Reason)
		p.SourceURL = strings.TrimSpace(p.SourceURL)
		if !strings.HasPrefix(p.SourceURL, "https://") && !strings.HasPrefix(p.SourceURL, "http://") {
			p.SourceURL = ""
		}
		if p.Kind != "web_serial" {
			p.Kind = "book"
		}
		if p.Title != "" {
			out = append(out, p)
		}
	}
	return out, nil
}

var fence = regexp.MustCompile("(?s)^```[a-zA-Z]*\\s*(.*?)\\s*```$")

// decodePicks reads {"picks": [...]} (or a bare list), tolerating code
// fences and text around the JSON.
func decodePicks(content string, picks any) error {
	s := strings.TrimSpace(content)
	if m := fence.FindStringSubmatch(s); m != nil {
		s = m[1]
	}
	var wrapper struct {
		Picks json.RawMessage `json:"picks"`
	}
	try := func(s string) bool {
		if json.Unmarshal([]byte(s), &wrapper) == nil && len(wrapper.Picks) > 0 {
			return json.Unmarshal(wrapper.Picks, picks) == nil
		}
		return json.Unmarshal([]byte(s), picks) == nil
	}
	if try(s) {
		return nil
	}
	if i, j := strings.Index(s, "{"), strings.LastIndex(s, "}"); i >= 0 && j > i && try(s[i:j+1]) {
		return nil
	}
	if i, j := strings.Index(s, "["), strings.LastIndex(s, "]"); i >= 0 && j > i && try(s[i:j+1]) {
		return nil
	}
	return errors.New("the model's answer was not the JSON asked for")
}

var (
	bracketed  = regexp.MustCompile(`\[[^\]]*\]|\([^)]*\)`)
	nonWord    = regexp.MustCompile(`[^\p{L}\p{N}]+`)
	leadingThe = regexp.MustCompile(`^(the|a|an) `)
)

// NormTitle reduces a title for matching: lower case, no bracketed tags
// ("[Timeloop LitRPG]"), punctuation or leading article.
func NormTitle(s string) string {
	s = strings.ToLower(bracketed.ReplaceAllString(s, " "))
	s = strings.TrimSpace(nonWord.ReplaceAllString(s, " "))
	return leadingThe.ReplaceAllString(s, "")
}

// MainTitle is a title without its subtitle ("Mother of Learning: Arc 1"
// → "Mother of Learning").
func MainTitle(s string) string {
	s = bracketed.ReplaceAllString(s, " ")
	for _, sep := range []string{":", " - ", " – ", " — "} {
		if i := strings.Index(s, sep); i > 0 {
			s = s[:i]
		}
	}
	return NormTitle(s)
}

// Owned matches titles against the reader's library.
type Owned struct {
	full map[string]bool
	main map[string]bool
}

// NewOwned indexes the given titles (book titles, series names, serials).
func NewOwned(titles []string) *Owned {
	o := &Owned{full: map[string]bool{}, main: map[string]bool{}}
	for _, t := range titles {
		if n := NormTitle(t); n != "" {
			o.full[n] = true
		}
		// Short main titles ("Pact", "Worm") match too loosely.
		if m := MainTitle(t); len(m) >= 8 {
			o.main[m] = true
		}
	}
	return o
}

// Has reports whether the title looks like one already owned.
func (o *Owned) Has(title string) bool {
	if n := NormTitle(title); n != "" && o.full[n] {
		return true
	}
	m := MainTitle(title)
	return len(m) >= 8 && (o.main[m] || o.full[m])
}

// Key identifies a title and author for feedback.
func Key(title, author string) string {
	return NormTitle(title) + "|" + NormTitle(author)
}

func oneLine(s string, limit int) string {
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > limit {
		s = strings.TrimSpace(string(r[:limit])) + "…"
	}
	return s
}

func round1(x float64) float64 { return math.Round(x*10) / 10 }

func fmtRating(r float64) string {
	return strconv.FormatFloat(math.Round(r*10)/10, 'f', -1, 64)
}

func cmpFloat(a, b float64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}
