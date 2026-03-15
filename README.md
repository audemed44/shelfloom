# Shelfloom

Self-hosted book library manager with deep KOReader integration and rich reading statistics.

## Quick Start (Docker)

```bash
git clone https://github.com/your-user/shelfloom.git
cd shelfloom

# Create local directories for persistent data
mkdir -p data books

# Start the container
docker compose up -d --build
```

Open **http://localhost:8000** — the setup wizard will guide you through creating your first shelf.

### Volumes

| Mount   | Purpose                                    |
|---------|--------------------------------------------|
| `./data`  | Database, cover images                   |
| `./books` | Your book files — organize sub-folders however you like (e.g. `books/fiction`, `books/nonfiction`) |

Place your `.epub` and `.pdf` files inside `./books/` (in any sub-folder structure you prefer), then use the shelf management UI to point shelves at the paths inside the container under `/books`.

### KOReader Sync

Shelfloom includes a built-in KOSync-compatible server. Point KOReader's sync plugin at `http://<your-host>:8000` and register an account — progress syncs automatically.

### KOReader `.sdr` Reading Data

Place `.sdr` folders alongside their book files in your books directory. Shelfloom will automatically import highlights, bookmarks, and reading sessions during shelf scans.

If you have a KOReader `statistics.sqlite3` file, mount it into the container and provide the path when triggering a scan via the API.

## Importing from Booklore

Shelfloom includes a migration script for [Booklore](https://github.com/adamsuk/booklore) libraries. Run it inside the container:

```bash
# Copy your Booklore export into the books volume first, then:
docker compose exec shelfloom python scripts/import_booklore.py \
    --source /books/booklore-export \
    --in-place \
    --shelf-name "Library" \
    --db-path /data/shelfloom.db \
    --covers-dir /data/covers
```

Options:
- `--source` — path to the Booklore books directory (inside the container)
- `--in-place` — use the source directory as the shelf (no file copying)
- `--shelf-path <path>` — copy files to a different shelf directory (required if not using `--in-place`)
- `--stats-db <path>` — path to a KOReader `statistics.sqlite3` to import reading sessions
- `--dry-run` — preview metadata enrichment without writing changes
- `-v` — verbose logging

## Development

```bash
# Install root dev tools
npm install

# Backend
cd backend
uv venv .venv
uv pip install -e ".[dev]"
source .venv/Scripts/activate   # Windows Git Bash
# source .venv/bin/activate     # Linux/macOS

# Frontend
cd frontend
npm install

# Run both dev servers
npm run dev   # from repo root
```

### Tests

```bash
# All tests
npm test

# Backend only
cd backend && python -m pytest --cov=app --cov-fail-under=90

# Frontend only
cd frontend && npm test
```
