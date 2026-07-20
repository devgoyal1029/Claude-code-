/**
 * Engine tests. Pure Node, no deps:  node webapp/static/model/model.test.mjs
 *
 * Proves: (1) normalisation maps synonyms + flags unmapped, (2) a balanced
 * dataset passes ALL hard checks for every forecast year, (3) a deliberately
 * broken dataset (assets != liabilities) triggers the balance-sheet FAIL.
 */

import { normaliseHistoricals, matchLabel } from "./normalise.mjs";
import { buildModel, seedAssumptions } from "./engine.mjs";
import { modelBalances } from "./validate.mjs";

let passed = 0, failed = 0;
const ok = (name, cond) => cond ? (passed++) : (failed++, console.log("  FAIL:", name));

// ---------------------------------------------------------------------------
// Part A — normalisation
// ---------------------------------------------------------------------------
console.log("\n[normalisation]");
ok("Net Sales -> revenue", matchLabel("Net Sales").canonical === "revenue");
ok("Revenue from Operations -> revenue", matchLabel("Revenue from Operations").canonical === "revenue");
ok("Trade Receivables -> accounts_receivable", matchLabel("Trade Receivables").canonical === "accounts_receivable");
ok("Finance costs -> interest_expense", matchLabel("Finance costs").canonical === "interest_expense");
ok("Reserves and Surplus -> retained_earnings", matchLabel("Reserves and Surplus").canonical === "retained_earnings");
ok("gibberish -> unmapped (null)", matchLabel("Sundry Wibble Quux").canonical === null);

// Schedule III word-order + qualifier disambiguation (regression: these used to
// BOTH map to long_term_debt, silently dropping the current-borrowings value).
ok("Borrowings (current) -> short_term_debt",
   matchLabel("Borrowings (current)").canonical === "short_term_debt");
ok("Borrowings (non-current) -> long_term_debt",
   matchLabel("Borrowings (non-current)").canonical === "long_term_debt");
ok("Current maturities of long-term debt -> short_term_debt",
   matchLabel("Current maturities of long-term debt").canonical === "short_term_debt");
ok("Lease liabilities (current) -> other_current_liab",
   matchLabel("Lease liabilities (current)").canonical === "other_current_liab");
ok("Lease liabilities (non-current) -> other_noncurrent_liab",
   matchLabel("Lease liabilities (non-current)").canonical === "other_noncurrent_liab");

// Collision safety: when two distinct rows match the SAME canonical key with
// different values, the loser must land in `unmapped` — never vanish.
{
  const c = { periods: ["FY2025"], income_statement: [], cash_flow: [],
    balance_sheet: [
      { line_item: "Borrowings (non-current)", values: { FY2025: 3100 } },
      { line_item: "Borrowings (current)", values: { FY2025: 600 } },
    ] };
  const h = normaliseHistoricals(c);
  ok("current & non-current borrowings kept separately",
     h.values.long_term_debt?.FY2025 === 3100 && h.values.short_term_debt?.FY2025 === 600);
  const c2 = { periods: ["FY2025"], balance_sheet: [], cash_flow: [],
    income_statement: [
      { line_item: "Revenue from Operations", values: { FY2025: 16789 } },
      { line_item: "Total Income", values: { FY2025: 17989 } },
    ] };
  const h2 = normaliseHistoricals(c2);
  ok("first confident mapping wins (no double-count)", h2.values.revenue.FY2025 === 16789);
  ok("losing duplicate surfaces in unmapped with collision note",
     h2.unmapped.length === 1 && h2.unmapped[0].collision === "revenue"
     && h2.unmapped[0].values.FY2025 === 17989);
}

// ---------------------------------------------------------------------------
// Balanced dataset (Crores) — FY2024 & FY2025 both balance to 800 / 870
// ---------------------------------------------------------------------------
function balancedConfirmed() {
  return {
    company_name: "Toy Co Ltd", units: "Crores", periods: ["FY2024", "FY2025"],
    income_statement: [
      row("Revenue from Operations", { FY2024: 900, FY2025: 1000 }),
      row("Cost of materials consumed", { FY2024: 540, FY2025: 600 }),
      row("Gross Profit", { FY2024: 360, FY2025: 400 }),
      row("Other Expenses", { FY2024: 180, FY2025: 200 }),
      row("EBITDA", { FY2024: 180, FY2025: 200 }),
      row("Depreciation", { FY2024: 45, FY2025: 50 }),
      row("EBIT", { FY2024: 135, FY2025: 150 }),
      row("Finance costs", { FY2024: 18, FY2025: 20 }),
      row("Profit Before Tax", { FY2024: 117, FY2025: 130 }),
      row("Tax expense", { FY2024: 29.25, FY2025: 32.5 }),
      row("Profit for the year", { FY2024: 87.75, FY2025: 97.5 }),
    ],
    balance_sheet: [
      row("Cash and Cash Equivalents", { FY2024: 90, FY2025: 100 }),
      row("Trade Receivables", { FY2024: 135, FY2025: 150 }),
      row("Inventories", { FY2024: 108, FY2025: 120 }),
      row("Property, Plant and Equipment", { FY2024: 467, FY2025: 500 }),
      row("Total Assets", { FY2024: 800, FY2025: 870 }),
      row("Trade Payables", { FY2024: 72, FY2025: 80 }),
      row("Long term borrowings", { FY2024: 180, FY2025: 200 }),
      row("Equity Share Capital", { FY2024: 300, FY2025: 300 }),
      row("Reserves and Surplus", { FY2024: 248, FY2025: 290 }),
      row("Total Equity and Liabilities", { FY2024: 800, FY2025: 870 }),
    ],
    cash_flow: [],
  };
}
const row = (line_item, values) => ({ line_item, values });

const ASSUMPTIONS = {
  revenue_growth_pct: 0.10, cogs_pct_of_revenue: 0.60, opex_pct_of_revenue: 0.20,
  depreciation_pct: 0.10, capex_pct_of_revenue: 0.05,
  dso: 54.75, dio: 73, dpo: 48.67,
  tax_rate: 0.25, interest_rate: 0.10, dividend_payout_ratio: 0,
  new_borrowing: 0, repayment: 0,
};

console.log("\n[balanced model]");
const hist = normaliseHistoricals(balancedConfirmed());
ok("no material line items unmapped", hist.unmapped.length === 0);
ok("revenue value normalised", hist.values.revenue.FY2025 === 1000);

const model = buildModel(hist, ASSUMPTIONS, 3);
ok("3 forecast years generated", model.forecastPeriods.length === 3);
ok("forecast periods are FY2026..FY2028",
   model.forecastPeriods.join(",") === "FY2026,FY2027,FY2028");

const fails = model.checks.filter((c) => c.status === "fail");
ok("NO hard-check failures on balanced model", fails.length === 0);
ok("modelBalances() == true", modelBalances(model.checks) === true);

// every forecast year's balance sheet balances within tolerance
for (const fy of model.forecastPeriods) {
  const y = model.years[fy];
  const diff = Math.abs(y.total_assets - y.total_liabilities_and_equity);
  ok(`BS balances ${fy} (diff ${diff.toExponential(1)})`, diff <= 0.5);
  ok(`cash ties ${fy}`, Math.abs(y.closing_cash - y.cash) <= 0.5);
}
if (fails.length) console.log("  unexpected fails:", fails);

// seeding sanity
const seeded = seedAssumptions(hist);
ok("seeded revenue growth ~11%", Math.abs(seeded.revenue_growth_pct - 0.1111) < 0.01);
ok("seeded cogs% == 0.60", Math.abs(seeded.cogs_pct_of_revenue - 0.60) < 0.001);

// iterative circularity converges
const iter = buildModel(hist, ASSUMPTIONS, 3, { circularity: "iterative" });
ok("iterative solver converged", iter.converged === true);
ok("iterative model still balances", modelBalances(iter.checks) === true);

// ---------------------------------------------------------------------------
// Broken dataset — equity understated so assets (870) != L+E (830)
// ---------------------------------------------------------------------------
console.log("\n[broken model — must FAIL]");
const broken = balancedConfirmed();
broken.periods = ["FY2025"];
for (const s of ["income_statement", "balance_sheet"])
  broken[s] = broken[s].map((r) => ({ line_item: r.line_item, values: { FY2025: r.values.FY2025 } }));
// break it: drop retained earnings 290 -> 250 and total L+E 870 -> 830
broken.balance_sheet = broken.balance_sheet.map((r) => {
  if (r.line_item === "Reserves and Surplus") return row("Reserves and Surplus", { FY2025: 250 });
  if (r.line_item === "Total Equity and Liabilities") return row("Total Equity and Liabilities", { FY2025: 830 });
  return r;
});

const bm = buildModel(normaliseHistoricals(broken), ASSUMPTIONS, 2);
const bsFails = bm.checks.filter((c) => c.status === "fail" && c.name === "Balance sheet balances");
ok("broken model triggers a Balance-sheet FAIL", bsFails.length > 0);
ok("modelBalances() == false on broken model", modelBalances(bm.checks) === false);
console.log("  -> reported break:", bsFails[0] ? bsFails[0].detail : "(none)");

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(46));
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log("=".repeat(46));
process.exit(failed ? 1 : 0);
