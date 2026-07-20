/** DCF engine tests.  node dcf.test.mjs */
import { seedInputs, fcffSeries, computeDCF } from "./dcf.mjs";

let passed = 0, failed = 0;
const ok = (n, c) => c ? passed++ : (failed++, console.log("  FAIL:", n));
const near = (a, b, t) => a != null && Math.abs(a - b) <= t;

// model with 3 forecast years carrying ebit, D&A, capex, ΔWC
const model = {
  company_name: "Test Co", units: "Crores",
  periods: ["FY2025", "FY2026", "FY2027", "FY2028"],
  historicalPeriods: ["FY2025"], forecastPeriods: ["FY2026", "FY2027", "FY2028"],
  assumptions: { tax_rate: 0.25 },
  years: {
    FY2025: { long_term_debt: 200, short_term_debt: 0, cash: 100, total_equity: 590, interest_expense: 20 },
    FY2026: { _isForecast: true, _assumptions: { tax_rate: 0.25 }, ebit: 165, depreciation_amortisation: 55, capex: 55, change_in_working_capital: 10, ebitda: 220 },
    FY2027: { _isForecast: true, _assumptions: { tax_rate: 0.25 }, ebit: 180, depreciation_amortisation: 60, capex: 60, change_in_working_capital: 11, ebitda: 240 },
    FY2028: { _isForecast: true, _assumptions: { tax_rate: 0.25 }, ebit: 198, depreciation_amortisation: 66, capex: 66, change_in_working_capital: 12, ebitda: 264 },
  },
};

console.log("\n[seed + FCFF]");
const I = seedInputs(model);
ok("seeded debt = 200 from balance sheet", I.debt === 200);
ok("seeded cash = 100", I.cash === 100);
ok("seeded Kd = 20/200 = 0.10", near(I.kd, 0.10, 0.001));
const s = fcffSeries(model, 0.25);
// FY2026 FCFF = 165*0.75 + 55 - 55 - 10 = 123.75 - 10 = 113.75
ok("FCFF FY2026 = 113.75", near(s[0].fcff, 113.75, 0.01));

console.log("\n[WACC]");
// E (book) = 590, D = 200, V = 790 ; Ke = .07 + 1*.075 = .145 ; Kd_after = .10*.75 = .075
// WACC = (590/790)*.145 + (200/790)*.075 = .10829 + .018987 = .12728
const d = computeDCF(model, { ...I, price: null, shares: null });
ok("Ke = 14.5%", near(d.ke, 0.145, 0.001));
ok("Kd after-tax = 7.5%", near(d.kdAfter, 0.075, 0.001));
ok("WACC ≈ 12.73%", near(d.wacc, 0.1273, 0.002));
ok("g(4.5%) < WACC -> valid", d.gValid === true);

console.log("\n[valuation]");
ok("Enterprise Value computed (positive)", d.ev > 0);
ok("Equity Value = EV − 200 + 100", near(d.equityValue, d.ev - 200 + 100, 0.01));
ok("no shares -> fairValue null (not NaN)", d.fairValue === null);
const d2 = computeDCF(model, { ...I, price: 50, shares: 100 });
ok("with shares -> fairValue per share computed", d2.fairValue != null && Number.isFinite(d2.fairValue));
ok("upside computed vs price", d2.upside != null && Number.isFinite(d2.upside));

console.log("\n[guards]");
const dLow = computeDCF(model, { ...I, rf: 0.02, erp: 0.03, beta: 0.5 });
ok("low WACC -> amber warning", dLow.warnings.some((w) => /low for Indian/i.test(w)));
const dBadG = computeDCF(model, { ...I, g: 0.20 });   // g > WACC
ok("g > WACC -> warning + no fair value", dBadG.warnings.some((w) => /must be LESS than WACC/i.test(w)) && dBadG.ev == null);

console.log("\n[sensitivity]");
ok("sensitivity grid is 5x5", d2.sensitivity.grid.length === 5 && d2.sensitivity.grid[0].length === 5);
ok("base cell (centre) is finite", Number.isFinite(d2.sensitivity.grid[2][2]));

console.log("\n" + "=".repeat(44));
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log("=".repeat(44));
process.exit(failed ? 1 : 0);
