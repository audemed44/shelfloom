// Command shelfloom is Shelfloom's server: the API, the background library
// scan and serial update check, and the built frontend.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // the runtime image may have no zoneinfo; TZ needs this

	"github.com/audemed44/shelfloom/internal/server"
	"github.com/audemed44/shelfloom/internal/store"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func seconds(key string, fallback int) time.Duration {
	n, err := strconv.Atoi(env(key, strconv.Itoa(fallback)))
	if err != nil || n < 1 {
		slog.Warn("ignoring invalid "+key, "value", os.Getenv(key))
		n = fallback
	}
	return time.Duration(n) * time.Second
}

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "healthcheck":
			os.Exit(healthcheck())
		}
	}
	var level slog.Level
	if err := level.UnmarshalText([]byte(strings.ToLower(env("SHELFLOOM_LOG_LEVEL", "info")))); err != nil {
		level = slog.LevelInfo
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: level})))

	dbPath := env("SHELFLOOM_DB_PATH", "/data/shelfloom.db")
	db, err := store.Open(dbPath)
	if err != nil {
		slog.Error("could not open the database", "path", dbPath, "err", err)
		os.Exit(1)
	}
	defer db.Close()

	app := &server.Server{
		DB: db,
		Config: server.Config{
			CoversDir:           env("SHELFLOOM_COVERS_DIR", "/data/covers"),
			DefaultShelfName:    env("SHELFLOOM_DEFAULT_SHELF_NAME", "Library"),
			DefaultShelfPath:    env("SHELFLOOM_DEFAULT_SHELF_PATH", "/shelves/library"),
			ScanInterval:        seconds("SHELFLOOM_SCAN_INTERVAL", 300),
			SerialCheckInterval: seconds("SHELFLOOM_SERIAL_CHECK_INTERVAL", 86400),
			FoyerURL:            os.Getenv("HOMEPAGE_URL"),
		},
	}
	if dir := env("SHELFLOOM_FRONTEND_DIR", "frontend/dist"); isDir(dir) {
		app.Frontend = os.DirFS(dir)
	} else {
		slog.Warn("no built frontend; serving the API only", "dir", dir)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	handler := app.Handler()
	// SHELFLOOM_DISABLE_BACKGROUND turns the scan and serial check loops off
	// (manual scans still work); for comparing instances on copied data.
	app.Start(ctx, os.Getenv("SHELFLOOM_DISABLE_BACKGROUND") == "")

	srv := &http.Server{
		Addr:              env("SHELFLOOM_LISTEN", ":8000"),
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       2 * time.Minute,
		// No read or write timeout: uploads and volume builds can take minutes.
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	slog.Info(fmt.Sprintf("Shelfloom started (log_level=%s)", strings.ToUpper(level.String())), "addr", srv.Addr, "db", dbPath)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server stopped", "err", err)
		stop()
		app.Wait()
		os.Exit(1)
	}
	app.Wait()
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// healthcheck is the container's HEALTHCHECK.
func healthcheck() int {
	client := http.Client{Timeout: 3 * time.Second}
	port := env("SHELFLOOM_LISTEN", ":8000")
	port = port[strings.LastIndex(port, ":")+1:]
	resp, err := client.Get("http://127.0.0.1:" + port + "/api/health")
	if err != nil {
		return 1
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
