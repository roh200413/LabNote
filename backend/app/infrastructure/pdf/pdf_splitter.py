from io import BytesIO

from PIL import Image, ImageDraw
from pypdf import PdfReader


class PdfSplitResult:
    def __init__(self, page_no: int, image_bytes: bytes) -> None:
        self.page_no = page_no
        self.image_bytes = image_bytes


class PdfSplitterService:
    """Minimal PDF split service.

    For each page in PDF, create a placeholder PNG preview image with page number.
    This avoids OS-level poppler dependency while preserving per-page artifacts.
    """

    def split_to_images(self, pdf_bytes: bytes) -> list[PdfSplitResult]:
        reader = PdfReader(BytesIO(pdf_bytes))
        results: list[PdfSplitResult] = []

        for index, _ in enumerate(reader.pages, start=1):
            image = Image.new("RGB", (1240, 1754), color=(255, 255, 255))
            draw = ImageDraw.Draw(image)
            draw.text((40, 40), f"PDF Page {index}", fill=(0, 0, 0))

            output = BytesIO()
            image.save(output, format="PNG")
            results.append(PdfSplitResult(page_no=index, image_bytes=output.getvalue()))

        return results
