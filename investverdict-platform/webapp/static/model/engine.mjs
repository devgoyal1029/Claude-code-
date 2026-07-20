/**
 * PART B — Three-statement model engine. PURE functions, no UI/React.
 *
 * buildModel(historicals, assumptions, forecastYears, options) -> model
 *
 * `historicals` is the output of normaliseHistoricals(): a flat canonical
 * `values` map plus `periods`. The engine recomputes historical subtotals for
 * validation (without overwriting reported figures), then forecasts each future
 * year applying the formulas in the correct order so the three statements stay
 * linked. Validation (Part C) is attached to the result.
 */

import { validateModel } from "./validate.mjs";

// Numeric helper: null/undefined -> 0 for arithmetic, but callers track which
// material inputs were missing so we can WARN rather than silently zero.
const n = (x) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));

export const DEFAULT_ASSUMPTIONS = {
  revenue_growth_pct: 0.10,
  cogs_pct_of_revenue: 0.60,
  opex_pct_of_revenue: 0.20,
  depreciation_pct: 0.10,        // of opening PP&E net
  capex_pct_of_revenue: 0.05,
  dso: 45, dio: 60, dpo: 40,     // working-capital days
  tax_rate: 0.25,
  interest_rate: 0.09,           // on opening total debt
  dividend_payout_ratio: 0.0,
  new_borrowing: 0,
  repayment: 0,
  asset_sales: 0,
  equity_raised: 0,
  interest_income: 0,
};

/** Latest historical period by FY number. */
function latestPeriod(periods) {
  return [...periods].sort((a, b) => fyNum(a) - fyNum(b)).slice(-1)[0];
}
function fyNum(p) {
  const m = String(p).match(/(\d{4})/);
  return m ? +m[1] : 0;
}
function makeForecastPeriods(lastHist, count) {
  const base = fyNum(lastHist);
  return Array.from({ length: count }, (_, i) => `FY${base + i + 1}`);
}

const get = (values, key, year) => {
  const row = values[key];
  return row ? row[year] : undefined;
};

/**
 * Seed sensible default assumptions from the latest historical year so the UI
 * panel starts populated. Guards against divide-by-zero / missing data.
 */
export function seedAssumptions(historicals) {
  const { values, periods } = historicals;
  const sorted = [...periods].sort((a, b) => fyNum(a) - fyNum(b));
  const last = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const a = { ...DEFAULT_ASSUMPTIONS };
  if (!last) return a;

  const rev = n(get(values, "revenue", last));
  const cogs = n(get(values, "cogs", last));
  const opex = n(get(values, "operating_expenses", last));
  const ar = n(get(values, "accounts_receivable", last));
  const inv = n(get(values, "inventory", last));
  const ap = n(get(values, "accounts_payable", last));
  const tax = n(get(values, "tax", last));
  const ebt = n(get(values, "ebt", last));
  const intExp = n(get(values, "interest_expense", last));
  const ltd = n(get(values, "long_term_debt", last));
  const std = n(get(values, "short_term_debt", last));
  const dep = n(get(values, "depreciation_amortisation", last));
  const ppe = n(get(values, "ppe_net", last));

  if (prev) {
    const prevRev = n(get(values, "revenue", prev));
    if (prevRev > 0) a.revenue_growth_pct = +((rev - prevRev) / prevRev).toFixed(4);
  }
  if (rev > 0) {
    a.cogs_pct_of_revenue = +(cogs / rev).toFixed(4);
    a.opex_pct_of_revenue = +(opex / rev).toFixed(4);
    a.dso = +((ar / rev) * 365).toFixed(1);
  }
  if (cogs > 0) {
    a.dio = +((inv / cogs) * 365).toFixed(1);
    a.dpo = +((ap / cogs) * 365).toFixed(1);
  }
  if (ebt > 0) a.tax_rate = Math.max(0, Math.min(0.5, +(tax / ebt).toFixed(4)));
  const debt = ltd + std;
  if (debt > 0) a.interest_rate = Math.max(0, +(intExp / debt).toFixed(4));
  if (ppe > 0 && dep > 0) a.depreciation_pct = Math.max(0, +(dep / ppe).toFixed(4));
  return a;
}

/** Resolve per-year effective assumptions (defaults + per-year overrides). */
function effectiveAssumptions(base, overrides, year) {
  return { ...DEFAULT_ASSUMPTIONS, ...base, ...((overrides && overrides[year]) || {}) };
}

/** Snapshot of the canonical figures needed to roll forward into next year. */
function historicalSnapshot(values, year) {
  const g = (k) => n(get(values, k, year));
  return {
    revenue: g("revenue"),
    other_income: g("other_income"),
    cash: g("cash"),
    accounts_receivable: g("accounts_receivable"),
    inventory: g("inventory"),
    other_current_assets: g("other_current_assets"),
    ppe_net: g("ppe_net"),
    intangibles: g("intangibles"),
    other_noncurrent_assets: g("other_noncurrent_assets"),
    accounts_payable: g("accounts_payable"),
    short_term_debt: g("short_term_debt"),
    other_current_liab: g("other_current_liab"),
    long_term_debt: g("long_term_debt"),
    other_noncurrent_liab: g("other_noncurrent_liab"),
    share_capital: g("share_capital"),
    retained_earnings: g("retained_earnings"),
  };
}

/**
 * Compute ONE forecast year from the prior year's closing figures.
 *
 * CIRCULARITY: interest_expense depends on debt; debt & cash interact; cash
 * depends on interest -> circular. v1 DEFAULT breaks it by charging interest on
 * the OPENING (beginning-of-period) total debt balance — a standard, defensible
 * convention. An optional iterative solver (see buildModel) instead converges on
 * the AVERAGE debt balance. The convention in force is recorded on the model.
 */
function forecastYear(prior, A, opts) {
  const openingDebt = n(prior.long_term_debt) + n(prior.short_term_debt);

  // ---- Income statement ----
  const revenue = prior.revenue * (1 + A.revenue_growth_pct);
  const cogs = revenue * A.cogs_pct_of_revenue;
  const gross_profit = revenue - cogs;
  const operating_expenses = revenue * A.opex_pct_of_revenue;
  const other_income = n(prior.other_income);                 // held flat
  const ebitda = gross_profit - operating_expenses + other_income;
  const depreciation_amortisation = prior.ppe_net * A.depreciation_pct;
  const ebit = ebitda - depreciation_amortisation;

  // interest debt base: opening (default) or provided average (iterative pass)
  const interestDebtBase = opts && opts.interestDebtBase != null
    ? opts.interestDebtBase : openingDebt;
  const interest_expense = A.interest_rate * interestDebtBase;
  const ebt = ebit - interest_expense + n(A.interest_income);
  const tax = Math.max(0, ebt) * A.tax_rate;
  const net_income = ebt - tax;

  // ---- Balance sheet roll-forwards ----
  const capex = revenue * A.capex_pct_of_revenue;
  const ppe_net = prior.ppe_net + capex - depreciation_amortisation;

  const accounts_receivable = revenue * (A.dso / 365);
  const inventory = cogs * (A.dio / 365);
  const accounts_payable = cogs * (A.dpo / 365);

  const dividends = net_income * A.dividend_payout_ratio;
  const retained_earnings = prior.retained_earnings + net_income - dividends;

  const long_term_debt = prior.long_term_debt + A.new_borrowing - A.repayment;

  // held-flat lines (no driver supplied)
  const short_term_debt = n(prior.short_term_debt);
  const other_current_assets = n(prior.other_current_assets);
  const intangibles = n(prior.intangibles);
  const other_noncurrent_assets = n(prior.other_noncurrent_assets);
  const other_current_liab = n(prior.other_current_liab);
  const other_noncurrent_liab = n(prior.other_noncurrent_liab);
  const share_capital = n(prior.share_capital) + n(A.equity_raised);

  // ---- Cash flow statement (indirect) — GOLDEN LINKS 1 & 3 ----
  const change_in_AR = accounts_receivable - prior.accounts_receivable;
  const change_in_inventory = inventory - prior.inventory;
  const change_in_AP = accounts_payable - prior.accounts_payable;
  const change_in_working_capital = change_in_AR + change_in_inventory - change_in_AP;
  const cfo = net_income + depreciation_amortisation - change_in_working_capital;
  const cfi = -capex + n(A.asset_sales);
  const cff = A.new_borrowing - A.repayment + n(A.equity_raised) - dividends;
  const net_change_in_cash = cfo + cfi + cff;
  const opening_cash = n(prior.cash);
  const closing_cash = opening_cash + net_change_in_cash;   // GOLDEN LINK 2 -> BS cash

  const cash = closing_cash;
  const total_assets = cash + accounts_receivable + inventory
    + other_current_assets + ppe_net + intangibles + other_noncurrent_assets;
  const total_liabilities_and_equity = accounts_payable + short_term_debt
    + other_current_liab + long_term_debt + other_noncurrent_liab
    + share_capital + retained_earnings;
  const total_equity = share_capital + retained_earnings;

  return {
    // IS
    revenue, cogs, gross_profit, operating_expenses, other_income, ebitda,
    depreciation_amortisation, ebit, interest_expense, ebt, tax, net_income,
    dividends,
    // BS
    cash, accounts_receivable, inventory, other_current_assets, ppe_net,
    intangibles, other_noncurrent_assets, total_assets,
    accounts_payable, short_term_debt, other_current_liab, long_term_debt,
    other_noncurrent_liab, share_capital, retained_earnings, total_equity,
    total_liabilities_and_equity,
    // CF
    cfo, cfi, cff, net_change_in_cash, opening_cash, closing_cash, capex,
    change_in_working_capital,
    // memo
    _openingDebt: openingDebt,
  };
}

/** Iterative circularity solver: converge interest on AVERAGE debt balance. */
function forecastYearIterative(prior, A, maxIter = 50, tol = 0.01) {
  let yr = forecastYear(prior, A);            // first pass on opening debt
  let converged = false;
  for (let i = 0; i < maxIter; i++) {
    const avgDebt = (yr._openingDebt + yr.long_term_debt + yr.short_term_debt) / 2;
    const next = forecastYear(prior, A, { interestDebtBase: avgDebt });
    if (Math.abs(next.net_income - yr.net_income) < tol) {
      yr = next; converged = true; break;
    }
    yr = next;
  }
  yr._converged = converged;
  return yr;
}

export function buildModel(historicals, assumptions = {}, forecastYears = 3, options = {}) {
  const circularity = options.circularity === "iterative" ? "iterative" : "opening";
  const overrides = assumptions.overrides || null;
  const base = { ...DEFAULT_ASSUMPTIONS, ...assumptions };
  delete base.overrides;

  const { values, periods } = historicals;
  const histSorted = [...periods].sort((a, b) => fyNum(a) - fyNum(b));
  const lastHist = latestPeriod(histSorted);
  const forecastPeriods = makeForecastPeriods(lastHist, forecastYears);

  const warnings = [];
  // Flag missing material opening balances rather than silently zeroing them.
  for (const key of ["revenue", "ppe_net", "retained_earnings", "cash"]) {
    if (get(values, key, lastHist) == null) {
      warnings.push(`Missing material input '${key}' in ${lastHist}; treated as 0 for forecasting.`);
    }
  }

  // Years map: historical years keep REPORTED canonical values; forecast years
  // are computed.
  const years = {};
  for (const y of histSorted) {
    years[y] = { ...flattenReported(values, y), _isForecast: false };
  }

  let prior = historicalSnapshot(values, lastHist);
  let allConverged = true;
  for (const fy of forecastPeriods) {
    const A = effectiveAssumptions(base, overrides, fy);
    const yr = circularity === "iterative"
      ? forecastYearIterative(prior, A)
      : forecastYear(prior, A);
    if (circularity === "iterative" && yr._converged === false) allConverged = false;
    years[fy] = { ...yr, _isForecast: true, _assumptions: A };
    prior = yr;                                  // roll forward
  }

  const model = {
    company_name: historicals.company_name ?? null,
    units: historicals.units ?? "Absolute",
    historicalPeriods: histSorted,
    forecastPeriods,
    periods: [...histSorted, ...forecastPeriods],
    assumptions: base,
    overrides,
    circularity,
    converged: circularity === "iterative" ? allConverged : true,
    warnings,
    years,
    unmapped: historicals.unmapped || [],
  };
  model.checks = validateModel(model);
  return model;
}

/** Pull reported canonical figures for a historical year into a flat object. */
function flattenReported(values, year) {
  const o = {};
  for (const key of Object.keys(values)) {
    const v = get(values, key, year);
    if (v !== undefined) o[key] = v;
  }
  return o;
}

export { n as _num, fyNum };
