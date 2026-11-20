"""Plain-text extraction for documents uploaded as AI generation sources (PDF, DOCX, TXT/MD)."""

import io
import re
import zipfile
from xml.etree import ElementTree

MAX_SOURCE_BYTES = 20 * 1024 * 1024
WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class UnsupportedDocumentError(ValueError):
    pass


def _clean(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _pdf_text(data: bytes) -> str:
    import fitz

    try:
        with fitz.open(stream=data, filetype="pdf") as document:
            pages = [f"[{index} 페이지]\n{page.get_text('text')}" for index, page in enumerate(document, 1)]
    except Exception as exc:  # PyMuPDF raises several error types for broken files
        raise UnsupportedDocumentError("PDF를 읽을 수 없습니다") from exc
    return "\n\n".join(pages)


def _docx_text(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            xml = archive.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError) as exc:
        raise UnsupportedDocumentError("Word(.docx) 파일을 읽을 수 없습니다") from exc
    root = ElementTree.fromstring(xml)
    paragraphs = []
    for paragraph in root.iter(f"{WORD_NS}p"):
        texts = [node.text or "" for node in paragraph.iter(f"{WORD_NS}t")]
        paragraphs.append("".join(texts))
    return "\n".join(paragraphs)


def _plain_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "cp949", "euc-kr"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise UnsupportedDocumentError("텍스트 파일 인코딩을 알 수 없습니다 (UTF-8로 저장해 주세요)")


def extract_text(filename: str, data: bytes) -> str:
    if not data:
        raise UnsupportedDocumentError(f"{filename}: 빈 파일입니다")
    if len(data) > MAX_SOURCE_BYTES:
        raise UnsupportedDocumentError(f"{filename}: 파일은 20MB 이하여야 합니다")
    name = filename.lower()
    if name.endswith(".pdf"):
        text = _pdf_text(data)
    elif name.endswith(".docx"):
        text = _docx_text(data)
    elif name.endswith((".txt", ".md", ".csv")):
        text = _plain_text(data)
    elif name.endswith((".hwp", ".hwpx", ".doc")):
        raise UnsupportedDocumentError(f"{filename}: 한글/구형 Word 파일은 PDF나 .docx로 저장해서 올려 주세요")
    else:
        raise UnsupportedDocumentError(f"{filename}: PDF, Word(.docx), 텍스트(.txt/.md) 파일만 올릴 수 있습니다")
    cleaned = _clean(text)
    if len(re.sub(r"\[\d+ 페이지\]|\s", "", cleaned)) < 20:
        raise UnsupportedDocumentError(
            f"{filename}: 글자를 거의 찾지 못했습니다. 스캔한 PDF라면 텍스트가 있는 PDF로 다시 저장해 주세요"
        )
    return cleaned
