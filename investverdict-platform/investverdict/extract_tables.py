"""
Raw table extraction with positional coordinates.

Digital PDFs -> pdfplumber (preserves cell grid + word coordinates).
Scanned PDFs / images -> OCR path (preprocess.py + OCR engine), built as a
stage but degrades gracefully if the OCR engine isn't installed.

A "RawTable" is a positional grid: list of rows, each row a list of cell
strings, plus the page text for section/header detection. We deliberately
keep the grid (row, col) intact instead of flattening to a text blob.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RawTable:
    rows: list                      # list[list[str]]  (positional grid)
    page_number: int
    page_text: str = ""             # full page text for header/section detection
    source: str = "pdf"             # "pdf" | "ocr"

    @property
    def n_cols(self) -> int:
        return max((len(r) for r in self.rows), default=0)


def extract_digital_pdf(path: str) -> list:
    """
    Extract positional tables from a digital (text-based) PDF using pdfplumber.
    Returns list[RawTable]. Lazy-imports pdfplumber so the deterministic core
    stays importable without it.
    """
    import pdfplumber  # lazy

    tables: list = []
    with pdfplumber.open(path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            page_text = page.extract_text() or ""
            # Try lattice-like (lines) then stream-like (text) settings.
            found = page.extract_tables() or []
            for raw in found:
                rows = [[(_clean_cell(c)) for c in row] for row in raw]
                rows = [r for r in rows if any(cell for cell in r)]
                if rows:
                    tables.append(RawTable(rows=rows, page_number=i,
                                           page_text=page_text, source="pdf"))
            # Fallback: if no ruled tables, reconstruct a grid from word x-positions.
            if not found:
                rows = _grid_from_words(page)
                if rows:
                    tables.append(RawTable(rows=rows, page_number=i,
                                           page_text=page_text, source="pdf"))
    return tables


def _clean_cell(c) -> str:
    if c is None:
        return ""
    return str(c).replace("\n", " ").strip()


def _grid_from_words(page, x_tol: float = 3.0, y_tol: float = 3.0) -> list:
    """
    Reconstruct a positional grid from word coordinates when no ruled table is
    detected. Groups words into rows by y, then into columns by x-gaps. This is
    the 'reconstruct the grid; don't read left-to-right blindly' requirement.
    """
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    if not words:
        return []

    # Group into rows by top coordinate.
    words.sort(key=lambda w: (round(w["top"]), w["x0"]))
    rows_by_y: list = []
    for w in words:
        placed = False
        for row in rows_by_y:
            if abs(row["top"] - w["top"]) <= y_tol:
                row["words"].append(w)
                placed = True
                break
        if not placed:
            rows_by_y.append({"top": w["top"], "words": [w]})

    # Build column boundaries from the global distribution of word x0s.
    grid = []
    for row in rows_by_y:
        ws = sorted(row["words"], key=lambda w: w["x0"])
        cells = []
        cur = ws[0]["text"]
        last_x1 = ws[0]["x1"]
        for w in ws[1:]:
            gap = w["x0"] - last_x1
            if gap > 12:                      # column break heuristic
                cells.append(cur)
                cur = w["text"]
            else:
                cur += " " + w["text"]
            last_x1 = w["x1"]
        cells.append(cur)
        grid.append([c.strip() for c in cells])
    return grid


def extract_scanned(path: str, dpi: int = 300) -> list:
    """
    OCR path for scanned PDFs / images. Built as a stage; raises a clear,
    actionable error if the OCR toolchain isn't installed rather than failing
    obscurely. (tesseract + pytesseract + pdf2image/Pillow + opencv.)
    """
    try:
        from . import preprocess
        import pytesseract  # noqa: F401
    except Exception as e:  # pragma: no cover - env dependent
        raise RuntimeError(
            "OCR path requires the optional OCR stack (pytesseract + tesseract "
            "binary + Pillow/opencv + pdf2image). Install tesseract "
            "(`brew install tesseract`) and `pip install pytesseract pdf2image "
            "opencv-python pillow`. Original import error: " + str(e)
        )
    from . import preprocess
    return preprocess.ocr_to_tables(path, dpi=dpi)
