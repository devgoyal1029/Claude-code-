"""
InvestVerdict — Financial Statement Extractor backend.

Flow:  upload -> Gemini Flash extraction -> editable table (frontend)
       -> Confirm -> final corrected JSON.

The Gemini API key stays server-side (read from the GEMINI_API_KEY env var).
The browser never sees it.

Run:
    export GEMINI_API_KEY=...            # required for extraction
    python3 webapp/server.py             # -> http://127.0.0.1:5050
"""

from __future__ import annotations

import os
import sys
import tempfile
import traceback

from flask import Flask, request, jsonify, send_from_directory

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from webapp.gemini_extractor import extract_with_gemini, explain_term, GeminiError  # noqa: E402
from webapp import term_store  # noqa: E402

term_store.init()

app = Flask(__name__, static_folder="static", static_url_path="")

ALLOWED = (".pdf", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp")
MAX_MB = 40        # total across all uploaded files in one request
app.config["MAX_CONTENT_LENGTH"] = MAX_MB * 1024 * 1024


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/health")
def health():
    """Lets the frontend warn if the key isn't configured before uploading."""
    return jsonify({"gemini_key_present": bool(os.environ.get("GEMINI_API_KEY")),
                    "model": os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")})


@app.post("/api/extract")
def api_extract():
    # Accept one OR many files under the field name 'file'.
    files = request.files.getlist("file")
    files = [f for f in files if f and f.filename]
    if not files:
        return jsonify({"error": "No file(s) uploaded (field name must be 'file')."}), 400

    tmp_paths = []
    names = []
    try:
        for f in files:
            ext = os.path.splitext(f.filename)[1].lower()
            if ext not in ALLOWED:
                return jsonify({"error": f"Unsupported type {ext!r} ({f.filename}). "
                                         f"Allowed: {', '.join(ALLOWED)}"}), 400
            tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
            f.save(tmp.name)
            tmp.close()
            tmp_paths.append(tmp.name)
            names.append(f.filename)

        result = extract_with_gemini(tmp_paths, filenames=names)
        return jsonify({"ok": True, "filenames": names, "result": result})
    except GeminiError as e:
        return jsonify({"ok": False, "error": str(e)}), 502
    except Exception as e:
        # Log the full traceback server-side only — never leak internals
        # (paths, library versions) to the browser.
        traceback.print_exc()
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}"}), 500
    finally:
        for p in tmp_paths:
            try:
                os.unlink(p)
            except OSError:
                pass


@app.post("/api/term")
def api_term():
    """
    "What is this?" lookup. DB first; if missing, ask Gemini and SAVE it so the
    next lookup (any user) is instant. Never 500s the panel — returns ok:false
    with a friendly message so the UI can still show the Google option.
    """
    data = request.get_json(silent=True) or {}
    term = (data.get("term") or "").strip()
    if not term:
        return jsonify({"ok": False, "error": "No term provided."}), 400
    if len(term) > 120:
        # A financial-statement line label is short; anything longer is abuse
        # of the endpoint (unbounded DB growth / prompt stuffing).
        return jsonify({"ok": False, "error": "Term too long (max 120 characters)."}), 400

    key = term_store.normalise(term)
    cached = term_store.get(key)
    if cached:
        return jsonify({"ok": True, "explanation": cached, "source": "db", "term": term})

    try:
        text = explain_term(term)
    except GeminiError as e:
        return jsonify({"ok": False, "error": str(e), "term": term}), 200
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}", "term": term}), 200

    try:
        term_store.save(key, term, text)
    except Exception:
        pass        # caching is best-effort; still return the answer
    return jsonify({"ok": True, "explanation": text, "source": "gemini", "term": term})


@app.post("/api/confirm")
def api_confirm():
    """
    Receive the user-corrected JSON from the editable table and return it as
    the finalised payload. This is the hand-off point the rest of the platform
    (and future Excel export) will consume. No DB write yet, per scope.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"ok": False, "error": "Expected a JSON object body."}), 400
    return jsonify({"ok": True, "confirmed": data})


if __name__ == "__main__":
    # Default 5050: on macOS port 5000 is taken by AirPlay Receiver.
    port = int(os.environ.get("PORT", "5050"))
    if not os.environ.get("GEMINI_API_KEY"):
        print("  WARNING: GEMINI_API_KEY not set — extraction will fail until "
              "you export it.")
    print(f"\n  InvestVerdict -> http://127.0.0.1:{port}\n")
    # Debug (auto-reload + Werkzeug debugger) is opt-in via FLASK_DEBUG=1.
    # The interactive debugger allows remote code execution if the server is
    # ever exposed beyond localhost, so it must never be the default.
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(host="127.0.0.1", port=port, debug=debug)
