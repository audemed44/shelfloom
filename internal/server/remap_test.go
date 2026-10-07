package server

import (
	"encoding/json"
	"math"
	"testing"
)

func TestRemapPositionMatchesPython(t *testing.T) {
	var cases []struct {
		P   string
		Pct float64
		Old [][2]any
		New [][2]any
		Out *[2]any
	}
	if err := json.Unmarshal([]byte(remapCases), &cases); err != nil {
		t.Fatal(err)
	}
	conv := func(in [][2]any) []spineItem {
		var out []spineItem
		for _, x := range in {
			out = append(out, spineItem{href: x[0].(string), size: int64(x[1].(float64))})
		}
		return out
	}
	for i, c := range cases {
		p, pct, ok := remapPosition(c.P, c.Pct, conv(c.Old), conv(c.New))
		if c.Out == nil {
			if ok {
				t.Errorf("case %d: got %s %v, want no change", i, p, pct)
			}
			continue
		}
		if !ok || p != c.Out[0].(string) || math.Abs(pct-c.Out[1].(float64)) > 1e-12 {
			t.Errorf("case %d (%s): got %s %v %v, want %v", i, c.P, p, pct, ok, *c.Out)
		}
	}
}
