/**
 * PART C — Validation layer. Pure functions.
 *
 * validateModel(model) -> [{ name, status: 'pass'|'warn'|'fail', detail, year }]
 *
 * Runs HARD checks (fail beyond tolerance) and SOFT checks (sanity warns) on
 * every year — historical and forecast. The balance-sheet identity is the most
 * important check: a model that doesn't balance is broken.
 */

const num = (x) => (x == null || Number.isNaN(Number(x)) ? 0 : Number(x));
const has = (y, k) => y[k] != null && !Number.isNaN(Number(y[k]));

// Tolerance: abs diff <= 0.5 units OR <= 0.1% of the reference magnitude.
function within(a, b, ref) {
  const tol = Math.max(0.5, 0.001 * Math.abs(ref ?? Math.max(Math.abs(a), Math.abs(b))));
  return Math.abs(a - b) <= tol;
}

function check(list, name, status, detail, year) {
  list.push({ name, status, detail, year });
}

export function validateModel(model) {
  const checks = [];
  const { years, periods, units } = model;

  for (const year of periods) {
    const y = years[year];
    if (!y) continue;
    const isF = !!y._isForecast;

    // ---- HARD: balance sheet balances ----
    if (has(y, "total_assets") && has(y, "total_liabilities_and_equity")) {
      const ta = num(y.total_assets), tle = num(y.total_liabilities_and_equity);
      const ok = within(ta, tle, ta);
      check(checks, "Balance sheet balances",
        ok ? "pass" : "fail",
        ok ? `${year}: assets = L+E = ${fmt(ta)} ${units}`
           : `${year}: assets ${fmt(ta)} ≠ L+E ${fmt(tle)} (diff ${fmt(ta - tle)} ${units})`,
        year);
    }

    // ---- HARD: subtotal integrity ----
    if (has(y, "revenue") && has(y, "cogs") && has(y, "gross_profit")) {
      const exp = num(y.revenue) - num(y.cogs);
      checkEq(checks, "Gross profit = revenue − COGS", exp, num(y.gross_profit), year, units);
    }
    if (has(y, "ebitda") && has(y, "depreciation_amortisation") && has(y, "ebit")) {
      const exp = num(y.ebitda) - num(y.depreciation_amortisation);
      checkEq(checks, "EBIT = EBITDA − D&A", exp, num(y.ebit), year, units);
    }
    if (has(y, "ebt") && has(y, "tax") && has(y, "net_income")) {
      const exp = num(y.ebt) - num(y.tax);
      checkEq(checks, "Net income = EBT − tax", exp, num(y.net_income), year, units);
    }

    // ---- HARD: cash ties (CFS closing cash == BS cash) ----
    if (has(y, "closing_cash") && has(y, "cash")) {
      const ok = within(num(y.closing_cash), num(y.cash), num(y.cash));
      check(checks, "Cash ties (CFS = BS)",
        ok ? "pass" : "fail",
        `${year}: closing cash ${fmt(num(y.closing_cash))} vs BS cash ${fmt(num(y.cash))} ${units}`,
        year);
    }

    // ---- Roll-forwards (need prior year) ----
    const idx = periods.indexOf(year);
    const prior = idx > 0 ? years[periods[idx - 1]] : null;
    if (prior && isF) {
      // Retained earnings roll
      if (has(y, "retained_earnings") && has(prior, "retained_earnings")
          && has(y, "net_income")) {
        const exp = num(prior.retained_earnings) + num(y.net_income) - num(y.dividends);
        checkEq(checks, "Retained earnings rolls", exp, num(y.retained_earnings), year, units);
      }
      // PPE roll
      if (has(y, "ppe_net") && has(prior, "ppe_net") && has(y, "capex")) {
        const exp = num(prior.ppe_net) + num(y.capex) - num(y.depreciation_amortisation);
        checkEq(checks, "PP&E rolls", exp, num(y.ppe_net), year, units);
      }
      // Debt roll
      if (has(y, "long_term_debt") && has(prior, "long_term_debt")) {
        const A = y._assumptions || {};
        const exp = num(prior.long_term_debt) + num(A.new_borrowing) - num(A.repayment);
        checkEq(checks, "Debt rolls", exp, num(y.long_term_debt), year, units);
      }
    }

    // ---- SOFT checks ----
    if (has(y, "cash") && num(y.cash) < 0)
      check(checks, "Negative cash balance", "warn",
        `${year}: cash is ${fmt(num(y.cash))} ${units} — consider a revolver/financing assumption.`, year);
    if (has(y, "revenue") && num(y.revenue) < 0)
      check(checks, "Negative revenue", "warn", `${year}: revenue ${fmt(num(y.revenue))}`, year);
    if (has(y, "gross_profit") && num(y.gross_profit) < 0)
      check(checks, "Negative gross margin", "warn", `${year}: gross profit ${fmt(num(y.gross_profit))}`, year);
    if (has(y, "ebt") && num(y.ebt) < 0 && has(y, "tax") && num(y.tax) > 0)
      check(checks, "Tax charged on a loss", "warn", `${year}: EBT ${fmt(num(y.ebt))} but tax ${fmt(num(y.tax))}`, year);

    // growth / margin sanity vs prior
    if (prior && has(y, "revenue") && has(prior, "revenue") && num(prior.revenue) !== 0) {
      const g = (num(y.revenue) - num(prior.revenue)) / Math.abs(num(prior.revenue));
      if (g > 1.0 || g < -0.5)
        check(checks, "Revenue growth out of range", "warn",
          `${year}: ${(g * 100).toFixed(0)}% YoY revenue change`, year);
    }

    // absurd working-capital days
    const A = y._assumptions;
    if (A) {
      for (const k of ["dso", "dio", "dpo"]) {
        if (A[k] < 0 || A[k] > 365)
          check(checks, `${k.toUpperCase()} out of range`, "warn",
            `${year}: ${k} = ${A[k]} days`, year);
      }
    }
  }

  return checks;
}

function checkEq(list, name, expected, actual, year, units) {
  const ok = within(expected, actual, expected);
  check(list, name, ok ? "pass" : "fail",
    ok ? `${year}: ${fmt(actual)} ${units}`
       : `${year}: expected ${fmt(expected)} but got ${fmt(actual)} (diff ${fmt(actual - expected)} ${units})`,
    year);
}

function fmt(x) {
  return Number(x).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/** Convenience: does the whole model pass all HARD checks? */
export function modelBalances(checks) {
  return !checks.some((c) => c.status === "fail");
}
