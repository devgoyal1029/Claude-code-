/** Tests for forecast assumptions logic.  node assumptions.test.mjs */
import { anchors, validateAssumption, DRIVERS } from "./assumptions.mjs";
import { normaliseHistoricals } from "../model/normalise.mjs";
import { seedAssumptions, buildModel } from "../model/engine.mjs";
import { modelBalances } from "../model/validate.mjs";

let passed = 0, failed = 0;
const ok = (n, c) => c ? passed++ : (failed++, console.log("  FAIL:", n));
const near = (a, b, t = 0.02) => a != null && Math.abs(a - b) <= t;

// fake normalised historicals (canonical values)
const hist = {
  periods: ["FY2023", "FY2024", "FY2025"], units: "Crores",
  values: {
    revenue: { FY2023: 9000, FY2024: 9500, FY2025: 10000 },
    cogs: { FY2023: 5400, FY2024: 5600, FY2025: 6000 },
    operating_expenses: { FY2023: 1800, FY2024: 1850, FY2025: 2000 },
    accounts_receivable: { FY2025: 1000 }, inventory: { FY2025: 1200 },
    accounts_payable: { FY2025: 800 }, ebt: { FY2025: 1900 }, tax: { FY2025: 475 },
  },
};

console.log("\n[anchors]");
const A = anchors(hist);
ok("revenue CAGR ~5.4%", near(A.cagr, 0.0541, 0.005));
ok("COGS% range computed", A.cogsMin != null && A.cogsMax != null);
ok("DSO history = 1000/10000*365 = 36.5", near(A.dsoH, 36.5, 0.1));
ok("effective tax history = 475/1900 = 25%", near(A.taxH, 0.25, 0.01));

console.log("\n[soft validation]");
ok("normal growth (6%) -> no warning", validateAssumption("revenue_growth_pct", 0.06, A) === null);
ok("growth 30% (>2x CAGR) -> warns", !!validateAssumption("revenue_growth_pct", 0.30, A));
ok("tax 60% -> warns", !!validateAssumption("tax_rate", 0.60, A));
ok("tax 25% -> ok", validateAssumption("tax_rate", 0.25, A) === null);
ok("payout 120% -> warns", !!validateAssumption("dividend_payout_ratio", 1.2, A));
ok("DSO 60 (>1.15x of 36.5) -> warns", !!validateAssumption("dso", 60, A));
ok("DSO 36 -> ok", validateAssumption("dso", 36, A) === null);
ok("COGS% far below history -> warns", !!validateAssumption("cogs_pct_of_revenue", 0.40, A));

console.log("\n[seed + forecast balances on balanced data]");
// a clean balanced confirmed set -> seed -> buildModel -> should balance
const confirmed = {
  company_name: "Toy Co", units: "Crores", periods: ["FY2024", "FY2025"],
  income_statement: [
    { line_item: "Revenue from operations", values: { FY2024: 900, FY2025: 1000 } },
    { line_item: "Cost of materials consumed", values: { FY2024: 540, FY2025: 600 } },
    { line_item: "Depreciation", values: { FY2024: 45, FY2025: 50 } },
    { line_item: "Finance costs", values: { FY2024: 18, FY2025: 20 } },
    { line_item: "Profit before tax", values: { FY2024: 117, FY2025: 130 } },
    { line_item: "Tax expense", values: { FY2024: 29.25, FY2025: 32.5 } },
    { line_item: "Profit for the year", values: { FY2024: 87.75, FY2025: 97.5 } },
  ],
  balance_sheet: [
    { line_item: "Cash and cash equivalents", values: { FY2024: 90, FY2025: 100 } },
    { line_item: "Trade receivables", values: { FY2024: 135, FY2025: 150 } },
    { line_item: "Inventories", values: { FY2024: 108, FY2025: 120 } },
    { line_item: "Property, Plant and Equipment", values: { FY2024: 467, FY2025: 500 } },
    { line_item: "Total assets", values: { FY2024: 800, FY2025: 870 } },
    { line_item: "Trade payables", values: { FY2024: 72, FY2025: 80 } },
    { line_item: "Long term borrowings", values: { FY2024: 180, FY2025: 200 } },
    { line_item: "Equity share capital", values: { FY2024: 300, FY2025: 300 } },
    { line_item: "Reserves and surplus", values: { FY2024: 192.5, FY2025: 290 } },
    { line_item: "Total equity and liabilities", values: { FY2024: 800, FY2025: 870 } },
  ],
  cash_flow: [],
};
const h = normaliseHistoricals(confirmed);
const model = buildModel(h, { ...seedAssumptions(h), overrides: {} }, 3);
ok("forecast model balances on seeded assumptions", modelBalances(model.checks) === true);
ok("13 drivers defined", DRIVERS.length === 13);

console.log("\n" + "=".repeat(44));
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log("=".repeat(44));
process.exit(failed ? 1 : 0);
