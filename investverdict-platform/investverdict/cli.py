"""
CLI entry point.

    python -m investverdict.cli <file_path> [--out out.json] [--llm]

Or via the test harness, drop files in /test_inputs and run run_tests.py.
"""

from __future__ import annotations

import argparse
import json
import sys

from .pipeline import extract


def main(argv=None) -> int:
    p = argparse.ArgumentParser(
        prog="investverdict",
        description="Extract structured JSON from financial statement files.")
    p.add_argument("file_path", help="PDF / JPG / PNG of financial statements")
    p.add_argument("--out", help="write JSON here instead of stdout")
    p.add_argument("--llm", action="store_true",
                   help="enable optional LLM label-reconciliation pass "
                        "(requires ANTHROPIC_API_KEY)")
    args = p.parse_args(argv)

    try:
        result = extract(args.file_path, use_llm=args.llm)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    text = json.dumps(result, indent=2, ensure_ascii=False)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"Wrote {args.out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
