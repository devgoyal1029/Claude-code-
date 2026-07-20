/** Stage 1 tests — shared valuation modules.  node stage1.test.mjs */
import { capmKe, afterTaxKd, waccOf, releverBeta, pv, discountSeries, gordon,
         sensitivityGrid, axisAround, median } from "./common.mjs";
import { safeDiv, checkRange, requireGrowthBelowRate, spreadInstability,
         indiaWaccFloor, ddmSuitability, sustainableGrowth, growthVsSustainable,
         dataConsistency, peerSetChecks, ipoConsistency, collect, hasFail } from "./validation-core.mjs";
import { recommend, mismatchWarning, MODELS } from "./selector.mjs";

let passed = 0, failed = 0;
const ok = (n, c) => c ? passed++ : (failed++, console.log("  FAIL:", n));
const near = (a, b, t = 1e-6) => a != null && Math.abs(a - b) <= t;

console.log("\n[common math]");
ok("CAPM: 7% + 1.2×7.5% = 16%", near(capmKe(0.07, 1.2, 0.075), 0.16));
ok("after-tax Kd: 10%×(1−25%) = 7.5%", near(afterTaxKd(0.10, 0.25), 0.075));
ok("WACC: E590 D200 Ke14.5% Kd7.5% ≈ 12.728%", near(waccOf(590, 200, 0.145, 0.075), (590/790)*0.145 + (200/790)*0.075));
ok("Hamada: βU 0.8, D/E 0.5, t 25% → 1.1", near(releverBeta(0.8, 100, 200, 0.25), 0.8 * (1 + 0.5 * 0.75)));
ok("PV: 110 @10% t=1 → 100", near(pv(110, 0.10, 1), 100));
const ds = discountSeries([110, 121], 0.10);
ok("discountSeries totals 200", near(ds.total, 200));
ok("gordon: 105/(0.10−0.05) = 2100", near(gordon(105, 0.10, 0.05), 2100));
ok("gordon r<=g → null (never Infinity)", gordon(100, 0.05, 0.05) === null && gordon(100, 0.04, 0.05) === null);
const grid = sensitivityGrid(axisAround(0.12, [-0.01, 0, 0.01]), axisAround(0.04, [-0.005, 0, 0.005]), (w, g) => gordon(100, w, g));
ok("sensitivity grid 3×3 with centre base", grid.grid.length === 3 && grid.baseRow === 1 && grid.baseCol === 1);
ok("grid cell where r<=g is null", sensitivityGrid([0.04], [0.05], (w, g) => gordon(100, w, g)).grid[0][0] === null);
ok("median ignores nulls, odd/even", median([3, null, 1, 2]) === 2 && median([1, 2, 3, 4]) === 2.5);

console.log("\n[validation-core]");
ok("safeDiv by zero → null", safeDiv(5, 0) === null && safeDiv(null, 3) === null);
ok("hard range: tax 1.5 fails", hasFail(checkRange(1.5, { label: "Tax", pct: true, hardMin: 0, hardMax: 1 })));
ok("soft range: warns, not fails", (() => { const c = checkRange(0.30, { label: "Rf", pct: true, min: 0.04, max: 0.09 }); return c.length === 1 && c[0].level === "warn"; })());
ok("g >= Ke hard-fails", hasFail(requireGrowthBelowRate(0.12, 0.12)));
ok("g < Ke passes", requireGrowthBelowRate(0.04, 0.12).length === 0);
ok("thin Ke−g spread warns", spreadInstability(0.10, 0.09).length === 1);
ok("healthy spread silent", spreadInstability(0.14, 0.04).length === 0);
ok("India WACC floor warns at 8%", indiaWaccFloor(0.08).length === 1);
ok("DDM unsuitable on 2 thin payouts", ddmSuitability([0.05, 0.12]).length === 1);
ok("DDM ok on 3 real payouts", ddmSuitability([0.3, 0.35, 0.4]).length === 0);
ok("sustainable g = ROE×(1−payout)", near(sustainableGrowth(0.18, 0.4), 0.108));
ok("g above sustainable warns", growthVsSustainable(0.15, 0.108).length === 1);
ok("data breaks surfaced from model.checks", dataConsistency({ checks: [{ status: "fail", name: "Balance sheet balances", detail: "FY26: off by 12" }] }).length >= 2);
ok("clean model → no data warnings", dataConsistency({ checks: [{ status: "pass", name: "x", detail: "" }] }).length === 0);
ok("peer set <3 warns", peerSetChecks([12, 15]).length >= 1);
ok(">2× peer dispersion warns", peerSetChecks([10, 12, 25]).some((c) => /2×/.test(c.msg)));
ok("IPO: band low > high fails", hasFail(ipoConsistency({ bandLow: 100, bandHigh: 90 })));
ok("IPO: shares shrink fails", hasFail(ipoConsistency({ freshIssue: 100, preShares: 100, postShares: 90 })));
ok("IPO: 40% dilution warns", ipoConsistency({ freshIssue: 1, preShares: 60, postShares: 100 }).some((c) => c.level === "warn"));
ok("collect: fails sort first, dedup", (() => { const c = collect([{ level: "warn", msg: "a" }], [{ level: "fail", msg: "b" }, { level: "warn", msg: "a" }]); return c.length === 2 && c[0].level === "fail"; })());

console.log("\n[selector]");
ok("5 models defined", MODELS.length === 5);
const bank = recommend({ financial: true, dividends: true });
ok("financial → bank + ddm + comps", ["bank", "ddm", "comps"].every((k) => bank.recommended.includes(k)));
ok("financial does NOT recommend dcf", !bank.recommended.includes("dcf"));
const ipo = recommend({ ipo: true });
ok("ipo → ipo + comps", ipo.recommended.includes("ipo") && ipo.recommended.includes("comps"));
const plain = recommend({ financial: false, ipo: false, dividends: false });
ok("plain company → dcf + comps, no ddm", plain.recommended.includes("dcf") && !plain.recommended.includes("ddm"));
ok("DCF-for-bank mismatch warns & teaches", /raw material/i.test(mismatchWarning("dcf", { financial: true }) || ""));
ok("DDM-for-non-payer mismatch warns", mismatchWarning("ddm", { dividends: false }) != null);
ok("no false mismatch on a good pick", mismatchWarning("dcf", { financial: false }) === null);

console.log("\n" + "=".repeat(44));
console.log(`PASSED: ${passed}   FAILED: ${failed}`);
console.log("=".repeat(44));
process.exit(failed ? 1 : 0);
