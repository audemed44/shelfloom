// Package store opens Shelfloom's SQLite database and owns its schema.
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	_ "modernc.org/sqlite" // pure Go, so the build stays cgo-free
)

// AlembicHead is the last migration the Python backend applied. The schema
// in schema/0001_baseline.sql is the database at that revision.
const AlembicHead = "e7b2c9d41a05"

//go:embed schema/*.sql
var schemaFiles embed.FS

// DB is the database. Reads share a small pool; writes that span several
// statements go through Tx, which takes SQLite's write lock up front
// (BEGIN IMMEDIATE) so two writers never deadlock on an upgrade.
type DB struct {
	*sql.DB
}

// Open opens (creating if needed) the database at path and brings its schema
// up to date.
func Open(path string) (*DB, error) {
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	q := url.Values{}
	for _, p := range []string{"foreign_keys(1)", "journal_mode(WAL)", "synchronous(NORMAL)", "busy_timeout(5000)"} {
		q.Add("_pragma", p)
	}
	q.Set("_txlock", "immediate")
	sqlDB, err := sql.Open("sqlite", "file:"+path+"?"+q.Encode())
	if err != nil {
		return nil, err
	}
	sqlDB.SetMaxOpenConns(4)
	sqlDB.SetMaxIdleConns(2)
	db := &DB{sqlDB}
	if err := db.migrate(); err != nil {
		sqlDB.Close()
		return nil, err
	}
	return db, nil
}

// Tx runs fn in a write transaction and commits it unless fn fails.
func (db *DB) Tx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// migrate creates the schema for a new database and applies any migration
// added since. Databases made by the Python backend carry Alembic's version;
// they must be at AlembicHead, the schema Go's migrations start from.
func (db *DB) migrate() error {
	var tables int
	if err := db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").Scan(&tables); err != nil {
		return err
	}
	var hasAlembic, hasMigrations int
	db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='alembic_version'").Scan(&hasAlembic)
	db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'").Scan(&hasMigrations)

	if tables > 0 && hasMigrations == 0 {
		// A database the Python backend made: it must be at Alembic's last
		// revision. One from before Alembic existed (no alembic_version) was
		// stamped at head by Python too, so do the same.
		if hasAlembic == 0 {
			if _, err := db.Exec(`CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL, CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))`); err != nil {
				return err
			}
			if _, err := db.Exec("INSERT INTO alembic_version (version_num) VALUES (?)", AlembicHead); err != nil {
				return err
			}
		}
		var version string
		if err := db.QueryRow("SELECT version_num FROM alembic_version").Scan(&version); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if version != AlembicHead {
			return fmt.Errorf("database is at schema revision %q, but this version of Shelfloom needs %q: start the last Python-based release once to upgrade it, then this one", version, AlembicHead)
		}
	}

	if _, err := db.Exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL)"); err != nil {
		return err
	}
	if tables > 0 && hasMigrations == 0 {
		// The baseline is already in place.
		if _, err := db.Exec("INSERT INTO schema_migrations (version) VALUES (1)"); err != nil {
			return err
		}
	}

	names, err := fs.Glob(schemaFiles, "schema/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(names)
	for _, name := range names {
		var version int
		if _, err := fmt.Sscanf(filepath.Base(name), "%04d_", &version); err != nil {
			return fmt.Errorf("bad migration file name %s", name)
		}
		var applied int
		if err := db.QueryRow("SELECT count(*) FROM schema_migrations WHERE version=?", version).Scan(&applied); err != nil {
			return err
		}
		if applied > 0 {
			continue
		}
		body, err := schemaFiles.ReadFile(name)
		if err != nil {
			return err
		}
		err = db.Tx(context.Background(), func(tx *sql.Tx) error {
			for _, stmt := range splitStatements(string(body)) {
				if _, err := tx.Exec(stmt); err != nil {
					return fmt.Errorf("%s: %w", name, err)
				}
			}
			_, err := tx.Exec("INSERT INTO schema_migrations (version) VALUES (?)", version)
			return err
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// splitStatements splits a migration file on semicolons that end a line.
func splitStatements(body string) []string {
	var out []string
	var cur strings.Builder
	for _, line := range strings.Split(body, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		cur.WriteString(line)
		cur.WriteString("\n")
		if strings.HasSuffix(strings.TrimSpace(line), ";") {
			if s := strings.TrimSpace(cur.String()); s != ";" {
				out = append(out, s)
			}
			cur.Reset()
		}
	}
	if s := strings.TrimSpace(cur.String()); s != "" {
		out = append(out, s)
	}
	return out
}
