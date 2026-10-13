# Shelfloom

Instructions for coding agents (Codex, Claude Code and others) working in
this repository. `CLAUDE.md` imports this file.

## Project

Self-hosted book library: a Go server (`cmd/shelfloom`, `internal/`) with
SQLite (`modernc.org/sqlite`, cgo-free) and a React + TypeScript + Tailwind
frontend in `frontend/`, served by the Go server.

- `internal/server`: HTTP handlers and the library logic (routes in
  `routes.go`); `internal/store`: database, schema migrations, datetimes;
  `internal/epub`, `internal/pdf` (poppler-utils), `internal/koreader`
  (Lua/.sdr, statistics DB), `internal/scrapers` (web serials),
  `internal/covergen`, `internal/imaging`, `internal/hashing`.
- The backend used to be Python (FastAPI). The Go code keeps its behaviour
  and data formats on purpose, so existing databases, files and KOReader
  devices keep working: datetimes stored as `YYYY-MM-DD HH:MM:SS.ffffff`
  naive UTC and sent without an offset, JSON shaped like the Pydantic models
  (including FastAPI-style 422 bodies), chapter keys from normalised URLs,
  KOReader partial MD5s, EPUB page-count estimates. Keep those stable.

## Logging

Use `internal/logging` (copied from homelab-app-template), through `log/slog`:

- Inside a request or job, log with the `Context` variants
  (`slog.ErrorContext(r.Context(), …)`) so the line carries its trace.
- Wrap background work in `logging.Job` (or `QuietJob` when it runs every
  minute or so) and call `End(err, counts…)`.
- Call `logging.Audit(ctx, "thing.verb", ids…)` for anything a person
  changes: sign-ins, settings, deletes. Set `logging.SetUser` where the app
  knows who's signed in.
- Messages are short and stable (`"mail sync failed"`, not one with an id
  in it); details go in attributes. The limits count repeats per message.
- Ids, counts and names only. Never tokens, passwords or the content the
  app stores (mail bodies, amounts, document text).

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <summary in the imperative, lower case>
```

- Types: `feat`, `fix`, `perf`, `refactor`, `style`, `docs`, `test`, `build`,
  `ci`, `chore`.
- Scopes are the area touched, e.g. `serials`, `series`, `reader`, `kosync`,
  `home`, `library`, `book`, `stats`, `settings`, `search`, `ui`, `backend`,
  `deps`, `docker`. Omit the scope when a change spans the whole app.
- Keep the subject short; explain the why in the body.
- PR titles follow the same format.

## Checks before pushing

```sh
gofmt -l cmd internal          # must print nothing
go vet ./cmd/... ./internal/... && go test -race ./cmd/... ./internal/...
cd frontend && npm run lint && npx prettier --check "src/**/*.{ts,tsx}" && npx tsc -b && npm test && npm run build
```

Go commands list the directories explicitly: `./...` would also pick up a
Go package inside `node_modules/`. PDF tests need `pdfinfo`/`pdftoppm`
(poppler-utils) and skip without them.

## Conventions

- Schema changes are new files in `internal/store/schema/` (`NNNN_name.sql`),
  applied in order on startup. `0001_baseline.sql` is the schema the Python
  release left (Alembic revision `e7b2c9d41a05`); `alembic_version` is kept
  so an older release can still open the database.
- Keep dependencies few; Go code uses the standard library where it can.
- The UI follows a Swiss style: black and white with blue (`primary`) as the
  accent, square corners, typographic hierarchy. Check new screens on a
  phone-width viewport too.
- `frontend/public/foliate/` is foliate-js vendored unmodified (see its
  README for the pinned commit); don't edit it in place.
- The KOReader sync server (`internal/server/kosync.go`) must stay
  compatible with KOReader's Progress sync plugin; the XPointer conversion in
  `frontend/src/reader/xpointer.ts` can be checked against KOReader with
  `frontend/scripts/koreader-xpointer-check`.
