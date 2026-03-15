# Shelfloom

Self-hosted book library manager with deep KOReader integration and rich reading statistics.

## Quick Start (Docker)

```bash
git clone https://github.com/your-user/shelfloom.git
cd shelfloom

# Create local directories for persistent data
mkdir -p .data/books .data/covers

# Start the container
docker compose up -d --build
```

Open **http://localhost:8000** — the setup wizard will guide you through creating your first shelf.

### Volumes

The default `docker-compose.yml` uses a `.data/` directory in the repo root:

| Host path       | Container path | Purpose                  |
|-----------------|---------------|--------------------------|
| `./.data`       | `/data`       | Database and cover images |
| `./.data/books` | `/books`      | Book files (your shelf)  |

To mount an external source directory for importing (e.g. from Booklore), add it as an extra read-only volume:

```yaml
volumes:
  - ./.data:/data
  - ./.data/books:/books
  - /path/to/your/source/books:/source:ro
```

Then follow the import instructions below.

### KOReader Sync

Shelfloom includes a built-in KOSync-compatible server. Point KOReader's sync plugin at `http://<your-host>:8000` and register an account — progress syncs automatically.

### KOReader `.sdr` Reading Data

Place `.sdr` folders alongside their book files in your books directory. Shelfloom will automatically import highlights, bookmarks, and reading sessions during shelf scans.

If you have a KOReader `statistics.sqlite3` file, mount it into the container and provide the path when triggering a scan via the API.

## Importing from Booklore

Shelfloom includes a migration script for [Booklore](https://github.com/adamsuk/booklore) libraries.

**1. Add your source directory to `docker-compose.yml`** (if not already):

```yaml
volumes:
  - ./.data:/data
  - ./.data/books:/books
  - /path/to/booklore/books:/source:ro
```

**2. Restart the container** to pick up the new volume:

```bash
docker compose up -d
```

**3. Run the import script:**

```bash
docker compose exec -T shelfloom python scripts/import_booklore.py \
    --source /source \
    --shelf-path /books \
    --shelf-name "Library" \
    --db-path /data/shelfloom.db \
    --covers-dir /data/covers \
    -v
```

To also import reading sessions from a KOReader `statistics.sqlite3`, mount it and add `--stats-db`:

```yaml
# in docker-compose.yml volumes:
- /path/to/koreader/statistics.sqlite3:/koreader/statistics.sqlite3:ro
```

```bash
docker compose exec -T shelfloom python scripts/import_booklore.py \
    --source /source \
    --shelf-path /books \
    --shelf-name "Library" \
    --db-path /data/shelfloom.db \
    --covers-dir /data/covers \
    --stats-db /koreader/statistics.sqlite3 \
    -v
```

Options:
- `--source` — path to the Booklore books directory (inside the container)
- `--shelf-path` — destination shelf directory where files will be copied
- `--stats-db` — path to a KOReader `statistics.sqlite3` to import reading sessions
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
