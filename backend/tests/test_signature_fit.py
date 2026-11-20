import base64
from io import BytesIO

from PIL import Image, ImageDraw

from app.domain.accounts.use_cases import normalize_signature_image
from app.presentation.routers.document_editor import SIGNATURE_RECTS


def _png(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_signature_margins_are_cropped_and_background_removed() -> None:
    image = Image.new("RGB", (600, 400), "white")
    ImageDraw.Draw(image).line([(250, 180), (350, 220)], fill="black", width=6)

    result = Image.open(BytesIO(normalize_signature_image(_png(image))))
    assert result.mode == "RGBA"
    # Only the stroke (~100x40) plus a small padding is left.
    assert result.width < 120 and result.height < 60
    assert result.getpixel((0, 0))[3] == 0  # white paper became transparent


def test_blank_or_invalid_images() -> None:
    blank = Image.new("RGB", (50, 30), "white")
    assert Image.open(BytesIO(normalize_signature_image(_png(blank)))).size == (50, 30)
    try:
        normalize_signature_image(b"not an image")
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")


def test_signature_boxes_stay_inside_footer_cells() -> None:
    # Footer grid: signature column x 250-510, rows 955-1026 (author) and 1026-1098 (reviewer).
    rows = {"author-signature": (955, 1026), "reviewer-signature": (1026, 1098)}
    for block_id, rect in SIGNATURE_RECTS.items():
        top, bottom = rows[block_id]
        assert 250 < rect["x"] and rect["x"] + rect["w"] < 510
        assert top < rect["y"] and rect["y"] + rect["h"] < bottom
