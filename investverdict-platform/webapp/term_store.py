"""
Tiny persistent store for term explanations (tier-1 of the "What is this?" flow).
SQLite via the stdlib — no extra dependencies. Lookup is by normalised term_key.
"""

from __future__ import annotations

import os
import sqlite3
import time

DB_PATH = os.path.join(os.path.dirname(__file__), "terms.db")


def _conn():
    c = sqlite3.connect(DB_PATH, timeout=5)
    return c


def init():
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS term_explanations (
                term_key    TEXT PRIMARY KEY,
                term_label  TEXT,
                explanation TEXT,
                created_at  REAL
            )""")


def normalise(term: str) -> str:
    return (term or "").strip().lower()


def get(term_key: str):
    with _conn() as c:
        row = c.execute(
            "SELECT explanation FROM term_explanations WHERE term_key = ?",
            (term_key,)).fetchone()
        return row[0] if row else None


def save(term_key: str, term_label: str, explanation: str):
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO term_explanations "
            "(term_key, term_label, explanation, created_at) VALUES (?, ?, ?, ?)",
            (term_key, term_label, explanation, time.time()))
