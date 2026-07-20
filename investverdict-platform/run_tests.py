"""
Test harness: drop financial-statement files into /test_inputs and run this.
For every file it writes <name>.json next to it and prints a one-line summary.

Usage:
    python3 run_tests.py            # process everything in test_inputs/
    python3 run_tests.py --unit     # also run the deterministic unit tests
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from investverdict import extract  # noqa: E402

INPUT_DIR = os.path.join(HERE, "test_inputs")
SUPPORTED = (".pdf", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp")


def _summary(result: dict) -> str:
    stmts = result.get("statements", [result])
    parts = []
    for s in stmts:
        n = (len(s.get("income_statement", [])) +
             len(s.get("balance_sheet", [])) +
             len(s.get("cash_flow", [])))
        conf = s.get("extraction_confidence", {}).get("overall", 0)
        nflags = len(s.get("extraction_confidence", {}).get("flags", []))
        parts.append(f"{s.get('statement_type')}: {n} items, "
                     f"conf={conf}, flags={nflags}")
    return " | ".join(parts)


def main(argv):
    if "--unit" in argv:
        os.system(f'{sys.executable} "{os.path.join(HERE, "tests", "test_core.py")}"')
        print()

    if not os.path.isdir(INPUT_DIR):
        os.makedirs(INPUT_DIR, exist_ok=True)
    files = [f for f in sorted(os.listdir(INPUT_DIR))
             if f.lower().endswith(SUPPORTED)]
    if not files:
        print(f"No input files in {INPUT_DIR}. Drop a PDF/image there.")
        print("Tip: python3 tests/make_sample_pdf.py  creates a sample.")
        return 0

    for fname in files:
        path = os.path.join(INPUT_DIR, fname)
        out = os.path.splitext(path)[0] + ".json"
        try:
            result = extract(path)
            with open(out, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2, ensure_ascii=False)
            print(f"OK   {fname:35s} -> {os.path.basename(out)}  [{_summary(result)}]")
        except Exception as e:
            print(f"FAIL {fname:35s} -> {type(e).__name__}: {e}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
