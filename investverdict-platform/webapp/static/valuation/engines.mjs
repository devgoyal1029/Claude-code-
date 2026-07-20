/** Engines for DDM / Comps / Bank / IPO — pure. */
import { gordon, discountSeries, pv, capmKe, median, sensitivityGrid, axisAround } from "./common.mjs";
import { requireGrowthBelowRate, spreadInstability, ddmSuitability, sustainableGrowth,
         growthVsSustainable, peerSetChecks, ipoConsistency, collect, safeDiv } from "./validation-core.mjs";

/* ---------- DDM ---------- */
export function ddm(I) {
  // I: {d0, ke, gh, gs, n, form: gordon|two|h, payouts, roe, payout}
  const checks = collect(
    requireGrowthBelowRate(I.gs, I.ke, "stable growth", "Ke"),
    spreadInstability(I.ke, I.gs, "Ke − g"),
    ddmSuitability(I.payouts),
    growthVsSustainable(I.gh, sustainableGrowth(I.roe, I.payout)));
  let value = null, detail = [];
  if (I.d0 != null && I.ke != null && I.gs != null && I.gs < I.ke) {
    if (I.form === "gordon") {
      value = gordon(I.d0 * (1 + I.gs), I.ke, I.gs);
      detail = [`D1 = ${(I.d0 * (1 + I.gs)).toFixed(2)}; V = D1/(Ke−g)`];
    } else if (I.form === "two") {
      const n = I.n || 5; let pvv = 0; let d = I.d0;
      for (let t = 1; t <= n; t++) { d = d * (1 + I.gh); pvv += pv(d, I.ke, t); detail.push(`D${t}=${d.toFixed(2)}`); }
      const tv = gordon(d * (1 + I.gs), I.ke, I.gs);
      value = tv != null ? pvv + pv(tv, I.ke, n) : null;
    } else { // H-model
      const H = (I.n || 5) / 2;
      value = (I.d0 * (1 + I.gs) + I.d0 * H * (I.gh - I.gs)) / (I.ke - I.gs);
    }
  }
  // form-aware value function so the grid's base cell EQUALS the headline value
  const vFn = (ke, g) => {
    if (g >= ke) return null;
    if (I.form === "two") {
      const n = I.n || 5; let pvv = 0, d = I.d0;
      for (let t = 1; t <= n; t++) { d *= (1 + I.gh); pvv += pv(d, ke, t); }
      const tv = gordon(d * (1 + g), ke, g);
      return tv == null ? null : pvv + pv(tv, ke, n);
    }
    if (I.form === "h") return (I.d0 * (1 + g) + I.d0 * ((I.n || 5) / 2) * (I.gh - g)) / (ke - g);
    return gordon(I.d0 * (1 + g), ke, g);
  };
  const sens = sensitivityGrid(axisAround(I.ke, [-0.01, -0.005, 0, 0.005, 0.01]),
    axisAround(I.gs, [-0.01, -0.005, 0, 0.005, 0.01]), vFn);
  return { value, detail, checks, sens };
}

/* ---------- Comps ---------- */
export function comps(target, peers) {
  // peers: [{name, price, shares, netDebt, eps, ebitda, book, revenue}]
  // Negative/zero denominators -> n/m (a loss-maker has no meaningful P/E);
  // EV needs BOTH price and shares — never fall back to net debt alone.
  const pos = (x) => (x != null && Number.isFinite(x) && x > 0) ? x : null;
  const mult = (p) => {
    const mcap = (pos(p.price) && pos(p.shares)) ? p.price * p.shares : null;
    return {
      pe: safeDiv(pos(p.price), pos(p.eps)),
      pb: safeDiv(pos(p.price), pos(safeDiv(p.book, p.shares))),
      evEbitda: safeDiv(mcap != null ? mcap + (p.netDebt || 0) : null, pos(p.ebitda)),
      ps: safeDiv(mcap, pos(p.revenue)),
    };
  };
  const rows = peers.map((p) => ({ name: p.name, ...mult(p) }));
  const med = { pe: median(rows.map((r) => r.pe)), pb: median(rows.map((r) => r.pb)),
    evEbitda: median(rows.map((r) => r.evEbitda)), ps: median(rows.map((r) => r.ps)) };
  const meanOf = (a) => { const v = a.filter((x) => x != null && x > 0); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
  const mean = { pe: meanOf(rows.map((r) => r.pe)), pb: meanOf(rows.map((r) => r.pb)),
    evEbitda: meanOf(rows.map((r) => r.evEbitda)), ps: meanOf(rows.map((r) => r.ps)) };
  const implied = {};
  if (med.pe != null && target.eps != null) implied["P/E"] = med.pe * target.eps;
  if (med.pb != null && target.book != null && target.shares) implied["P/B"] = med.pb * target.book / target.shares;
  if (med.evEbitda != null && target.ebitda != null && target.shares)
    implied["EV/EBITDA"] = (med.evEbitda * target.ebitda - (target.netDebt || 0)) / target.shares;
  if (med.ps != null && target.revenue != null && target.shares)
    implied["P/S"] = med.ps * target.revenue / target.shares;
  const checks = collect(peerSetChecks(rows.map((r) => r.pe), "P/E"), peerSetChecks(rows.map((r) => r.evEbitda), "EV/EBITDA"));
  return { rows, med, mean, implied, checks };
}

/* ---------- Bank (Excess Return) ---------- */
export function bank(I) {
  // I: {bv0, ke, roePath[], payout, gs, fadeToKe}
  const checks = collect(requireGrowthBelowRate(I.gs, I.ke, "stable growth", "Ke"), spreadInstability(I.ke, I.gs));
  let bv = I.bv0, pvSum = 0, rows = [];
  const n = I.roePath.length;
  for (let t = 1; t <= n; t++) {
    const roe = I.roePath[t - 1];
    const ni = roe * bv, div = ni * I.payout;
    const er = (roe - I.ke) * bv;
    const p = pv(er, I.ke, t);
    rows.push({ t, bv, roe, ni, er, pv: p });
    pvSum += p; bv = bv + ni - div;
  }
  let tv = 0;
  if (!I.fadeToKe && I.gs < I.ke) {
    const roeS = I.roePath[n - 1];
    tv = pv((roeS - I.ke) * bv / (I.ke - I.gs), I.ke, n) || 0;
  }
  const value = I.bv0 + pvSum + tv;
  const justifiedPB = (I.gs < I.ke) ? (I.roePath[n - 1] - I.gs) / (I.ke - I.gs) : null;
  const sens = sensitivityGrid(axisAround(I.ke, [-0.01, -0.005, 0, 0.005, 0.01]), axisAround(I.roePath[n - 1], [-0.02, -0.01, 0, 0.01, 0.02]),
    (ke, roe) => { let b = I.bv0, s = 0;
      for (let t = 1; t <= n; t++) { s += pv((roe - ke) * b, ke, t); b += roe * b * (1 - I.payout); }
      const tvx = (!I.fadeToKe && I.gs < ke) ? pv((roe - ke) * b / (ke - I.gs), ke, n) : 0;  // same TV as base
      return I.bv0 + s + (tvx || 0); });
  return { value, rows, tv, justifiedPB, checks, sens };
}

/* ---------- IPO ---------- */
export function ipo(I) {
  // I: {bandLow, bandHigh, freshIssue, ofs, preShares, postShares, eps, ebitda, netDebt, peerPE, peerEvEbitda, dcfValue}
  const checks = collect(ipoConsistency(I));
  const freshShares = (I.postShares != null && I.preShares != null) ? I.postShares - I.preShares : null;
  const dilution = safeDiv(freshShares, I.postShares);
  const at = (px) => ({
    mcap: px * I.postShares,
    pe: safeDiv(px, I.eps),
    evEbitda: safeDiv(px * I.postShares + (I.netDebt || 0), I.ebitda),
  });
  const low = I.bandLow != null ? at(I.bandLow) : null, high = I.bandHigh != null ? at(I.bandHigh) : null;
  const rl = safeDiv(low ? low.pe : null, I.peerPE > 0 ? I.peerPE : null);
  const rh = safeDiv(high ? high.pe : null, I.peerPE > 0 ? I.peerPE : null);
  const premLow = rl == null ? null : rl - 1, premHigh = rh == null ? null : rh - 1;
  return { freshShares, dilution, low, high, premLow, premHigh, dcfValue: I.dcfValue ?? null, checks };
}
