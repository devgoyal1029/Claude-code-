/**
 * Tests for common-size + linking logic.  node webapp/static/analysis/commonsize.test.mjs
 */
import { computeCommonSize, computeLinks, linksTieOut } from "./commonsize.mjs";

let passed = 0, failed = 0;
const ok = (n, c) => c ? passed++ : (failed++, console.log("  FAIL:", n));
const near = (a, b, t = 0.05) => a != null && Math.abs(a - b) <= t;

function tieOutData() {
  return {
    company_name: "Toy Co Ltd", units: "Crores", periods: ["FY2024", "FY2025"],
    income_statement: [
      r("Revenue from Operations", { FY2024: 900, FY2025: 1000 }),
      r("Cost of materials consumed", { FY2024: 540, FY2025: 600 }),
      r("Other Expenses", { FY2024: 180, FY2025: 200 }),
      r("Profit Before Tax", { FY2024: 117, FY2025: 130 }),
      r("Tax expense", { FY2024: 29.25, FY2025: 32.5 }),
      r("Profit for the year", { FY2024: 87.75, FY2025: 97.5 }),
    ],
    balance_sheet: [
      r("Cash and Cash Equivalents", { FY2024: 90, FY2025: 100 }),
      r("Total Assets", { FY2024: 800, FY2025: 870 }),
      r("Reserves and Surplus", { FY2024: 192.5, FY2025: 290 }),
    ],
    cash_flow: [
      r("Profit before tax", { FY2024: 117, FY2025: 130 }),
      r("Cash and cash equivalents at the end", { FY2024: 90, FY2025: 100 }),
    ],
  };
}
const r = (line_item, values) => ({ line_item, values });

// ---- common-size ----
console.log("\n[common-size]");
const cs = computeCommonSize(tieOutData());
ok("no base flags (revenue + total assets found)", cs.flags.length === 0);
const cogs = cs.sections.income_statement.rows.find((x) => x.line_item.includes("Cost of materials"));
ok("COGS = 60.0% of revenue (FY2025)", near(cogs.pct.FY2025, 60.0));
const ni = cs.sections.income_statement.rows.find((x) => x.line_item === "Profit for the year");
ok("Net profit = 9.75% of revenue (FY2025)", near(ni.pct.FY2025, 9.75));
const cashBS = cs.sections.balance_sheet.rows.find((x) => x.line_item.includes("Cash"));
ok("Cash = 11.49% of total assets (FY2025)", near(cashBS.pct.FY2025, 11.49, 0.02));
const cfCash = cs.sections.cash_flow.rows.find((x) => x.line_item.includes("end"));
ok("CF closing cash = 10.0% of revenue (FY2025)", near(cfCash.pct.FY2025, 10.0));

// division-by-zero / missing base handling
const noBase = computeCommonSize({ periods: ["FY2025"], income_statement: [
  r("Some Expense", { FY2025: 50 })], balance_sheet: [], cash_flow: [] });
ok("missing revenue base -> flag raised", noBase.flags.some((f) => f.includes("Revenue")));
ok("missing base -> pct is null (not NaN)",
   noBase.sections.income_statement.rows[0].pct.FY2025 === null);

// ---- linking: tie-out ----
console.log("\n[linking — tie out]");
const L = computeLinks(tieOutData());
const fails = L.checks.filter((c) => c.status === "fail");
ok("no link FAILs on clean data", fails.length === 0);
ok("linksTieOut() == true", linksTieOut(L) === true);
ok("Link 1 (RE) present & passes",
   L.checks.some((c) => c.link_name.includes("Retained earnings") && c.status === "pass"));
ok("Link 2 (cash ties) passes FY2025",
   L.checks.some((c) => c.link_name.includes("Cash ties") && c.year === "FY2025" && c.status === "pass"));
ok("Link 3 (PBT -> CFO) passes",
   L.checks.some((c) => c.link_name.includes("PBT") && c.status === "pass"));

// ---- linking: broken ----
console.log("\n[linking — broken, must FAIL]");
const broken = tieOutData();
broken.balance_sheet = broken.balance_sheet.map((x) =>
  x.line_item.includes("Cash") ? r("Cash and Cash Equivalents", { FY2024: 90, FY2025: 120 }) : x);
const LB = computeLinks(broken);
const cashFail = LB.checks.find((c) => c.link_name.includes("Cash ties") && c.year === "FY2025");
ok("cash mismatch -> Link 2 FAILs", cashFail && cashFail.status === "fail");
ok("difference reported = 20", cashFail && Math.abs(cashFail.difference) === 20);
ok("linksTieOut() == false on broken", linksTieOut(LB) === false);
console.log("  -> break:", cashFail ? `${cashFail.link_name} ${cashFail.year}: CFS ${cashFail.expected} vs BS ${cashFail.actual} (diff ${cashFail.difference})` : "(none)");

console.log("\n" + "=".repeat(46));
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log("=".repeat(46));
process.exit(failed ? 1 : 0);
