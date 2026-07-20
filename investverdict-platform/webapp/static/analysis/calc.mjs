/**
 * Interactive-analysis calculations — PURE functions, no DOM.
 *   - Feature 1: selectable common-size base per statement
 *   - Feature 2: YoY (horizontal) change view
 *   - Feature 4: heatmap direction + intensity
 * Reuses findRowBySynonyms/normLabel from commonsize.mjs (generalised base).
 * Robust: missing/null/zero-base -> null ("-"); zero prior in YoY -> "n/m".
 */

import { findRowBySynonyms, normLabel } from "./commonsize.mjs";

const REVENUE_SYN = ["revenue from operations", "total sales", "net sales",
                     "revenue", "sales", "turnover", "income from operations"];

// Base options per statement (first = DEFAULT used by the standard view).
// `source` says WHICH statement holds the base line (CF revenue lives in P&L).
export const BASE_OPTIONS = {
  income_statement: [
    { key: "revenue", label: "Revenue from Operations", syn: REVENUE_SYN, source: "income_statement" },
    { key: "total_income", label: "Total Income", syn: ["total income", "total revenue"], source: "income_statement" },
    { key: "total_expenses", label: "Total Expenses", syn: ["total expenses", "total expenditure"], source: "income_statement" },
  ],
  balance_sheet: [
    { key: "total_assets", label: "Total Assets", syn: ["total assets"], source: "balance_sheet" },
    { key: "total_equity", label: "Total Equity", syn: ["total equity", "shareholders funds", "shareholders' funds", "net worth", "total shareholders funds", "total equity attributable"], source: "balance_sheet" },
    { key: "total_equity_liabilities", label: "Total Equity + Liabilities", syn: ["total equity and liabilities", "total liabilities and equity", "total equity & liabilities"], source: "balance_sheet" },
  ],
  cash_flow: [
    { key: "revenue", label: "Revenue from Operations", syn: REVENUE_SYN, source: "income_statement" },
    { key: "cfo", label: "Net Cash from Operating Activities", syn: ["net cash from operating activities", "net cash generated from operating activities", "cash flow from operating activities", "net cash flow from operating activities", "cash generated from operations"], source: "cash_flow" },
  ],
};

export function defaultBaseKey(statementKey) {
  return BASE_OPTIONS[statementKey][0].key;
}

// ---- number helpers -------------------------------------------------------
function num(x) { if (x == null) return null; const v = Number(x); return Number.isFinite(v) ? v : null; }
function getVal(row, y) { return row && row.values ? num(row.values[y]) : null; }
function pct(v, b) { if (v == null || b == null || b === 0) return null; const p = v / b * 100; return Number.isFinite(p) ? p : null; }
function fyNum(p) { const m = String(p).match(/(\d{4})/); return m ? +m[1] : 0; }
export function sortPeriods(p) { return [...(p || [])].sort((a, b) => fyNum(a) - fyNum(b)); }

// ---- Feature 1: common-size against a chosen base -------------------------
/**
 * commonSizeForStatement(confirmed, statementKey, baseKey) ->
 *   { base, baseKey, baseFound, rows: [{ line_item, abs:{yr}, pct:{yr}, isBase }] }
 */
export function commonSizeForStatement(confirmed, statementKey, baseKey) {
  const periods = confirmed.periods || [];
  const opts = BASE_OPTIONS[statementKey];
  const opt = opts.find((o) => o.key === baseKey) || opts[0];
  const baseRow = findRowBySynonyms(confirmed[opt.source] || [], opt.syn);

  const rows = (confirmed[statementKey] || []).map((r) => {
    const abs = {}, pc = {};
    for (const y of periods) {
      const v = getVal(r, y);
      abs[y] = v;
      pc[y] = pct(v, getVal(baseRow, y));
    }
    const isBase = !!baseRow && opt.source === statementKey &&
      normLabel(r.line_item) === normLabel(baseRow.line_item);
    return { line_item: r.line_item, abs, pct: pc, isBase };
  });

  return { base: opt.label, baseKey: opt.key, baseFound: !!baseRow, rows };
}

// ---- Feature 2: YoY (horizontal) change -----------------------------------
/**
 * computeYoYForStatement(confirmed, statementKey) ->
 *   { periods, rows: [{ line_item, abs:{yr}, yoyAbs:{yr|null}, yoyPct:{yr|null|"n/m"} }] }
 * First year has no prior -> nulls. Prior == 0 -> "n/m" (not NaN).
 */
export function computeYoYForStatement(confirmed, statementKey) {
  const periods = sortPeriods(confirmed.periods);
  const rows = (confirmed[statementKey] || []).map((r) => {
    const abs = {}, yoyAbs = {}, yoyPct = {};
    periods.forEach((y, i) => {
      const v = getVal(r, y);
      abs[y] = v;
      if (i === 0) { yoyAbs[y] = null; yoyPct[y] = null; return; }
      const p = getVal(r, periods[i - 1]);
      if (v == null || p == null) { yoyAbs[y] = null; yoyPct[y] = null; return; }
      yoyAbs[y] = v - p;
      yoyPct[y] = p === 0 ? "n/m" : ((v - p) / Math.abs(p)) * 100;
    });
    return { line_item: r.line_item, abs, yoyAbs, yoyPct };
  });
  return { periods, rows };
}

// ---- Feature 4: heatmap direction + intensity -----------------------------
// "up is good" vs "up is bad". Checked GOOD-first so "profit before tax" reads
// as good despite containing the word "tax".
const GOOD = ["profit", "revenue", "sales", "ebitda", "income", "gross",
              "equity", "reserves", "surplus", "cash", "assets", "turnover",
              "net worth", "operating activities", "margin", "receipts"];
const BAD = ["expense", "cost", "cogs", "borrowing", "debt", "payable",
             "depreciation", "amortis", "finance cost", "interest", "tax",
             "provision", "liabilit", "outflow", "purchase"];

export function classifyDirection(line_item) {
  const L = normLabel(line_item);
  if (GOOD.some((k) => L.includes(k))) return "up_good";
  if (BAD.some((k) => L.includes(k))) return "up_bad";
  return "neutral";
}

/** Background colour for a cell given its YoY %; "" when no shading applies. */
export function heatBg(line_item, yoyPct, enabled) {
  if (!enabled || yoyPct == null || yoyPct === "n/m") return "";
  const dir = classifyDirection(line_item);
  if (dir === "neutral") return "";
  const up = yoyPct > 0;
  const good = (dir === "up_good" && up) || (dir === "up_bad" && !up);
  const intensity = Math.min(1, Math.abs(yoyPct) / 40);
  const a = (0.06 + 0.24 * intensity).toFixed(3);
  return good ? `rgba(58,210,159,${a})` : `rgba(255,107,107,${a})`;
}

export { num as _num, getVal as _getVal, pct as _pct, fyNum };
