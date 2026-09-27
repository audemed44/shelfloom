# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ── Stage 2: Python runtime ─────────────────────────────────────────────────
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    && rm -rf /var/lib/apt/lists/*

# uv installs the exact versions pinned in backend/uv.lock, so the image runs
# the same dependencies the tests ran against (a plain `pip install .` would
# pick up whatever is newest on PyPI at build time).
COPY --from=ghcr.io/astral-sh/uv:0.8.17 /uv /bin/uv

WORKDIR /app

ENV UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

# Dependencies first (cached layer), then the app itself.
# --locked fails the build if uv.lock is out of date with pyproject.toml.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project --no-cache
COPY backend/ .
RUN uv sync --locked --no-dev --no-editable --no-cache

ENV PATH="/app/.venv/bin:$PATH"

# Copy built frontend next to backend at /app/frontend/dist
COPY --from=frontend-build /build/dist /app/frontend/dist

# Default data/config paths — the setup wizard handles everything else
ENV SHELFLOOM_DB_PATH=/data/shelfloom.db
ENV SHELFLOOM_COVERS_DIR=/data/covers
ENV PYTHONUNBUFFERED=1

VOLUME ["/data", "/books"]

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level $(echo ${SHELFLOOM_LOG_LEVEL:-info} | tr '[:upper:]' '[:lower:]')"]
