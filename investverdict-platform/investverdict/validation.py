"""
Validation & confidence scoring.

Programmatic sanity checks the downstream model can trust:
- Subtotal/total = sum of its components (within rounding tolerance)
- Balance Sheet balances: Total Assets == Total Equity + Liabilities
- Year-count consistency across line items
- Confidence score derived from readability + check pass rate
"""

from __future__ import annotations

import re

from .schema import Statement, ExtractionConfidence

# Relative tolerance for "total = sum of components". Statements rounded to
# the reporting unit can drift by a unit or two.
_REL_TOL = 0.01
_ABS_TOL = 1.0


def _is_total_assets(label: str) -> bool:
    return bool(re.search(r"\btotal\s+assets\b", label, re.IGNORECASE))


def _is_total_eq_liab(label: str) -> bool:
    return bool(re.search(r"\btotal\s+equity\s+and\s+liabilities\b"
                          r"|\btotal\s+liabilities\s+and\s+equity\b",
                          label, re.IGNORECASE))


def _close(a: float, b: float) -> bool:
    return abs(a - b) <= max(_ABS_TOL, _REL_TOL * max(abs(a), abs(b)))


def check_balance_sheet(stmt: Statement) -> list:
    """Flag if Total Assets != Total Equity & Liabilities per year."""
    flags = []
    assets = {li.line_item: li for li in stmt.balance_sheet if _is_total_assets(li.line_item)}
    eqliab = {li.line_item: li for li in stmt.balance_sheet if _is_total_eq_liab(li.line_item)}
    if not assets or not eqliab:
        return flags
    ta = next(iter(assets.values()))
    tel = next(iter(eqliab.values()))
    for year in stmt.periods:
        a, b = ta.values.get(year), tel.values.get(year)
        if a is None or b is None:
            continue
        if not _close(a, b):
            flags.append(
                f"Balance sheet does not balance [{year}]: "
                f"Total Assets {a} != Total Equity & Liabilities {b}")
    return flags


def check_subtotals(items: list, periods: list) -> list:
    """
    For each subtotal row, check it equals the sum of the non-subtotal rows
    immediately preceding it (since the last subtotal). Heuristic but catches
    column-misalignment and sign errors.
    """
    flags = []
    for year in periods:
        running = 0.0
        seen_component = False
        for li in items:
            val = li.values.get(year)
            if li.is_subtotal:
                if seen_component and val is not None and not _close(val, running):
                    flags.append(
                        f"Subtotal mismatch '{li.line_item}' [{year}]: "
                        f"printed {val} vs sum-of-components {round(running, 2)}")
                running = 0.0
                seen_component = False
            else:
                if val is not None:
                    running += val
                    seen_component = True
    return flags


def score_confidence(stmt: Statement, extra_flags: list) -> ExtractionConfidence:
    """
    Overall confidence = fraction of cells read cleanly, penalised by the
    number of validation flags. Bounded to [0, 1].
    """
    total_cells = 0
    read_cells = 0
    for section in (stmt.income_statement, stmt.balance_sheet, stmt.cash_flow):
        for li in section:
            for year in stmt.periods:
                total_cells += 1
                if li.values.get(year) is not None:
                    read_cells += 1

    readability = (read_cells / total_cells) if total_cells else 0.0
    all_flags = list(stmt.extraction_confidence.flags) + list(extra_flags)
    penalty = min(0.4, 0.03 * len(all_flags))
    overall = max(0.0, readability - penalty)
    if total_cells == 0:
        overall = 0.0
    return ExtractionConfidence(overall=overall, flags=all_flags)


def validate(stmt: Statement) -> Statement:
    """Run all checks, attach flags + confidence to the statement."""
    flags = []
    flags += check_subtotals(stmt.income_statement, stmt.periods)
    flags += check_subtotals(stmt.balance_sheet, stmt.periods)
    flags += check_subtotals(stmt.cash_flow, stmt.periods)
    flags += check_balance_sheet(stmt)

    # Year-count consistency.
    for section_name, section in (("income_statement", stmt.income_statement),
                                  ("balance_sheet", stmt.balance_sheet),
                                  ("cash_flow", stmt.cash_flow)):
        for li in section:
            missing = [y for y in stmt.periods if y not in li.values]
            if missing:
                flags.append(f"{section_name}: '{li.line_item}' missing years {missing}")

    stmt.extraction_confidence = score_confidence(stmt, flags)
    return stmt
