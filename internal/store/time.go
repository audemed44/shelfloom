package store

import (
	"database/sql/driver"
	"fmt"
	"strings"
	"time"
)

// Time is a naive date and time, stored the way SQLAlchemy stores DATETIME
// columns in SQLite ("2006-01-02 15:04:05.000000") and sent to the frontend
// the way Python formats it ("2006-01-02T15:04:05", with ".ffffff" only when
// there are microseconds). Stored times are UTC. The zero value is NULL.
type Time struct {
	time.Time
	Valid bool
}

// StorageLayout is how SQLAlchemy writes a datetime into SQLite.
const StorageLayout = "2006-01-02 15:04:05.000000"

// T wraps a time; it is converted to UTC and loses anything below a
// microsecond, as Python's datetime would.
func T(t time.Time) Time {
	return Time{Time: t.UTC().Truncate(time.Microsecond), Valid: true}
}

// Now is the current UTC time.
func Now() Time { return T(time.Now()) }

// Scan reads a DATETIME column (the driver gives time.Time) or a datetime
// produced by an SQL expression (text).
func (t *Time) Scan(v any) error {
	switch x := v.(type) {
	case nil:
		*t = Time{}
	case time.Time:
		*t = Time{Time: time.Date(x.Year(), x.Month(), x.Day(), x.Hour(), x.Minute(), x.Second(), x.Nanosecond(), time.UTC), Valid: true}
	case string:
		return t.parse(x)
	case []byte:
		return t.parse(string(x))
	default:
		return fmt.Errorf("store.Time: cannot scan %T", v)
	}
	return nil
}

func (t *Time) parse(s string) error {
	p, err := ParseTime(s)
	if err != nil {
		return err
	}
	*t = Time{Time: p, Valid: true}
	return nil
}

// ParseTime parses a stored datetime ("2006-01-02 15:04:05[.ffffff]",
// also with a "T").
func ParseTime(s string) (time.Time, error) {
	s = strings.Replace(strings.TrimSpace(s), "T", " ", 1)
	for _, layout := range []string{"2006-01-02 15:04:05.999999999", "2006-01-02 15:04:05", "2006-01-02 15:04", "2006-01-02"} {
		if p, err := time.ParseInLocation(layout, s, time.UTC); err == nil {
			return p, nil
		}
	}
	return time.Time{}, fmt.Errorf("store.Time: cannot parse %q", s)
}

// Value writes the time as SQLAlchemy would.
func (t Time) Value() (driver.Value, error) {
	if !t.Valid {
		return nil, nil
	}
	return t.Time.Format(StorageLayout), nil
}

// ISO is Python's datetime.isoformat() for a naive datetime.
func (t Time) ISO() string {
	return isoformat(t.Time)
}

func isoformat(t time.Time) string {
	s := t.Format("2006-01-02T15:04:05")
	if us := t.Nanosecond() / 1000; us != 0 {
		s += fmt.Sprintf(".%06d", us)
	}
	return s
}

// MarshalJSON writes the time as Python does, or null.
func (t Time) MarshalJSON() ([]byte, error) {
	if !t.Valid {
		return []byte("null"), nil
	}
	return []byte(`"` + t.ISO() + `"`), nil
}

// Ptr returns nil for NULL, so optional fields can use *string-like logic.
func (t Time) Ptr() *Time {
	if !t.Valid {
		return nil
	}
	return &t
}

// UTCTime is an aware UTC datetime as Pydantic writes it in a response model
// ("2006-01-02T15:04:05.123456Z"). Used for in-memory job state.
type UTCTime struct {
	time.Time
	Valid bool
}

// UTCNow is the current time.
func UTCNow() UTCTime {
	return UTCTime{Time: time.Now().UTC().Truncate(time.Microsecond), Valid: true}
}

// MarshalJSON writes the time with a Z, or null.
func (t UTCTime) MarshalJSON() ([]byte, error) {
	if !t.Valid {
		return []byte("null"), nil
	}
	return []byte(`"` + isoformat(t.Time) + `Z"`), nil
}

// Naive is the same instant as a naive UTC time, for storing.
func (t UTCTime) Naive() Time {
	if !t.Valid {
		return Time{}
	}
	return T(t.Time)
}

// Local converts a stored (UTC) time to naive local time, as
// app.services.local_time.to_local does.
func (t Time) Local() Time {
	if !t.Valid {
		return t
	}
	l := t.Time.In(time.Local)
	return Time{Time: time.Date(l.Year(), l.Month(), l.Day(), l.Hour(), l.Minute(), l.Second(), l.Nanosecond(), time.UTC), Valid: true}
}

// FromLocal reads a naive local wall time as a stored UTC time.
func FromLocal(year int, month time.Month, day, hour, min, sec, usec int) Time {
	return T(time.Date(year, month, day, hour, min, sec, usec*1000, time.Local))
}

// UnmarshalJSON reads what MarshalJSON writes.
func (t *Time) UnmarshalJSON(b []byte) error {
	s := string(b)
	if s == "null" {
		*t = Time{}
		return nil
	}
	return t.parse(strings.Trim(s, `"`))
}
