import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

router = APIRouter(tags=["filesystem"])


class DirEntry(BaseModel):
    name: str
    path: str
    has_children: bool


class DirListing(BaseModel):
    path: str
    parent: str | None
    entries: list[DirEntry]


def _list_dirs(path: str) -> DirListing:
    p = Path(path).resolve()
    if not p.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Path not found: {path}")
    if not p.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Not a directory: {path}"
        )

    parent = str(p.parent) if p.parent != p else None

    entries: list[DirEntry] = []
    try:
        for child in sorted(p.iterdir(), key=lambda x: x.name.lower()):
            if not child.is_dir():
                continue
            try:
                has_children = any(c.is_dir() for c in child.iterdir())
            except PermissionError:
                has_children = False
            entries.append(DirEntry(name=child.name, path=str(child), has_children=has_children))
    except PermissionError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=f"Permission denied: {path}"
        )

    return DirListing(path=str(p), parent=parent, entries=entries)


def _get_roots() -> DirListing:
    """Return filesystem roots (drives on Windows, / on Unix)."""
    import sys

    if sys.platform == "win32":
        import string

        roots = [f"{d}:\\" for d in string.ascii_uppercase if os.path.exists(f"{d}:\\")]
        entries = [DirEntry(name=r, path=r, has_children=True) for r in roots]
        return DirListing(path="", parent=None, entries=entries)
    return _list_dirs("/")


@router.get("/fs/dirs", response_model=DirListing)
async def list_dirs(path: str | None = Query(None)) -> DirListing:
    """List subdirectories at the given path. Omit path to get filesystem roots."""
    if path is None or path == "":
        return _get_roots()
    return _list_dirs(path)
