/**
 * PART A — Normalisation layer.
 *
 * Maps raw extracted line items (inconsistent labels) onto a CANONICAL chart
 * of accounts. Pure, framework-agnostic. No React, no DOM.
 *
 * normaliseHistoricals(confirmedJson) -> {
 *   company_name, units, periods,
 *   values: { canonicalKey: { FY2023: n, ... } },   // flat, keyed by canonical
 *   mapped:   [{ line_item, canonical, section, confidence }],
 *   unmapped: [{ line_item, section, values }]        // ask user to map manually
 * }
 *
 * NEVER silently drops or guesses a mapping for a material line item — anything
 * not confidently matched goes into `unmapped`.
 */

// Canonical key -> list of synonym phrases (normalised form compared).
export const SYNONYMS = {
  // ---- Income statement ----
  revenue: ["revenue from operations", "revenue", "net sales", "sales",
            "total income", "total revenue", "turnover", "income from operations"],
  cogs: ["cost of goods sold", "cogs", "cost of materials consumed",
         "cost of sales", "cost of revenue", "material cost",
         "purchases of stock in trade"],
  gross_profit: ["gross profit", "gross margin"],
  operating_expenses: ["operating expenses", "opex", "other expenses",
                       "employee benefits expense", "selling and distribution",
                       "administrative expenses", "sg&a", "sga"],
  other_income: ["other income", "non operating income", "miscellaneous income"],
  ebitda: ["ebitda", "operating profit before depreciation",
           "earnings before interest tax depreciation and amortisation"],
  depreciation_amortisation: ["depreciation and amortisation",
                              "depreciation & amortisation", "depreciation",
                              "amortisation", "depreciation amortization expense",
                              "depreciation and amortization"],
  ebit: ["ebit", "operating profit", "profit from operations",
         "earnings before interest and tax"],
  interest_expense: ["interest expense", "finance costs", "finance cost",
                     "interest", "interest and finance charges"],
  ebt: ["ebt", "profit before tax", "pbt", "profit before tax and exceptional",
        "earnings before tax"],
  tax: ["tax", "tax expense", "total tax expense", "income tax",
        "current tax", "provision for tax"],
  net_income: ["net income", "net profit", "profit for the year", "pat",
               "profit after tax", "profit for the period", "net earnings"],

  // ---- Balance sheet: assets ----
  cash: ["cash", "cash and cash equivalents", "cash and bank balances",
         "cash & cash equivalents", "bank balances"],
  accounts_receivable: ["accounts receivable", "trade receivables",
                        "trade and other receivables", "debtors", "receivables",
                        "sundry debtors"],
  inventory: ["inventory", "inventories", "stock", "stock in trade"],
  other_current_assets: ["other current assets", "short term loans and advances",
                        "current investments", "other financial assets current"],
  ppe_gross: ["gross block", "property plant and equipment gross",
              "ppe gross", "tangible assets gross"],
  accumulated_depreciation: ["accumulated depreciation", "less depreciation"],
  ppe_net: ["property plant and equipment", "ppe", "net block",
            "property, plant and equipment", "fixed assets",
            "tangible assets", "ppe net"],
  intangibles: ["intangible assets", "intangibles", "goodwill"],
  other_noncurrent_assets: ["other non current assets", "other noncurrent assets",
                          "long term loans and advances", "non current investments",
                          "deferred tax assets"],
  total_assets: ["total assets"],

  // ---- Balance sheet: liabilities + equity ----
  accounts_payable: ["accounts payable", "trade payables", "creditors",
                     "sundry creditors", "trade and other payables", "payables"],
  short_term_debt: ["short term debt", "short term borrowings",
                    "current borrowings", "current maturities of long term debt"],
  other_current_liab: ["other current liabilities", "other financial liabilities current",
                      "short term provisions", "current provisions",
                      "lease liabilities current", "current lease liabilities"],
  long_term_debt: ["long term debt", "long term borrowings", "borrowings",
                   "non current borrowings", "borrowings non current",
                   "term loans", "debentures"],
  other_noncurrent_liab: ["other non current liabilities", "long term provisions",
                        "deferred tax liabilities", "other noncurrent liabilities",
                        "lease liabilities non current", "lease liabilities",
                        "non current lease liabilities"],
  share_capital: ["share capital", "equity share capital", "paid up capital",
                  "issued capital"],
  retained_earnings: ["retained earnings", "reserves and surplus", "other equity",
                      "surplus", "reserves & surplus"],
  total_equity: ["total equity", "shareholders funds", "shareholders' funds",
                 "total shareholders equity", "net worth", "equity"],
  total_liabilities_and_equity: ["total equity and liabilities",
                               "total liabilities and equity",
                               "total equity & liabilities"],

  // ---- Cash flow ----
  cfo: ["cash flow from operating activities", "net cash from operating activities",
        "cash generated from operations", "operating activities",
        "net cash flow from operating activities", "cfo"],
  cfi: ["cash flow from investing activities", "net cash from investing activities",
        "investing activities", "net cash used in investing activities", "cfi"],
  cff: ["cash flow from financing activities", "net cash from financing activities",
        "financing activities", "net cash used in financing activities", "cff"],
  net_change_in_cash: ["net increase in cash", "net decrease in cash",
                     "net change in cash", "net increase decrease in cash"],
  opening_cash: ["opening cash", "cash at beginning", "cash at the beginning",
                 "cash and cash equivalents at beginning"],
  closing_cash: ["closing cash", "cash at end", "cash at the end",
                 "cash and cash equivalents at end"],
};

const SECTION_OF = (() => {
  const is = new Set(["revenue", "cogs", "gross_profit", "operating_expenses",
    "other_income", "ebitda", "depreciation_amortisation", "ebit",
    "interest_expense", "ebt", "tax", "net_income"]);
  const cf = new Set(["cfo", "cfi", "cff", "net_change_in_cash", "opening_cash",
    "closing_cash"]);
  return (key) => is.has(key) ? "income_statement"
                 : cf.has(key) ? "cash_flow" : "balance_sheet";
})();

export function normLabel(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Pre-flatten the synonym table into [{canonical, phrase}] for matching.
const PHRASES = [];
for (const [canonical, list] of Object.entries(SYNONYMS)) {
  for (const p of list) PHRASES.push({ canonical, phrase: normLabel(p) });
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(
        dp[i] + 1, dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[m];
}

function ratio(a, b) {
  const d = levenshtein(a, b);
  const L = Math.max(a.length, b.length) || 1;
  return 1 - d / L;
}

/**
 * Match a single raw label to a canonical key.
 * Returns { canonical, confidence } or { canonical: null }.
 */
export function matchLabel(rawLabel) {
  const label = normLabel(rawLabel);
  if (!label) return { canonical: null, confidence: 0 };

  // 1. exact phrase match.
  for (const { canonical, phrase } of PHRASES) {
    if (label === phrase) return { canonical, confidence: 1.0 };
  }

  // 2. token-set match — word ORDER must not matter. Schedule III prints
  //    "Borrowings (current)" while the synonym is "current borrowings";
  //    substring containment misses that and previously mis-mapped it to
  //    long_term_debt (silently losing the value). Compare word sets instead:
  //    the more phrase tokens the label covers, the higher the confidence, so
  //    "borrowings non current" prefers the 3-token "non current borrowings"
  //    phrase (conf 0.95) over the bare 1-token "borrowings" (conf 0.32).
  const labelTokens = new Set(label.split(" "));
  let best = { canonical: null, confidence: 0 };
  for (const { canonical, phrase } of PHRASES) {
    const ptoks = phrase.split(" ");
    if (ptoks.every((t) => labelTokens.has(t))) {
      const conf = 0.95 * (ptoks.length / Math.max(labelTokens.size, ptoks.length));
      if (conf > best.confidence) best = { canonical, confidence: conf };
    }
  }
  if (best.canonical && best.confidence >= 0.6) {
    return { canonical: best.canonical, confidence: +best.confidence.toFixed(2) };
  }

  // 3. containment (label contains a synonym phrase, or vice-versa) — guard
  //    against trivially short phrases, and score by length overlap so a more
  //    specific phrase beats a shorter generic one.
  for (const { canonical, phrase } of PHRASES) {
    if (phrase.length >= 4 && (label.includes(phrase) || phrase.includes(label))) {
      const conf = 0.9 * (Math.min(label.length, phrase.length) /
                          Math.max(label.length, phrase.length));
      if (conf > best.confidence) best = { canonical, confidence: conf };
    }
  }
  if (best.canonical && best.confidence >= 0.45) {
    return { canonical: best.canonical, confidence: +Math.min(best.confidence, 0.85).toFixed(2) };
  }

  // 4. fuzzy fallback (Levenshtein ratio).
  for (const { canonical, phrase } of PHRASES) {
    const r = ratio(label, phrase);
    if (r > best.confidence) best = { canonical, confidence: r };
  }
  if (best.confidence >= 0.82) return best;       // confident enough
  return { canonical: null, confidence: best.confidence };
}

export function normaliseHistoricals(confirmed) {
  const out = {
    company_name: confirmed.company_name ?? null,
    units: confirmed.units ?? "Absolute",
    periods: Array.isArray(confirmed.periods) ? [...confirmed.periods] : [],
    values: {},
    mapped: [],
    unmapped: [],
  };

  const sections = ["income_statement", "balance_sheet", "cash_flow"];
  for (const section of sections) {
    const rows = Array.isArray(confirmed[section]) ? confirmed[section] : [];
    for (const row of rows) {
      const label = row.line_item ?? "";
      const { canonical, confidence } = matchLabel(label);
      if (!canonical) {
        out.unmapped.push({ line_item: label, section, values: row.values || {} });
        continue;
      }
      // Merge values into the canonical flat map. First confident mapping wins
      // (summing would double-count when e.g. "Revenue from Operations" and the
      // "Total Income" subtotal both map to `revenue`). BUT a losing duplicate
      // with a materially different value must NEVER vanish silently — surface
      // it in `unmapped` so the user can re-map it and the tie-out checks can
      // point at the real cause.
      if (!out.values[canonical]) out.values[canonical] = {};
      let collided = false;
      for (const [yr, v] of Object.entries(row.values || {})) {
        if (out.values[canonical][yr] == null) out.values[canonical][yr] = v;
        else if (v != null && v !== out.values[canonical][yr]) collided = true;
      }
      if (collided) {
        out.unmapped.push({
          line_item: label, section, values: row.values || {},
          collision: canonical,
          note: `Also matched '${canonical}' (already filled by an earlier row) — value NOT merged; map it manually.`,
        });
      }
      out.mapped.push({ line_item: label, canonical, section, confidence: +confidence.toFixed(2) });
    }
  }
  return out;
}

export { SECTION_OF };
