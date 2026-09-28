# Shelfloom

Instructions for coding agents (Codex, Claude Code and others) working in
this repository. `CLAUDE.md` imports this file.

## Project

Self-hosted book library: FastAPI + SQLAlchemy (async, SQLite) backend in
`backend/`, React + TypeScript + Tailwind frontend in `frontend/`.

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
npm run lint          # ruff + eslint
npm run test          # pytest (90% coverage floor) + vitest
cd backend && uv run ruff format --check .
cd frontend && npx prettier --check "src/**/*.{ts,tsx}" && npx tsc -b && npm run build
```

## Conventions

- Backend dependencies are locked in `backend/uv.lock`; the Docker image
  installs from it.
- Alembic migrations are self-contained (no imports from `app`) and use
  `op.batch_alter_table` for SQLite. The app upgrades to head on startup.
- The UI follows a Swiss style: black and white with blue (`primary`) as the
  accent, square corners, typographic hierarchy. Check new screens on a
  phone-width viewport too.
- `frontend/public/foliate/` is foliate-js vendored unmodified (see its
  README for the pinned commit); don't edit it in place.
- The KOReader sync server (`backend/app/routers/kosync.py`) must stay
  compatible with KOReader's Progress sync plugin; the XPointer conversion in
  `frontend/src/reader/xpointer.ts` can be checked against KOReader with
  `frontend/scripts/koreader-xpointer-check`.
