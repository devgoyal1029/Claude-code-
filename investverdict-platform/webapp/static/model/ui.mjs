/**
 * Vanilla-JS UI for the three-statement model. No framework, no build step.
 * Imports the pure engine and renders an assumptions panel + 3 statement tables
 * + validation bar + charts, recomputing live on any assumption change.
 *
 * renderModelApp(container, confirmedJson)
 */

import { normaliseHistoricals } from "./normalise.mjs";
import { buildModel, seedAssumptions, fyNum } from "./engine.mjs";
import { modelBalances } from "./validate.mjs";

// Assumption inputs: display type controls how the value is shown/parsed.
const FIELDS = [
  ["revenue_growth_pct", "Revenue growth", "pct"],
  ["cogs_pct_of_revenue", "COGS % of revenue", "pct"],
  ["opex_pct_of_revenue", "Opex % of revenue", "pct"],
  ["depreciation_pct", "Depreciation % of PP&E", "pct"],
  ["capex_pct_of_revenue", "Capex % of revenue", "pct"],
  ["dso", "Receivable days (DSO)", "days"],
  ["dio", "Inventory days (DIO)", "days"],
  ["dpo", "Payable days (DPO)", "days"],
  ["tax_rate", "Tax rate", "pct"],
  ["interest_rate", "Interest rate on debt", "pct"],
  ["dividend_payout_ratio", "Dividend payout", "pct"],
  ["new_borrowing", "New borrowing", "abs"],
  ["repayment", "Debt repayment", "abs"],
];

const SECTIONS = {
  income_statement: { title: "Income Statement", rows: [
    ["revenue", "Revenue from Operations"], ["cogs", "Cost of Goods Sold"],
    ["gross_profit", "Gross Profit", true], ["operating_expenses", "Operating Expenses"],
    ["other_income", "Other Income"], ["ebitda", "EBITDA", true],
    ["depreciation_amortisation", "Depreciation & Amortisation"], ["ebit", "EBIT", true],
    ["interest_expense", "Interest Expense"], ["ebt", "Profit Before Tax", true],
    ["tax", "Tax"], ["net_income", "Net Income", true],
  ]},
  balance_sheet: { title: "Balance Sheet", rows: [
    ["cash", "Cash & Equivalents"], ["accounts_receivable", "Trade Receivables"],
    ["inventory", "Inventory"], ["other_current_assets", "Other Current Assets"],
    ["ppe_net", "Property, Plant & Equipment"], ["intangibles", "Intangibles"],
    ["other_noncurrent_assets", "Other Non-current Assets"],
    ["total_assets", "Total Assets", true],
    ["accounts_payable", "Trade Payables"], ["short_term_debt", "Short-term Debt"],
    ["other_current_liab", "Other Current Liabilities"], ["long_term_debt", "Long-term Debt"],
    ["other_noncurrent_liab", "Other Non-current Liabilities"],
    ["share_capital", "Share Capital"], ["retained_earnings", "Retained Earnings"],
    ["total_liabilities_and_equity", "Total Equity & Liabilities", true],
  ]},
  cash_flow: { title: "Cash Flow", rows: [
    ["cfo", "Cash from Operations", true], ["cfi", "Cash from Investing", true],
    ["cff", "Cash from Financing", true], ["net_change_in_cash", "Net Change in Cash", true],
    ["opening_cash", "Opening Cash"], ["closing_cash", "Closing Cash", true],
  ]},
};

const state = {};

export function renderModelApp(container, confirmed) {
  state.confirmed = confirmed;
  state.hist = normaliseHistoricals(confirmed);
  state.base = seedAssumptions(state.hist);
  state.forecastYears = 3;
  state.overrides = {};          // { FY2026: { key: value, ... }, ... }
  state.activeYear = null;       // which forecast year the panel is editing

  container.innerHTML = `
    <h2 id="m-title"></h2>
    <div class="unmapped" id="m-unmapped"></div>
    <div class="layout">
      <aside class="panel">
        <h3>Assumptions</h3>
        <div class="ctrl"><label>Forecast years</label>
          <select id="m-fy"><option>3</option><option>4</option><option>5</option></select></div>
        <div class="yeartabs" id="m-yeartabs"></div>
        <div id="m-fields"></div>
        <div class="seeded">Defaults seeded from latest historical year. Edit any value — the whole model re-flows instantly.</div>
        <div class="seeded" id="m-circ"></div>
      </aside>
      <section>
        <div id="m-validation"></div>
        <div id="m-tables"></div>
        <h3>Charts</h3>
        <div class="charts" id="m-charts"></div>
      </section>
    </div>`;

  container.querySelector("#m-fy").onchange = (e) => {
    state.forecastYears = +e.target.value;
    pruneOverrides();
    state.activeYear = forecastPeriods()[0];
    renderYearTabs(); renderFields(); recompute();
  };

  state.activeYear = forecastPeriods()[0];
  document.getElementById("m-title").textContent =
    `${state.hist.company_name || "Company"} · ${state.hist.units} · ${state.hist.periods.join(", ")} (historical)`;
  renderUnmapped();
  renderYearTabs();
  renderFields();
  recompute();
}

function forecastPeriods() {
  const last = [...state.hist.periods].sort((a, b) => fyNum(a) - fyNum(b)).slice(-1)[0];
  const base = fyNum(last);
  return Array.from({ length: state.forecastYears }, (_, i) => `FY${base + i + 1}`);
}
function pruneOverrides() {
  const valid = new Set(forecastPeriods());
  for (const y of Object.keys(state.overrides)) if (!valid.has(y)) delete state.overrides[y];
}

function renderUnmapped() {
  const el = document.getElementById("m-unmapped");
  const u = state.hist.unmapped;
  if (!u.length) { el.textContent = ""; return; }
  el.innerHTML = `⚠ ${u.length} line item(s) could not be auto-mapped and are excluded: ` +
    u.map((x) => `“${escapeHtml(x.line_item)}”`).join(", ") +
    `. They are not silently dropped — map them manually to include them.`;
}

function renderYearTabs() {
  const el = document.getElementById("m-yeartabs");
  const fps = forecastPeriods();
  el.innerHTML = fps.map((y) =>
    `<button data-y="${y}" class="${y === state.activeYear ? "active" : ""}">${y}</button>`).join("");
  el.querySelectorAll("button").forEach((b) => b.onclick = () => {
    state.activeYear = b.dataset.y; renderYearTabs(); renderFields();
  });
}

function effectiveValue(year, key) {
  const ov = state.overrides[year];
  if (ov && ov[key] != null) return ov[key];
  return state.base[key];
}

function renderFields() {
  const el = document.getElementById("m-fields");
  const year = state.activeYear;
  el.innerHTML = FIELDS.map(([key, label, type]) => {
    const raw = effectiveValue(year, key);
    const shown = type === "pct" ? (raw * 100) : raw;
    const unit = type === "pct" ? "%" : type === "days" ? "days" : state.hist.units;
    const overridden = state.overrides[year] && state.overrides[year][key] != null;
    return `<div class="ctrl">
        <label>${label}${overridden ? " •" : ""}</label>
        <input type="number" step="any" data-key="${key}" data-type="${type}"
               value="${round(shown)}">
        <span class="unit">${unit}</span></div>`;
  }).join("");
  el.querySelectorAll("input").forEach((inp) => {
    inp.oninput = () => {
      const key = inp.dataset.key, type = inp.dataset.type;
      let v = parseFloat(inp.value);
      if (Number.isNaN(v)) return;
      if (type === "pct") v = v / 100;
      if (!state.overrides[year]) state.overrides[year] = {};
      state.overrides[year][key] = v;
      recompute();
    };
  });
}

function currentModel() {
  const assumptions = { ...state.base, overrides: state.overrides };
  return buildModel(state.hist, assumptions, state.forecastYears);
}

function recompute() {
  const model = currentModel();
  state.model = model;
  document.getElementById("m-circ").textContent =
    `Circularity: interest on opening debt (standard v1 convention).`;
  renderValidation(model);
  renderTables(model);
  renderCharts(model);
}

/* ---------- validation bar ---------- */
function renderValidation(model) {
  const el = document.getElementById("m-validation");
  const fails = model.checks.filter((c) => c.status === "fail");
  const warns = model.checks.filter((c) => c.status === "warn");
  const balances = modelBalances(model.checks);
  let html = balances
    ? `<div class="vbar good">✓ Model balances — all hard checks pass for every year</div>`
    : `<div class="vbar bad">✗ Model does not balance — ${fails.length} hard check(s) failed</div>`;
  if (fails.length || warns.length) {
    html += `<ul class="vlist">` +
      fails.map((c) => `<li class="fail"><span class="tag">FAIL</span>${escapeHtml(c.name)} — ${escapeHtml(c.detail)}</li>`).join("") +
      warns.map((c) => `<li class="warn"><span class="tag">WARN</span>${escapeHtml(c.name)} — ${escapeHtml(c.detail)}</li>`).join("") +
      `</ul>`;
  }
  el.innerHTML = html;
}

/* ---------- statement tables ---------- */
function renderTables(model) {
  const el = document.getElementById("m-tables");
  const periods = model.periods, fset = new Set(model.forecastPeriods);
  let html = "";
  for (const [secKey, sec] of Object.entries(SECTIONS)) {
    html += `<h3>${sec.title}</h3><table><thead><tr><th>Line item</th>` +
      periods.map((p) => `<th class="${fset.has(p) ? "fc" : ""}">${p}${fset.has(p) ? " ·F" : ""}</th>`).join("") +
      `</tr></thead><tbody>`;
    for (const [key, label, sub] of sec.rows) {
      html += `<tr class="${sub ? "sub" : ""}"><td>${label}</td>` +
        periods.map((p) => {
          const v = model.years[p] ? model.years[p][key] : undefined;
          const fc = fset.has(p) ? "fc" : "";
          if (v == null) return `<td class="${fc}">—</td>`;
          const neg = v < 0 ? "neg" : "";
          return `<td class="${fc} ${neg}">${fmt(v)}</td>`;
        }).join("") + `</tr>`;
    }
    html += `</tbody></table>`;
  }
  el.innerHTML = html;
}

/* ---------- charts (lightweight SVG) ---------- */
function renderCharts(model) {
  const el = document.getElementById("m-charts");
  const periods = model.periods;
  const rev = periods.map((p) => num(model.years[p]?.revenue));
  const ni = periods.map((p) => num(model.years[p]?.net_income));
  const fset = new Set(model.forecastPeriods);

  el.innerHTML = `
    <div class="chartbox"><h4>Revenue & Net Income</h4>
      ${groupedBars(periods, [
        { name: "Revenue", data: rev, color: "var(--gold)" },
        { name: "Net Income", data: ni, color: "var(--gold-soft)" }], fset)}</div>
    <div class="chartbox"><h4>Cash-flow Bridge (forecast)</h4>
      ${cashBridge(model)}</div>`;
}

function groupedBars(labels, series, fset) {
  const W = 380, H = 200, padL = 44, padB = 26, padT = 10;
  const all = series.flatMap((s) => s.data);
  const max = Math.max(1, ...all), min = Math.min(0, ...all);
  const span = max - min || 1;
  const y = (v) => padT + (H - padT - padB) * (1 - (v - min) / span);
  const groupW = (W - padL - 8) / labels.length;
  const bw = Math.min(18, groupW / (series.length + 1));
  let bars = "";
  labels.forEach((lab, i) => {
    const gx = padL + i * groupW + 6;
    series.forEach((s, j) => {
      const v = s.data[i], yy = y(v), y0 = y(0);
      bars += `<rect x="${gx + j * (bw + 2)}" y="${Math.min(yy, y0)}" width="${bw}"
        height="${Math.abs(yy - y0)}" fill="${s.color}" opacity="${fset.has(lab) ? 1 : 0.55}"/>`;
    });
    bars += `<text x="${gx + groupW / 2 - 6}" y="${H - 8}" fill="var(--mut)" font-size="9">${lab}</text>`;
  });
  const zero = y(0);
  const legend = series.map((s, j) =>
    `<rect x="${padL + j * 92}" y="2" width="9" height="9" fill="${s.color}"/>
     <text x="${padL + j * 92 + 13}" y="10" fill="var(--mut)" font-size="9">${s.name}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">
     <line x1="${padL}" y1="${zero}" x2="${W - 4}" y2="${zero}" stroke="var(--line)"/>
     ${bars}<g transform="translate(0,${H - 2})">${legend}</g></svg>`;
}

function cashBridge(model) {
  const fps = model.forecastPeriods;
  if (!fps.length) return `<div class="empty">No forecast years.</div>`;
  const parts = [
    { name: "CFO", key: "cfo", color: "var(--good)" },
    { name: "CFI", key: "cfi", color: "var(--bad)" },
    { name: "CFF", key: "cff", color: "var(--gold-soft)" },
  ];
  const W = 380, H = 200, padL = 44, padB = 26, padT = 10;
  const vals = fps.flatMap((p) => parts.map((pt) => num(model.years[p][pt.key])));
  const max = Math.max(1, ...vals), min = Math.min(0, ...vals), span = max - min || 1;
  const y = (v) => padT + (H - padT - padB) * (1 - (v - min) / span);
  const groupW = (W - padL - 8) / fps.length, bw = Math.min(16, groupW / 4);
  let bars = "";
  fps.forEach((p, i) => {
    const gx = padL + i * groupW + 6;
    parts.forEach((pt, j) => {
      const v = num(model.years[p][pt.key]), yy = y(v), y0 = y(0);
      bars += `<rect x="${gx + j * (bw + 2)}" y="${Math.min(yy, y0)}" width="${bw}"
        height="${Math.abs(yy - y0)}" fill="${pt.color}"/>`;
    });
    bars += `<text x="${gx + groupW / 2 - 8}" y="${H - 8}" fill="var(--mut)" font-size="9">${p}</text>`;
  });
  const zero = y(0);
  const legend = parts.map((pt, j) =>
    `<rect x="${padL + j * 70}" y="2" width="9" height="9" fill="${pt.color}"/>
     <text x="${padL + j * 70 + 13}" y="10" fill="var(--mut)" font-size="9">${pt.name}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%">
     <line x1="${padL}" y1="${zero}" x2="${W - 4}" y2="${zero}" stroke="var(--line)"/>
     ${bars}<g transform="translate(0,${H - 2})">${legend}</g></svg>`;
}

/* ---------- helpers ---------- */
function num(x) { return x == null || Number.isNaN(Number(x)) ? 0 : Number(x); }
function round(x) { return Math.round(x * 1000) / 1000; }
function fmt(v) {
  return Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
