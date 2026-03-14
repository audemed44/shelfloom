# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Shelfloom** is a self-hosted book library management system with deep KOReader integration and rich reading statistics. Target: ~30–50MB RAM in a single Docker container.

See `PLAN.md` for full architecture decisions and data model. See `IMPLEMENTATION.md` for the phased development roadmap.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.12 + FastAPI + uvicorn |
| Database | SQLite via aiosqlite |
| ORM / Migrations | SQLAlchemy 2.0 (async) + Alembic |
| Frontend | React + Vite + Tailwind CSS |
| Charts | Recharts or Nivo |
| Container | Single Docker image (multi-stage: Node build → Python runtime) |

## Project Structure (planned)

```
shelfloom/
  backend/
    app/
      main.py          — FastAPI app factory
      config.py        — Settings via pydantic-settings
      database.py      — SQLAlchemy async engine + session factory
      models/          — SQLAlchemy ORM models
      routers/         — FastAPI route handlers
      services/        — Business logic (library, koreader, stats, import)
    alembic/           — DB migrations
    pyproject.toml     — Python deps, pytest/coverage config
    Dockerfile
  frontend/
    src/
    package.json
    vite.config.js
    tailwind.config.js
  tests/
    conftest.py        — Fixtures: async DB session, test client, tmp dirs
  docker-compose.yml
```

## Commands

### Setup (first time)
```bash
cd backend
uv venv .venv
uv pip install -e ".[dev]"
source .venv/Scripts/activate      # Windows Git Bash
# .venv\Scripts\Activate.ps1       # Windows PowerShell
# source .venv/bin/activate        # Linux/macOS
```

### Backend
```bash
cd backend
# Activate venv first (see above for your shell)
python -m pytest --cov=app --cov-fail-under=90   # Run tests with coverage enforcement
python -m pytest ../tests/test_foo.py             # Run a single test file
python -m pytest -k "test_name"                   # Run a single test by name
ruff check .                                       # Lint
mypy app/                                          # Type check
uvicorn app.main:app --reload --port 8000          # Run dev server
```

### Frontend
```bash
cd frontend
npm install
npm run dev        # Dev server
npm run build      # Production build
npm test           # Vitest
npm run lint       # ESLint
```

### Docker
```bash
docker compose up          # Start full stack
docker compose up --build  # Rebuild and start
```

## Architecture

- **Single container**: FastAPI serves both the REST API (`/api/*`) and the built React frontend via `StaticFiles`.
- **Service layer**: Business logic lives in `app/services/` (LibraryService, KOReaderService, StatsService, ImportService). Routers are thin — they validate input and delegate to services.
- **Async throughout**: All DB access is async via aiosqlite. Use `async def` for all service methods and route handlers.
- **Volumes**: `/shelves/*` for book files (multiple configurable shelves), `/data` for DB and covers, `/koreader` for optional KOReader stats.

## Testing Patterns

- **DB tests**: Use in-memory SQLite, rolled back after each test.
- **File operations**: Use pytest's `tmp_path` fixture — never touch real filesystems.
- **API tests**: Use FastAPI's async test client (httpx).
- **Fixtures**: Factory functions for books, shelves, sessions in `tests/conftest.py`.
- **EPUB/PDF/sdr fixtures**: Small valid test files committed to the repo.
- **Coverage exclusions**: Alembic migration boilerplate, `__main__.py`, third-party wrappers.

## Workflow Rules

- **Commit after every step**: When a step from IMPLEMENTATION.md is complete, make a conventional commit before moving on. Use the format `feat(<scope>): <description> (step X.Y)` matching the step number and scope from the plan.

## Key Domain Concepts

- **Shelf**: A mounted directory of book files (e.g., `/shelves/library`). Books have a `shelf_id` FK.
- **Book hashes**: SHA-256 for deduplication; MD5 for KOReader matching. Both stored on `books` table.
- **KOReader `.sdr` files**: Per-book directories containing Lua table files with highlights, bookmarks, and reading progress. Parsed manually (no lupa dependency if avoidable).
- **ReadingSession**: Has `source` + `source_key` for deduplication across KOReader's `.sdr` files and `statistics.sqlite3`. Sessions can be `dismissed`.
- **Series hierarchy**: Series can have a parent series (e.g., Cosmere → Stormlight Archive). The full ancestor chain is resolved client-side by fetching `/api/series/tree` (flat list) and walking `parent_id` links.
- **One series per book (UI rule)**: The backend supports many-to-many book↔series, but the UI enforces one series per book. A reading-order feature will handle multi-series placement later.

## Frontend Design System

The UI follows a strict OLED-dark Swiss design language. Keep these patterns consistent:

- **Colours**: `bg-black`, `bg-slate-900/60` for cards, `text-white/40` for labels, `text-primary` (`#258cf4`) for accents and active states, `text-red-400` for destructive actions.
- **Typography**: `text-[10px] font-black tracking-widest uppercase` for all labels/section headers. Large display text uses `font-black tracking-tighter uppercase` (CSS class, never `.toUpperCase()` in JS — preserve DOM text for tests and accessibility).
- **Borders**: `border-white/10` standard, `border-white/20` on hover. No rounded corners on inputs/buttons inside modals (sharp edges). `rounded-lg` only on action buttons in the main page view.
- **Inputs**: `bg-black border border-white/10 px-4 py-3 focus:border-primary` — no focus ring, border color change only.
- **Section headers in modals**: Numbered `01`, `02` prefix + `border-b border-white/10 pb-2 mb-6`.
- **Modals**: `max-w-2xl`, `bg-black`, sticky header + scrollable body + sticky footer. Backdrop `bg-black/80`. Sub-modals at `z-[60]` over the parent at `z-50`.
- **Mock-up source**: UI designs live in `.data/example/ui-mockups/` as HTML files — reference these when redesigning pages.
