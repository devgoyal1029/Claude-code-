"""
Image preprocessing + OCR -> positional tables.

Optional stage. Only imported on the scanned/image path. Performs deskew and
contrast enhancement, then runs layout-aware OCR. All heavy deps are imported
lazily so the rest of the package works without them.
"""

from __future__ import annotations

from .extract_tables import RawTable


def deskew_and_enhance(pil_image):
    """
    Deskew a scanned page and boost contrast. Returns a PIL image.
    Uses opencv if available; otherwise returns the image unchanged.
    """
    try:
        import numpy as np
        import cv2
    except Exception:
        return pil_image

    img = np.array(pil_image.convert("L"))
    # Threshold to find text pixels, estimate skew via minAreaRect.
    thr = cv2.threshold(img, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    coords = cv2.findNonZero(thr)
    if coords is None:
        return pil_image
    angle = cv2.minAreaRect(coords)[-1]
    if angle < -45:
        angle = 90 + angle
    (h, w) = img.shape
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    rotated = cv2.warpAffine(img, M, (w, h),
                             flags=cv2.INTER_CUBIC,
                             borderMode=cv2.BORDER_REPLICATE)
    rotated = cv2.normalize(rotated, None, 0, 255, cv2.NORM_MINMAX)
    from PIL import Image
    return Image.fromarray(rotated)


def _pages_to_images(path: str, dpi: int):
    """Yield PIL images for each page (PDF) or the single image file."""
    ext = path.lower().rsplit(".", 1)[-1]
    if ext == "pdf":
        from pdf2image import convert_from_path
        yield from convert_from_path(path, dpi=dpi)
    else:
        from PIL import Image
        yield Image.open(path)


def ocr_to_tables(path: str, dpi: int = 300) -> list:
    """
    Run layout-aware OCR over each page and reconstruct a positional grid from
    word bounding boxes (same grid logic as the digital path, applied to OCR
    output). Returns list[RawTable].
    """
    import pytesseract
    from pytesseract import Output

    tables = []
    for i, image in enumerate(_pages_to_images(path, dpi), start=1):
        image = deskew_and_enhance(image)
        data = pytesseract.image_to_data(image, output_type=Output.DICT)
        page_text = pytesseract.image_to_string(image)
        rows = _ocr_words_to_grid(data)
        if rows:
            tables.append(RawTable(rows=rows, page_number=i,
                                   page_text=page_text, source="ocr"))
    return tables


def _ocr_words_to_grid(data: dict, y_tol: int = 10, col_gap: int = 25) -> list:
    """Group OCR words into a positional grid by (line, x-gap)."""
    words = []
    n = len(data["text"])
    for k in range(n):
        txt = data["text"][k].strip()
        if not txt or int(data["conf"][k]) < 0:
            continue
        words.append({
            "text": txt,
            "x0": data["left"][k],
            "x1": data["left"][k] + data["width"][k],
            "top": data["top"][k],
        })
    if not words:
        return []

    words.sort(key=lambda w: (w["top"], w["x0"]))
    rows_by_y = []
    for w in words:
        placed = False
        for row in rows_by_y:
            if abs(row["top"] - w["top"]) <= y_tol:
                row["words"].append(w)
                placed = True
                break
        if not placed:
            rows_by_y.append({"top": w["top"], "words": [w]})

    grid = []
    for row in sorted(rows_by_y, key=lambda r: r["top"]):
        ws = sorted(row["words"], key=lambda w: w["x0"])
        cells, cur, last_x1 = [], ws[0]["text"], ws[0]["x1"]
        for w in ws[1:]:
            if w["x0"] - last_x1 > col_gap:
                cells.append(cur)
                cur = w["text"]
            else:
                cur += " " + w["text"]
            last_x1 = w["x1"]
        cells.append(cur)
        grid.append([c.strip() for c in cells])
    return grid
