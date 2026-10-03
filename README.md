# Shelfloom

Self-hosted book library manager with deep KOReader integration and rich reading statistics. Only meant for my own personal use and it is perpetually in development.

## Screenshots

<table>
  <tr>
    <td colspan="3"><img src="docs/screenshots/home-desktop.png" alt="Home dashboard on desktop" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/book-desktop.png" alt="Book detail page with the series shelf" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/library-desktop.png" alt="Library grid on desktop" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/search-desktop.png" alt="Quick search matching books by genre" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/stats-desktop.png" alt="Reading stats" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/home-serials-desktop.png" alt="Web serials row on the home dashboard with new-chapter badges and fetch buttons" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/serials-desktop.png" alt="Web serials list" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/serial-chapters-desktop.png" alt="Serial chapter list loading more chapters as you scroll" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/reader-desktop.png" alt="EPUB web reader" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/reader-sync-koreader-to-web.png" alt="A page read in KOReader and the web reader continuing from it" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/serial-ebook-volumes.png" alt="Published ebooks linked to a serial as its first volumes, ahead of generated volumes" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/volume-suggestions-desktop.png" alt="Book-length volume suggestions of 500 to 600 pages for a web serial" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/series-merge-banner.png" alt="Serial page offering to merge the ebooks' existing series into the serial's series" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="docs/screenshots/settings-desktop.png" alt="Settings" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/home-mobile.png" alt="Home dashboard on mobile" /></td>
    <td><img src="docs/screenshots/book-mobile.png" alt="Book detail page on mobile" /></td>
    <td><img src="docs/screenshots/library-mobile.png" alt="Library on mobile" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/search-mobile.png" alt="Quick search on mobile" /></td>
    <td><img src="docs/screenshots/stats-mobile.png" alt="Reading stats on mobile" /></td>
    <td><img src="docs/screenshots/serial-mobile.png" alt="Web serial detail on mobile" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/reader-mobile.png" alt="Web reader on mobile" /></td>
  </tr>
</table>

Shelfloom can also be installed to your phone's home screen (Add to Home Screen) and opened full screen like an app. Press <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> or <kbd>/</kbd> anywhere to search.

## Quick Start (Docker)

### Using the pre-built image (recommended)

Images are published automatically to GHCR on every push to `main` and on version tags (`v*`).

Copy the example compose file and edit it for your machine:

```bash
cp docker-compose.example.yml docker-compose.yml
```

The tracked example file is `docker-compose.example.yml`. Your local
`docker-compose.yml` is ignored so machine-specific paths do not keep showing up
as unstaged changes.

Example:

```yaml
services:
  shelfloom:
    image: ghcr.io/audemed44/shelfloom:latest
    ports:
      - "8000:8000"
    volumes:
      - ./.data:/data
      - ./.data/books:/books
    restart: unless-stopped
```

Then:

```bash
mkdir -p .data/books .data/covers
docker compose up -d
```

To pin to a specific release, use a version tag instead of `latest`:

```yaml
image: ghcr.io/audemed44/shelfloom:v1.0.0
```

### Building from source

```bash
git clone https://github.com/audemed44/shelfloom.git
cd shelfloom

mkdir -p .data/books .data/covers

# Start the container (builds the image locally)
docker compose up -d --build
```

Open **http://localhost:8000** — the setup wizard will guide you through creating your first shelf.

### Volumes

The default `docker-compose.example.yml` uses a `.data/` directory in the repo root:

| Host path       | Container path | Purpose                   |
| --------------- | -------------- | ------------------------- |
| `./.data`       | `/data`        | Database and cover images |
| `./.data/books` | `/books`       | Book files (your shelf)   |

To mount an external source directory for importing (e.g. from Booklore), add it as an extra read-only volume:

```yaml
volumes:
  - ./.data:/data
  - ./.data/books:/books
  - /path/to/your/source/books:/source:ro
```

Then follow the import instructions below.

### Link back to Foyer

Set `HOMEPAGE_URL` to your [Foyer](https://github.com/audemed44/foyer)
address (e.g. `https://home.example.com`) to get a link back to it at the top
of the sidebar, and in the **More** menu on phones.

### KOReader Sync and the web reader

Shelfloom runs a sync server for KOReader's built-in **Progress sync** plugin, and has a web reader for EPUBs (the **Read** button on a book). Both share one reading position per book, so you can read a chapter in the browser and pick up on your e-reader, or the other way round. No KOReader plugin is needed.

1. In KOReader, open a book and go to **Tools → Progress sync → Custom sync server**. Enter `http://<your-host>:8000/api/kosync` (Settings → KOReader Sync shows the exact address).
2. **Register / Login**, with a new account or one created in Settings → KOReader Sync.
3. Turn on **Automatically keep documents in sync**. Under **Sync behavior**, "Sync to a newer state: Silently" and "Sync to an older state: Prompt" work well. Leave **Document matching method** on Binary.

Books are matched by file, so this works however the files reach the device (Syncthing, USB, OPDS). Positions follow a book when its file changes, including when a web serial volume is rebuilt with chapters added. The web reader converts positions to KOReader's own format; `frontend/scripts/koreader-xpointer-check` checks that conversion against KOReader's engine.

### KOReader `.sdr` Reading Data

Place `.sdr` folders alongside their book files in your books directory. Shelfloom will automatically import highlights, bookmarks, and reading sessions during shelf scans.

If you have a KOReader `statistics.sqlite3` file, mount it into the container and provide the path when triggering a scan via the API.

## Importing from Booklore

Shelfloom includes a migration script for Booklore libraries.

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
