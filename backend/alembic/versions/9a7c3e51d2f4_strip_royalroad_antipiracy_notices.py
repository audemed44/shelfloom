"""strip RoyalRoad anti-piracy notices from stored chapters

RoyalRoad injects a hidden "this story is stolen / report it on Amazon" sentence
into every chapter. Older scrapes exposed it because the page CSS that hides it
was dropped. The scraper now removes it at fetch time; this cleans chapters that
were already fetched and marks generated volumes containing them as stale so
they can be regenerated.

The detection logic is copied here (not imported from app code) so this
migration keeps behaving the same even if the scraper changes later.

Revision ID: 9a7c3e51d2f4
Revises: e4f0d0f4e7a1
Create Date: 2026-09-27 21:10:00.000000

"""

import html as html_lib
import re
from collections.abc import Sequence

import sqlalchemy as sa
from bs4 import BeautifulSoup, Tag

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "9a7c3e51d2f4"
down_revision: str | None = "e4f0d0f4e7a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_BATCH = 200
_MAX_CHARS = 250
_RANDOM_NOTICE_CLASS = re.compile(r"^c(?!n)[A-Za-z0-9]{40,}$")
_NOTICE_TEXT = re.compile(
    r"\bamazon\b|royal\s*road|stolen|unauthori[sz]ed|without (?:the author'?s? )?"
    r"(?:consent|permission|approval)|original (?:site|source|website)"
    r"|(?:different|another) website|genuine (?:story|version)",
    re.IGNORECASE,
)


def _strip(content: str) -> tuple[str, int]:
    soup = BeautifulSoup(content, "html.parser")
    removed = 0
    for body in soup.select("div.chapter-inner") or [soup]:
        for child in list(body.children):
            if not isinstance(child, Tag) or child.name != "span":
                continue
            text = child.get_text(" ", strip=True)
            if not text or len(text) > _MAX_CHARS:
                continue
            classes = child.get("class") or []
            if any(_RANDOM_NOTICE_CLASS.match(c) for c in classes) or _NOTICE_TEXT.search(text):
                child.decompose()
                removed += 1
    return (str(soup), removed) if removed else (content, 0)


def _count_words(content: str) -> int:
    text = re.sub(r"<[^>]+>", " ", content)
    return len(html_lib.unescape(text).split())


def upgrade() -> None:
    conn = op.get_bind()
    changed: dict[int, set[int]] = {}
    last_id = 0
    while True:
        rows = conn.execute(
            sa.text(
                "SELECT c.id, c.serial_id, c.chapter_number, c.content "
                "FROM serial_chapters c JOIN web_serials s ON s.id = c.serial_id "
                "WHERE s.source = 'royalroad' AND c.content IS NOT NULL AND c.id > :last "
                "ORDER BY c.id LIMIT :n"
            ),
            {"last": last_id, "n": _BATCH},
        ).fetchall()
        if not rows:
            break
        for chapter_id, serial_id, number, content in rows:
            last_id = chapter_id
            cleaned, removed = _strip(content)
            if not removed:
                continue
            conn.execute(
                sa.text("UPDATE serial_chapters SET content = :c, word_count = :w WHERE id = :id"),
                {"c": cleaned, "w": _count_words(cleaned), "id": chapter_id},
            )
            changed.setdefault(serial_id, set()).add(number)

    # Generated EPUB volumes that include a cleaned chapter are now out of date.
    for serial_id, numbers in changed.items():
        volumes = conn.execute(
            sa.text(
                "SELECT id, chapter_start, chapter_end FROM serial_volumes "
                "WHERE serial_id = :s AND generated_at IS NOT NULL"
            ),
            {"s": serial_id},
        ).fetchall()
        for volume_id, start, end in volumes:
            if any(start <= n <= end for n in numbers):
                conn.execute(
                    sa.text("UPDATE serial_volumes SET is_stale = 1 WHERE id = :id"),
                    {"id": volume_id},
                )


def downgrade() -> None:
    # The removed notices are not worth restoring.
    pass
