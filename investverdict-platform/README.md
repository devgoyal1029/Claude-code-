# InvestVerdict — Financial Statement Data Extractor

High-accuracy extraction engine. Input: financial statements (PDF / image,
2–3 years, Indian Schedule III format). Output: clean, structured JSON for the
Income Statement, Balance Sheet, and Cash Flow — line item by line item, mapped
across years.

**Accuracy is the #1 priority.** The engine never guesses a number: unreadable
values become `null` and are flagged.

---

## Quick start

```bash
pip install -r requirements.txt        # core only needs pdfplumber

# Generate a sample digital PDF and extract it:
python3 tests/make_sample_pdf.py
python3 -m investverdict.cli test_inputs/sample_financials.pdf

# Or use the entry-point function:
python3 -c "from investverdict import extract; import json; \
print(json.dumps(extract('test_inputs/sample_financials.pdf'), indent=2))"
```

## Verify it works (no API key / OCR needed)

```bash
python3 tests/test_core.py     # 46 deterministic unit tests
python3 run_tests.py --unit    # unit tests + processes everything in test_inputs/
```

The deterministic core (number cleaning, sign handling, Indian comma grouping,
period normalisation, section classification, grid→schema mapping, validation)
runs and is fully testable **without** any OCR engine or LLM/API key.

---

## Function / CLI entry points

```python
from investverdict import extract
result = extract("path/to/report.pdf")      # -> dict (the JSON contract)
result = extract("path/to/report.pdf", use_llm=True)  # optional LLM refine
```

```bash
python3 -m investverdict.cli <file> [--out out.json] [--llm]
```

**Test harness:** drop PDFs/images into `test_inputs/`, run `python3 run_tests.py`.
Each file gets a `<name>.json` plus a one-line summary (items, confidence, flags).

---

## Pipeline (modular stages)

| Stage | Module | What it does |
|------|--------|--------------|
| 1. Ingest & classify | `ingest.py` | digital PDF / scanned PDF / image |
| 2. Pre-process | `preprocess.py` | deskew + enhance (image/scan path) |
| 3. Extract raw tables | `extract_tables.py` | pdfplumber grid + word-coordinate fallback; OCR for scans |
| 4. Section detection | `classify_sections.py` | P&L / BS / CF via keyword scoring; units + consolidated/standalone |
| 5. Map → schema | `mapping.py` | rule-based grid→LineItems (+ optional LLM refine) |
| 6. Validate & score | `validation.py` | totals = sum-of-components, BS balancing, confidence |
| 7. Orchestrate | `pipeline.py` | `extract(file_path)` → JSON |

Multi-column financial tables are read **positionally**: a value's meaning is
its `(row label, year column)` coordinate. The grid is reconstructed from cell
borders or word x-positions — never read left-to-right blindly.

---

## Accuracy guarantees implemented

- **No hallucinated numbers** — unreadable → `null` + flag (`numbers.clean_number`).
- **Verbatim labels** — original printed text preserved, not normalised.
- **Sign handling** — `(1,234)` → `-1234`; `1,234 Cr` → negative; `1,234 Dr` → positive.
- **Number cleaning** — strips ₹/Rs/commas/footnote superscripts; handles Indian
  lakh/crore grouping (`1,23,456` → `123456`).
- **Year alignment** — `2024-25`, `FY25`, `March 31, 2025` → canonical `FY2025`
  (FY-end year); raw labels kept in `period_labels_raw`.
- **Subtotals/totals** — flagged `is_subtotal: true`; sanity-checked against the
  sum of their components within rounding tolerance.
- **Balance sheet balancing** — Total Assets vs Total Equity & Liabilities per year.
- **Note refs** — captured per line item (`note_ref`).
- **Standalone vs Consolidated** — returned as **separate** objects, never mixed.

---

## Output schema

See the spec; a single statement returns one JSON object, and when both
Consolidated and Standalone are present they come back under a top-level
`statements` array. Each statement carries `extraction_confidence` with an
overall score and a list of flags.

---

## Optional capabilities

**OCR (scanned PDFs / images).** Install the OCR stack and the tesseract binary:

```bash
brew install tesseract poppler
pip install pytesseract pdf2image pillow opencv-python
```

Without it, the digital-PDF path works fully; the scan/image path raises a clear,
actionable error.

**LLM label reconciliation (`--llm`).** Set `ANTHROPIC_API_KEY` to let Claude
reconcile messy labels and resolve flagged ambiguities. It is constrained to
**relabel/re-bucket only** — the deterministic layer remains the source of truth
for numeric values, so the LLM can never introduce a fabricated number.

---

## Extending label mappings

- Add statement-section keywords in `classify_sections.py` (`_PL_KEYS`,
  `_BS_KEYS`, `_CF_KEYS`).
- Adjust subtotal/total detection in `mapping.py` (`_SUBTOTAL_RE`).
- Tune validation tolerance in `validation.py` (`_REL_TOL`, `_ABS_TOL`).
- Add period header formats in `periods.py` (`normalize_period`).

## Not built yet (per spec — later phases)

Excel export · DB / platform upload · UI / frontend. This is the extraction
engine + structured JSON + validation only.
