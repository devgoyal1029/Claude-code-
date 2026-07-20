"""
Pipeline orchestrator.

extract(file_path) -> dict (the structured JSON contract).

Stages:
1. Ingest & classify file type
2. Pre-process (image path) — handled inside extractor
3. Extract raw positional tables
4. Identify statement sections (P&L / BS / CF)
5. Map raw grid -> structured JSON (rule-based; optional LLM refine)
6. Validate & score confidence
7. Return JSON + confidence report
"""

from __future__ import annotations

from . import ingest, extract_tables, classify_sections, mapping, validation
from .schema import Statement, result_to_json


def _route_extract(path: str) -> tuple:
    kind = ingest.classify_file(path)
    if kind == "digital_pdf":
        return extract_tables.extract_digital_pdf(path), kind
    if kind in ("scanned_pdf", "image"):
        return extract_tables.extract_scanned(path), kind
    raise ValueError(f"Unsupported file type for {path!r} (classified as {kind})")


def _new_statement(stype: str, units: str) -> Statement:
    return Statement(company_name=None, units=units, statement_type=stype)


def extract(file_path: str, use_llm: bool = False) -> dict:
    """
    Main entry point. Returns the structured JSON object (dict).

    Both Consolidated and Standalone, if present, are returned as separate
    objects (never mixed) under a top-level `statements` list.
    """
    raw_tables, kind = _route_extract(file_path)

    # Bucket tables by (statement_type) -> Statement, then fill sections.
    buckets: dict = {}
    global_flags: list = []
    company_name = None

    for tbl in raw_tables:
        # Classify by the table's OWN row content first — when several
        # statements share a page, the page text is ambiguous but each table's
        # labels (e.g. "Total Assets" vs "Profit Before Tax") are decisive.
        own_text = " ".join(" ".join(r) for r in tbl.rows)
        section, score = classify_sections.classify_section(own_text)
        if section is None:
            section, score = classify_sections.classify_section(tbl.page_text or "")
        if section is None:
            continue

        # Units / statement-type come from the page header (often above the
        # table), falling back to the table's own text.
        text = (tbl.page_text or "") + "\n" + own_text
        units = classify_sections.detect_units(text)
        stype = classify_sections.detect_statement_type(text)
        if company_name is None:
            company_name = _guess_company(text)

        stmt = buckets.get(stype)
        if stmt is None:
            stmt = _new_statement(stype, units)
            buckets[stype] = stmt
        if units != "Absolute":
            stmt.units = units

        items, period_labels_raw, flags = mapping.map_table(tbl.rows)
        global_flags += flags

        if use_llm:
            items = mapping.llm_refine(items, period_labels_raw, tbl.rows, section)

        # Merge periods.
        for li in items:
            for y in li.values:
                if y not in stmt.periods:
                    stmt.periods.append(y)
        stmt.periods = sorted(set(stmt.periods))
        for y, raw in period_labels_raw.items():
            if raw and raw not in stmt.period_labels_raw:
                stmt.period_labels_raw.append(raw)

        getattr(stmt, section).extend(items)

    if not buckets:
        # Nothing recognised; return an empty-but-valid shell with a flag.
        empty = _new_statement("Standalone", "Absolute")
        empty.company_name = company_name
        empty.extraction_confidence.flags.append(
            f"No financial statement sections detected (file kind: {kind}).")
        return result_to_json([empty])

    statements = []
    for stype, stmt in buckets.items():
        stmt.company_name = company_name
        stmt.extraction_confidence.flags.extend(global_flags)
        stmt = validation.validate(stmt)
        statements.append(stmt)

    return result_to_json(statements)


def _guess_company(text: str) -> str | None:
    """Cheap company-name guess: first 'XYZ Limited/Ltd' phrase in the text."""
    import re
    m = re.search(r"([A-Z][A-Za-z0-9&'\.\- ]{2,60}?\s(?:Limited|Ltd\.?|LLP))",
                  text or "")
    return m.group(1).strip() if m else None
