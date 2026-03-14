"""Read and parse KOReader .sdr folder contents."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from app.koreader.lua_parser import parse_lua

log = logging.getLogger(__name__)


@dataclass
class SdrAnnotation:
    text: str
    note: str | None
    chapter: str | None
    page: int | None
    datetime: datetime | None


@dataclass
class SdrReadingData:
    """Parsed data from a KOReader .sdr folder."""

    # Book identity (for matching)
    partial_md5: str | None  # partial_md5_checksum
    doc_path: str | None  # doc_path (original path on device)
    title: str | None  # doc_props.title
    authors: str | None  # doc_props.authors
    # Reading state
    percent_finished: float | None  # 0.0–1.0
    last_xpointer: str | None
    doc_pages: int | None
    status: str | None  # summary.status ("reading", "complete", etc.)
    # Reading sessions (from stats.performance_in_pages)
    performance_in_pages: dict[int, int]  # {unix_timestamp: pages}
    total_time_in_sec: int | None
    # Highlights
    annotations: list[SdrAnnotation]
    # Raw parsed data for debugging
    raw: dict[str, Any]


def _parse_datetime(dt_str: str | None) -> datetime | None:
    """Parse KOReader datetime string like '2024-01-15 20:30:00'."""
    if not dt_str:
        return None
    try:
        return datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
    except (ValueError, TypeError):
        return None


def _extract_annotations(raw: dict[str, Any]) -> list[SdrAnnotation]:
    """Extract annotations list from raw parsed Lua data."""
    annotations_raw = raw.get("annotations")
    if not annotations_raw or not isinstance(annotations_raw, dict):
        return []

    result: list[SdrAnnotation] = []
    # KOReader uses 1-based numeric keys for array-like tables
    for key in sorted(annotations_raw.keys(), key=lambda k: k if isinstance(k, int) else 0):
        ann = annotations_raw[key]
        if not isinstance(ann, dict):
            continue
        text = ann.get("text", "")
        if not text:
            continue
        note_raw = ann.get("note", "")
        note = note_raw if note_raw else None
        result.append(
            SdrAnnotation(
                text=str(text),
                note=note if isinstance(note, str) and note else None,
                chapter=ann.get("chapter") or None,
                page=ann.get("pageno") or None,
                datetime=_parse_datetime(ann.get("datetime")),
            )
        )
    return result


def _extract_performance_in_pages(raw: dict[str, Any]) -> dict[int, int]:
    """Extract {unix_timestamp: pages} mapping from stats.performance_in_pages."""
    stats = raw.get("stats")
    if not isinstance(stats, dict):
        return {}
    perf = stats.get("performance_in_pages")
    if not isinstance(perf, dict):
        return {}
    result: dict[int, int] = {}
    for k, v in perf.items():
        try:
            result[int(k)] = int(v)
        except (ValueError, TypeError):
            pass
    return result


def read_sdr(sdr_path: Path) -> SdrReadingData | None:
    """
    Parse the metadata.*.lua file from a .sdr folder.
    Returns None if no readable metadata file found.
    """
    if not sdr_path.is_dir():
        return None

    # Find metadata.*.lua files
    lua_files = list(sdr_path.glob("metadata.*.lua"))
    if not lua_files:
        return None

    # Use the first one found (usually only one)
    lua_file = lua_files[0]
    try:
        text = lua_file.read_text(encoding="utf-8", errors="replace")
        raw = parse_lua(text)
    except Exception as e:
        log.warning("Failed to parse %s: %s", lua_file, e)
        return None

    if not isinstance(raw, dict):
        log.warning("Expected dict from %s, got %s", lua_file, type(raw))
        return None

    doc_props = raw.get("doc_props") or {}
    summary = raw.get("summary") or {}
    stats = raw.get("stats") or {}

    return SdrReadingData(
        partial_md5=raw.get("partial_md5_checksum") or None,
        doc_path=raw.get("doc_path") or None,
        title=doc_props.get("title") or None,
        authors=doc_props.get("authors") or None,
        percent_finished=raw.get("percent_finished") or None,
        last_xpointer=raw.get("last_xpointer") or None,
        doc_pages=raw.get("doc_pages") or None,
        status=summary.get("status") or None,
        performance_in_pages=_extract_performance_in_pages(raw),
        total_time_in_sec=stats.get("total_time_in_sec") or None,
        annotations=_extract_annotations(raw),
        raw=raw,
    )
