/**
 * Ratio Analysis screen UI. DOM only; math in ratios.mjs. White Excel grid,
 * collapsible categories, click-to-expand rows (formula + per-year calc + meaning),
 * inline sparklines, forecast columns tinted, optional market inputs for valuation.
 */

import { computeRatios, fmtRatio, f } from "./ratios.mjs";

const state = {};

export function renderRatiosApp(container, model) {
  state.model = model;
  let M = {}; try { M = JSON.parse(sessionStorage.getItem("iv_market") || "{}"); } catch (e) {}
  state.market = { price: M.price ?? null, shares: M.shares ?? null };
  state.collapsed = new Set();
  state.expanded = new Set();

  container.innerHTML = `
    <div class="r-head">
      <h2>${esc(model.company_name || "Company")} <span class="meta">· ${esc(model.units || "")} · ratio analysis across all years</span></h2>
      <div class="r-market">
        <label>Market price ₹ <input type="number" step="any" id="r-price" placeholder="optional"></label>
        <label>Diluted shares <input type="number" step="any" id="r-shares" placeholder="optional"></label>
        <span class="hint">for valuation ratios (EPS, P/E, P/B…)</span>
      </div>
    </div>
    <p class="r-intro">Each ratio shows just its value by default. <b>Click any row</b> to reveal its formula, the actual numbers plugged in for every year, and what it means. Forecast years are tinted gold. Click a category header to collapse it.</p>
    <div class="sheet"><div class="xl-scroll" id="r-table"></div></div>
    <div class="disclaimer">Educational ratio analysis — describes what each number indicates, not buy/sell advice.</div>`;

  const price = container.querySelector("#r-price"), shares = container.querySelector("#r-shares");
  if (state.market.price != null) price.value = state.market.price;
  if (state.market.shares != null) shares.value = state.market.shares;
  const saveM = () => { try { sessionStorage.setItem("iv_market", JSON.stringify(state.market)); } catch (e) {} };
  price.oninput = () => { state.market.price = parseFloat(price.value) || null; saveM(); render(); };
  shares.oninput = () => { state.market.shares = parseFloat(shares.value) || null; saveM(); render(); };

  render();
  document.getElementById("r-table").addEventListener("click", onClick);
}

function onClick(e) {
  const cat = e.target.closest(".cat-row");
  if (cat) { const i = +cat.dataset.cat; state.collapsed.has(i) ? state.collapsed.delete(i) : state.collapsed.add(i); render(); return; }
  const row = e.target.closest(".ratio-row");
  if (row) { const id = row.dataset.rid; state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id); render(); }
}

function render() {
  const data = computeRatios(state.model, state.market);
  const periods = data.periods, fset = new Set(data.forecastPeriods);
  const ncol = periods.length + 1;
  let html = `<table class="xl ratios"><thead><tr><th class="lbl">Ratio</th>`
    + periods.map((p) => `<th class="num${fset.has(p) ? " fcol" : ""}">${fyLabel(p, fset.has(p))}</th>`).join("") + `</tr></thead><tbody>`;

  data.categories.forEach((c, ci) => {
    const collapsed = state.collapsed.has(ci);
    html += `<tr class="cat-row" data-cat="${ci}"><td colspan="${ncol}"><span class="caret">${collapsed ? "▸" : "▾"}</span> ${esc(c.name)}${c.needsMarket && !(state.market.price || state.market.shares) ? ` <span class="needs">— enter market price / shares to compute</span>` : ""}</td></tr>`;
    if (collapsed) return;
    c.ratios.forEach((r, ri) => {
      const rid = `${ci}-${ri}`;
      const vals = periods.map((p) => r.perYear[p].v);
      html += `<tr class="ratio-row" data-rid="${rid}"><td class="lbl"><span class="rname">${esc(r.name)}</span>${spark(vals, fset, periods)}</td>`
        + periods.map((p) => { const cell = r.perYear[p]; const fc = fset.has(p) ? " fcol" : "";
            return `<td class="num${fc}">${fmtRatio(cell.v, r.pct)}</td>`; }).join("") + `</tr>`;
      if (state.expanded.has(rid)) {
        let calc = periods.map((p) => {
          const cell = r.perYear[p];
          const val = fmtRatio(cell.v, r.pct);
          return `<div class="exp-line"><span class="exp-yr">${fyLabel(p, fset.has(p))}</span> ${esc(cell.detail)} ${cell.v == null ? "" : "= <b>" + val + "</b>"}${cell.firstYear && /Avg/.test(r.formula) ? " <i>(closing used — no prior year)</i>" : ""}</div>`;
        }).join("");
        html += `<tr class="ratio-exp"><td colspan="${ncol}">
          <div class="exp-formula"><b>Formula:</b> ${esc(r.formula)}</div>
          <div class="exp-calc">${calc}</div>
          <div class="exp-meaning">${esc(r.meaning)}</div></td></tr>`;
      }
    });
  });
  html += `</tbody></table>`;
  document.getElementById("r-table").innerHTML = html;
}

/* tiny inline sparkline of the ratio across years */
function spark(vals, fset, periods) {
  const pts = vals.map((v, i) => [i, v]).filter(([, v]) => v != null && Number.isFinite(v));
  if (pts.length < 2) return "";
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = 60, H = 16, spanX = (maxX - minX) || 1, spanY = (maxY - minY) || 1;
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${((x - minX) / spanX * W).toFixed(1)},${(H - (y - minY) / spanY * H).toFixed(1)}`).join(" ");
  return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path d="${d}" fill="none" stroke="#3c7d3f" stroke-width="1.3"/></svg>`;
}

function fyLabel(p, isF) { const m = String(p).match(/(\d{4})/); return (m ? `FY-${m[1]}` : esc(p)) + (isF ? "E" : ""); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
