"""Company-wide research note format: body sections, page layout, header/footer labels, fonts.

The same structure is mirrored in ``frontend/src/lib/noteFormat.ts``; keep the two in sync.
"""

import math
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

PAGE_WIDTH = 794
PAGE_HEIGHT = 1123
CONTENT_X = 34
CONTENT_W = 726
HEADER_LINE_Y = 55
FOOTER_TOP_Y = 955
FRAME_BOTTOM_Y = 1098


class _CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")


class NoteFormatSection(_CamelModel):
    id: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=60)
    guide: str = Field(default="", max_length=300)

    @field_validator("id")
    @classmethod
    def _slug(cls, value: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            raise ValueError("섹션 ID에는 영문, 숫자, '-', '_'만 쓸 수 있습니다")
        return value


class NoteFormatLayout(_CamelModel):
    mode: Literal["image_top", "text_top", "text_only", "image_only"] = "image_top"
    image_ratio: float = Field(default=0.48, ge=0.2, le=0.8)


class NoteFormatHeader(_CamelModel):
    show: bool = True
    title_label: str = Field(default="제목 :", max_length=30)


class NoteFormatFooter(_CamelModel):
    show: bool = True
    recorded_label: str = Field(default="작성자", max_length=30)
    witnessed_label: str = Field(default="검토자", max_length=30)
    signature_label: str = Field(default="서명", max_length=30)
    date_label: str = Field(default="날짜", max_length=30)


class NoteFormatTypography(_CamelModel):
    body_font_size: int = Field(default=12, ge=8, le=24)
    heading_font_size: int = Field(default=13, ge=8, le=28)
    heading_bold: bool = True


def _default_sections() -> list[NoteFormatSection]:
    return [
        NoteFormatSection(id="purpose", title="연구 목적", guide="이번 실험/작업의 목적과 배경"),
        NoteFormatSection(id="method", title="수행 내용", guide="재료, 조건, 절차 등 수행한 내용"),
        NoteFormatSection(id="result", title="결과", guide="관찰 결과와 측정값"),
        NoteFormatSection(id="discussion", title="고찰 및 향후 계획", guide="결과 해석, 문제점, 다음 계획"),
    ]


class NoteFormat(_CamelModel):
    version: int = 1
    sections: list[NoteFormatSection] = Field(default_factory=_default_sections, max_length=12)
    layout: NoteFormatLayout = Field(default_factory=NoteFormatLayout)
    header: NoteFormatHeader = Field(default_factory=NoteFormatHeader)
    footer: NoteFormatFooter = Field(default_factory=NoteFormatFooter)
    typography: NoteFormatTypography = Field(default_factory=NoteFormatTypography)

    @field_validator("sections")
    @classmethod
    def _unique_ids(cls, sections: list[NoteFormatSection]) -> list[NoteFormatSection]:
        ids = [section.id for section in sections]
        if len(ids) != len(set(ids)):
            raise ValueError("섹션 ID가 중복되었습니다")
        return sections

    # ─── Geometry shared by the PDF renderer ──────────────────────────────
    @property
    def content_top(self) -> int:
        return 64 if self.header.show else 34

    @property
    def content_bottom(self) -> int:
        return 948 if self.footer.show else 1088

    @property
    def has_image_area(self) -> bool:
        return self.layout.mode != "text_only"

    def max_image_ratio(self) -> float:
        """Largest image share that still leaves every section a title line and a small box.

        Mirrors ``maxImageRatio`` in frontend/src/lib/noteFormat.ts.
        """
        if self.layout.mode == "image_only" or not self.sections:
            return 0.8
        height = self.content_bottom - self.content_top
        count = len(self.sections)
        heading_h = round(self.typography.heading_font_size * 1.5 + 10)
        min_text = count * (heading_h + 28) + (count - 1) * 8
        ratio = math.floor(((height - 12 - min_text) / height) * 50) / 50
        return min(0.8, max(0.2, ratio))

    def content_image_rect(self) -> tuple[int, int, int, int] | None:
        """Area the uploaded page image is fitted into, or None when the layout has no image."""
        top, bottom = self.content_top, self.content_bottom
        height = bottom - top
        if self.layout.mode == "text_only":
            return None
        if self.layout.mode == "image_only" or not self.sections:
            return (CONTENT_X, top, CONTENT_W, height)
        image_h = round(height * min(self.layout.image_ratio, self.max_image_ratio()))
        if self.layout.mode == "image_top":
            return (CONTENT_X, top, CONTENT_W, image_h)
        return (CONTENT_X, bottom - image_h, CONTENT_W, image_h)


DEFAULT_NOTE_FORMAT = NoteFormat()
