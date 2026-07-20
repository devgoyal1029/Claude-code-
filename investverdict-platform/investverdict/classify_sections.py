"""
Statement section detection via header keyword scoring.

Given a block of rows (or a page's text), decide whether it belongs to the
Income Statement (P&L), Balance Sheet, or Cash Flow statement. Also detects
units (Lakhs/Crores) and Consolidated vs Standalone from header text.
"""

from __future__ import annotations

import re

# Keyword signals per section. Scored, not first-match, to survive noise.
_PL_KEYS = [
    "statement of profit and loss", "profit and loss", "profit & loss",
    "income statement", "revenue from operations", "total income",
    "total expenses", "profit before tax", "earnings per",
]
_BS_KEYS = [
    "balance sheet", "statement of assets and liabilities",
    "total equity and liabilities", "total assets", "non-current assets",
    "current liabilities", "shareholders' funds", "equity and liabilities",
]
_CF_KEYS = [
    "cash flow statement", "statement of cash flows", "cash flow",
    "operating activities", "investing activities", "financing activities",
    "net increase in cash", "cash and cash equivalents at",
]

SECTIONS = ("income_statement", "balance_sheet", "cash_flow")


def _score(text: str, keys: list) -> int:
    t = text.lower()
    return sum(1 for k in keys if k in t)


def classify_section(text: str) -> tuple:
    """
    Return (section_name | None, score). None when no signal is strong enough.
    """
    scores = {
        "income_statement": _score(text, _PL_KEYS),
        "balance_sheet": _score(text, _BS_KEYS),
        "cash_flow": _score(text, _CF_KEYS),
    }
    best = max(scores, key=scores.get)
    if scores[best] == 0:
        return None, 0
    return best, scores[best]


def detect_units(text: str) -> str:
    """Detect reporting units from header text. Defaults to 'Absolute'."""
    t = text.lower()
    if re.search(r"\bin\s+crores?\b|₹\s*crores?|rs\.?\s*crores?|\bcr\.?\b", t):
        return "Crores"
    if re.search(r"\bin\s+lakhs?\b|\blacs?\b|₹\s*lakhs?|rs\.?\s*lakhs?", t):
        return "Lakhs"
    if re.search(r"\bin\s+millions?\b|\bmn\b", t):
        return "Millions"
    return "Absolute"


def detect_statement_type(text: str) -> str:
    """Consolidated vs Standalone from header text. Defaults to Standalone."""
    t = text.lower()
    if "consolidated" in t:
        return "Consolidated"
    if "standalone" in t or "separate financial" in t:
        return "Standalone"
    return "Standalone"
