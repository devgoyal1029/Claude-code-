/**
 * validation-core — shared validation for ALL valuation models. PURE, no DOM.
 *
 * Philosophy (per spec):
 *  - HARD failures only for mathematical impossibilities (g >= Ke, tax > 100%…)
 *  - SOFT warnings for judgement calls, always plain-language + where to verify
 *  - Numerical safety: divide-by-zero -> null ("n/m"), never NaN/Infinity
 *  - Data-consistency: surface breaks in the carried-forward statements INSIDE
 *    valuation screens ("your underlying data has a break")
 *
 * A check = { level: "fail"|"warn", msg }
 */

export const fail = (msg) => ({ level: "fail", msg });
export const warn = (msg) => ({ level: "warn", msg });

/** Safe division: null when denominator is missing/zero or inputs invalid. */
export function safeDiv(n, d) {
  if (n == null || d == null) return null;
  const N = Number(n), D = Number(d);
  if (!Number.isFinite(N) || !Number.isFinite(D) || D === 0) return null;
  const r = N / D;
  return Number.isFinite(r) ? r : null;
}

/** Clamp-check a numeric input against a spec. Returns checks (possibly empty).
 *  spec: { label, min, max, hardMin, hardMax, where } — hard bounds block. */
export function checkRange(value, spec) {
  const out = [];
  const v = Number(value);
  if (value == null || Number.isNaN(v)) return out;      // absent = no check
  if (spec.hardMin != null && v < spec.hardMin)
    out.push(fail(`${spec.label} can't be below ${fmtBound(spec.hardMin, spec)} — that's mathematically invalid.`));
  if (spec.hardMax != null && v > spec.hardMax)
    out.push(fail(`${spec.label} can't exceed ${fmtBound(spec.hardMax, spec)} — that's mathematically invalid.`));
  if (spec.min != null && v < spec.min)
    out.push(warn(`${spec.label} looks low (${fmtBound(v, spec)}). Typical band starts around ${fmtBound(spec.min, spec)}.${whereNote(spec)}`));
  if (spec.max != null && v > spec.max)
    out.push(warn(`${spec.label} looks high (${fmtBound(v, spec)}). Typical band tops out around ${fmtBound(spec.max, spec)}.${whereNote(spec)}`));
  return out;
}
const fmtBound = (v, spec) => spec.pct ? (v * 100).toFixed(1) + "%" : String(v);
const whereNote = (spec) => spec.where ? ` Verify in: ${spec.where}.` : "";

/** HARD: growth must be strictly below the discount rate. */
export function requireGrowthBelowRate(g, rate, gName = "terminal growth", rateName = "the discount rate") {
  if (g == null || rate == null) return [];
  if (g >= rate) return [fail(`${cap(gName)} (${(g * 100).toFixed(1)}%) must be LESS than ${rateName} (${(rate * 100).toFixed(1)}%) — otherwise the perpetuity value is infinite/meaningless. Lower growth or raise the rate.`)];
  return [];
}

/** SOFT: near-zero spread (Ke−g / WACC−g) makes the value explode — force caution. */
export function spreadInstability(rate, g, name = "Ke − g") {
  if (rate == null || g == null || g >= rate) return [];
  const spread = rate - g;
  if (spread < 0.02)
    return [warn(`The spread ${name} is only ${(spread * 100).toFixed(1)} percentage points. The valuation is EXTREMELY sensitive here — a 0.5% input change can swing the answer hugely. Read the sensitivity table as the answer, not the single number.`)];
  return [];
}

/** SOFT: India WACC floor — INR cash flows rarely justify a sub-10–11% WACC. */
export function indiaWaccFloor(wacc) {
  if (wacc == null) return [];
  if (wacc < 0.10)
    return [warn(`WACC of ${(wacc * 100).toFixed(1)}% looks low for Indian rupee cash flows (defensible range is usually ~12–18%). Re-check the risk-free rate (10Y G-Sec ~7%), equity risk premium (~7–8% for India) and beta.`)];
  return [];
}

/** DDM suitability: needs a real dividend history. payouts = array of payout ratios. */
export function ddmSuitability(payouts) {
  const meaningful = (payouts || []).filter((p) => p != null && p > 0.10);
  if (meaningful.length < 3)
    return [warn("DDM is unsuitable here — the company barely pays dividends (payout under ~10% or too short a history). Professionals would use DCF or comparables instead; results below are for learning only.")];
  return [];
}

/** Sustainable growth cross-check: g_implied = ROE × (1 − payout). */
export function sustainableGrowth(roe, payout) {
  if (roe == null || payout == null) return null;
  return roe * (1 - payout);
}
export function growthVsSustainable(g, gSustainable) {
  if (g == null || gSustainable == null) return [];
  if (g > gSustainable + 0.02)
    return [warn(`Your growth ${(g * 100).toFixed(1)}% is above the sustainable growth the company's own economics imply (ROE × (1 − payout) ≈ ${(gSustainable * 100).toFixed(1)}%). Growth beyond that needs new capital or better returns — check the MD&A for a reason.`)];
  return [];
}

/** Data-consistency: surface FAILs from the carried-forward model's checks. */
export function dataConsistency(model) {
  const fails = ((model && model.checks) || []).filter((c) => c.status === "fail");
  if (!fails.length) return [];
  return [warn(`Your underlying statements have ${fails.length} unresolved break(s) (e.g. "${fails[0].name}"). Any valuation built on them may be wrong — fix the data on the Analysis/Forecast screens first.`),
    ...fails.slice(0, 3).map((c) => warn(`Data break — ${c.name}: ${c.detail}`))];
}

/** Peer-set checks for comps. multiples = array of numbers (nulls allowed). */
export function peerSetChecks(multiples, label = "multiple") {
  const out = [];
  const clean = (multiples || []).filter((m) => m != null && Number.isFinite(m) && m > 0);
  if (clean.length < 3)
    out.push(warn(`Fewer than 3 usable peers for this ${label} — the median is fragile. Add peers from the same sector with similar size/margins.`));
  if (clean.length >= 2) {
    const mn = Math.min(...clean), mx = Math.max(...clean);
    if (mx > 2 * mn)
      out.push(warn(`Peer ${label}s range from ${mn.toFixed(1)}× to ${mx.toFixed(1)}× (more than 2× apart) — the peer set may be inconsistent (mixing different business models). Reconsider the selection.`));
  }
  return out;
}

/** IPO mechanics consistency. */
export function ipoConsistency({ bandLow, bandHigh, freshIssue, postShares, preShares }) {
  const out = [];
  if (bandLow != null && bandHigh != null && bandLow > bandHigh)
    out.push(fail("Price band low must be ≤ band high."));
  if (postShares != null && postShares <= 0) out.push(fail("Post-issue share count must be positive."));
  if (freshIssue != null && postShares != null && preShares != null) {
    const freshShares = postShares - preShares;
    if (freshShares < 0) out.push(fail("Post-issue shares are fewer than pre-issue shares — fresh issue can't remove shares (OFS doesn't create new shares). Recheck the RHP capital-structure section."));
    else if (postShares > 0) {
      const dilution = freshShares / postShares;
      if (dilution > 0.35)
        out.push(warn(`Dilution of ${(dilution * 100).toFixed(0)}% is unusually high (typical IPOs stay under ~35%). Recheck fresh-issue size vs post-issue shares in the RHP.`));
    }
  }
  return out;
}

/** Merge + de-duplicate check lists. */
export function collect(...lists) {
  const seen = new Set(); const out = [];
  for (const l of lists) for (const c of (l || [])) {
    if (!c || seen.has(c.msg)) continue;
    seen.add(c.msg); out.push(c);
  }
  // fails first
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "fail" ? -1 : 1));
}
export const hasFail = (checks) => (checks || []).some((c) => c.level === "fail");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
