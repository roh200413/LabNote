"""How much text fits in a box on the A4 note page.

A note is one A4 page, so generated text must fit the space the note format leaves for it. These
estimates mirror how text is drawn (PDF export uses line height 1.35 inside a 4px inset) and are
deliberately a little conservative: Hangul and other CJK glyphs count as one em wide, Latin
letters and digits as about half an em.
"""

import math

from app.domain.note_formats.entities import CONTENT_W, NoteFormat

LINE_HEIGHT = 1.35
BOX_INSET = 8  # 4px on each side, as in the PDF renderer
MIN_FONT_SIZE = 9
DEFAULT_CHAR_BUDGET = 1500


def _char_width(char: str) -> float:
    if char == " ":
        return 0.3
    if ord(char) >= 0x1100:  # Hangul, CJK and other wide scripts
        return 1.0
    return 0.56


def estimate_lines(text: str, width: float, font_size: float) -> int:
    """Lines the text takes once wrapped to the box width (an empty line still takes one)."""
    per_line = max(1.0, (width - BOX_INSET) / font_size)
    total = 0
    for paragraph in text.split("\n"):
        units = sum(_char_width(char) for char in paragraph)
        total += max(1, math.ceil(units / per_line))
    return total


def text_height(text: str, width: float, font_size: float) -> float:
    return estimate_lines(text, width, font_size) * font_size * LINE_HEIGHT + BOX_INSET


def fit_font_size(text: str, width: float, height: float, *, start: int, minimum: int = MIN_FONT_SIZE) -> int | None:
    """Largest size from ``start`` down to ``minimum`` at which the text fits, or None."""
    for size in range(start, minimum - 1, -1):
        if text_height(text, width, size) <= height:
            return size
    return None


def char_budget(width: float, height: float, font_size: float) -> int:
    """Roughly how many (mostly Korean) characters of bullet text fit in the box.

    Bullets rarely fill their last line, so only ~60% of the raw line capacity is counted.
    """
    if height <= BOX_INSET:
        return 0
    lines = (height - BOX_INSET) / (font_size * LINE_HEIGHT)
    per_line = (width - BOX_INSET) / font_size
    return int(lines * per_line * 0.6)


def draft_char_budget(fmt: NoteFormat) -> int:
    """Characters available for the section bodies of a draft placed into the note format's text area."""
    if fmt.layout.mode == "image_only":
        return 400
    height = fmt.content_bottom - fmt.content_top
    image = fmt.content_image_rect()
    if image is not None:
        height -= image[3] + 12
    count = max(1, len(fmt.sections))
    heading_height = round(fmt.typography.heading_font_size * 1.5 + 10)
    height -= count * heading_height + (count - 1) * 8 + 12
    return max(300, char_budget(CONTENT_W - 16, height, fmt.typography.body_font_size))
