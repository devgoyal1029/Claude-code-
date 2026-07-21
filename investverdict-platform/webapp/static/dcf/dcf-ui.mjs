/**
 * DCF screen UI — the premium "valuation verdict". DOM only; math in dcf.mjs.
 * Editable India-aware inputs, hero fair-value card, WACC build-up, FCFF/PV table,
 * waterfall + sensitivity grid, honest limitations. Recomputes live.
 */

import { seedInputs, computeDCF } from "./dcf.mjs";
import { dataConsistency, spreadInstability, collect } from "../valuation/validation-core.mjs";

const state = {};

const INPUTS = [
  { group: "Discount rate (WACC)", items: [
    { key: "rf", label: "Risk-free rate (10Y G-Sec)", type: "pct", tip: "India 10-year government bond yield (~7%). Source: RBI / worldgovernmentbonds." },
    { key: "erp", label: "Equity risk premium", type: "pct", tip: "Extra return demanded over risk-free for equity risk. India ≈ 7–8% (higher than US ~4–4.5%)." },
    { key: "beta", label: "Beta (β)", type: "num", tip: "Stock volatility vs the market. From the stock's data / industry beta (relever to the company's D/E)." },
    { key: "kd", label: "Cost of debt (pre-tax)", type: "pct", tip: "Interest expense ÷ total debt, or the company's borrowing rate. It gets tax-affected automatically." },
    { key: "tax", label: "Tax rate", type: "pct", tip: "Effective tax rate (Tax ÷ PBT). India statutory ~25%." },
  ] },
  { group: "Capital structure & bridge", items: [
    { key: "debt", label: "Total debt (₹)", type: "abs", tip: "Long + short-term borrowings from the latest balance sheet." },
    { key: "cash", label: "Cash & equivalents (₹)", type: "abs", tip: "Added back when bridging Enterprise Value to Equity Value." },
    { key: "minority", label: "Minority interest (₹)", type: "abs", tip: "Subtracted in the equity bridge (0 if none)." },
    { key: "preferred", label: "Preferred equity (₹)", type: "abs", tip: "Subtracted in the equity bridge (0 if none)." },
  ] },
  { group: "Terminal value & market", items: [
    { key: "g", label: "Terminal growth (g)", type: "pct", tip: "Perpetual growth ≈ long-run inflation / GDP (India ~4–5%). MUST be < WACC." },
    { key: "price", label: "Market price (₹/share)", type: "abs", tip: "Current share price — for the fair-value comparison." },
    { key: "shares", label: "Diluted shares", type: "abs", tip: "Diluted shares outstanding — to convert equity value to per-share." },
  ] },
];

export function renderDcfApp(container, model) {
  state.model = model;
  state.inputs = seedInputs(model);
  // reuse price/shares entered on any other screen (single source of truth)
  try { const M = JSON.parse(sessionStorage.getItem("iv_market") || "{}");
    if (M.price != null) state.inputs.price = M.price;
    if (M.shares != null) state.inputs.shares = M.shares; } catch (e) {}

  container.innerHTML = `
    <h2>${esc(model.company_name || "Company")} <span class="meta">· ${esc(model.units || "")} · DCF intrinsic valuation</span></h2>
    <div id="d-hero"></div>
    <div class="d-grid">
      <section class="d-inputs"><h3>Assumptions</h3><div id="d-inputs"></div>
        <div class="d-tvmethod">Terminal value:
          <label><input type="radio" name="tvm" value="gordon" checked> Gordon growth</label>
          <label><input type="radio" name="tvm" value="exit"> Exit multiple <input type="number" step="any" id="d-exit" class="d-exitm"> × EBITDA</label>
        </div>
        <div id="d-warn"></div>
      </section>
      <section class="d-out">
        <div id="d-wacc"></div>
        <h3>Free Cash Flow → Present Value</h3>
        <div class="d-scroll" id="d-table"></div>
        <div class="chartbox"><canvas id="d-wf" height="150"></canvas></div>
      </section>
    </div>
    <h3>Sensitivity — fair value across WACC × terminal growth</h3>
    <p class="d-note">Terminal value is usually 60–80% of a DCF, so small changes in WACC or g move the answer a lot. Read the result as a <b>range</b>, not a single number. The base case is outlined.</p>
    <div class="d-scroll" id="d-sens"></div>
    <div class="d-limits">
      <h3>How to read this</h3>
      <ul>
        <li>This is an <b>intrinsic-value estimate</b>: projected cash flows discounted to today, then compared to the market price. It's an analytical observation, <b>not buy/sell advice</b>.</li>
        <li><b>Terminal value dominates</b> (60–80% of the total), so the answer is sensitive to g and WACC — always look at the range above.</li>
        <li>DCF suits <b>mature, predictable</b> cash-flow businesses; it's unreliable for early-stage or highly cyclical firms.</li>
        <li>Triangulate with comparables (P/E, EV/EBITDA) from the Ratio screen — don't rely on a single method.</li>
      </ul>
    </div>`;

  renderInputs();
  container.querySelectorAll('input[name="tvm"]').forEach((r) => r.onchange = () => { state.inputs.tvMethod = r.value; recompute(); });
  const ex = container.querySelector("#d-exit"); ex.value = state.inputs.exitMultiple;
  ex.oninput = () => { const v = parseFloat(ex.value); if (!Number.isNaN(v)) { state.inputs.exitMultiple = v; recompute(); } };
  recompute();
}

function renderInputs() {
  const el = document.getElementById("d-inputs");
  let html = "";
  for (const g of INPUTS) {
    html += `<div class="d-ig"><div class="d-igh">${esc(g.group)}</div>`;
    for (const it of g.items) {
      const v = state.inputs[it.key];
      const shown = it.type === "pct" ? (v == null ? "" : round(v * 100)) : (v == null ? "" : round(v));
      const unit = it.type === "pct" ? "%" : "";
      html += `<div class="d-row"><label>${esc(it.label)}<span class="ⓘ" title="${esc(it.tip)}">ⓘ</span></label>
        <span class="d-inwrap"><input type="number" step="any" data-key="${it.key}" data-type="${it.type}" value="${shown}" placeholder="${it.key === "price" || it.key === "shares" ? "enter" : ""}"><span class="d-u">${unit}</span></span></div>`;
    }
    html += `</div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll("input[data-key]").forEach((inp) => {
    inp.oninput = () => {
      let v = parseFloat(inp.value);
      if (inp.value.trim() === "") v = (inp.dataset.key === "price" || inp.dataset.key === "shares") ? null : 0;
      else if (Number.isNaN(v)) return;
      if (inp.dataset.type === "pct" && v != null) v = v / 100;
      state.inputs[inp.dataset.key] = v;
      recompute();
    };
  });
}

function recompute() {
  const d = computeDCF(state.model, state.inputs);
  state.d = d;
  try {
    sessionStorage.setItem("iv_market", JSON.stringify({ price: state.inputs.price, shares: state.inputs.shares }));
    if (d.fairValue != null) { const V = JSON.parse(sessionStorage.getItem("iv_valuations") || "{}"); V.dcf = d.fairValue; sessionStorage.setItem("iv_valuations", JSON.stringify(V)); }
    import("../lib/supa.mjs").then((m) => m.saveValuations()).catch(() => {});
  } catch (e) {}
  renderHero(d);
  renderWacc(d);
  renderTable(d);
  renderWaterfall(d);
  renderSensitivity(d);
  renderWarn(d);
}

/* ---------- hero ---------- */
function renderHero(d) {
  const el = document.getElementById("d-hero");
  const fv = d.fairValue, price = state.inputs.price;
  if (fv == null) {
    el.innerHTML = `<div class="hero"><div class="hero-main"><div class="hero-k">Intrinsic Fair Value</div>
      <div class="hero-val">— <span class="hero-per">/ share</span></div>
      <div class="hero-sub">Enter <b>market price</b> &amp; <b>diluted shares</b> to get a per-share fair value.${d.equityValue != null ? ` (Equity value ≈ ₹${money(d.equityValue)} ${unitWord()})` : ""}</div></div></div>`;
    return;
  }
  const up = d.upside;
  const verdict = up == null ? "" : up >= 0 ? "Undervalued" : "Overvalued";
  const vcls = up == null ? "" : up >= 0 ? "good" : "bad";
  el.innerHTML = `<div class="hero">
    <div class="hero-main">
      <div class="hero-k">Intrinsic Fair Value</div>
      <div class="hero-val">₹${money(fv)} <span class="hero-per">/ share</span></div>
      <div class="hero-sub">${price ? `Market price ₹${money(price)} · ` : ""}WACC ${(d.wacc * 100).toFixed(1)}% · terminal g ${(state.inputs.g * 100).toFixed(1)}%</div>
    </div>
    ${up == null ? "" : `<div class="hero-verdict ${vcls}">
      <div class="hv-word">${verdict}</div>
      <div class="hv-gap">${up >= 0 ? "+" : ""}${(up * 100).toFixed(1)}%</div>
      ${gauge(up)}
      <div class="hv-foot">vs market price · analytical observation, not advice</div></div>`}
  </div>`;
}
function gauge(up) {
  const c = Math.max(-0.5, Math.min(0.5, up));
  const x = 10 + ((c + 0.5) / 1) * 180;       // 10..190
  return `<svg class="gauge" viewBox="0 0 200 26" width="200">
    <defs><linearGradient id="gg" x1="0" x2="1"><stop offset="0" stop-color="#c23a2e"/><stop offset="0.5" stop-color="#6d675a"/><stop offset="1" stop-color="#157a4c"/></linearGradient></defs>
    <rect x="10" y="10" width="180" height="6" rx="3" fill="url(#gg)"/>
    <line x1="100" y1="6" x2="100" y2="20" stroke="#6d675a" stroke-width="1" stroke-dasharray="2 2"/>
    <polygon points="${x - 5},4 ${x + 5},4 ${x},12" fill="#8a6a15"/></svg>`;
}

/* ---------- WACC build-up ---------- */
function renderWacc(d) {
  const w = d.weights;
  document.getElementById("d-wacc").innerHTML = `
    <h3>WACC build-up</h3>
    <div class="wacc-cards">
      <div class="wc"><span>Cost of equity (Ke)</span><b>${pct(d.ke)}</b><i>Rf ${pct(state.inputs.rf)} + β ${round(state.inputs.beta)} × ERP ${pct(state.inputs.erp)}</i></div>
      <div class="wc"><span>Cost of debt (after-tax)</span><b>${pct(d.kdAfter)}</b><i>Kd ${pct(state.inputs.kd)} × (1 − tax ${pct(state.inputs.tax)})</i></div>
      <div class="wc"><span>Weights E / D</span><b>${(w.wE * 100).toFixed(0)}% / ${(w.wD * 100).toFixed(0)}%</b><i>E ₹${money(w.E)} · D ₹${money(w.D)}</i></div>
      <div class="wc accent"><span>WACC</span><b>${pct(d.wacc)}</b><i>wE×Ke + wD×Kd(1−t)</i></div>
    </div>`;
}

/* ---------- FCFF -> PV table ---------- */
function renderTable(d) {
  let html = `<table class="dt"><thead><tr><th>Year</th><th class="num">FCFF</th><th class="num">Discount factor</th><th class="num">PV of FCFF</th></tr></thead><tbody>`;
  for (const r of d.rows)
    html += `<tr><td>${fyLabel(r.period)}</td><td class="num">${r.fcff == null ? "-" : money(r.fcff)}</td><td class="num">${r.discountFactor == null ? "-" : r.discountFactor.toFixed(3)}</td><td class="num">${r.pv == null ? "-" : money(r.pv)}</td></tr>`;
  html += `<tr class="sub"><td>PV of Terminal Value</td><td class="num"></td><td class="num"></td><td class="num">${d.pvTv == null ? "-" : money(d.pvTv)}</td></tr>`;
  html += `<tr class="tot"><td>Enterprise Value</td><td colspan="2"></td><td class="num">${d.ev == null ? "-" : money(d.ev)}</td></tr>`;
  html += `<tr><td>− Debt + Cash − Minority − Preferred</td><td colspan="2"></td><td class="num">${d.equityValue == null ? "-" : money(d.equityValue - (d.ev || 0))}</td></tr>`;
  html += `<tr class="tot"><td>Equity Value</td><td colspan="2"></td><td class="num">${d.equityValue == null ? "-" : money(d.equityValue)}</td></tr>`;
  html += `</tbody></table>`;
  document.getElementById("d-table").innerHTML = html;
}

/* ---------- waterfall: where the value comes from ---------- */
function renderWaterfall(d) {
  const c = document.getElementById("d-wf");
  if (!c || !window.Chart) return;
  const labels = d.rows.map((r) => fyLabel(r.period)).concat(["Terminal Value"]);
  const data = d.rows.map((r) => r.pv || 0).concat([d.pvTv || 0]);
  if (c._chart) c._chart.destroy();
  c._chart = new window.Chart(c, {
    type: "bar",
    data: { labels, datasets: [{ label: "Present value", data,
      backgroundColor: labels.map((l) => l === "Terminal Value" ? "#c9982a" : "#157a4c") }] },
    options: { responsive: true,
      plugins: { legend: { display: false }, title: { display: true, text: "Present value of each cash flow (Terminal Value usually dominates)", color: "#555555" } },
      scales: { x: { ticks: { color: "#555555" }, grid: { color: "#e5e5e5" } }, y: { ticks: { color: "#555555" }, grid: { color: "#e5e5e5" } } } },
  });
}

/* ---------- sensitivity grid ---------- */
function renderSensitivity(d) {
  const s = d.sensitivity;
  const flat = s.grid.flat().filter((x) => x != null);
  const min = Math.min(...flat), max = Math.max(...flat), span = (max - min) || 1;
  const baseRow = 2, baseCol = 2;
  let html = `<table class="sens"><thead><tr><th>WACC \\ g →</th>${s.gs.map((g) => `<th>${(g * 100).toFixed(1)}%</th>`).join("")}</tr></thead><tbody>`;
  s.waccs.forEach((w, ri) => {
    html += `<tr><th>${(w * 100).toFixed(1)}%</th>`;
    s.gs.forEach((g, ci) => {
      const v = s.grid[ri][ci];
      const tcol = v == null ? "" : `background:${heat((v - min) / span)}`;
      const baseCls = (ri === baseRow && ci === baseCol) ? " base" : "";
      html += `<td class="${baseCls}" style="${tcol}">${v == null ? "-" : (s.perShare ? "₹" + money(v) : money(v))}</td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>` + (s.perShare ? "" : `<div class="d-note">Enter diluted shares to see per-share values; showing equity value (₹).</div>`);
  document.getElementById("d-sens").innerHTML = html;
}
function heat(t) { // 0 red -> 1 green
  const r = Math.round(255 * (1 - t) * 0.55 + 40), g = Math.round(120 * t + 30), b = 50;
  return `rgba(${r},${g + 40},${b},0.45)`;
}

function renderWarn(d) {
  const el = document.getElementById("d-warn");
  // shared validation-core checks: underlying-data breaks + WACC−g instability
  const extra = collect(
    dataConsistency(state.model),
    spreadInstability(d.wacc, state.inputs.g, "WACC − g"),
  ).map((c) => c.msg);
  const all = [...d.warnings, ...extra];
  el.innerHTML = all.length
    ? `<div class="d-warnbox">${all.map((w) => `<div>⚠ ${esc(w)}</div>`).join("")}</div>` : "";
}

/* ---------- helpers ---------- */
function round(x) { return Math.round(Number(x) * 1000) / 1000; }
function pct(x) { return x == null ? "-" : (x * 100).toFixed(1) + "%"; }
function money(v) { return v == null ? "-" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 }); }
function unitWord() { const u = String(state.model.units || "").toLowerCase(); return u.startsWith("cr") ? "Cr" : u.startsWith("lakh") ? "Lakhs" : ""; }
function fyLabel(p) { const m = String(p).match(/(\d{4})/); return m ? `FY-${m[1]}E` : esc(p); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
