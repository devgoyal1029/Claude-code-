"""
Number cleaning & sign handling for Indian financial statements.

This is the deterministic core of the extractor. It is intentionally
dependency-free so it can be unit-tested in isolation.

Handles:
- Indian comma grouping (lakh/crore: 1,23,456) and Western (123,456)
- Negatives shown as (1,234), -1,234, 1,234(Dr), 1,234 Dr
- Currency symbols (Rs, INR, Rs.) and footnote superscripts
- Blank / dash / Nil / NA  -> None (caller decides 0 vs null)
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

# Tokens that mean "no value" (vs a real zero). Caller decides 0 vs null.
_NIL_TOKENS = {"", "-", "--", "—", "–", "nil", "na", "n/a", "n.a.", "x", "*"}

# Currency markers stripped before parsing.
_CURRENCY_RE = re.compile(r"(?:₹|rs\.?|inr|usd|\$)", re.IGNORECASE)

# Trailing footnote / note superscripts e.g. "1,234^5" or "1,234#" or unicode ¹²³.
_SUPERSCRIPT_MAP = str.maketrans("⁰¹²³⁴⁵⁶⁷⁸⁹", "0123456789")
_TRAILING_NOTE_RE = re.compile(r"[\^\#\*]+\d*\s*$")

# Dr / Cr accounting suffixes.
_DR_RE = re.compile(r"\(?\s*dr\.?\s*\)?\s*$", re.IGNORECASE)
_CR_RE = re.compile(r"\(?\s*cr\.?\s*\)?\s*$", re.IGNORECASE)


@dataclass
class ParsedNumber:
    """Result of parsing a single cell."""
    value: Optional[float]      # None when unreadable / nil
    is_nil_token: bool          # True if cell was an explicit nil/dash/blank
    was_negative: bool          # sign was applied (bracket / minus / Dr)
    raw: str                    # original text
    note: str = ""              # one-line reason if value is None


def clean_number(raw: str) -> ParsedNumber:
    """
    Parse a single financial-statement cell into a signed float.

    Never guesses. If the cleaned text is not a clean number, returns
    value=None with a note so the caller can flag it rather than fabricate.
    """
    if raw is None:
        return ParsedNumber(None, True, False, "", note="empty cell")

    original = str(raw)
    s = original.strip()

    # Explicit nil / dash / blank tokens.
    if s.lower() in _NIL_TOKENS:
        return ParsedNumber(None, True, False, original, note="nil/dash token")

    # Normalise unicode superscripts to plain digits only AFTER we check
    # for note markers, so we don't merge a note number into the value.
    s = _TRAILING_NOTE_RE.sub("", s).strip()
    s = s.translate(_SUPERSCRIPT_MAP)

    # Strip currency symbols and stray whitespace inside the number.
    s = _CURRENCY_RE.sub("", s).strip()

    negative = False

    # Accounting bracket negative: (1,234) or (1,234.00)
    if s.startswith("(") and s.endswith(")"):
        negative = True
        s = s[1:-1].strip()

    # Dr/Cr suffix. Dr on an asset-style figure is typically positive; here we
    # treat a trailing "Cr" as negative and "Dr" as positive, but record the
    # marker so the mapping layer can apply account-aware logic if needed.
    if _CR_RE.search(s):
        negative = True
        s = _CR_RE.sub("", s).strip()
    elif _DR_RE.search(s):
        s = _DR_RE.sub("", s).strip()

    # Leading minus (may co-exist after bracket strip in malformed cells).
    if s.startswith("-"):
        negative = not negative
        s = s[1:].strip()
    if s.startswith("+"):
        s = s[1:].strip()

    # Remove ALL commas (both Indian and Western grouping are now irrelevant
    # because we only need the digits; grouping never affects magnitude).
    s = s.replace(",", "").replace(" ", "")

    if s == "":
        return ParsedNumber(None, True, negative, original, note="empty after cleaning")

    # Must be a clean decimal now. Anything else = unreadable, do NOT guess.
    if not re.fullmatch(r"\d+(?:\.\d+)?", s):
        return ParsedNumber(None, False, negative, original,
                            note=f"unparseable numeric token: {original!r}")

    value = float(s)
    if negative:
        value = -value
    return ParsedNumber(value, False, negative, original)


def looks_like_number(raw: str) -> bool:
    """Cheap predicate: does this cell plausibly contain a numeric value?"""
    p = clean_number(raw)
    return p.value is not None


# --- Indian comma validation (used by tests + confidence checks) -----------

def is_indian_grouped(raw: str) -> bool:
    """
    True if the string uses Indian lakh/crore comma grouping (e.g. 1,23,456),
    as opposed to Western thousands grouping (123,456). Useful for detecting
    mixed conventions in a document.
    """
    s = _CURRENCY_RE.sub("", str(raw)).strip().lstrip("(-").rstrip(")")
    s = s.split(".")[0]
    if "," not in s:
        return False
    groups = s.split(",")
    # Indian: first group 1-2 digits, all following groups exactly 2, last 3.
    if len(groups) < 2:
        return False
    last = groups[-1]
    middle = groups[1:-1]
    if len(last) != 3:
        return False
    return all(len(g) == 2 for g in middle) and len(middle) > 0
