/**
 * Feature 3 — auto-generated, number-derived, plain-English insights.
 * PURE. Returns [{ text, dir: 'up'|'down'|'neutral' }].
 *
 * Hard rules:
 *  - Only state what the numbers support; if an input is missing, skip silently.
 *  - Beginner-friendly tone, NO jargon without rephrase.
 *  - NEVER give buy/sell advice — factual observation only (compliance-safe).
 */

import { findRowBySynonyms } from "./commonsize.mjs";
import { sortPeriods, _getVal as getVal } from "./calc.mjs";

const S = {
  revenue: ["revenue from operations", "total sales", "net sales", "revenue", "sales", "turnover"],
  net_income: ["profit for the year", "net profit", "profit after tax", "net income", "pat"],
  cogs: ["cost of materials consumed", "cost of goods sold", "cost of sales", "cost of revenue"],
  ebitda: ["ebitda", "operating profit before depreciation"],
  receivables: ["trade receivables", "accounts receivable", "sundry debtors", "debtors"],
  inventory: ["inventories", "inventory", "stock in trade"],
  cash: ["cash and cash equivalents", "cash and bank balances", "cash & cash equivalents"],
  debt: ["borrowings", "long term borrowings", "total debt", "long-term debt"],
  dividends: ["dividends paid", "dividend paid", "dividends", "dividend"],
};

const fmtFY = (p) => { const m = String(p).match(/(\d{4})/); return m ? `FY-${m[1]}` : p; };
const cr = (v) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
const pp = (x) => (x >= 0 ? "+" : "") + x.toFixed(1);

function firstLast(confirmed) {
  const p = sortPeriods(confirmed.periods);
  return { periods: p, first: p[0], last: p[p.length - 1], n: p.length };
}
function rowVal(statement, key, year) {
  return getVal(findRowBySynonyms(statement, S[key]), year);
}

export function generateInsights(confirmed) {
  const out = [];
  const { first, last, n } = firstLast(confirmed);
  if (!first || !last || first === last) return out;
  const IS = confirmed.income_statement, BS = confirmed.balance_sheet, CF = confirmed.cash_flow;

  const rev0 = rowVal(IS, "revenue", first), rev1 = rowVal(IS, "revenue", last);
  const ni0 = rowVal(IS, "net_income", first), ni1 = rowVal(IS, "net_income", last);

  // 1) Revenue CAGR
  if (rev0 != null && rev1 != null && rev0 > 0 && n >= 2) {
    const cagr = (Math.pow(rev1 / rev0, 1 / (n - 1)) - 1) * 100;
    out.push({
      text: cagr >= 0
        ? `Revenue grew at about ${cagr.toFixed(1)}% per year (CAGR) over ${fmtFY(first)}–${fmtFY(last)}.`
        : `Revenue shrank at about ${Math.abs(cagr).toFixed(1)}% per year over ${fmtFY(first)}–${fmtFY(last)}.`,
      dir: cagr >= 0 ? "up" : "down",
    });
  }

  // 2) Net profit margin trend
  if (rev0 > 0 && rev1 > 0 && ni0 != null && ni1 != null) {
    const m0 = (ni0 / rev0) * 100, m1 = (ni1 / rev1) * 100;
    out.push({
      text: `Net profit margin moved from ${m0.toFixed(1)}% to ${m1.toFixed(1)}% of sales (${pp(m1 - m0)} pp) — `
        + `for every ₹100 of sales the company kept ₹${m1.toFixed(1)} as profit in ${fmtFY(last)}.`,
      dir: m1 >= m0 ? "up" : "down",
    });
  }

  // 3) COGS as % of revenue (cost pressure)
  const cogs0 = rowVal(IS, "cogs", first), cogs1 = rowVal(IS, "cogs", last);
  if (rev0 > 0 && rev1 > 0 && cogs0 != null && cogs1 != null) {
    const c0 = (cogs0 / rev0) * 100, c1 = (cogs1 / rev1) * 100;
    if (Math.abs(c1 - c0) >= 0.5) {
      out.push({
        text: c1 > c0
          ? `Cost of goods rose from ${c0.toFixed(1)}% to ${c1.toFixed(1)}% of sales, squeezing margins.`
          : `Cost of goods fell from ${c0.toFixed(1)}% to ${c1.toFixed(1)}% of sales, helping margins.`,
        dir: c1 > c0 ? "down" : "up",
      });
    }
  }

  // 4) EBITDA margin trend
  const eb0 = rowVal(IS, "ebitda", first), eb1 = rowVal(IS, "ebitda", last);
  if (rev0 > 0 && rev1 > 0 && eb0 != null && eb1 != null) {
    const e0 = (eb0 / rev0) * 100, e1 = (eb1 / rev1) * 100;
    out.push({
      text: `Operating (EBITDA) margin went from ${e0.toFixed(1)}% to ${e1.toFixed(1)}% of sales (${pp(e1 - e0)} pp).`,
      dir: e1 >= e0 ? "up" : "down",
    });
  }

  // 5) Receivables vs sales growth (collection speed)
  const r0 = rowVal(BS, "receivables", first), r1 = rowVal(BS, "receivables", last);
  if (r0 != null && r1 != null && rev0 > 0 && rev1 != null && r0 > 0) {
    const recG = (r1 / r0 - 1) * 100, revG = (rev1 / rev0 - 1) * 100;
    if (recG > revG + 3) {
      out.push({
        text: `Money owed by customers (receivables) grew faster than sales (${recG.toFixed(0)}% vs ${revG.toFixed(0)}%) — collections may be slowing.`,
        dir: "down",
      });
    }
  }

  // 6) Inventory vs sales growth (stock build-up)
  const i0 = rowVal(BS, "inventory", first), i1 = rowVal(BS, "inventory", last);
  if (i0 != null && i1 != null && rev0 > 0 && rev1 != null && i0 > 0) {
    const invG = (i1 / i0 - 1) * 100, revG = (rev1 / rev0 - 1) * 100;
    if (invG > revG + 3) {
      out.push({
        text: `Unsold stock (inventory) grew faster than sales (${invG.toFixed(0)}% vs ${revG.toFixed(0)}%) — possible working-capital build-up.`,
        dir: "down",
      });
    }
  }

  // 7) Cash trend
  const c0c = rowVal(BS, "cash", first), c1c = rowVal(BS, "cash", last);
  if (c0c != null && c1c != null && Math.abs(c1c - c0c) > 0) {
    out.push({
      text: `Cash on hand ${c1c >= c0c ? "rose" : "fell"} from ₹${cr(c0c)} Cr to ₹${cr(c1c)} Cr over the period.`,
      dir: c1c >= c0c ? "up" : "down",
    });
  }

  // 8) Debt trend
  const d0 = rowVal(BS, "debt", first), d1 = rowVal(BS, "debt", last);
  if (d0 != null && d1 != null && Math.abs(d1 - d0) > 0) {
    out.push({
      text: `Total borrowings ${d1 >= d0 ? "increased" : "reduced"} from ₹${cr(d0)} Cr to ₹${cr(d1)} Cr.`,
      dir: d1 <= d0 ? "up" : "down",
    });
  }

  // 9) Dividend payout trend
  const div0 = rowVal(IS, "dividends", first) ?? rowVal(CF, "dividends", first);
  const div1 = rowVal(IS, "dividends", last) ?? rowVal(CF, "dividends", last);
  if (div0 != null && div1 != null && ni0 > 0 && ni1 > 0) {
    const p0 = (Math.abs(div0) / ni0) * 100, p1 = (Math.abs(div1) / ni1) * 100;
    if (Math.abs(p1 - p0) >= 2) {
      out.push({
        text: `Dividend payout ${p1 > p0 ? "rose" : "fell"} from ${p0.toFixed(0)}% to ${p1.toFixed(0)}% of profit.`,
        dir: "neutral",
      });
    }
  }

  return out.slice(0, 6);     // 4–6 most material
}
