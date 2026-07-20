/**
 * DCF valuation engine — PURE. Consumes the forecast model (forecast years carry
 * EBIT, D&A, capex, ΔWorking-capital). Computes FCFF, India-aware WACC, terminal
 * value, discounted EV, equity bridge to fair value/share, and a WACC × g
 * sensitivity grid. Robust: missing/zero -> null; never NaN/Infinity.
 */

const num = (x) => (x == null || Number.isNaN(Number(x)) ? null : Number(x));
const sumOpt = (...a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) : null; };

/** Sensible, India-aware default inputs derived from the model. */
export function seedInputs(model) {
  const hist = model.historicalPeriods && model.historicalPeriods.length
    ? model.historicalPeriods : model.periods.filter((p) => !(model.forecastPeriods || []).includes(p));
  const last = hist[hist.length - 1] || model.periods[0];
  const y = model.years[last] || {};
  const g = (k) => num(y[k]);
  const debt = sumOpt(g("long_term_debt"), g("short_term_debt")) ?? 0;
  const cash = g("cash") ?? 0;
  const equityBook = g("total_equity") ?? sumOpt(g("share_capital"), g("retained_earnings")) ?? 0;
  const interest = g("interest_expense");
  const kd = (interest != null && debt > 0) ? Math.max(0, Math.min(0.3, interest / debt)) : 0.09;
  const tax = (model.assumptions && model.assumptions.tax_rate != null) ? model.assumptions.tax_rate : 0.25;
  return {
    rf: 0.07, erp: 0.075, beta: 1.0,        // India-typical: Rf ~7%, ERP ~7.5%
    kd, tax,
    g: 0.045,                                // terminal growth ~ inflation/GDP, < WACC
    debt, cash, equityBook,
    minority: 0, preferred: 0,
    price: null, shares: null,               // user enters for the final comparison
    tvMethod: "gordon", exitMultiple: 12,
  };
}

/** FCFF for each forecast year = EBIT×(1−t) + D&A − Capex − ΔNWC. */
export function fcffSeries(model, tax) {
  const fps = model.forecastPeriods || [];
  return fps.map((p) => {
    const y = model.years[p] || {};
    const ebit = num(y.ebit), dep = num(y.depreciation_amortisation), capex = num(y.capex);
    const dwc = num(y.change_in_working_capital) ?? 0;
    if (ebit == null) return { period: p, fcff: null };
    const nopat = ebit * (1 - tax);
    const fcff = nopat + (dep || 0) - (capex || 0) - dwc;
    return { period: p, fcff, nopat, dep: dep || 0, capex: capex || 0, dwc, ebitda: num(y.ebitda) };
  });
}

export function computeDCF(model, I) {
  const fps = model.forecastPeriods || [];
  const n = fps.length;
  const series = fcffSeries(model, I.tax);
  const fcff = series.map((s) => s.fcff);

  // capital structure: equity = market cap if price×shares given, else book equity
  const marketCap = (I.price != null && I.shares != null) ? I.price * I.shares : null;
  const E = marketCap != null ? marketCap : I.equityBook;
  const D = I.debt || 0;
  const V = E + D;
  const wE = V ? E / V : 1, wD = V ? D / V : 0;

  const ke = I.rf + I.beta * I.erp;
  const kdAfter = I.kd * (1 - I.tax);
  const wacc = wE * ke + wD * kdAfter;

  const warnings = [];
  if (wacc < 0.10) warnings.push("WACC looks low for Indian cash flows (< 10%). Re-check the risk-free rate, equity risk premium and beta — Indian INR cash flows usually warrant ~12–18%.");
  if (I.tax < 0 || I.tax > 1) warnings.push("Tax rate should be between 0 and 100%.");
  const gValid = I.g < wacc;
  if (!gValid) warnings.push("Terminal growth (g) must be LESS than WACC, otherwise the terminal value is meaningless. Lower g or raise WACC.");

  const lastFcff = n ? fcff[n - 1] : null;
  const lastEbitda = n ? series[n - 1].ebitda : null;

  // value per share at a given (wacc, g) — used for the base case and sensitivity
  function valueAt(w, g) {
    if (!n || lastFcff == null) return null;
    let pv = 0;
    for (let t = 1; t <= n; t++) {
      if (fcff[t - 1] == null) return null;
      pv += fcff[t - 1] / Math.pow(1 + w, t);
    }
    let tv;
    if (I.tvMethod === "exit") tv = (lastEbitda != null) ? lastEbitda * I.exitMultiple : null;
    else tv = (w > g) ? lastFcff * (1 + g) / (w - g) : null;
    if (tv == null) return null;
    const pvTv = tv / Math.pow(1 + w, n);
    const ev = pv + pvTv;
    const equity = ev - D - (I.minority || 0) - (I.preferred || 0) + (I.cash || 0);
    return { pvFcffTotal: pv, tv, pvTv, ev, equity, perShare: I.shares ? equity / I.shares : null };
  }

  const base = (gValid || I.tvMethod === "exit") ? valueAt(wacc, I.g) : null;

  // per-year PV breakdown for the table/waterfall
  const rows = series.map((s, i) => {
    const t = i + 1;
    const df = Math.pow(1 + wacc, t);
    const pv = s.fcff != null ? s.fcff / df : null;
    return { period: s.period, fcff: s.fcff, t, discountFactor: 1 / df, pv };
  });

  // sensitivity grid: WACC (rows) × terminal growth g (cols)
  const waccSteps = [-0.015, -0.0075, 0, 0.0075, 0.015].map((d) => wacc + d);
  const gSteps = [-0.01, -0.005, 0, 0.005, 0.01].map((d) => I.g + d);
  const sensitivity = {
    waccs: waccSteps, gs: gSteps,
    grid: waccSteps.map((w) => gSteps.map((g) => {
      const r = valueAt(w, g);
      return r ? (I.shares ? r.perShare : r.equity) : null;
    })),
    perShare: !!I.shares,
  };

  const fairValue = base ? base.perShare : null;
  const upside = (fairValue != null && I.price) ? fairValue / I.price - 1 : null;

  return {
    fcff: series, rows, n,
    ke, kdAfter, wacc, weights: { E, D, V, wE, wD }, marketCap,
    tv: base ? base.tv : null, pvTv: base ? base.pvTv : null, pvFcffTotal: base ? base.pvFcffTotal : null,
    ev: base ? base.ev : null, equityValue: base ? base.equity : null,
    fairValue, upside, sensitivity, warnings, gValid,
    inputsUsed: I,
  };
}
