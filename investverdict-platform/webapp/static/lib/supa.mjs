/**
 * Supabase cloud persistence for the InvestVerdict tool — PURE fetch, no SDK.
 *
 * Design rules:
 *  - FAIL-OPEN: the cloud being down/unconfigured must NEVER break the tool.
 *    Every function resolves to { ok:false } instead of throwing.
 *  - No login by design. Identity = the master site's profile:
 *    opening any screen with  ?profile=<profiles.id uuid>  binds this browser
 *    to that profile (persisted in localStorage) and tags every save with it.
 *    Without a profile the tool saves under owner "anon".
 *  - Runtime override (used by the master site and by tests):
 *    localStorage "iv_supa" = {"url":"...","key":"..."}.
 */

import { SUPABASE_URL, SUPABASE_KEY } from "./config.mjs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function conn() {
  try {
    const o = JSON.parse(localStorage.getItem("iv_supa") || "null");
    if (o && o.url && o.key) return { url: o.url.replace(/\/+$/, ""), key: o.key };
  } catch { /* fall through */ }
  return { url: SUPABASE_URL, key: SUPABASE_KEY };
}

/** Capture ?profile=<uuid> from the master site; remember it for the session. */
export function profileId() {
  try {
    const q = new URLSearchParams(location.search).get("profile");
    if (q && UUID_RE.test(q)) { localStorage.setItem("iv_profile", q); return q; }
    const saved = localStorage.getItem("iv_profile");
    return saved && UUID_RE.test(saved) ? saved : null;
  } catch { return null; }
}
export const ownerKey = () => profileId() || "anon";

async function rest(path, { method = "GET", body, prefer } = {}) {
  const { url, key } = conn();
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method, headers, signal: ctrl.signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) return { ok: false, status: res.status, error: (data && data.message) || text };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally { clearTimeout(t); }
}

const companyKey = (name) => String(name || "").trim().toLowerCase();

/**
 * Upsert a patch into this browser's row for the CURRENT company (identified
 * by iv_confirmed.company_name). Only the provided columns change — PostgREST
 * merge-duplicates leaves the rest untouched. Silently does nothing when no
 * company is confirmed yet.
 */
export async function cloudPatch(patch = {}) {
  let confirmed = null;
  try { confirmed = JSON.parse(sessionStorage.getItem("iv_confirmed") || "null"); } catch { /* ignore */ }
  const name = (confirmed && confirmed.company_name) || patch.company_name;
  if (!name) return { ok: false, error: "no company to save" };
  const row = {
    owner_key: ownerKey(),
    company_key: companyKey(name),
    company_name: name,
    profile_id: profileId(),
    ...patch,
  };
  delete row.company_name_override;
  const res = await rest("iv_analyses?on_conflict=owner_key,company_key",
    { method: "POST", body: [row], prefer: "resolution=merge-duplicates,return=minimal" });
  if (res.ok) toast("☁ saved to cloud");
  return res;
}

/** Convenience wrappers used by the screens. Forecast/valuation screens
 *  recompute on EVERY input keystroke, so those saves are debounced — only the
 *  settled state (1.5s of quiet) reaches Supabase. */
export const saveStatements = (confirmed) =>
  cloudPatch({ statements: confirmed, units: confirmed.units || null, company_name: confirmed.company_name });

const debounces = {};
function debounced(name, fn, ms = 1500) {
  clearTimeout(debounces[name]);
  debounces[name] = setTimeout(fn, ms);
}
export const saveForecast = (model) =>
  debounced("forecast", () => cloudPatch({ forecast: model }));
export const saveValuations = () =>
  debounced("valuations", () => {
    let valuations = null, market = null;
    try { valuations = JSON.parse(sessionStorage.getItem("iv_valuations") || "null"); } catch { /* ignore */ }
    try { market = JSON.parse(sessionStorage.getItem("iv_market") || "null"); } catch { /* ignore */ }
    if (valuations || market) cloudPatch({ valuations, market });
  });

/** Dashboard library: newest first, this owner's rows. */
export function listAnalyses() {
  return rest(`iv_analyses?owner_key=eq.${encodeURIComponent(ownerKey())}` +
    `&select=company_key,company_name,units,updated_at,statements,forecast,valuations,market` +
    `&order=updated_at.desc&limit=50`);
}

/** Load a saved company back into the session and hand off to the screens. */
export function hydrateSession(row) {
  try {
    if (row.statements) sessionStorage.setItem("iv_confirmed", JSON.stringify(row.statements));
    if (row.forecast) sessionStorage.setItem("iv_forecast", JSON.stringify(row.forecast));
    if (row.valuations) sessionStorage.setItem("iv_valuations", JSON.stringify(row.valuations));
    if (row.market) sessionStorage.setItem("iv_market", JSON.stringify(row.market));
    return true;
  } catch { return false; }
}

export function deleteAnalysis(company_key) {
  return rest(`iv_analyses?owner_key=eq.${encodeURIComponent(ownerKey())}` +
    `&company_key=eq.${encodeURIComponent(company_key)}`, { method: "DELETE" });
}

/** Tiny non-blocking toast so saves are visible without being noisy. */
let toastTimer = null;
export function toast(msg) {
  try {
    let el = document.getElementById("iv-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "iv-toast";
      el.style.cssText = "position:fixed;bottom:18px;right:18px;z-index:999;padding:9px 16px;" +
        "border-radius:9px;background:#20272f;color:#f6f3ec;font:500 12.5px 'DM Sans',sans-serif;" +
        "box-shadow:0 8px 24px -10px rgba(31,28,20,.45);opacity:0;transition:opacity .25s;pointer-events:none;";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = "1";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = "0"; }, 2200);
  } catch { /* never break the page over a toast */ }
}
