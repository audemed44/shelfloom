# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /build
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ── Stage 2: Server ─────────────────────────────────────────────────────────
FROM golang:1.27-alpine AS server-build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ cmd/
COPY internal/ internal/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /shelfloom ./cmd/shelfloom

# ── Stage 3: Runtime ────────────────────────────────────────────────────────
# poppler-utils reads PDF metadata and renders PDF covers.
FROM alpine:3.23

RUN apk add --no-cache ca-certificates poppler-utils tzdata

COPY --from=server-build /shelfloom /usr/local/bin/shelfloom
COPY --from=frontend-build /build/dist /app/frontend/dist

WORKDIR /app

# Default data/config paths — the setup wizard handles everything else.
# The image runs as root unless the compose file sets a user, as before.
ENV SHELFLOOM_DB_PATH=/data/shelfloom.db \
    SHELFLOOM_COVERS_DIR=/data/covers \
    SHELFLOOM_LISTEN=:8000 \
    SHELFLOOM_FRONTEND_DIR=/app/frontend/dist \
    GOMEMLIMIT=64MiB

VOLUME ["/data", "/books"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD ["shelfloom", "healthcheck"]

CMD ["shelfloom"]
