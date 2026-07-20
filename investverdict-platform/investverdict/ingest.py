"""
File ingestion & classification.

Decide whether a file is a digital PDF, a scanned (image-only) PDF, or a
plain image, so the pipeline can route to the right extractor.
"""

from __future__ import annotations

import os


def classify_file(path: str) -> str:
    """
    Return one of: 'digital_pdf', 'scanned_pdf', 'image', 'unknown'.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    ext = os.path.splitext(path)[1].lower()
    if ext in (".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"):
        return "image"
    if ext != ".pdf":
        return "unknown"

    return "digital_pdf" if _pdf_has_text(path) else "scanned_pdf"


def _pdf_has_text(path: str, min_chars: int = 60) -> bool:
    """
    A PDF is 'digital' if its pages yield a meaningful amount of extractable
    text. Scanned PDFs are image-only and return little/no text.
    """
    try:
        import pdfplumber  # lazy
    except Exception:
        # Without pdfplumber we can't introspect; assume digital and let the
        # extractor surface a clearer error.
        return True

    try:
        with pdfplumber.open(path) as pdf:
            chars = 0
            for page in pdf.pages[:3]:        # sample first 3 pages
                chars += len((page.extract_text() or ""))
                if chars >= min_chars:
                    return True
    except Exception:
        return True
    return False
