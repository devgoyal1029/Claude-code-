"""
Period header normalisation.

Year headers in Indian statements appear as: "2024-25", "FY25", "FY 2024-25",
"March 31, 2025", "31.03.2025", "As at 31 March 2025", "Year ended 31st March, 2024".
We normalise all of these to a canonical "FY<YYYY>" key (the year the
financial year ENDS) while preserving the raw label.
"""

from __future__ import annotations

import re
from typing import Optional

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def normalize_period(raw: str) -> Optional[str]:
    """
    Return canonical 'FY<YYYY>' (FY end year) or None if no year is found.
    Indian FY ends 31 March, so '2024-25' -> FY2025.
    """
    if not raw:
        return None
    s = str(raw).strip().lower()

    # Pattern: 2024-25 or 2024-2025 or 2024/25  -> take the END year.
    m = re.search(r"(20\d{2})\s*[-/]\s*(\d{2,4})", s)
    if m:
        start = int(m.group(1))
        end_frag = m.group(2)
        end = int(end_frag) if len(end_frag) == 4 else (start // 100) * 100 + int(end_frag)
        # Handle century rollover e.g. 1999-00
        if end < start:
            end += 100
        return f"FY{end}"

    # Pattern: FY25 / FY2025 / FY 25
    m = re.search(r"fy\s*'?(\d{2,4})", s)
    if m:
        frag = m.group(1)
        year = int(frag) if len(frag) == 4 else 2000 + int(frag)
        return f"FY{year}"

    # Pattern: a month + a 4-digit year (March 31, 2025 / 31 March 2025).
    has_month = any(mon in s for mon in _MONTHS)
    m = re.search(r"(20\d{2})", s)
    if m and (has_month or "as at" in s or "year end" in s or "ended" in s):
        return f"FY{int(m.group(1))}"

    # Bare 4-digit year as a last resort.
    m = re.fullmatch(r"\s*(20\d{2})\s*", s)
    if m:
        return f"FY{int(m.group(1))}"

    return None


def looks_like_period_header(raw: str) -> bool:
    return normalize_period(raw) is not None
