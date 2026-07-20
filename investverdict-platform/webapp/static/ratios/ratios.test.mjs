/** Ratio engine tests.  node ratios.test.mjs */
import { computeRatios } from "./ratios.mjs";

let passed = 0, failed = 0;
const ok = (n, c) => c ? passed++ : (failed++, console.log("  FAIL:", n));
const near = (a, b, t = 0.01) => a != null && Math.abs(a - b) <= t;

// minimal model in the engine's shape (model.years[period][canonicalKey])
const model = {
  company_name: "Test Co", units: "Crores",
  periods: ["FY2024", "FY2025"], historicalPeriods: ["FY2024"], forecastPeriods: ["FY2025"],
  assumptions: { tax_rate: 0.25 },
  years: {
    FY2024: { revenue: 1000, cogs: 600, gross_profit: 400, operating_expenses: 200, ebitda: 200,
      depreciation_amortisation: 50, ebit: 150, interest_expense: 20, ebt: 130, tax: 32.5, net_income: 97.5,
      cash: 100, accounts_receivable: 150, inventory: 120, ppe_net: 500, total_assets: 870,
      accounts_payable: 80, short_term_debt: 0, long_term_debt: 200, share_capital: 300, retained_earnings: 290,
      cfo: 120, capex: 50, dividends: 0 },
    FY2025: { _isForecast: true, _assumptions: { tax_rate: 0.25, repayment: 0 },
      revenue: 1100, cogs: 660, gross_profit: 440, operating_expenses: 220, ebitda: 220,
      depreciation_amortisation: 55, ebit: 165, interest_expense: 18, ebt: 147, tax: 36.75, net_income: 110.25,
      cash: 110, accounts_receivable: 165, inventory: 132, ppe_net: 550, total_assets: 957,
      accounts_payable: 88, short_term_debt: 0, long_term_debt: 200, share_capital: 300, retained_earnings: 400,
      cfo: 140, capex: 55, dividends: 0 },
  },
};

const data = computeRatios(model, { price: 50, shares: 100 });
const find = (cat, name) => data.categories.find((c) => c.name === cat).ratios.find((r) => r.name === name);

console.log("\n[liquidity]");
// Current Assets FY2024 = 100+150+120 = 370 ; Current Liab = 80
ok("Current Ratio FY2024 = 370/80 = 4.625", near(find("Liquidity", "Current Ratio").perYear.FY2024.v, 4.625));
ok("Quick Ratio FY2024 = 250/80 = 3.125", near(find("Liquidity", "Quick Ratio (Acid-Test)").perYear.FY2024.v, 3.125));

console.log("\n[solvency]");
ok("Debt-to-Equity FY2024 = 200/590", near(find("Solvency / Leverage", "Debt-to-Equity").perYear.FY2024.v, 200 / 590));
ok("Interest Coverage FY2024 = 150/20 = 7.5", near(find("Solvency / Leverage", "Interest Coverage (TIE)").perYear.FY2024.v, 7.5));

console.log("\n[profitability]");
ok("Net Margin FY2024 = 9.75%", near(find("Profitability — Margins", "Net Profit Margin").perYear.FY2024.v, 0.0975));
// ROE FY2025 uses AVG equity: (590+700)/2 = 645 ; NI 110.25 -> 17.09%
ok("ROE FY2025 on avg equity = 110.25/645", near(find("Profitability — Returns", "ROE").perYear.FY2025.v, 110.25 / 645, 0.001));
ok("ROA FY2024 first year uses closing 870", near(find("Profitability — Returns", "ROA").perYear.FY2024.v, 97.5 / 870, 0.001));

console.log("\n[DuPont identity]");
const roe3 = find("DuPont (ROE drivers)", "= ROE (3-step)").perYear.FY2025.v;
const roeDirect = find("Profitability — Returns", "ROE").perYear.FY2025.v;
ok("3-step DuPont ROE ≈ direct ROE", near(roe3, roeDirect, 0.002));

console.log("\n[cash flow]");
ok("FCF FY2024 = 120 − 50 = 70", near(find("Cash Flow", "Free Cash Flow (₹)").perYear.FY2024.v, 70));

console.log("\n[valuation w/ market]");
ok("EPS FY2025 = 110.25/100 = 1.1025", near(find("Valuation / Market", "EPS (₹)").perYear.FY2025.v, 1.1025));
ok("P/E FY2025 = 50 / 1.1025", near(find("Valuation / Market", "P/E").perYear.FY2025.v, 50 / 1.1025, 0.05));

console.log("\n[robustness]");
const noMkt = computeRatios(model, {});
ok("P/E without price -> null (not NaN)", noMkt.categories.find((c) => c.name === "Valuation / Market").ratios.find((r) => r.name === "P/E").perYear.FY2024.v === null);
// zero-denominator safety
const z = { ...model, years: { FY2024: { revenue: 0, cogs: 0, net_income: 5 }, }, periods: ["FY2024"], forecastPeriods: [] };
const zr = computeRatios(z, {});
ok("net margin with revenue 0 -> null", zr.categories.find((c) => c.name === "Profitability — Margins").ratios.find((r) => r.name === "Net Profit Margin").perYear.FY2024.v === null);

console.log("\n" + "=".repeat(44));
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log("=".repeat(44));
process.exit(failed ? 1 : 0);
