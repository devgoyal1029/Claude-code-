/**
 * Feature 5 — peer comparison (two companies, A vs B). PURE.
 * Aligns common-size rows by a canonical key so the same economic line lines up
 * even when labels differ. Where a company lacks a line, value is null ("-").
 * v1: exactly two companies.
 */

import { normLabel } from "./commonsize.mjs";
import { commonSizeForStatement, sortPeriods } from "./calc.mjs";

// Canonical buckets for alignment (broad; falls back to the label itself).
const CANON = {
  revenue: ["revenue from operations", "net sales", "total sales", "revenue", "sales", "turnover"],
  other_income: ["other income"],
  total_income: ["total income"],
  cogs: ["cost of materials consumed", "cost of goods sold", "cost of sales", "cost of revenue"],
  employee_cost: ["employee benefits expense", "employee cost", "staff cost"],
  other_expenses: ["other expenses"],
  total_expenses: ["total expenses"],
  ebitda: ["ebitda"],
  depreciation: ["depreciation and amortisation", "depreciation", "amortisation"],
  finance_cost: ["finance costs", "finance cost", "interest expense"],
  pbt: ["profit before tax"],
  tax: ["tax expense", "income tax", "current tax", "tax"],
  net_profit: ["profit for the year", "net profit", "profit after tax", "pat"],
  cash: ["cash and cash equivalents", "cash and bank balances"],
  receivables: ["trade receivables", "accounts receivable", "debtors"],
  inventory: ["inventories", "inventory"],
  ppe: ["property plant and equipment", "fixed assets", "net block"],
  total_assets: ["total assets"],
  payables: ["trade payables", "creditors"],
  borrowings: ["borrowings", "long term borrowings", "short term borrowings"],
  share_capital: ["share capital", "equity share capital"],
  reserves: ["reserves and surplus", "other equity", "retained earnings"],
  total_equity_liab: ["total equity and liabilities", "total liabilities and equity"],
};

const CANON_PHRASES = [];
for (const [key, list] of Object.entries(CANON))
  for (const p of list) CANON_PHRASES.push({ key, p: normLabel(p) });

export function canonicalKey(label) {
  const L = normLabel(label);
  let best = null, score = 0;
  for (const { key, p } of CANON_PHRASES) {
    if (L === p) return key;
    if (p.length >= 4 && (L.includes(p) || p.includes(L))) {
      const s = Math.min(L.length, p.length) / Math.max(L.length, p.length);
      if (s > score) { score = s; best = key; }
    }
  }
  return best || ("raw:" + L);
}

/**
 * alignPeers(confA, confB, statementKey, baseKey) ->
 * {
 *   a:{name, periods}, b:{name, periods},
 *   rows: [{ key, label, aPct:{yr}, bPct:{yr} }]   // % of chosen base, aligned
 * }
 */
export function alignPeers(confA, confB, statementKey, baseKey) {
  const csA = commonSizeForStatement(confA, statementKey, baseKey);
  const csB = commonSizeForStatement(confB, statementKey, baseKey);
  const pA = sortPeriods(confA.periods), pB = sortPeriods(confB.periods);

  const indexBy = (cs) => {
    const m = new Map();
    for (const r of cs.rows) {
      const k = canonicalKey(r.line_item);
      if (!m.has(k)) m.set(k, r);          // first occurrence wins
    }
    return m;
  };
  const mA = indexBy(csA), mB = indexBy(csB);

  const order = [];
  const seen = new Set();
  for (const r of csA.rows) { const k = canonicalKey(r.line_item); if (!seen.has(k)) { seen.add(k); order.push(k); } }
  for (const r of csB.rows) { const k = canonicalKey(r.line_item); if (!seen.has(k)) { seen.add(k); order.push(k); } }

  const rows = order.map((k) => {
    const ra = mA.get(k), rb = mB.get(k);
    return {
      key: k,
      label: (ra && ra.line_item) || (rb && rb.line_item) || k,
      aPct: ra ? ra.pct : {},
      bPct: rb ? rb.pct : {},
    };
  });

  return {
    a: { name: confA.company_name || "Company A", periods: pA },
    b: { name: confB.company_name || "Company B", periods: pB },
    base: csA.base,
    rows,
  };
}
