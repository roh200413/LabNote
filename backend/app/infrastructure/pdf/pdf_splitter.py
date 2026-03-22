from io import BytesIO

import fitz


class PdfSplitResult:
    def __init__(self, page_no: int, image_bytes: bytes) -> None:
        self.page_no = page_no
        self.image_bytes = image_bytes


class PdfSplitterService:
    """Render each PDF page to a PNG preview image."""

    def split_to_images(self, pdf_bytes: bytes) -> list[PdfSplitResult]:
        results: list[PdfSplitResult] = []
        document = fitz.open(stream=pdf_bytes, filetype="pdf")

        for index, page in enumerate(document, start=1):
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image_bytes = pixmap.tobytes("png")
            results.append(PdfSplitResult(page_no=index, image_bytes=image_bytes))

        document.close()

        return results
