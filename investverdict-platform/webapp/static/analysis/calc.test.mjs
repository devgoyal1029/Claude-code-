/** Tests for the interactive-analysis layers.  node calc.test.mjs */
import { commonSizeForStatement, computeYoYForStatement, heatBg,
         classifyDirection, defaultBaseKey } from "./calc.mjs";
import { generateInsights } from "./insights.mjs";
import { alignPeers, canonicalKey } from "./peers.mjs";

let passed = 0, failed = 0;
const ok = (n, c) => c ? passed++ : (failed++, console.log("  FAIL:", n));
const near = (a, b, t = 0.05) => a != null && Math.abs(a - b) <= t;
const r = (line_item, values) => ({ line_item, values });

function companyA() {
  return {
    company_name: "Dabur India Ltd", units: "Crores", periods: ["FY2023", "FY2024", "FY2025"],
    income_statement: [
      r("Revenue from operations", { FY2023: 9000, FY2024: 9500, FY2025: 10000 }),
      r("Other Income", { FY2023: 200, FY2024: 200, FY2025: 200 }),
      r("Total Income", { FY2023: 9200, FY2024: 9700, FY2025: 10200 }),
      r("Cost of materials consumed", { FY2023: 5400, FY2024: 5600, FY2025: 6000 }),
      r("Other Expenses", { FY2023: 1800, FY2024: 1850, FY2025: 2000 }),
      r("Total Expenses", { FY2023: 7200, FY2024: 7450, FY2025: 8000 }),
      r("Profit before tax", { FY2023: 1700, FY2024: 1800, FY2025: 1900 }),
      r("Tax expense", { FY2023: 420, FY2024: 450, FY2025: 470 }),
      r("Profit for the year", { FY2023: 1280, FY2024: 1350, FY2025: 1430 }),
    ],
    balance_sheet: [
      r("Cash and cash equivalents", { FY2023: 800, FY2024: 900, FY2025: 1000 }),
      r("Trade receivables", { FY2023: 1000, FY2024: 1100, FY2025: 1400 }),
      r("Inventories", { FY2023: 900, FY2024: 950, FY2025: 1000 }),
      r("Total assets", { FY2023: 12000, FY2024: 13000, FY2025: 14000 }),
      r("Borrowings", { FY2023: 2000, FY2024: 1800, FY2025: 1500 }),
      r("Total equity", { FY2023: 9000, FY2024: 9800, FY2025: 10800 }),
      r("Total equity and liabilities", { FY2023: 12000, FY2024: 13000, FY2025: 14000 }),
    ],
    cash_flow: [
      r("Profit before tax", { FY2023: 1700, FY2024: 1800, FY2025: 1900 }),
      r("Net cash from operating activities", { FY2023: 1500, FY2024: 1600, FY2025: 1700 }),
      r("Cash and cash equivalents at the end of the year", { FY2023: 800, FY2024: 900, FY2025: 1000 }),
    ],
  };
}

// ---- Feature 1: selectable base ----
console.log("\n[base selection]");
ok("default IS base is revenue", defaultBaseKey("income_statement") === "revenue");
const csRev = commonSizeForStatement(companyA(), "income_statement", "revenue");
const cogsR = csRev.rows.find((x) => x.line_item.includes("Cost of materials"));
ok("COGS = 60% of revenue (default base)", near(cogsR.pct.FY2025, 60.0));
const csExp = commonSizeForStatement(companyA(), "income_statement", "total_expenses");
const cogsE = csExp.rows.find((x) => x.line_item.includes("Cost of materials"));
ok("COGS = 75% of total expenses (alt base)", near(cogsE.pct.FY2025, 75.0));
const csEq = commonSizeForStatement(companyA(), "balance_sheet", "total_equity");
const cashEq = csEq.rows.find((x) => x.line_item.includes("Cash"));
ok("Cash = 9.26% of total equity (alt BS base)", near(cashEq.pct.FY2025, 9.26, 0.05));
const csCfo = commonSizeForStatement(companyA(), "cash_flow", "cfo");
const cfoRow = csCfo.rows.find((x) => x.line_item.includes("operating activities"));
ok("CFO base self = 100%", near(cfoRow.pct.FY2025, 100.0));
ok("baseFound true for valid base", csRev.baseFound === true);
const csBad = commonSizeForStatement({ periods: ["FY2025"], income_statement: [r("X", { FY2025: 5 })] }, "income_statement", "revenue");
ok("missing base -> baseFound false & pct null",
   csBad.baseFound === false && csBad.rows[0].pct.FY2025 === null);

// ---- Feature 2: YoY ----
console.log("\n[YoY]");
const yoy = computeYoYForStatement(companyA(), "income_statement");
const rev = yoy.rows.find((x) => x.line_item.includes("Revenue"));
ok("first year YoY is null", rev.yoyPct.FY2023 === null);
ok("YoY abs FY2024 = 500", rev.yoyAbs.FY2024 === 500);
ok("YoY % FY2024 ≈ 5.56%", near(rev.yoyPct.FY2024, 5.56, 0.02));
const zeroPrior = computeYoYForStatement(
  { periods: ["FY2024", "FY2025"], income_statement: [r("Item", { FY2024: 0, FY2025: 10 })] }, "income_statement");
ok("zero prior -> 'n/m' (not NaN/Infinity)", zeroPrior.rows[0].yoyPct.FY2025 === "n/m");

// ---- Feature 4: heatmap ----
console.log("\n[heatmap]");
ok("PBT classified up_good (not 'tax')", classifyDirection("Profit before tax") === "up_good");
ok("Finance costs classified up_bad", classifyDirection("Finance costs") === "up_bad");
ok("revenue +10% -> green", heatBg("Revenue", 10, true).startsWith("rgba(58,210,159"));
ok("expenses +10% -> red", heatBg("Total Expenses", 10, true).startsWith("rgba(255,107,107"));
ok("heatmap disabled -> empty", heatBg("Revenue", 10, false) === "");
ok("n/m -> empty", heatBg("Revenue", "n/m", true) === "");

// ---- Feature 3: insights ----
console.log("\n[insights]");
const ins = generateInsights(companyA());
ok("4–6 insights produced", ins.length >= 4 && ins.length <= 6);
ok("revenue CAGR insight present", ins.some((i) => i.text.includes("CAGR")));
ok("receivables insight present", ins.some((i) => i.text.toLowerCase().includes("receivables")));
ok("no NaN/Infinity in any insight", !ins.some((i) => /NaN|Infinity/.test(i.text)));
ok("every insight has a direction", ins.every((i) => ["up", "down", "neutral"].includes(i.dir)));

// ---- Feature 5: peers ----
console.log("\n[peers]");
const companyB = {
  company_name: "Marico Ltd", units: "Crores", periods: ["FY2024", "FY2025"],
  income_statement: [
    r("Revenue from operations", { FY2024: 8000, FY2025: 8500 }),
    r("Cost of goods sold", { FY2024: 4000, FY2025: 4200 }),
    r("Profit for the year", { FY2024: 1100, FY2025: 1200 }),
  ],
  balance_sheet: [], cash_flow: [],
};
ok("canonicalKey aligns revenue labels",
   canonicalKey("Revenue from operations") === canonicalKey("Net Sales"));
const peer = alignPeers(companyA(), companyB, "income_statement", "revenue");
const prow = peer.rows.find((x) => x.key === "revenue");
ok("revenue aligned for both companies",
   near(prow.aPct.FY2025, 100) && near(prow.bPct.FY2025, 100));
const cogsPeer = peer.rows.find((x) => x.key === "cogs");
ok("COGS aligned A=60% B=49.4%",
   near(cogsPeer.aPct.FY2025, 60) && near(cogsPeer.bPct.FY2025, 49.41, 0.1));

console.log("\n" + "=".repeat(46));
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log("=".repeat(46));
process.exit(failed ? 1 : 0);
