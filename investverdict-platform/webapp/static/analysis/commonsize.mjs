/**
 * Common-size analysis + statement linking (tie-out) — PURE calculation logic.
 * No DOM, no framework, no forecasting. Easy to unit-test and reuse.
 *
 * Two public functions:
 *   computeCommonSize(confirmed) -> per-statement rows with absolute + % of base
 *   computeLinks(confirmed)      -> the 3 inter-statement tie-out checks
 *
 * Robust number handling: missing/null/base=0 -> "-" (null), never NaN/Infinity.
 * Only CHECKS and REPORTS — never overwrites the user's numbers.
 */

// ---- label matching -------------------------------------------------------
export function normLabel(s) {
  return String(s || "")
    .toLowerCase().replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

const SYN = {
  revenue: ["revenue from operations", "net sales", "total income", "revenue",
            "sales", "turnover", "income from operations"],
  total_assets: ["total assets"],
  net_income: ["profit for the year", "profit for the period", "net profit",
               "profit after tax", "net income", "pat"],
  retained_earnings: ["retained earnings", "reserves and surplus", "other equity",
                      "surplus", "reserves & surplus"],
  dividends: ["dividends paid", "dividend paid", "dividends", "dividend"],
  bs_cash: ["cash and cash equivalents", "cash and bank balances", "cash & cash equivalents",
            "cash"],
  cf_closing_cash: ["cash and cash equivalents at the end", "cash and cash equivalents at end",
                    "closing cash and cash equivalents", "closing cash", "cash at the end",
                    "cash at end"],
  pbt: ["profit before tax and exceptional items", "profit before tax",
        "profit before exceptional items and tax", "pbt"],
  // CFO (indirect) starts at PBT; fall back to net-profit labels if needed.
  cf_start: ["profit before tax and exceptional items", "profit before tax", "pbt",
             "profit for the year", "net profit", "profit after tax", "net income"],
  cogs: ["cost of goods sold", "cost of materials consumed", "cost of sales",
         "cost of revenue", "purchases of stock in trade"],
  opex: ["operating expenses", "other expenses", "employee benefits expense",
         "selling and distribution expenses", "administrative expenses"],
  tax: ["tax expense", "income tax", "current tax", "total tax expense", "tax"],
};

/** Score how well a row label matches a synonym list (0 = no match). */
function scoreLabel(label, synonyms) {
  const L = normLabel(label);
  if (!L) return 0;
  let best = 0;
  for (const syn of synonyms) {
    if (L === syn) return 1000;                       // exact wins
    if (L.includes(syn) || syn.includes(L)) {
      const s = 100 * (Math.min(L.length, syn.length) / Math.max(L.length, syn.length));
      if (s > best) best = s;
    }
  }
  return best;
}

/** Find the best-matching row in a statement for an arbitrary synonym list. */
export function findRowBySynonyms(statement, synonyms, minScore = 40) {
  let best = null, bestScore = minScore;
  for (const row of statement || []) {
    const s = scoreLabel(row.line_item, synonyms || []);
    if (s > bestScore) { bestScore = s; best = row; }
  }
  return best;
}

/** Find the single best-matching row in a statement array for a synonym key. */
export function findRow(statement, key) {
  return findRowBySynonyms(statement, SYN[key] || []);
}

export { scoreLabel };

/** Sum all rows matching a synonym key (used for opex which may be split). */
function sumRows(statement, key, year) {
  const synonyms = SYN[key] || [];
  let total = 0, found = false;
  for (const row of statement || []) {
    if (scoreLabel(row.line_item, synonyms) >= 60) {
      const v = num(getVal(row, year));
      if (v != null) { total += v; found = true; }
    }
  }
  return found ? total : null;
}

// ---- number helpers -------------------------------------------------------
function num(x) {
  if (x == null) return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}
function getVal(row, year) {
  return row && row.values ? num(row.values[year]) : null;
}
/** common-size %: value / base * 100, or null if base missing/zero. */
function pct(value, base) {
  if (value == null || base == null || base === 0) return null;
  const p = (value / base) * 100;
  return Number.isFinite(p) ? p : null;
}

// ---- PART 1: common-size --------------------------------------------------
/**
 * Returns:
 * {
 *   periods,
 *   sections: {
 *     income_statement: { base: "Revenue", baseFound: bool, rows: [{line_item, abs:{yr}, pct:{yr}}] },
 *     balance_sheet:    { base: "Total Assets", ... },
 *     cash_flow:        { base: "Revenue", ... }
 *   },
 *   flags: [ ... base-not-found warnings ... ]
 * }
 */
export function computeCommonSize(confirmed) {
  const periods = Array.isArray(confirmed.periods) ? confirmed.periods : [];
  const flags = [];

  const revenueRow = findRow(confirmed.income_statement, "revenue");
  const totalAssetsRow = findRow(confirmed.balance_sheet, "total_assets");
  if (!revenueRow) flags.push("Income statement base 'Revenue' not found — IS/CF %s shown as '-'.");
  if (!totalAssetsRow) flags.push("Balance sheet base 'Total Assets' not found — BS %s shown as '-'.");

  const revenueByYear = {};
  const taByYear = {};
  for (const y of periods) {
    revenueByYear[y] = revenueRow ? getVal(revenueRow, y) : null;
    taByYear[y] = totalAssetsRow ? getVal(totalAssetsRow, y) : null;
  }

  const build = (statement, baseByYear, baseLabel, baseRow) => ({
    base: baseLabel,
    baseFound: !!baseRow,
    rows: (statement || []).map((row) => {
      const abs = {}, pcts = {};
      for (const y of periods) {
        const v = getVal(row, y);
        abs[y] = v;
        pcts[y] = pct(v, baseByYear[y]);
      }
      return { line_item: row.line_item, abs, pct: pcts, isBase: row === baseRow };
    }),
  });

  return {
    periods,
    company_name: confirmed.company_name ?? null,
    units: confirmed.units ?? "Absolute",
    sections: {
      income_statement: build(confirmed.income_statement, revenueByYear, "Revenue", revenueRow),
      balance_sheet: build(confirmed.balance_sheet, taByYear, "Total Assets", totalAssetsRow),
      cash_flow: build(confirmed.cash_flow, revenueByYear, "Revenue", revenueRow),
    },
    flags,
  };
}

// ---- PART 2: statement linking (tie-out) ----------------------------------
function tolOK(a, b, base) {
  const ref = base != null ? Math.abs(base) : Math.max(Math.abs(a), Math.abs(b));
  const tol = Math.max(0.5, 0.001 * ref);
  return Math.abs(a - b) <= tol;
}
const sortPeriods = (p) => [...p].sort((a, b) => fyNum(a) - fyNum(b));
function fyNum(p) { const m = String(p).match(/(\d{4})/); return m ? +m[1] : 0; }

/**
 * Returns an array of checks:
 *   { link_name, year, status: 'pass'|'warn'|'fail', expected, actual, difference, detail }
 */
export function computeLinks(confirmed) {
  const checks = [];
  const periods = sortPeriods(confirmed.periods || []);
  const IS = confirmed.income_statement, BS = confirmed.balance_sheet, CF = confirmed.cash_flow;

  const reRow = findRow(BS, "retained_earnings");
  const niRow = findRow(IS, "net_income");
  const pbtRow = findRow(IS, "pbt");
  const divRow = findRow(IS, "dividends") || findRow(CF, "dividends");
  const bsCashRow = findRow(BS, "bs_cash");
  const cfCashRow = findRow(CF, "cf_closing_cash");
  const cfStartRow = findRow(CF, "cf_start");

  // LINK 1 — Net income -> Retained earnings (needs a prior year for opening RE)
  for (let i = 1; i < periods.length; i++) {
    const y = periods[i], prev = periods[i - 1];
    const openRE = getVal(reRow, prev), closeRE = getVal(reRow, y), ni = getVal(niRow, y);
    if (openRE == null || closeRE == null || ni == null) continue;
    const div = getVal(divRow, y);
    if (div != null) {
      const expected = openRE + ni - div;
      const ok = tolOK(expected, closeRE, closeRE);
      checks.push(mk("Net income → Retained earnings", y, ok ? "pass" : "fail",
        expected, closeRE,
        `closing RE vs opening RE + NI − dividends`));
    } else {
      // dividends unknown: check directional consistency (assume 0 dividends).
      const impliedDiv = openRE + ni - closeRE;
      const ok = tolOK(openRE + ni, closeRE, closeRE);
      checks.push(mk("Net income → Retained earnings", y, ok ? "pass" : "warn",
        openRE + ni, closeRE,
        ok ? "RE change matches NI (no dividends)"
           : `dividends not separately available; implied dividends ≈ ${round(impliedDiv)}`));
    }
  }

  // LINK 2 — Cash ties: CFS closing cash == BS cash
  for (const y of periods) {
    const cfCash = getVal(cfCashRow, y), bsCash = getVal(bsCashRow, y);
    if (cfCash == null || bsCash == null) continue;
    const ok = tolOK(cfCash, bsCash, bsCash);
    checks.push(mk("Cash ties (CFS = BS)", y, ok ? "pass" : "fail",
      cfCash, bsCash, "closing cash (CFS) vs cash (BS)"));
  }

  // LINK 3 — Profit Before Tax flows into top of CFO (indirect method)
  for (const y of periods) {
    const cfStart = getVal(cfStartRow, y), pbt = getVal(pbtRow, y);
    if (cfStart == null || pbt == null) continue;
    const ok = tolOK(cfStart, pbt, pbt);
    checks.push(mk("PBT → CFO start", y, ok ? "pass" : "warn",
      pbt, cfStart, ok ? "CFO opens at profit before tax"
        : "CFO starting line differs from PBT (review)"));
  }

  // Surface what couldn't be checked, so nothing is silently skipped.
  const notes = [];
  if (!reRow) notes.push("Retained earnings / Reserves & surplus not found (Link 1 skipped).");
  if (!cfCashRow) notes.push("CFS closing cash not found (Link 2 skipped).");
  if (!pbtRow || !cfStartRow) notes.push("PBT or CFO starting line not found (Link 3 skipped).");

  return { checks, notes };
}

function mk(link_name, year, status, expected, actual, detail) {
  return {
    link_name, year, status,
    expected: round(expected), actual: round(actual),
    difference: round(actual - expected), detail,
  };
}
function round(x) { return x == null ? null : Math.round(x * 100) / 100; }

/** Convenience: do all CHECKABLE links pass (no fails)? */
export function linksTieOut(linkResult) {
  return !linkResult.checks.some((c) => c.status === "fail");
}

export { num as _num, pct as _pct };
