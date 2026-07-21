"""
Supabase-backed extraction dedupe cache (server side, stdlib only).

Annual reports are public documents: the same PDF bytes should cost exactly ONE
Gemini call ever, across every user of the tool. Before calling Gemini the
server hashes the uploaded bytes and asks Supabase whether that exact document
set was already extracted; afterwards it stores the result.

FAIL-OPEN by design: if Supabase is unreachable, unconfigured, or the table
doesn't exist yet, every function quietly returns None/False and extraction
proceeds exactly as before. The cloud can never break the tool.

Configuration (env wins so the master site can rotate keys without a deploy):
    SUPABASE_URL  — e.g. https://xxxx.supabase.co
    SUPABASE_KEY  — the PUBLISHABLE key (safe: RLS scopes it to iv_* tables).
"""

from __future__ import annotations

import hashlib
import json
import os
import ssl
import urllib.error
import urllib.request

DEFAULT_URL = "https://pmpyqgzvesrwoqoyhbin.supabase.co"
DEFAULT_KEY = "sb_publishable_IKSAhQCwejx7Dz6MSgAsmg_cjdevELv"

TIMEOUT = 6          # seconds — a cache must be fast or absent, never slow

try:
    import certifi
    _SSL_CTX = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _SSL_CTX = ssl.create_default_context()


def _conn():
    url = (os.environ.get("SUPABASE_URL") or DEFAULT_URL).rstrip("/")
    key = os.environ.get("SUPABASE_KEY") or DEFAULT_KEY
    if not url or not key:
        return None
    return url, key


def _rest(path: str, method: str = "GET", body=None, prefer: str | None = None):
    conn = _conn()
    if not conn:
        return None
    url, key = conn
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(f"{url}/rest/v1/{path}", data=data,
                                 headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT, context=_SSL_CTX) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else []
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError,
            json.JSONDecodeError, OSError):
        return None


def files_hash(paths) -> str:
    """sha256 over the raw bytes of every uploaded file, in upload order."""
    h = hashlib.sha256()
    for p in paths:
        with open(p, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
    return h.hexdigest()


def get_extraction(pdf_hash: str):
    """Return the cached extraction dict, or None on miss/any failure."""
    rows = _rest(f"iv_extractions?pdf_hash=eq.{pdf_hash}&select=result")
    if rows and isinstance(rows, list) and rows[0].get("result"):
        return rows[0]["result"]
    return None


def put_extraction(pdf_hash: str, filenames, result) -> bool:
    """Store an extraction (best-effort). Returns True when stored."""
    ok = _rest("iv_extractions?on_conflict=pdf_hash", method="POST",
               body=[{"pdf_hash": pdf_hash, "filenames": list(filenames or []),
                      "result": result}],
               prefer="resolution=merge-duplicates,return=minimal")
    return ok is not None
