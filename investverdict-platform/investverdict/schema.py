"""
Output schema for InvestVerdict extraction.

Plain dataclasses that serialise to the exact JSON contract in the spec.
Kept dependency-free.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional


@dataclass
class LineItem:
    line_item: str                          # original printed label, verbatim
    values: dict                            # {"FY2024": 123.0 | None, ...}
    note_ref: Optional[str] = None          # schedule / note number if present
    is_subtotal: bool = False

    def to_dict(self) -> dict:
        return {
            "line_item": self.line_item,
            "values": self.values,
            "note_ref": self.note_ref,
            "is_subtotal": self.is_subtotal,
        }


@dataclass
class ExtractionConfidence:
    overall: float = 0.0
    flags: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"overall": round(self.overall, 3), "flags": self.flags}


@dataclass
class Statement:
    """One full statement set (either Consolidated or Standalone)."""
    company_name: Optional[str]
    currency: str = "INR"
    units: str = "Absolute"                 # Lakhs | Crores | Absolute
    statement_type: str = "Standalone"      # Consolidated | Standalone
    periods: list = field(default_factory=list)        # ["FY2024", ...]
    period_labels_raw: list = field(default_factory=list)  # ["2023-24", ...]
    income_statement: list = field(default_factory=list)   # list[LineItem]
    balance_sheet: list = field(default_factory=list)
    cash_flow: list = field(default_factory=list)
    extraction_confidence: ExtractionConfidence = field(
        default_factory=ExtractionConfidence)

    def to_dict(self) -> dict:
        return {
            "company_name": self.company_name,
            "currency": self.currency,
            "units": self.units,
            "statement_type": self.statement_type,
            "periods": self.periods,
            "period_labels_raw": self.period_labels_raw,
            "income_statement": [li.to_dict() for li in self.income_statement],
            "balance_sheet": [li.to_dict() for li in self.balance_sheet],
            "cash_flow": [li.to_dict() for li in self.cash_flow],
            "extraction_confidence": self.extraction_confidence.to_dict(),
        }


def result_to_json(statements: list) -> dict:
    """
    Top-level result. The spec asks for a single JSON object; when both
    Consolidated and Standalone exist we return them under `statements`
    (never mixed), and surface the first as the top-level for convenience.
    """
    dicts = [s.to_dict() for s in statements]
    if len(dicts) == 1:
        return dicts[0]
    return {"statements": dicts}
