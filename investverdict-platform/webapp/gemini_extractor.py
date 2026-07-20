"""
Gemini Flash extraction path.

Sends an uploaded financial-statement file (PDF / image) to Gemini Flash,
which reads it natively, and returns structured JSON with per-line-item
confidence. The API key stays here on the server (read from env), never the
browser.

Zero third-party deps: uses urllib (stdlib) to call the REST API.
"""

from __future__ import annotations

import base64
import json
import os
import ssl
import urllib.request
import urllib.error

# macOS python.org builds often ship without a usable CA store, which breaks
# HTTPS to Google. Use certifi's bundle if available; fall back to default.
try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _SSL_CTX = ssl.create_default_context()

# Model is configurable; Flash is fast + multimodal and reads PDFs/images.
DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
# Multi-file PDF extraction can take a while; allow a generous read timeout.
REQUEST_TIMEOUT = int(os.environ.get("GEMINI_TIMEOUT", "300"))
# The API key is sent via the x-goog-api-key HEADER, never as a ?key= query
# parameter — query strings leak into proxy/access logs and shell history.
_ENDPOINT = ("https://generativelanguage.googleapis.com/v1beta/models/"
             "{model}:generateContent")

_MIME = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".tif": "image/tiff", ".tiff": "image/tiff",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
}

PROMPT = """You are a financial-statement data extraction engine for Indian \
companies (Schedule III, Companies Act 2013). Read the attached file and \
extract the financial statements into JSON.

Return ONLY a single valid JSON object with EXACTLY this shape:
{
  "company_name": "string",
  "units": "Lakhs | Crores | Absolute",
  "statement_type": "Consolidated | Standalone",
  "periods": ["FY2023", "FY2024", "FY2025"],
  "income_statement": [
    { "line_item": "Revenue from Operations",
      "values": { "FY2023": 12345, "FY2024": 14567, "FY2025": 16789 },
      "indent": 0,
      "confidence": 0.0 }
  ],
  "balance_sheet": [ ...same shape... ],
  "cash_flow": [ ...same shape... ]
}

Rules (accuracy is the #1 priority):
- NEVER guess a number. If a value is unreadable or not present for a year, \
use null for that year. Do not interpolate or fabricate.
- Indian comma grouping: "1,23,456" means 123456 (not 123). Strip commas and \
currency symbols (Rs, INR) and footnote superscripts.
- Numbers in brackets like "(1,234)" are NEGATIVE -> -1234.
- Preserve the ORIGINAL line-item labels exactly as printed (do not rename \
"Revenue from Operations" to "Sales").
- Match every value to its CORRECT year column.
- periods: normalise each year header to "FY<end-year>" (e.g. "2024-25" -> \
"FY2025", "March 31, 2025" -> "FY2025"). Use the SAME period keys in every \
"values" object across all rows.
- units: detect Lakhs / Crores / Absolute from the statement header.
- statement_type: Consolidated or Standalone (pick what the document says).
- confidence: a number 0.0-1.0 per line item = how confident you are that the \
row's label and values are correct. Use lower values for blurry/ambiguous rows.
- Include all three arrays: income_statement, balance_sheet, cash_flow. If a \
statement is not present in the file, use an empty array [].

STRUCTURE — KEEP EVERY ROW, EXACTLY AS PRINTED (very important):
- Include EVERY line shown in the statement, in the SAME top-to-bottom ORDER, \
INCLUDING heading/parent rows that have NO numbers of their own — e.g. \
"Non-current assets", "Financial assets", "ASSETS", "Income", "Expenses", \
"Net profit attributable to:". Do NOT skip a row just because it has no figures; \
output it with an empty values object {} (or nulls). The parent rows are what \
give the statement its structure — never drop them.
- For a line item that has a value only in SOME years, keep each value under its \
CORRECT year key and set the missing years to null. NEVER shift values left to \
fill blank earlier years.
- Add an integer "indent" to EVERY line item describing its visual nesting in \
the document: 0 = top-level line or main section heading; 1 = a sub-item indented \
under a parent (e.g. items under "Financial assets"); 2 = a sub-sub-item (e.g. \
"A (i) ...", "(ii) ...", items under a "... attributable to:" heading). Reflect \
the actual indentation you see. When unsure, use 0.
- Output ONLY the JSON object. No markdown fences, no commentary.

MULTIPLE FILES: You may be given more than one file (each clearly labelled \
"FILE k OF N"). They belong to the SAME company and together make up the full \
picture — they may be split by year (one file per financial year) and/or by \
statement (P&L in one file, Balance Sheet in another, etc.), and the files may \
be a mix of PDFs and images.
- You MUST read and use EVERY file. Do not ignore or skip any file, even if it \
is a photo/scan or lower quality than the others.
- The final "periods" list MUST be the UNION of all distinct years found \
across ALL files combined. If FILE 1 has FY2024 & FY2025 and FILE 2 has \
FY2023, the result must contain FY2023, FY2024 AND FY2025.
- For each line item, put every year's value (from whichever file it came \
from) into that row's "values" object, keyed by year.
- Do not duplicate a line item that appears in several files — merge it into \
ONE row spanning all years. If the same (line item, year) appears in two files \
with different numbers, keep the clearer one and lower its confidence.
- The SAME economic line is often worded slightly differently across years/files \
(e.g. "Profit before tax" vs "Profit before tax for the year"; "Share of profit \
from associates" vs "Share of loss/(profit) from associates and joint venture \
(net of tax)"). Treat these as ONE line: use a single consistent label and put \
each year's value in the correct year column. Never output two separate rows for \
what is clearly the same line.
- If a line item exists for some years but not others, set the missing years \
to null (do not drop the row, do not guess).
"""


def _multi_file_note(n: int) -> str:
    if n <= 1:
        return ""
    return (f"\n\nIMPORTANT: You have been given {n} separate files in this "
            f"request, each labelled 'FILE k OF {n}'. Read ALL {n} files. The "
            f"combined result must include the data and every distinct year "
            f"from ALL {n} files — never base the answer on only one file.")


class GeminiError(RuntimeError):
    pass


# --- "What is this?" term explainer ---------------------------------------

EXPLAIN_PROMPT = """Explain the financial-statement term "{term}" for a complete \
beginner who is an Indian retail investor.

Rules:
- Begin with one short line starting "In simple words:" then 2-3 more sentences.
- Keep it about 3-4 sentences total, plain simple English, Indian \
financial-statement context where relevant.
- PURELY EDUCATIONAL: just define what the term means. Do NOT say whether it is \
good or bad for any company, and give NO buy/sell or investment advice.
- Output plain text only — no markdown, no headings, no bullet points."""


def explain_term(term: str, model: str = None) -> str:
    """Generate a short plain-language explanation of a financial term."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise GeminiError("GEMINI_API_KEY is not set on the server.")

    body = {
        "contents": [{"parts": [{"text": EXPLAIN_PROMPT.format(term=term)}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 400},
    }
    url = _ENDPOINT.format(model=model or DEFAULT_MODEL)
    raw = json.dumps(body).encode("utf-8")

    import time
    last_err = None
    for attempt in range(3):
        req = urllib.request.Request(
            url, data=raw,
            headers={"Content-Type": "application/json",
                     "x-goog-api-key": api_key},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=60, context=_SSL_CTX) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            parts = payload["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts).strip()
            if not text:
                raise GeminiError("Empty explanation from Gemini.")
            return text
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")
            if e.code in (429, 503) and attempt < 2:
                last_err = f"Gemini API error {e.code}"
                time.sleep(1.5 * (attempt + 1))
                continue
            raise GeminiError(f"Gemini API error {e.code}: {detail[:200]}")
        except urllib.error.URLError as e:
            raise GeminiError(f"Could not reach Gemini API: {e.reason}")
        except (KeyError, IndexError):
            raise GeminiError("Unexpected Gemini response.")
    raise GeminiError(last_err or "Gemini unavailable after retries.")


def extract_with_gemini(file_paths, filenames=None, model: str = None) -> dict:
    """
    Run Gemini Flash extraction on one OR MORE files -> structured JSON dict.

    Pass a single path (str) or a list of paths. Multiple files are sent in one
    request, each explicitly labelled, so Gemini reads EVERY file and merges
    them (separate-per-year or per-statement files) into one year-aligned
    result without dropping any file's data.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise GeminiError(
            "GEMINI_API_KEY is not set on the server. Set it in the "
            "environment before starting the server (it must NOT be put in "
            "the browser).")

    if isinstance(file_paths, str):
        file_paths = [file_paths]
    if not file_paths:
        raise GeminiError("No files provided.")
    n = len(file_paths)
    names = filenames or [os.path.basename(p) for p in file_paths]

    # Label each file with a text marker BEFORE its bytes so the model treats
    # them as distinct documents (critical for multi-file merge accuracy).
    parts = []
    for i, path in enumerate(file_paths):
        ext = os.path.splitext(path)[1].lower()
        mime = _MIME.get(ext)
        if not mime:
            raise GeminiError(f"Unsupported file type {ext!r}.")
        with open(path, "rb") as f:
            data_b64 = base64.b64encode(f.read()).decode("ascii")
        label = (names[i] if i < len(names) else os.path.basename(path))
        parts.append({"text": f"\n===== FILE {i + 1} OF {n}: {label} ====="})
        parts.append({"inline_data": {"mime_type": mime, "data": data_b64}})

    parts.append({"text": PROMPT + _multi_file_note(n)})

    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0,
        },
    }

    url = _ENDPOINT.format(model=model or DEFAULT_MODEL)
    raw = json.dumps(body).encode("utf-8")

    import time
    last_err = None
    for attempt in range(4):                 # retry transient 429/503 w/ backoff
        req = urllib.request.Request(
            url, data=raw,
            headers={"Content-Type": "application/json",
                     "x-goog-api-key": api_key},
            method="POST")
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT, context=_SSL_CTX) as resp:
                return _parse_response(json.loads(resp.read().decode("utf-8")))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")
            if e.code in (429, 503) and attempt < 3:
                last_err = f"Gemini API error {e.code}: {detail[:300]}"
                time.sleep(2 * (attempt + 1))
                continue
            raise GeminiError(f"Gemini API error {e.code}: {detail[:500]}")
        except TimeoutError:
            if attempt < 1:                       # retry a slow request once
                last_err = "request timed out"
                continue
            raise GeminiError(
                "The request to Gemini timed out — your documents are large. "
                "Try uploading fewer or smaller files at once (e.g. split by "
                "statement, or 2 files instead of 4), then merge in stages, or retry.")
        except urllib.error.URLError as e:
            if isinstance(e.reason, TimeoutError) and attempt < 1:
                last_err = "connection timed out"
                continue
            raise GeminiError(f"Could not reach Gemini API: {e.reason}")
    raise GeminiError(last_err or "Gemini API unavailable after retries.")


def _parse_response(payload: dict) -> dict:
    """Pull the JSON text out of the Gemini response envelope and parse it."""
    try:
        candidates = payload["candidates"]
        parts = candidates[0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts).strip()
    except (KeyError, IndexError):
        # Surface safety blocks / empty responses clearly.
        fb = payload.get("promptFeedback") or payload
        raise GeminiError(f"Unexpected Gemini response: {json.dumps(fb)[:400]}")

    # Strip accidental markdown fences if the model added them.
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip()

    try:
        result = json.loads(text)
    except json.JSONDecodeError as e:
        raise GeminiError(f"Gemini did not return valid JSON: {e}. "
                          f"First 300 chars: {text[:300]!r}")

    return _normalise(result)


def _normalise(result: dict) -> dict:
    """Guarantee the keys the frontend expects exist, without inventing data."""
    result.setdefault("company_name", None)
    result.setdefault("units", "Absolute")
    result.setdefault("statement_type", "Standalone")
    result.setdefault("periods", [])
    for section in ("income_statement", "balance_sheet", "cash_flow"):
        result.setdefault(section, [])
        for row in result[section]:
            row.setdefault("values", {})
            row.setdefault("confidence", None)
            row.setdefault("line_item", "")
            row.setdefault("indent", None)
    return result
