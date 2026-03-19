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

WORKDIR /app

# Copy backend and install (includes app/ package that setuptools needs)
COPY backend/ .
RUN pip install --no-cache-dir .

# Copy built frontend next to backend at /app/frontend/dist
COPY --from=frontend-build /build/dist /app/frontend/dist

# Default data/config paths — the setup wizard handles everything else
ENV SHELFLOOM_DB_PATH=/data/shelfloom.db
ENV SHELFLOOM_COVERS_DIR=/data/covers
ENV PYTHONUNBUFFERED=1

VOLUME ["/data", "/books"]

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level $(echo ${SHELFLOOM_LOG_LEVEL:-info} | tr '[:upper:]' '[:lower:]')"]
