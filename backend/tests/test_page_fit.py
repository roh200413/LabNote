"""One note is one A4 page: length budgets for the AI and fitting text into its box."""

from app.domain.note_formats.entities import NoteFormat, NoteFormatLayout
from app.domain.note_formats.page_fit import char_budget, draft_char_budget, estimate_lines, fit_font_size
from app.infrastructure.llm.openai_note_generator import build_system_prompt

LINE = "- 조명 조건별로 Otsu 임계값을 적용해 이진화 결과를 비교함 (threshold.py)"


def test_wrapping_counts_wide_characters_as_full_width() -> None:
    assert estimate_lines("가" * 59, 726, 12) == 1
    assert estimate_lines("가" * 61, 726, 12) == 2
    assert estimate_lines("a" * 100, 726, 12) == 1  # Latin letters are about half as wide
    assert estimate_lines("첫 줄\n\n셋째 줄", 726, 12) == 3


def test_font_shrinks_until_text_fits_and_gives_up_below_minimum() -> None:
    assert fit_font_size(LINE, 726, 300, start=12) == 12
    long_text = "\n".join([LINE] * 60)
    size = fit_font_size(long_text, 726, 872, start=12)
    assert size is not None and 9 <= size < 12
    assert fit_font_size("\n".join([LINE] * 200), 726, 872, start=12) is None


def test_draft_budget_follows_the_format_text_area() -> None:
    text_only = draft_char_budget(NoteFormat(layout=NoteFormatLayout(mode="text_only")))
    with_image = draft_char_budget(NoteFormat())
    assert text_only > with_image >= 300
    assert char_budget(726, 872, 12) > char_budget(726, 400, 12)


def test_prompt_states_the_one_page_budget() -> None:
    prompt = build_system_prompt("ko", [("실험 목표", "")], max_chars=900)
    assert "single A4 page" in prompt and "900 characters" in prompt
    assert "Write the section bodies in Korean" in prompt and "[확인 필요]" in prompt
