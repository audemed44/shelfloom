package epub

import (
	"time"
	"unicode/utf8"
)

func utf8Valid(b []byte) bool { return utf8.Valid(b) }

// nowForZip is the timestamp Python's zipfile gives entries written from
// bytes: the current local time.
func nowForZip() time.Time { return time.Now() }
