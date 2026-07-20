/**
 * Guided Assumptions + Forecast screen. DOM rendering; all math is in the
 * reused model engine (../model/) + assumptions.mjs. Vanilla JS, Chart.js.
 */

import { normaliseHistoricals } from "../model/normalise.mjs";
import { seedAssumptions, buildModel } from "../model/engine.mjs";
import { modelBalances } from "../model/validate.mjs";
import { DRIVERS, anchors, validateAssumption } from "./assumptions.mjs";

const fy = (p) => { const m = String(p).match(/(\d{4})/); return m ? +m[1] : 0; };
const DRIVER_BY = Object.fromEntries(DRIVERS.map((d) => [d.key, d]));

const SECTIONS = {
  income_statement: { title: "Income Statement", rows: [
    ["revenue", "Revenue from Operations"], ["cogs", "Cost of Goods Sold"],
    ["gross_profit", "Gross Profit", 1], ["operating_expenses", "Operating Expenses"],
    ["other_income", "Other Income"], ["ebitda", "EBITDA", 1],
    ["depreciation_amortisation", "Depreciation & Amortisation"], ["ebit", "EBIT", 1],
    ["interest_expense", "Interest Expense"], ["ebt", "Profit Before Tax", 1],
    ["tax", "Tax"], ["net_income", "Net Profit", 1] ] },
  balance_sheet: { title: "Balance Sheet", rows: [
    ["cash", "Cash & Equivalents"], ["accounts_receivable", "Trade Receivables"],
    ["inventory", "Inventory"], ["other_current_assets", "Other Current Assets"],
    ["ppe_net", "Property, Plant & Equipment"], ["intangibles", "Intangibles"],
    ["other_noncurrent_assets", "Other Non-current Assets"], ["total_assets", "Total Assets", 1],
    ["accounts_payable", "Trade Payables"], ["short_term_debt", "Short-term Debt"],
    ["other_current_liab", "Other Current Liabilities"], ["long_term_debt", "Long-term Debt"],
    ["other_noncurrent_liab", "Other Non-current Liabilities"], ["share_capital", "Share Capital"],
    ["retained_earnings", "Retained Earnings"], ["total_liabilities_and_equity", "Total Equity & Liabilities", 1] ] },
  cash_flow: { title: "Cash Flow", rows: [
    ["cfo", "Cash from Operations", 1], ["cfi", "Cash from Investing", 1],
    ["cff", "Cash from Financing", 1], ["net_change_in_cash", "Net Change in Cash", 1],
    ["opening_cash", "Opening Cash"], ["closing_cash", "Closing Cash", 1] ] },
};

const state = {};

export function renderForecastApp(container, confirmed) {
  state.confirmed = confirmed;
  state.hist = normaliseHistoricals(confirmed);
  state.seeded = seedAssumptions(state.hist);
  state.anchors = anchors(state.hist);
  state.forecastYears = 3;
  state.overrides = {};               // { "FY2026": { key: value }, ... }

  const company = esc(state.hist.company_name || "Company");
  container.innerHTML = `
    <div class="fc-head">
      <h2>${company} <span class="meta">· ${esc(state.hist.units)} · forecast from your confirmed history</span></h2>
      <label class="fc-years">Forecast years
        <select id="fc-fy"><option>3</option><option>4</option><option>5</option></select></label>
    </div>
    <p class="fc-intro">Every assumption below is <b>pre-filled from this company's own history</b> — your defensible starting point. Adjust any cell, click <b>ⓘ Teach me</b> to learn where each number comes from, and the three statements re-forecast live. <span class="fc-conv">Interest is charged on <b>opening debt</b> (a standard convention that avoids circular maths).</span></p>
    <h3>Assumptions</h3>
    <div class="fc-asm-wrap"><div id="fc-asm"></div></div>
    <div id="fc-warn"></div>
    <div id="fc-badge"></div>
    <div id="fc-tables"></div>
    <h3>Trajectory</h3>
    <div class="fc-charts"><div class="chartbox"><canvas id="fc-chart1" height="150"></canvas></div>
      <div class="chartbox"><canvas id="fc-chart2" height="150"></canvas></div></div>`;

  container.querySelector("#fc-fy").onchange = (e) => {
    state.forecastYears = +e.target.value; pruneOverrides(); renderAssumptions(); recompute();
  };
  initTeach();
  renderAssumptions();
  recompute();
}

function forecastPeriods() {
  const ys = [...state.hist.periods].sort((a, b) => fy(a) - fy(b));
  const base = fy(ys[ys.length - 1]);
  return Array.from({ length: state.forecastYears }, (_, i) => `FY${base + i + 1}`);
}
function pruneOverrides() {
  const valid = new Set(forecastPeriods());
  for (const y of Object.keys(state.overrides)) if (!valid.has(y)) delete state.overrides[y];
}
function eff(key, year) {
  const ov = state.overrides[year];
  return (ov && ov[key] != null) ? ov[key] : state.seeded[key];
}
function show(driver, v) {
  if (v == null) return "";
  return driver.type === "pct" ? round(v * 100) : driver.type === "days" ? round(v) : round(v);
}

/* ---------- assumptions table ---------- */
function renderAssumptions() {
  const fps = forecastPeriods();
  let html = `<table class="asm"><thead><tr><th>Assumption</th><th class="hist">Historical</th>`
    + fps.map((p) => `<th class="num fc">${fyLabel(p, true)}</th>`).join("") + `</tr></thead><tbody>`;
  for (const d of DRIVERS) {
    const unit = d.type === "pct" ? "%" : d.type === "days" ? "d" : "";
    html += `<tr><td class="asm-lbl">${esc(d.label)} <button class="teachbtn" data-key="${d.key}" title="Teach me">ⓘ</button></td>`
      + `<td class="hist">${histText(d)}</td>`
      + fps.map((p) => `<td class="num"><input class="asm-in" type="number" step="any" data-key="${d.key}" data-year="${p}" value="${show(d, eff(d.key, p))}"><span class="asm-u">${unit}</span></td>`).join("")
      + `</tr>`;
  }
  html += `</tbody></table>`;
  document.getElementById("fc-asm").innerHTML = html;
  document.querySelectorAll(".asm-in").forEach((inp) => {
    inp.oninput = () => {
      const d = DRIVER_BY[inp.dataset.key];
      let v = parseFloat(inp.value);
      if (Number.isNaN(v)) return;
      if (d.type === "pct") v = v / 100;
      (state.overrides[inp.dataset.year] ||= {})[inp.dataset.key] = v;
      recompute();
    };
  });
}
function histText(d) {
  const v = state.seeded[d.key];
  if (v == null) return "—";
  if (d.type === "pct") return `${round(v * 100)}%`;
  if (d.type === "days") return `${round(v)} days`;
  return `₹${round(v)}`;
}

/* ---------- recompute + render outputs ---------- */
function currentModel() {
  return buildModel(state.hist, { ...state.seeded, overrides: state.overrides }, state.forecastYears);
}
function recompute() {
  const model = currentModel();
  state.model = model;
  // hand the built model forward to the Ratio + DCF screens
  try { sessionStorage.setItem("iv_forecast", JSON.stringify(model)); } catch (e) { /* ignore */ }
  renderTables(model);
  renderBadge(model);
  renderCharts(model);
  renderWarnings();
}

function renderWarnings() {
  const fps = forecastPeriods();
  const items = [];
  document.querySelectorAll(".asm-in").forEach((inp) => {
    const key = inp.dataset.key, year = inp.dataset.year;
    const w = validateAssumption(key, eff(key, year), state.anchors);
    inp.classList.toggle("warn", !!w);
    inp.title = w ? w.msg : "";
  });
  for (const d of DRIVERS) {
    for (const p of fps) {
      const w = validateAssumption(d.key, eff(d.key, p), state.anchors);
      if (w) items.push(`<li><span class="tag">${esc(d.label)} · ${fyLabel(p, true)}</span> ${esc(w.msg)}</li>`);
    }
  }
  document.getElementById("fc-warn").innerHTML = items.length
    ? `<div class="fc-warnbox"><b>Check your assumptions (${items.length})</b><ul>${items.join("")}</ul>
       <div class="disclaimer">Educational checks against this company's own history — not investment advice.</div></div>`
    : "";
}

function renderBadge(model) {
  const fails = model.checks.filter((c) => c.status === "fail");
  const ok = modelBalances(model.checks);
  let html = ok
    ? `<div class="vbar good">✓ Model balances — every forecast year ties out</div>`
    : `<div class="vbar bad">✗ Model doesn't balance — ${fails.length} break(s)</div>`;
  if (fails.length)
    html += `<ul class="vlist">` + fails.map((c) => `<li class="fail"><span class="tag">FAIL</span>${esc(c.name)} — ${esc(c.detail)}</li>`).join("") + `</ul>`;
  document.getElementById("fc-badge").innerHTML = html;
}

/* Render the forecast as the SAME white Dabur-style sheet as the analysis screen:
   one sheet per statement, Particulars + (historical + forecast) year columns,
   each value row followed by its % (margin) row; forecast columns tinted. */
function renderTables(model) {
  const periods = model.periods, fset = new Set(model.forecastPeriods);
  const company = esc(state.hist.company_name || "Company");
  const units = unitsLabel(state.hist.units);
  const BASES = { income_statement: "revenue", balance_sheet: "total_assets", cash_flow: "revenue" };
  const BASE_SHORT = { revenue: "revenue", total_assets: "total assets" };
  let html = "";
  for (const [skey, sec] of Object.entries(SECTIONS)) {
    const baseKey = BASES[skey], baseShort = BASE_SHORT[baseKey];
    html += `<div class="sheet">
      <div class="sheet-hdr"><div class="co">${company}</div>
        <div class="meta">Forecast model · base year + ${state.forecastYears} forecast year(s)</div></div>
      <div class="sheet-title">Forecasted Financial Statement — ${company} <span class="units-note">(${esc(units)})</span></div>
      <div class="xl-banner">${sec.title}</div>
      <div class="xl-scroll"><table class="xl"><thead><tr><th class="lbl">Particulars</th>`
      + periods.map((p) => `<th class="num${fset.has(p) ? " fcol" : ""}">${fyLabel(p, fset.has(p))}</th>`).join("")
      + `</tr></thead><tbody>`;
    for (const [k, label, sub] of sec.rows) {
      // value row
      html += `<tr class="xl-val${sub ? " xtot" : ""}"><td class="lbl">${esc(label)}</td>`
        + periods.map((p) => {
            const v = model.years[p] ? model.years[p][k] : undefined;
            const fc = fset.has(p) ? " fcol" : "";
            if (v == null) return `<td class="num${fc}">—</td>`;
            return `<td class="num${fc} ${v < 0 ? "neg" : ""}">${money(v)}</td>`;
          }).join("") + `</tr>`;
      // % of base (margin) row
      html += `<tr class="xl-sub"><td class="lbl">% of ${baseShort}</td>`
        + periods.map((p) => {
            const v = model.years[p] ? model.years[p][k] : undefined;
            const base = model.years[p] ? model.years[p][baseKey] : undefined;
            const fc = fset.has(p) ? " fcol" : "";
            const pct = (v != null && base) ? (v / base) * 100 : null;
            return `<td class="num${fc}">${pct == null ? "" : pct.toFixed(1) + "%"}</td>`;
          }).join("") + `</tr>`;
    }
    html += `</tbody></table></div></div>`;
  }
  document.getElementById("fc-tables").innerHTML = html;
}

function unitsLabel(units) {
  const u = String(units || "").toLowerCase();
  if (u.startsWith("cr")) return "INR (Cr.)";
  if (u.startsWith("lakh") || u.startsWith("lac")) return "INR (Lakhs)";
  return `INR (${units || "Absolute"})`;
}

/* ---------- charts ---------- */
function renderCharts(model) {
  if (typeof window === "undefined" || !window.Chart) return;
  const periods = model.periods, fset = new Set(model.forecastPeriods);
  const labels = periods.map((p) => fyLabel(p, fset.has(p)));
  const rev = periods.map((p) => n(model.years[p]?.revenue));
  const ni = periods.map((p) => n(model.years[p]?.net_income));
  const nm = periods.map((p) => { const r = n(model.years[p]?.revenue); return r ? (n(model.years[p]?.net_income) / r) * 100 : 0; });
  const em = periods.map((p) => { const r = n(model.years[p]?.revenue); return r ? (n(model.years[p]?.ebitda) / r) * 100 : 0; });
  const tint = periods.map((p) => fset.has(p) ? 1 : 0.5);

  drawChart("fc-chart1", {
    type: "bar", data: { labels, datasets: [
      { label: "Revenue", data: rev, backgroundColor: periods.map((p) => fset.has(p) ? "#c9982a" : "rgba(201,152,42,.5)") },
      { label: "Net Profit", data: ni, backgroundColor: periods.map((p) => fset.has(p) ? "#3ad29f" : "rgba(58,210,159,.5)") },
    ] },
    options: chartOpts("Revenue & Net Profit (forecast solid)"),
  });
  drawChart("fc-chart2", {
    type: "line", data: { labels, datasets: [
      { label: "Net margin %", data: nm, borderColor: "#3ad29f", backgroundColor: "transparent", tension: .3 },
      { label: "EBITDA margin %", data: em, borderColor: "#e0b94f", backgroundColor: "transparent", tension: .3 },
    ] },
    options: chartOpts("Margin trend", true),
  });
}
function drawChart(id, cfg) {
  const c = document.getElementById(id); if (!c) return;
  if (c._chart) c._chart.destroy();
  c._chart = new window.Chart(c, cfg);
}
function chartOpts(title, pct) {
  return { responsive: true, plugins: { legend: { labels: { color: "#8aa1b6" } },
      title: { display: true, text: title, color: "#8aa1b6" } },
    scales: { x: { ticks: { color: "#8aa1b6" }, grid: { color: "#1c3a52" } },
      y: { ticks: { color: "#8aa1b6", callback: (v) => pct ? v + "%" : v }, grid: { color: "#1c3a52" } } } };
}

/* ---------- teach side panel ---------- */
function initTeach() {
  if (initTeach._wired) return; initTeach._wired = true;
  document.getElementById("tp-close").onclick = closeTeach;
  document.getElementById("term-overlay").onclick = closeTeach;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTeach(); });
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".teachbtn");
    if (b) { e.preventDefault(); openTeach(b.dataset.key); }
  });
}
function openTeach(key) {
  const d = DRIVER_BY[key]; if (!d) return;
  document.getElementById("tp-title").textContent = d.label;
  document.getElementById("tp-body").innerHTML =
    `<div class="teach-sec"><span class="teach-k">What it is</span>${esc(d.what)}</div>
     <div class="teach-sec"><span class="teach-k">Where to find it</span>${esc(d.where)}</div>
     <div class="teach-sec"><span class="teach-k">How to set it</span>${esc(d.how)}</div>
     <div class="teach-sec"><span class="teach-k">Sanity check</span>${esc(d.validate)}</div>
     <div class="teach-sec"><span class="teach-k">This company's history</span>Pre-filled default: <b>${histText(d)}</b></div>`;
  document.getElementById("term-panel").classList.add("open");
  document.getElementById("term-overlay").classList.add("show");
}
function closeTeach() {
  document.getElementById("term-panel").classList.remove("open");
  document.getElementById("term-overlay").classList.remove("show");
}

/* ---------- helpers ---------- */
function n(x) { return x == null || Number.isNaN(Number(x)) ? 0 : Number(x); }
function round(x) { return Math.round(Number(x) * 100) / 100; }
function money(v) { return Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 }); }
function fyLabel(p, isForecast) { const m = String(p).match(/(\d{4})/); return (m ? `FY-${m[1]}` : esc(p)) + (isForecast ? "E" : ""); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
