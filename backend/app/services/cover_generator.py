"""Generated covers for books that have none.

Swiss-style typographic covers: a solid colour field, the author along the
top, a simple geometric motif, a large series number for books in a series,
and the title set big at the bottom. Books in the same series share a colour
and differ in motif, so a series reads as a set on the shelf.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 800, 1200
MARGIN = 64

_FONTS = Path(__file__).resolve().parent.parent / "assets" / "fonts"


@dataclass(frozen=True)
class Palette:
    background: str
    text: str
    accent: str


# Pairs checked for contrast: text on background is at least 7:1 except the
# saturated blue and red, where white text is still above 4.5:1 at these sizes.
PALETTES: tuple[Palette, ...] = (
    Palette("#2563ff", "#ffffff", "#0b1f66"),  # blue
    Palette("#0b0b0b", "#f4f1ea", "#2563ff"),  # black
    Palette("#e8381c", "#ffffff", "#3a0b03"),  # red
    Palette("#f2eee4", "#111111", "#e8381c"),  # paper
    Palette("#1d4a37", "#f2eee4", "#e3c14a"),  # green
    Palette("#e3c14a", "#111111", "#111111"),  # ochre
    Palette("#3a2c63", "#f2eee4", "#ff8a5b"),  # violet
    Palette("#dfe6ef", "#0b1f66", "#2563ff"),  # pale blue
)

MOTIFS = ("circle", "half", "bars", "grid", "diagonal", "rings")


@cache
def _font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(_FONTS / f"Inter-{weight}.ttf"), size)


def _digest(key: str) -> int:
    return int(hashlib.sha256(key.encode("utf-8")).hexdigest(), 16)


def choose_style(title: str, author: str | None, series: str | None) -> tuple[Palette, str]:
    """Colour from the series (or author), motif from the title."""
    colour_key = (series or author or title).strip().lower()
    palette = PALETTES[_digest(colour_key) % len(PALETTES)]
    motif = MOTIFS[_digest(title.strip().lower()) % len(MOTIFS)]
    return palette, motif


def _variant(title: str) -> int:
    """Small per-title variations of a motif (direction, counts)."""
    return (_digest(title.strip().lower()) // len(MOTIFS)) % 12


def format_sequence(sequence: float | None) -> str | None:
    if sequence is None:
        return None
    if float(sequence).is_integer():
        return f"{int(sequence):02d}"
    return f"{sequence:g}"


def _wrap(text: str, font: ImageFont.FreeTypeFont, width: int) -> list[str]:
    """Greedy word wrap; a single word longer than the line is broken by letters."""
    lines: list[str] = []
    line = ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if font.getlength(candidate) <= width:
            line = candidate
            continue
        if line:
            lines.append(line)
        while font.getlength(word) > width and len(word) > 1:
            cut = len(word)
            while cut > 1 and font.getlength(word[:cut] + "-") > width:
                cut -= 1
            lines.append(word[:cut] + "-")
            word = word[cut:]
        line = word
    if line:
        lines.append(line)
    return lines


def _fit_title(
    title: str, width: int, max_height: int, max_lines: int = 5
) -> tuple[ImageFont.FreeTypeFont, list[str], int]:
    """Largest title size (96px down to 40px) whose wrapped lines fit the box."""
    for size in range(104, 39, -4):
        font = _font("ExtraBold", size)
        lines = _wrap(title, font, width)
        leading = int(size * 1.02)
        if len(lines) <= max_lines and leading * len(lines) <= max_height:
            return font, lines, leading
    font = _font("ExtraBold", 40)
    lines = _wrap(title, font, width)[:max_lines]
    if lines:
        lines[-1] = lines[-1].rstrip(".") + "…"
    return font, lines, int(40 * 1.02)


def _spaced(draw: ImageDraw.ImageDraw, xy, text, font, fill, tracking: float) -> None:
    """Letter-spaced text (Pillow has no tracking)."""
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=font, fill=fill)
        x += font.getlength(ch) + tracking


def _fit_spaced(text: str, weight: str, size: int, tracking: float, width: int) -> str:
    font = _font(weight, size)
    while text and sum(font.getlength(c) + tracking for c in text) > width:
        text = text[:-2] + "…"
    return text


def _draw_motif(
    draw: ImageDraw.ImageDraw, motif: str, box, palette: Palette, variant: int = 0
) -> None:
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    cx, cy = x0 + w / 2, y0 + h / 2
    r = min(w, h) / 2
    fg, accent = palette.text, palette.accent
    if motif == "circle":
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=fg, width=10)
        draw.ellipse([cx - r * 0.18, cy - r * 0.18, cx + r * 0.18, cy + r * 0.18], fill=accent)
    elif motif == "half":
        # A rising half disc resting on a line at the bottom of the box.
        hr = min(w / 2, h * 0.85)
        base = y1 - 3
        draw.pieslice([cx - hr, base - hr, cx + hr, base + hr], 180, 360, fill=accent)
        draw.line([x0, base, x1, base], fill=fg, width=6)
    elif motif == "bars":
        n = 5 + variant % 4
        gap = h / (n * 2 - 1)
        for i in range(n):
            y = y0 + i * gap * 2
            length = w * (0.35 + 0.65 * ((i * 37) % n) / (n - 1))
            if variant % 2:  # right-aligned
                draw.rectangle([x1 - length, y, x1, y + gap], fill=accent if i == 2 else fg)
            else:
                draw.rectangle([x0, y, x0 + length, y + gap], fill=accent if i == 2 else fg)
    elif motif == "grid":
        n = 3 + variant % 3
        step = min(w, h) / n
        s = step * 0.34
        ox = cx - step * n / 2 + step / 2
        oy = cy - step * n / 2 + step / 2
        for i in range(n):
            for j in range(n):
                px, py = ox + i * step, oy + j * step
                fill = accent if (i, j) == (variant % n, (variant // 3) % n) else fg
                draw.ellipse([px - s, py - s, px + s, py + s], fill=fill)
    elif motif == "diagonal":
        count = 2 + variant % 3
        flip = variant % 2 == 1  # rising left-to-right, or falling
        band = w * (0.28 if count == 2 else 0.2 if count == 3 else 0.15)
        for k in range(count):
            off = (k - (count - 1) / 2) * band * 1.75
            colour = accent if k == count // 2 else fg
            bottom = (x0 + off, x0 + off + band)
            top = (x1 + off - band, x1 + off)
            if flip:
                bottom, top = (x1 - off - band, x1 - off), (x0 - off, x0 - off + band)
            draw.polygon(
                [(bottom[0], y1), (bottom[1], y1), (top[1], y0), (top[0], y0)],
                fill=colour,
            )
    else:  # rings
        for i, frac in enumerate((1.0, 0.72, 0.44)):
            rr = r * frac
            draw.ellipse(
                [cx - rr, cy - rr, cx + rr, cy + rr],
                outline=accent if i == 1 else fg,
                width=8,
            )


def render_cover(
    title: str,
    author: str | None = None,
    series: str | None = None,
    sequence: float | None = None,
) -> Image.Image:
    """Render a cover. Deterministic: the same inputs give the same image."""
    title = " ".join((title or "Untitled").split())
    palette, motif = choose_style(title, author, series)
    img = Image.new("RGB", (WIDTH, HEIGHT), palette.background)
    draw = ImageDraw.Draw(img)
    inner = WIDTH - 2 * MARGIN

    # Author, top left, letter-spaced, with a rule under it.
    top = MARGIN
    if author:
        name = _fit_spaced(author.upper(), "SemiBold", 26, 4, inner)
        _spaced(draw, (MARGIN, top), name, _font("SemiBold", 26), palette.text, 4)
    draw.rectangle([MARGIN, top + 50, WIDTH - MARGIN, top + 54], fill=palette.text)

    # Title block, sized to fit, anchored to the bottom margin.
    label = None
    number = format_sequence(sequence)
    if series:
        label = series.upper() + (f"  ·  BOOK {number.lstrip('0') or '0'}" if number else "")
    title_font, lines, leading = _fit_title(title, inner, max_height=HEIGHT * 0.36)
    block = leading * len(lines)
    y_title = HEIGHT - MARGIN - block
    y_label = y_title - 56
    if label:
        text = _fit_spaced(label, "SemiBold", 22, 3, inner)
        _spaced(draw, (MARGIN, y_label), text, _font("SemiBold", 22), palette.text, 3)
    for i, line in enumerate(lines):
        draw.text((MARGIN - 4, y_title + i * leading), line, font=title_font, fill=palette.text)

    # Motif between the rule and the title. A series number gets its own
    # column on the right, and the motif fills the space beside it.
    motif_top = top + 110
    motif_bottom = (y_label if label else y_title) - 60
    motif_right = WIDTH - MARGIN
    if number:
        size = 220 if len(number) <= 2 else 170
        font = _font("ExtraBold", size)
        bbox = draw.textbbox((0, 0), number, font=font)
        x = WIDTH - MARGIN - (bbox[2] - bbox[0]) - bbox[0]
        draw.text((x, motif_top - bbox[1]), number, font=font, fill=palette.accent)
        motif_right = x + bbox[0] - 48
    if motif_bottom - motif_top > 120 and motif_right - MARGIN > 120:
        # Draw on its own layer and paste only the motif's box, so shapes that
        # run past it (the diagonal bands) are clipped cleanly.
        box = (MARGIN, int(motif_top), int(motif_right), int(motif_bottom))
        layer = Image.new("RGB", (WIDTH, HEIGHT), palette.background)
        _draw_motif(ImageDraw.Draw(layer), motif, box, palette, _variant(title))
        img.paste(layer.crop(box), box[:2])
    return img


def save_cover(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "JPEG", quality=90, optimize=True)
