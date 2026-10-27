// Command shelfloom is Shelfloom's server: the API, the background library
// scan and serial update check, and the built frontend.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // the runtime image may have no zoneinfo; TZ needs this

	"github.com/audemed44/shelfloom/internal/logging"
	"github.com/audemed44/shelfloom/internal/scrapers"
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
	// SHELFLOOM_LOG_LEVEL still works, as LOG_LEVEL.
	if v := os.Getenv("SHELFLOOM_LOG_LEVEL"); v != "" && os.Getenv("LOG_LEVEL") == "" {
		os.Setenv("LOG_LEVEL", v)
	}
	logging.Setup("shelfloom", os.Stderr)

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
			ZLibraryDomain:      env("SHELFLOOM_ZLIBRARY_DOMAIN", "z-library.hn"),
			ZLibraryEmail:       os.Getenv("SHELFLOOM_ZLIBRARY_EMAIL"),
			ZLibraryPassword:    os.Getenv("SHELFLOOM_ZLIBRARY_PASSWORD"),
			OpenRouterKey:       env("SHELFLOOM_OPENROUTER_API_KEY", os.Getenv("OPENROUTER_API_KEY")),
			OpenRouterModel:     os.Getenv("SHELFLOOM_OPENROUTER_MODEL"),
			OpenRouterURL:       os.Getenv("SHELFLOOM_OPENROUTER_BASE_URL"),
		},
	}
	if u := os.Getenv("SHELFLOOM_FLARESOLVERR_URL"); u != "" {
		scrapers.Solver = scrapers.NewFlareSolverr(u)
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
		ErrorLog:          logging.ServerErrorLog(),
		IdleTimeout:       2 * time.Minute,
		// No read or write timeout: uploads and volume builds can take minutes.
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	slog.Info("shelfloom listening", "addr", srv.Addr, "db", dbPath, "log_level", logging.ParseLevel(os.Getenv("LOG_LEVEL")).String())
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
