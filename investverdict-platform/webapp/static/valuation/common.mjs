/**
 * Shared valuation math — PURE. Used by DDM / Comps / Bank / IPO engines.
 * (The existing DCF engine keeps its own internals — per spec we wrap shared
 * concepts here rather than rewriting a working screen.)
 */

import { safeDiv } from "./validation-core.mjs";

/** CAPM cost of equity: Ke = Rf + β × ERP. */
export function capmKe(rf, beta, erp) {
  if (rf == null || beta == null || erp == null) return null;
  return rf + beta * erp;
}

/** After-tax cost of debt. */
export function afterTaxKd(kd, tax) {
  if (kd == null || tax == null) return null;
  return kd * (1 - tax);
}

/** WACC from components. */
export function waccOf(E, D, ke, kdAfter) {
  const V = (E || 0) + (D || 0);
  if (!V || ke == null || kdAfter == null) return null;
  return (E / V) * ke + (D / V) * kdAfter;
}

/** Hamada relevering: β_L = β_U × [1 + (D/E)(1 − tax)]. */
export function releverBeta(betaU, D, E, tax) {
  const de = safeDiv(D, E);
  if (betaU == null || de == null || tax == null) return null;
  return betaU * (1 + de * (1 - tax));
}

/** PV of a single cash flow at time t. */
export function pv(cf, r, t) {
  if (cf == null || r == null || r <= -1) return null;
  return cf / Math.pow(1 + r, t);
}

/** Discount a series [cf1..cfn] (t = 1..n). Returns {pvs, total} or null on gaps. */
export function discountSeries(cfs, r) {
  if (!Array.isArray(cfs) || !cfs.length || r == null) return null;
  const pvs = [];
  let total = 0;
  for (let i = 0; i < cfs.length; i++) {
    const p = pv(cfs[i], r, i + 1);
    if (p == null) return null;
    pvs.push(p); total += p;
  }
  return { pvs, total };
}

/** Gordon perpetuity: CF_next / (r − g). Null (never Infinity) when r <= g. */
export function gordon(cfNext, r, g) {
  if (cfNext == null || r == null || g == null || r <= g) return null;
  return cfNext / (r - g);
}

/** Generalised 2-way sensitivity grid.
 *  rows/cols: arrays of axis values; fn(row, col) -> number|null.
 *  Returns { rows, cols, grid, baseRow, baseCol } (base = centre index). */
export function sensitivityGrid(rows, cols, fn) {
  const grid = rows.map((r) => cols.map((c) => {
    const v = fn(r, c);
    return (v != null && Number.isFinite(v)) ? v : null;
  }));
  return { rows, cols, grid, baseRow: Math.floor(rows.length / 2), baseCol: Math.floor(cols.length / 2) };
}

/** Symmetric axis around a base value: base ± steps. */
export function axisAround(base, steps) {
  return steps.map((d) => base + d);
}

/** Median of a numeric array (nulls ignored). Median > mean for peer multiples
 *  because one crazy peer shouldn't drag the answer — teach this in the UI. */
export function median(arr) {
  const a = (arr || []).filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export const fmtINR = (v, dp = 1) =>
  v == null ? "-" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: dp });
export const fmtPct = (v, dp = 1) => v == null ? "-" : (v * 100).toFixed(dp) + "%";
