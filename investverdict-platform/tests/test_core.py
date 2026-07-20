"""
Unit tests for the deterministic core. No external files / API needed.

Run:  python3 -m tests.test_core      (from project root)
   or  python3 tests/test_core.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from investverdict.numbers import clean_number, is_indian_grouped
from investverdict.periods import normalize_period
from investverdict.classify_sections import (
    classify_section, detect_units, detect_statement_type)
from investverdict.mapping import map_table
from investverdict.schema import Statement
from investverdict.validation import validate

_passed = 0
_failed = 0


def check(name, got, want):
    global _passed, _failed
    if got == want:
        _passed += 1
    else:
        _failed += 1
        print(f"  FAIL {name}: got {got!r}, want {want!r}")


def section(title):
    print(f"\n[{title}]")


# --- numbers --------------------------------------------------------------
section("number cleaning")
check("indian grouping 1,23,456", clean_number("1,23,456").value, 123456.0)
check("western grouping 123,456", clean_number("123,456").value, 123456.0)
check("rupee symbol", clean_number("₹1,23,456").value, 123456.0)
check("rs prefix", clean_number("Rs. 12,34,567").value, 1234567.0)
check("bracket negative", clean_number("(1,234)").value, -1234.0)
check("minus negative", clean_number("-1,234").value, -1234.0)
check("decimal", clean_number("1,234.56").value, 1234.56)
check("Cr suffix negative", clean_number("1,234 Cr").value, -1234.0)
check("Dr suffix positive", clean_number("1,234 Dr").value, 1234.0)
check("footnote superscript", clean_number("1,234^5").value, 1234.0)
check("nil token -> None", clean_number("Nil").value, None)
check("dash token -> None", clean_number("—").value, None)
check("blank -> None", clean_number("").value, None)
check("nil is flagged as nil token", clean_number("-").is_nil_token, True)
check("garbage -> None not guess", clean_number("12ab34").value, None)
check("garbage flagged not nil", clean_number("12ab34").is_nil_token, False)

section("indian grouping detection")
check("1,23,456 is indian", is_indian_grouped("1,23,456"), True)
check("123,456 is not indian", is_indian_grouped("123,456"), False)
check("plain int not indian", is_indian_grouped("4567"), False)

# --- periods --------------------------------------------------------------
section("period normalisation")
check("2024-25", normalize_period("2024-25"), "FY2025")
check("2024-2025", normalize_period("2024-2025"), "FY2025")
check("FY25", normalize_period("FY25"), "FY2025")
check("FY 2024-25", normalize_period("FY 2024-25"), "FY2025")
check("March 31, 2025", normalize_period("March 31, 2025"), "FY2025")
check("As at 31 March 2024", normalize_period("As at 31 March 2024"), "FY2024")
check("bare 2023", normalize_period("2023"), "FY2023")
check("garbage period", normalize_period("Particulars"), None)

# --- section / units / type ----------------------------------------------
section("section classification")
check("P&L detect",
      classify_section("Statement of Profit and Loss\nRevenue from Operations")[0],
      "income_statement")
check("BS detect",
      classify_section("Balance Sheet as at 31 March 2025\nTotal Assets")[0],
      "balance_sheet")
check("CF detect",
      classify_section("Cash Flow Statement\nNet cash from operating activities")[0],
      "cash_flow")
check("units crores", detect_units("(₹ in Crores)"), "Crores")
check("units lakhs", detect_units("Rs. in Lakhs"), "Lakhs")
check("type consolidated",
      detect_statement_type("Consolidated Balance Sheet"), "Consolidated")

# --- mapping on a synthetic grid -----------------------------------------
section("grid -> line items")
grid = [
    ["Particulars", "Note", "2024-25", "2023-24"],
    ["Revenue from Operations", "21", "16,789.00", "14,567.00"],
    ["Other Income", "22", "1,200.00", "1,100.00"],
    ["Total Income", "", "17,989.00", "15,667.00"],
    ["Cost of materials consumed", "23", "(9,000.00)", "(8,000.00)"],
    ["Finance costs", "24", "Nil", "120.00"],
]
items, raw_labels, flags = map_table(grid)
check("n line items", len(items), 5)
check("first label verbatim", items[0].line_item, "Revenue from Operations")
check("note_ref captured", items[0].note_ref, "21")
check("year mapping FY2025", items[0].values["FY2025"], 16789.0)
check("year mapping FY2024", items[0].values["FY2024"], 14567.0)
check("bracket -> negative", items[3].values["FY2025"], -9000.0)
check("subtotal flagged", items[2].is_subtotal, True)
check("non-subtotal not flagged", items[0].is_subtotal, False)
check("Nil -> None", items[4].values["FY2025"], None)
check("raw period labels kept", raw_labels.get("FY2025"), "2024-25")

# --- validation: subtotal sanity check -----------------------------------
section("validation")
stmt = Statement(company_name="Test Ltd", units="Crores",
                 statement_type="Standalone", periods=["FY2024", "FY2025"])
stmt.income_statement = items
stmt = validate(stmt)
# Total Income (17,989) should equal Revenue+Other (16,789+1,200) -> passes.
sub_flags = [f for f in stmt.extraction_confidence.flags if "Subtotal mismatch" in f]
check("good subtotal passes (no mismatch flag)", len(sub_flags), 0)
check("confidence in [0,1]",
      0.0 <= stmt.extraction_confidence.overall <= 1.0, True)

# Now a deliberately broken subtotal to prove the check fires.
bad_grid = [
    ["Particulars", "2024-25"],
    ["Item A", "100"],
    ["Item B", "100"],
    ["Total", "999"],          # should be 200
]
bad_items, _, _ = map_table(bad_grid)
bad_stmt = Statement(company_name="X", periods=["FY2025"])
bad_stmt.income_statement = bad_items
bad_stmt = validate(bad_stmt)
fired = any("Subtotal mismatch" in f for f in bad_stmt.extraction_confidence.flags)
check("broken subtotal IS flagged", fired, True)

# --- summary --------------------------------------------------------------
print(f"\n{'='*40}")
print(f"PASSED: {_passed}   FAILED: {_failed}")
print(f"{'='*40}")
sys.exit(1 if _failed else 0)
