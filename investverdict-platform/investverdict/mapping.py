"""
Map a positional table grid -> structured LineItems.

This is rule-based and deterministic by default (so the pipeline runs and is
verifiable WITHOUT an LLM or API key). An optional LLM pass can be enabled to
reconcile messy labels and resolve flagged ambiguities; it receives the raw
positional grid (not a flattened blob) plus the schema.

Mapping steps per table:
1. Find the header row(s) and locate year columns (-> period keys).
2. Identify the label column (left-most text column).
3. Identify an optional note/schedule column.
4. For each data row: label + per-year values (signed) + note_ref + subtotal?
"""

from __future__ import annotations

import re

from .numbers import clean_number, looks_like_number
from .periods import normalize_period, looks_like_period_header
from .schema import LineItem

# Labels that indicate a subtotal/total row (validation hooks off this).
_SUBTOTAL_RE = re.compile(
    r"\b(total|sub[-\s]?total|profit before|profit after|profit for|"
    r"net (?:profit|cash|increase|decrease)|earnings before|"
    r"total (?:assets|equity|liabilities|income|expenses|comprehensive))\b",
    re.IGNORECASE,
)

_NOTE_CELL_RE = re.compile(r"^\(?\s*\d{1,3}(?:\.\d+)?\s*\)?$")


def _find_header_row(rows: list) -> tuple:
    """
    Find the row that contains year headers and return
    (header_index, {col_index: period_key}).
    """
    best_idx, best_map = -1, {}
    for idx, row in enumerate(rows[:8]):     # headers are near the top
        col_map = {}
        for ci, cell in enumerate(row):
            key = normalize_period(cell)
            if key:
                col_map[ci] = key
        if len(col_map) > len(best_map):
            best_idx, best_map = idx, col_map
    return best_idx, best_map


def _raw_period_labels(rows: list, header_idx: int, year_cols: dict) -> dict:
    if header_idx < 0:
        return {}
    row = rows[header_idx]
    return {year_cols[ci]: (row[ci] if ci < len(row) else "")
            for ci in year_cols}


def _label_col(rows: list, year_cols: dict) -> int:
    """Left-most column that holds text labels (not years, not pure numbers)."""
    year_set = set(year_cols)
    max_cols = max((len(r) for r in rows), default=0)
    for ci in range(max_cols):
        if ci in year_set:
            continue
        texty = 0
        for r in rows:
            if ci < len(r) and r[ci] and not looks_like_number(r[ci]):
                texty += 1
        if texty >= 2:
            return ci
    return 0


def _extract_note_ref(row: list, label_ci: int, year_cols: dict) -> str:
    """A short numeric cell between the label and the year columns = note ref."""
    year_set = set(year_cols)
    first_year = min(year_cols) if year_cols else len(row)
    for ci in range(label_ci + 1, first_year):
        if ci in year_set:
            continue
        cell = (row[ci] if ci < len(row) else "").strip()
        if cell and _NOTE_CELL_RE.match(cell):
            return cell.strip("() ")
    return ""


def map_table(rows: list) -> tuple:
    """
    Map one positional grid to (list[LineItem], period_labels_raw dict, flags).
    """
    flags: list = []
    if not rows:
        return [], {}, flags

    header_idx, year_cols = _find_header_row(rows)
    if not year_cols:
        flags.append("no year/period header detected in a table block")
        return [], {}, flags

    period_labels_raw = _raw_period_labels(rows, header_idx, year_cols)
    label_ci = _label_col(rows, year_cols)
    sorted_years = [year_cols[c] for c in sorted(year_cols)]
    sorted_cols = sorted(year_cols)

    items: list = []
    for ri, row in enumerate(rows):
        if ri <= header_idx:
            continue
        label = (row[label_ci] if label_ci < len(row) else "").strip()
        if not label or looks_like_period_header(label):
            continue
        # Skip rows that are clearly just numbers with no label.
        if looks_like_number(label):
            continue

        values = {}
        any_value = False
        for col in sorted_cols:
            year = year_cols[col]
            cell = row[col] if col < len(row) else ""
            parsed = clean_number(cell)
            values[year] = parsed.value
            if parsed.value is not None:
                any_value = True
            elif not parsed.is_nil_token and cell.strip():
                flags.append(f"unreadable value for '{label}' [{year}]: {cell!r}")

        # A label row with no numeric values at all is likely a section header;
        # keep it only if it looks like a subtotal/total (those can be blank in
        # weird layouts) — otherwise skip to avoid noise.
        is_sub = bool(_SUBTOTAL_RE.search(label))
        if not any_value and not is_sub:
            continue

        note_ref = _extract_note_ref(row, label_ci, year_cols) or None
        items.append(LineItem(line_item=label, values=values,
                              note_ref=note_ref, is_subtotal=is_sub))

    return items, period_labels_raw, flags


# --- Optional LLM reconciliation pass --------------------------------------

def llm_refine(items: list, period_labels_raw: dict, raw_grid: list,
               section: str, model: str = "claude-opus-4-8") -> list:
    """
    OPTIONAL: use Claude to reconcile messy labels / resolve ambiguous rows.
    Receives the raw positional grid (not a blob). No-op + returns items
    unchanged if the anthropic SDK or API key isn't available.

    This never invents numbers: it is constrained (via prompt) to relabel and
    re-bucket only; numeric values stay as parsed by the deterministic layer.
    """
    try:
        import os
        import anthropic
    except Exception:
        return items
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return items

    # Implementation intentionally minimal here; the deterministic layer is the
    # source of truth for numbers. Wire prompt/schema-constrained call as needed.
    return items
