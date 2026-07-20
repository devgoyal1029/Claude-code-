/**
 * Vanilla-JS UI for the common-size module + interactive analysis layers.
 * DOM rendering only; all math is in commonsize.mjs / calc.mjs / insights.mjs /
 * peers.mjs / exporters.mjs.
 *
 * The STANDARD view (default bases, common-size mode, heatmap off, single
 * company) renders first; all extra controls live in one tidy control bar.
 */

import { computeLinks, linksTieOut, normLabel } from "./commonsize.mjs";
import { commonSizeForStatement, computeYoYForStatement, heatBg,
         BASE_OPTIONS, defaultBaseKey, sortPeriods } from "./calc.mjs";
import { generateInsights } from "./insights.mjs";
import { alignPeers, canonicalKey } from "./peers.mjs";
import { exportExcel, exportPDF } from "./exporters.mjs";

const SECTION_TITLES = { income_statement: "Income Statement", balance_sheet: "Balance Sheet", cash_flow: "Cash Flow" };
const BASE_SHORT = { income_statement: "revenue", balance_sheet: "total assets", cash_flow: "revenue" };

const state = {};

export function renderAnalysisApp(container, confirmed) {
  state.confirmed = confirmed;
  state.peer = null;
  state.bases = {
    income_statement: defaultBaseKey("income_statement"),
    balance_sheet: defaultBaseKey("balance_sheet"),
    cash_flow: defaultBaseKey("cash_flow"),
  };
  state.mode = "common";       // "common" | "yoy"
  state.heatmap = false;
  state.meta = { ticker: "", bse: "", sector: "" };               // editable header fields
  state.theme = { "--sh-bg": "#ffffff", "--sh-text": "#1d1d1d", "--sh-head": "#3c7d3f" };

  container.innerHTML = `
    <div class="controlbar" id="a-controls"></div>
    <div id="a-linkbar"></div>
    <div id="a-connections"></div>
    <div id="a-insights"></div>
    <div id="a-sheets"></div>
    <h3 class="noprint-chart">P&amp;L Cost Structure (% of revenue)</h3>
    <div class="chartbox noprint-chart"><canvas id="a-chart" height="120"></canvas></div>
    <div id="a-peer"></div>`;

  applyTheme();
  initTermPanel();
  renderControls();
  renderLinkBar(document.getElementById("a-linkbar"), computeLinks(confirmed));
  renderConnections();
  renderInsights();
  rerender();
  renderChart();
}

function rerender() { renderTables(); renderPeer(); }

/* ---------- control bar ---------- */
function renderControls() {
  const el = document.getElementById("a-controls");
  el.innerHTML = `
    <div class="cb-group">
      <span class="cb-label">View</span>
      <button class="seg ${state.mode === "common" ? "on" : ""}" data-mode="common">Common-size %</button>
      <button class="seg ${state.mode === "yoy" ? "on" : ""}" data-mode="yoy">YoY change</button>
    </div>
    <label class="cb-check"><input type="checkbox" id="cb-heat" ${state.heatmap ? "checked" : ""}> Heatmap</label>
    <div class="cb-group cb-theme">
      <span class="cb-label">Colours</span>
      <label>Bg<input type="color" id="th-bg" value="${state.theme["--sh-bg"]}"></label>
      <label>Text<input type="color" id="th-text" value="${state.theme["--sh-text"]}"></label>
      <label>Headings<input type="color" id="th-head" value="${state.theme["--sh-head"]}"></label>
      <button class="seg" id="th-reset">Reset</button>
    </div>
    <div class="cb-group">
      <label class="cb-file">+ Add peer (JSON)<input type="file" id="cb-peer" accept=".json" hidden></label>
      ${state.peer ? `<button class="seg" id="cb-peerclear">Clear peer</button>` : ""}
    </div>
    <div class="cb-group cb-right">
      <button class="seg" id="cb-xlsx">⬇ Excel</button>
      <button class="seg" id="cb-pdf">⬇ PDF</button>
    </div>`;
  el.querySelectorAll("button[data-mode]").forEach((b) =>
    b.onclick = () => { state.mode = b.dataset.mode; renderControls(); rerender(); });
  el.querySelector("#cb-heat").onchange = (e) => { state.heatmap = e.target.checked; rerender(); };
  // colour pickers (live)
  el.querySelector("#th-bg").oninput = (e) => { state.theme["--sh-bg"] = e.target.value; applyTheme(); };
  el.querySelector("#th-text").oninput = (e) => { state.theme["--sh-text"] = e.target.value; applyTheme(); };
  el.querySelector("#th-head").oninput = (e) => { state.theme["--sh-head"] = e.target.value; applyTheme(); };
  el.querySelector("#th-reset").onclick = () => {
    state.theme = { "--sh-bg": "#ffffff", "--sh-text": "#1d1d1d", "--sh-head": "#3c7d3f" };
    applyTheme(); renderControls();
  };
  el.querySelector("#cb-peer").onchange = (e) => loadPeer(e.target.files[0]);
  const pc = el.querySelector("#cb-peerclear");
  if (pc) pc.onclick = () => { state.peer = null; renderControls(); renderPeer(); };
  el.querySelector("#cb-xlsx").onclick = () => exportExcel(buildViewModel());
  el.querySelector("#cb-pdf").onclick = () => exportPDF();
}

/* apply the chosen colours to the sheets via CSS variables.
   "Headings" drives all the green accents (title banner, section banner, borders). */
function applyTheme() {
  const r = document.documentElement.style;
  r.setProperty("--sh-bg", state.theme["--sh-bg"]);
  r.setProperty("--sh-text", state.theme["--sh-text"]);
  r.setProperty("--sh-head", state.theme["--sh-head"]);
  r.setProperty("--sh-banner", state.theme["--sh-head"]);
  r.setProperty("--sh-accent", state.theme["--sh-head"]);
}

function loadPeer(file) {
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try { state.peer = JSON.parse(fr.result); renderControls(); renderPeer(); }
    catch (e) { alert("Could not read peer JSON: " + e); }
  };
  fr.readAsText(file);
}

/* ---------- linking status bar ---------- */
function renderLinkBar(el, link) {
  const fails = link.checks.filter((c) => c.status === "fail");
  const warns = link.checks.filter((c) => c.status === "warn");
  const passes = link.checks.filter((c) => c.status === "pass");
  const tie = linksTieOut(link);
  let html = tie
    ? `<div class="vbar good">✓ Statements tie out — ${passes.length} link check(s) pass</div>`
    : `<div class="vbar bad">✗ Statements do not tie out — ${fails.length} break(s) found</div>`;
  if (fails.length || warns.length || link.notes.length) {
    html += `<ul class="vlist">`;
    for (const c of fails)
      html += `<li class="fail"><span class="tag">FAIL</span>${escapeHtml(c.link_name)} (${c.year}) — expected ${fmt(c.expected)}, got ${fmt(c.actual)}, diff ${fmt(c.difference)}</li>`;
    for (const c of warns)
      html += `<li class="warn"><span class="tag">WARN</span>${escapeHtml(c.link_name)} (${c.year}) — ${escapeHtml(c.detail)}</li>`;
    for (const note of link.notes) html += `<li class="note">${escapeHtml(note)}</li>`;
    html += `</ul>`;
  }
  if (passes.length)
    html += `<details class="passes"><summary>${passes.length} check(s) passed</summary><ul class="vlist">`
      + passes.map((c) => `<li class="pass"><span class="tag">PASS</span>${escapeHtml(c.link_name)} (${c.year})</li>`).join("") + `</ul></details>`;
  el.innerHTML = html;
}

/* ---------- "How the statements connect" — educational link panel ---------- */
const CONNECTIONS = [
  {
    match: "Retained earnings",
    title: "Profit → Retained Earnings",
    from: "Income Statement", fromItem: "Net Profit",
    to: "Balance Sheet", toItem: "Reserves & Surplus",
    what: "Each year's net profit (from the Income Statement), after any dividends are paid, is added to the company's accumulated profits — shown as “Reserves & Surplus” (Retained Earnings) on the Balance Sheet.",
    why: "Profit belongs to the owners. Whatever is not paid out as dividend stays inside the business and raises its net worth. So: last year's reserves + this year's profit − dividends = this year's reserves.",
    formula: "Opening reserves + Net profit − Dividends = Closing reserves",
  },
  {
    match: "Cash ties",
    title: "Closing Cash ties across statements",
    from: "Cash Flow", fromItem: "Closing Cash",
    to: "Balance Sheet", toItem: "Cash & Equivalents",
    what: "The Cash Flow Statement ends with a “closing cash” figure. That exact number appears as “Cash & cash equivalents” on the Balance Sheet for the same date.",
    why: "The Cash Flow Statement exists to explain how the cash balance moved during the year. Its ending figure is, by definition, the cash the company holds on the last day — which is what the Balance Sheet reports.",
    formula: "Closing cash (Cash Flow) = Cash & equivalents (Balance Sheet)",
  },
  {
    match: "PBT",
    title: "Profit Before Tax → Cash Flow",
    from: "Income Statement", fromItem: "Profit Before Tax",
    to: "Cash Flow", toItem: "Top of Operating Activities",
    what: "Under the indirect method, the Cash Flow Statement starts from Profit Before Tax (taken straight from the Income Statement), then adjusts for non-cash items and working-capital changes.",
    why: "Profit is measured on an accrual basis and includes non-cash items like depreciation. To find the actual cash generated, the Cash Flow Statement begins with that same profit figure and works back to cash.",
    formula: "Profit Before Tax (P&L) = first line of Operating Activities",
  },
];

function renderConnections() {
  const el = document.getElementById("a-connections");
  const link = computeLinks(state.confirmed);
  let html = `<div class="connwrap"><h3>How the three statements connect</h3>
    <p class="conn-intro">The Income Statement, Balance Sheet and Cash Flow are not three separate reports — they lock together through three links. Here's what each link <b>is</b>, <b>why</b> it exists, and whether it ties out for this company.</p>
    <div class="conn-grid">`;
  for (const c of CONNECTIONS) {
    const checks = link.checks.filter((k) => k.link_name.includes(c.match));
    const latest = checks[checks.length - 1];
    let badge = "", numbers;
    if (latest) {
      const cls = latest.status === "pass" ? "ok" : latest.status === "warn" ? "warn" : "bad";
      const word = latest.status === "pass" ? "✓ Ties out" : latest.status === "warn" ? "⚠ Review" : "✗ Doesn't tie";
      badge = `<span class="conn-badge ${cls}">${word}</span>`;
      numbers = `<div class="conn-num">For ${escapeHtml(latest.year)}: expected <b>₹${fmt(latest.expected)}</b> vs reported <b>₹${fmt(latest.actual)}</b>`
        + (latest.status === "pass" ? "" : ` — off by ₹${fmt(Math.abs(latest.difference))}`) + `</div>`;
    } else {
      numbers = `<div class="conn-num muted">Couldn't verify on this data (a needed line item wasn't found in the extraction).</div>`;
    }
    html += `<div class="conn-card">
      <div class="conn-flow">
        <span class="cf-box"><span>${c.from}</span><b>${c.fromItem}</b></span>
        <span class="cf-arrow">→</span>
        <span class="cf-box"><span>${c.to}</span><b>${c.toItem}</b></span>
      </div>
      <div class="conn-title">${escapeHtml(c.title)} ${badge}</div>
      <div class="conn-sec"><span class="conn-k">What it is</span>${escapeHtml(c.what)}</div>
      <div class="conn-sec"><span class="conn-k">Why it exists</span>${escapeHtml(c.why)}</div>
      <div class="conn-formula">${escapeHtml(c.formula)}</div>
      ${numbers}
    </div>`;
  }
  html += `</div><div class="disclaimer">Educational explanation of how financial statements link together — not investment advice.</div></div>`;
  el.innerHTML = html;
}

/* ---------- Feature 3: insights ---------- */
function renderInsights() {
  const el = document.getElementById("a-insights");
  const ins = generateInsights(state.confirmed);
  if (!ins.length) { el.innerHTML = ""; return; }
  const cls = (d) => d === "up" ? "dot-up" : d === "down" ? "dot-down" : "dot-neutral";
  el.innerHTML = `<div class="insights"><h3>Key Observations</h3><ul>`
    + ins.map((i) => `<li><span class="dot ${cls(i.dir)}"></span>${escapeHtml(i.text)}</li>`).join("")
    + `</ul><div class="disclaimer">Observations are derived only from the reported numbers, for information — not investment advice.</div></div>`;
}

// subtotal detection by label (extracted JSON may not carry an is_subtotal flag)
const SUBTOTAL_RE = /\b(gross profit|ebitda|ebit|operating profit|profit before tax|pbt|\bebt\b|net profit|profit for the year|profit after tax|total\b|total income|total expenses|total tax|total comprehensive|total assets|total equity|total liabilities|net cash|closing cash)\b/i;
const isSubtotal = (label) => SUBTOTAL_RE.test(label);

/* Merge rows that are the SAME line split across years by a label variation
   (e.g. "Profit before tax" [FY21-23] + "Profit before tax for the year" [FY24-25]
   from different yearly files). Only merges recognised lines with DISJOINT year
   coverage, so genuinely different rows are never combined. */
function coalesceRows(rows, periods) {
  const out = [];
  const firstIdx = new Map();          // canonicalKey -> index of the kept row in out
  for (const row of rows) {
    const populated = periods.filter((y) => row.abs && row.abs[y] != null);
    const k = canonicalKey(row.line_item || "");
    if (populated.length === 0 || k.startsWith("raw:")) { out.push(row); continue; }
    if (firstIdx.has(k)) {
      const prev = out[firstIdx.get(k)];
      const overlap = populated.some((y) => prev.abs[y] != null);
      if (!overlap) {                  // disjoint years -> same line, fold in
        for (const y of populated) { prev.abs[y] = row.abs[y]; prev.pct[y] = row.pct[y]; }
        if ((row.line_item || "").length > (prev.line_item || "").length) prev.line_item = row.line_item;
        prev.isBase = prev.isBase || row.isBase;
        continue;                      // drop the duplicate
      }
      out.push(row);                   // overlapping years -> keep both
    } else {
      firstIdx.set(k, out.length);
      out.push(row);
    }
  }
  return out;
}

// sub-clause markers that imply a deeper indent: "(i)", "(a)", "(1)", "A (i)", "I."
const SUBMARKER_RE = /^([A-D]\s*)?\(\s*([ivxlcdm]+|[a-z]|\d{1,2})\s*\)|^[ivx]{1,4}\.\s/i;

/* ---------- Excel/Dabur sheet: Particulars | Notes | years,
   each value row followed by a Growth-rate (base) or Margin (others) row ---- */
function renderTables() {
  const el = document.getElementById("a-sheets");
  const c = state.confirmed;
  const periods = sortPeriods(c.periods);
  const company = escapeHtml(c.company_name || "Company");
  const units = unitsLabel(c.units);
  const m = state.meta;
  // the full company heading, repeated at the top of EACH statement sheet
  const headHTML = () => `
      <div class="sheet-hdr">
        <div class="co">${company}</div>
        <div class="meta"><input class="metaedit" data-meta="ticker" value="${escapeHtml(m.ticker)}" placeholder="TICKER" size="10"> | BSE Code: <input class="metaedit" data-meta="bse" value="${escapeHtml(m.bse)}" placeholder="—" size="8">)</div>
        <div class="meta">Sector: <input class="metaedit" data-meta="sector" value="${escapeHtml(m.sector)}" placeholder="—" size="28"></div>
      </div>
      <div class="sheet-title">Historical Financial Statement — ${company} <span class="units-note">(${units})</span></div>`;
  let html = "";
  for (const key of ["income_statement", "balance_sheet", "cash_flow"]) {
    const cs = commonSizeForStatement(c, key, state.bases[key]);
    const yoy = computeYoYForStatement(c, key);
    const yoyBy = new Map(yoy.rows.map((r) => [r.line_item, r]));
    const notesBy = new Map((c[key] || []).map((r) => [r.line_item, r.note_ref ?? r.note ?? ""]));
    // indent level straight from the extractor when it provided one (most reliable)
    const indentBy = new Map((c[key] || []).map((r) => [r.line_item, r.indent == null ? null : Number(r.indent)]));

    html += `<div class="sheet">${headHTML()}`;
    html += `<div class="xl-banner">${SECTION_TITLES[key]} ${baseSelectHTML(key, cs)}</div>`;
    if (!cs.rows.length) { html += `<div class="empty-row">— no data —</div></div>`; continue; }
    html += `<div class="xl-scroll"><table class="xl"><thead><tr><th class="lbl">Particulars</th><th class="notes">Notes</th>`
      + periods.map((y) => `<th class="num">${fmtPeriod(y)}</th>`).join("") + `</tr></thead><tbody>`;

    // Generic hierarchy: section headers (no values) open a group (children +1);
    // headers ending ":" open a deeper sub-group; "(i)/(a)/A (i)" markers indent
    // one more; subtotals snap back to level 0. Works for any company's labels.
    let childBase = 1;
    const rows = coalesceRows(cs.rows, periods);   // fold same-line rows split across years
    for (const row of rows) {
      const yr = yoyBy.get(row.line_item) || { yoyPct: {}, yoyAbs: {} };
      const label = row.line_item;
      const hasVal = periods.some((y) => row.abs[y] != null);
      const endsColon = /:\s*$/.test(label.trim());
      const sub = isSubtotal(label);

      // heuristic level (also keeps childBase in sync); header detection FIRST so a
      // "... attributable to:" header isn't mistaken for a subtotal.
      let hLevel;
      if (!hasVal || endsColon) {
        if (endsColon) { hLevel = 1; childBase = 2; }
        else { hLevel = 0; childBase = 1; }
      } else if (sub) { hLevel = 0; childBase = 1; }
      else { hLevel = childBase + (SUBMARKER_RE.test(label.trim()) ? 1 : 0); }

      // prefer the indent the extractor recorded; fall back to the heuristic
      const exIndent = indentBy.get(label);
      let level = (exIndent != null && !Number.isNaN(exIndent)) ? exIndent : hLevel;
      if (level > 3) level = 3; if (level < 0) level = 0;
      const pad = 12 + level * 18;                      // indent the label cell
      const weight = level >= 2 ? "400" : "600";

      // pure label, no numbers -> a heading. Top-level (level 0) = green section
      // banner; a NESTED parent (e.g. "Financial assets") = bold parent row that
      // keeps its empty value cells so the structure stays intact.
      if (!hasVal) {
        if (level <= 0) {
          html += `<tr class="xl-group"><td colspan="${periods.length + 2}" style="padding-left:${pad}px">${escapeHtml(label)}</td></tr>`;
        } else {
          html += `<tr class="xl-parent"><td class="lbl" style="padding-left:${pad}px">${escapeHtml(label)}${infoBtn(label)}</td><td class="notes"></td>`
            + periods.map(() => `<td class="num"></td>`).join("") + `</tr>`;
        }
        continue;
      }

      const note = escapeHtml(String(notesBy.get(label) || ""));
      html += `<tr class="xl-val${sub ? " xtot" : ""}${row.isBase ? " xbase" : ""}">`
        + `<td class="lbl" style="padding-left:${pad}px;font-weight:${weight}">${escapeHtml(label)}${infoBtn(label)}</td><td class="notes">${note}</td>`
        + periods.map((y) => {
            const a = row.abs[y];
            const bg = heatBg(label, yr.yoyPct[y], state.heatmap);
            return `<td class="num"${bg ? ` style="background:${bg}"` : ""}>${a == null ? "" : fmtMoney(a)}</td>`;
          }).join("") + `</tr>`;

      // sub-row: Growth rate (revenue base) or Margin (others) in common mode; YoY in yoy mode
      const subPad = pad + 14;
      if (state.mode === "common") {
        const subLabel = row.isBase ? "Growth rate" : "Margin";
        html += `<tr class="xl-sub"><td class="lbl" style="padding-left:${subPad}px">${subLabel}</td><td class="notes"></td>`
          + periods.map((y) => {
              const v = row.isBase ? yr.yoyPct[y] : row.pct[y];
              if (v == null) return `<td class="num"></td>`;
              if (v === "n/m") return `<td class="num">n/m</td>`;
              return `<td class="num">${v.toFixed(1)}%</td>`;
            }).join("") + `</tr>`;
      } else {
        html += `<tr class="xl-sub"><td class="lbl" style="padding-left:${subPad}px">YoY Δ</td><td class="notes"></td>`
          + periods.map((y) => {
              const p = yr.yoyPct[y];
              if (p == null) return `<td class="num"></td>`;
              return `<td class="num">${p === "n/m" ? "n/m" : (p >= 0 ? "+" : "") + p.toFixed(1) + "%"}</td>`;
            }).join("") + `</tr>`;
      }
    }
    html += `</tbody></table></div></div>`;   // close table, .xl-scroll, .sheet
  }
  el.innerHTML = html;
  el.querySelectorAll("select[data-stmt]").forEach((s) =>
    s.onchange = () => { state.bases[s.dataset.stmt] = s.value; rerender(); });
  el.querySelectorAll("button[data-reset]").forEach((b) =>
    b.onclick = () => { state.bases[b.dataset.reset] = defaultBaseKey(b.dataset.reset); rerender(); });
  // keep the repeated header fields (ticker/BSE/sector) in sync as the user types
  el.querySelectorAll("input[data-meta]").forEach((inp) => {
    inp.oninput = () => {
      const k = inp.dataset.meta; state.meta[k] = inp.value;
      el.querySelectorAll(`input[data-meta="${k}"]`).forEach((o) => { if (o !== inp) o.value = inp.value; });
    };
  });
}

/* ₹ money format, Indian grouping, 2 decimals (matches the Excel model) */
function fmtMoney(v) {
  if (v == null) return "";
  const n = Number(v);
  const s = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? "-₹" : "₹") + s;
}

function baseSelectHTML(key, cs) {
  const opts = BASE_OPTIONS[key].map((o) =>
    `<option value="${o.key}" ${o.key === state.bases[key] ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
  const isDefault = state.bases[key] === defaultBaseKey(key);
  const notFound = cs.baseFound ? "" : ` <span class="warnsmall">(base not found)</span>`;
  return `<span class="baseselect">base: <select data-stmt="${key}">${opts}</select>`
    + (isDefault ? "" : ` <button class="linklike" data-reset="${key}">reset to standard</button>`) + notFound + `</span>`;
}

/* ---------- Feature 5: peer comparison ---------- */
function renderPeer() {
  const el = document.getElementById("a-peer");
  if (!state.peer) { el.innerHTML = ""; return; }
  const baseKey = state.bases.income_statement;
  const peer = alignPeers(state.confirmed, state.peer, "income_statement", baseKey);
  const cell = (p) => `<td class="num pc">${p == null ? "-" : p.toFixed(1) + "%"}</td>`;
  let html = `<h3>Peer Comparison — ${escapeHtml(peer.a.name)} vs ${escapeHtml(peer.b.name)} <span class="meta">P&amp;L · % of ${peer.base}</span></h3>`;
  html += `<table class="dabur peer"><thead>
      <tr><th rowspan="2">Particulars</th>
        <th colspan="${peer.a.periods.length}" class="grpA">${escapeHtml(peer.a.name)}</th>
        <th colspan="${peer.b.periods.length}" class="grpB">${escapeHtml(peer.b.name)}</th></tr>
      <tr>${peer.a.periods.map((y) => `<th class="num">${fmtPeriod(y)}</th>`).join("")}
          ${peer.b.periods.map((y) => `<th class="num">${fmtPeriod(y)}</th>`).join("")}</tr>
    </thead><tbody>`;
  for (const row of peer.rows)
    html += `<tr><td>${escapeHtml(row.label)}</td>`
      + peer.a.periods.map((y) => cell(row.aPct[y])).join("")
      + peer.b.periods.map((y) => cell(row.bPct[y])).join("") + `</tr>`;
  html += `</tbody></table><div class="chartbox"><canvas id="a-peerchart" height="110"></canvas></div>`;
  el.innerHTML = html;
  renderPeerChart(peer);
}

function renderPeerChart(peer) {
  const canvas = document.getElementById("a-peerchart");
  if (!canvas || typeof window === "undefined" || !window.Chart) return;
  const netRow = peer.rows.find((r) => r.key === "net_profit");
  if (!netRow) return;
  const years = sortPeriods([...new Set([...peer.a.periods, ...peer.b.periods])]);
  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new window.Chart(canvas, {
    type: "bar",
    data: { labels: years.map(fmtPeriod), datasets: [
      { label: peer.a.name, data: years.map((y) => netRow.aPct[y] ?? null), backgroundColor: "#c9982a" },
      { label: peer.b.name, data: years.map((y) => netRow.bPct[y] ?? null), backgroundColor: "#157a4c" },
    ]},
    options: { responsive: true,
      plugins: { legend: { labels: { color: "#777062" } },
        title: { display: true, text: "Net profit margin (% of revenue)", color: "#777062" } },
      scales: { x: { ticks: { color: "#777062" }, grid: { color: "#e3dcc9" } },
                y: { ticks: { color: "#777062", callback: (v) => v + "%" }, grid: { color: "#e3dcc9" } } } },
  });
}

/* ---------- Chart.js: P&L cost structure ---------- */
function renderChart() {
  const canvas = document.getElementById("a-chart");
  if (!canvas || typeof window === "undefined" || !window.Chart) return;
  const cs = commonSizeForStatement(state.confirmed, "income_statement", "revenue");
  const rows = cs.rows, periods = sortPeriods(state.confirmed.periods);
  const pick = (kw) => { const f = rows.find((r) => kw.some((k) => normLabel(r.line_item).includes(k))); return f ? f.pct : {}; };
  const sumPick = (kw) => { const o = {}; for (const y of periods) { let s = null; for (const r of rows) if (kw.some((k) => normLabel(r.line_item).includes(k)) && r.pct[y] != null) s = (s || 0) + r.pct[y]; o[y] = s; } return o; };
  const cogs = pick(["cost of materials", "cost of goods", "cost of sales", "cost of revenue"]);
  const opex = sumPick(["other expenses", "employee benefit", "operating expenses", "selling", "administrative"]);
  const tax = pick(["tax expense", "income tax", "current tax"]);
  const net = pick(["profit for the year", "net profit", "profit after tax"]);
  const ds = [
    { label: "COGS", data: periods.map((y) => abs(cogs[y])), backgroundColor: "#c9982a" },
    { label: "OpEx", data: periods.map((y) => abs(opex[y])), backgroundColor: "#8a6a15" },
    { label: "Tax", data: periods.map((y) => abs(tax[y])), backgroundColor: "#777062" },
    { label: "Net Profit", data: periods.map((y) => abs(net[y])), backgroundColor: "#157a4c" },
  ];
  if (canvas._chart) canvas._chart.destroy();
  canvas._chart = new window.Chart(canvas, {
    type: "bar",
    data: { labels: periods.map(fmtPeriod), datasets: ds.map((s) => ({ ...s, stack: "cs" })) },
    options: { responsive: true,
      plugins: { legend: { labels: { color: "#777062" } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${(+c.parsed.y).toFixed(1)}%` } } },
      scales: { x: { stacked: true, ticks: { color: "#777062" }, grid: { color: "#e3dcc9" } },
                y: { stacked: true, ticks: { color: "#777062", callback: (v) => v + "%" }, grid: { color: "#e3dcc9" } } } },
  });
}

/* ---------- export view-model (reflects current selections) ---------- */
function buildViewModel() {
  const c = state.confirmed, periods = sortPeriods(c.periods);
  const sections = ["income_statement", "balance_sheet", "cash_flow"].map((key) => {
    const cs = commonSizeForStatement(c, key, state.bases[key]);
    const yoy = computeYoYForStatement(c, key);
    const yoyBy = new Map(yoy.rows.map((r) => [r.line_item, r]));
    const rows = cs.rows.map((row) => {
      const yr = yoyBy.get(row.line_item) || { yoyPct: {} };
      const secondary = {};
      for (const y of periods) secondary[y] = state.mode === "yoy" ? yr.yoyPct[y] : row.pct[y];
      return { label: row.line_item, isBase: row.isBase, values: row.abs, secondary };
    });
    return { title: SECTION_TITLES[key], base: cs.base, periods, rows };
  });
  return { company: c.company_name || "Company", units: c.units, mode: state.mode, sections };
}

/* ---------- helpers ---------- */
function abs(x) { return x == null ? 0 : x; }
function unitsLabel(units) {
  const u = String(units || "").toLowerCase();
  if (u.startsWith("cr")) return "INR (Cr.)";
  if (u.startsWith("lakh") || u.startsWith("lac")) return "INR (Lakhs)";
  return `INR (${escapeHtml(units || "Absolute")})`;
}
function fmtPeriod(p) { const m = String(p).match(/(\d{4})/); return m ? `FY-${m[1]}` : escapeHtml(p); }
function fmt(v) { return v == null ? "-" : Number(v).toLocaleString("en-IN", { maximumFractionDigits: 1 }); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/* ---------- "What is this?" info button + side panel ---------- */
const termCache = new Map();   // session cache: term_key -> explanation
function infoBtn(label) {
  const t = escapeHtml(label);
  return `<button class="infobtn" data-term="${t}" title="What is this?" aria-label="What is ${t}?">ⓘ</button>`;
}

function initTermPanel() {
  if (initTermPanel._wired) return;          // wire the global listeners once
  initTermPanel._wired = true;
  document.getElementById("tp-close").onclick = closeTermPanel;
  document.getElementById("term-overlay").onclick = closeTermPanel;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTermPanel(); });
  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest(".infobtn");
    if (btn) { e.preventDefault(); openTermPanel(btn.dataset.term); }
  });
}

function openTermPanel(term) {
  const panel = document.getElementById("term-panel");
  const overlay = document.getElementById("term-overlay");
  const body = document.getElementById("tp-body");
  document.getElementById("tp-title").textContent = term;
  document.getElementById("tp-google").href =
    "https://www.google.com/search?q=" + encodeURIComponent(`"${term}" meaning in financial statements`);
  panel.classList.add("open"); overlay.classList.add("show"); panel.setAttribute("aria-hidden", "false");

  const key = term.trim().toLowerCase();
  if (termCache.has(key)) { body.innerHTML = `<div>${escapeHtml(termCache.get(key))}</div>`; return; }

  body.innerHTML = `<div class="tp-loading"><span class="tp-spin"></span> Looking it up…</div>`;
  const fail = () => { body.innerHTML = `<div class="tp-err">Couldn't load the explanation right now — try the Google option below.</div>`; };
  fetch("/api/term", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ term }) })
    .then((r) => r.json())
    .then((d) => {
      if (d && d.ok && d.explanation) {
        termCache.set(key, d.explanation);
        body.innerHTML = `<div>${escapeHtml(d.explanation)}</div>`
          + (d.source === "gemini" ? `<div class="tp-src">Generated &amp; saved — instant next time.</div>` : "");
      } else { fail(); }
    })
    .catch(fail);
}

function closeTermPanel() {
  const panel = document.getElementById("term-panel");
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  document.getElementById("term-overlay").classList.remove("show");
}
