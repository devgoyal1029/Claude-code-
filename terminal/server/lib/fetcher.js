/* =============================================================================
 * fetcher.js — one HTTP client for every provider.
 * Timeouts, retry with backoff, a browser UA (several sources 403 without it),
 * an in-memory TTL cache, and per-host health tracking so /api/health can say
 * which feeds are actually working.
 * ========================================================================== */

'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const cache = new Map();          // key -> { at, ttl, value }
const health = new Map();         // host -> { ok, fail, lastError, lastOkAt }

function hostOf(url) { try { return new URL(url).host; } catch (_) { return url; } }

function note(url, ok, err) {
  const h = hostOf(url);
  const e = health.get(h) || { ok: 0, fail: 0, lastError: null, lastOkAt: null };
  if (ok) { e.ok++; e.lastOkAt = Date.now(); e.lastError = null; }
  else { e.fail++; e.lastError = String(err && err.message || err).slice(0, 200); }
  health.set(h, e);
}

async function raw(url, opts = {}) {
  const {
    timeout = 9000, retries = 2, headers = {}, json = true, method = 'GET', body
  } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        method, body, signal: ctrl.signal,
        headers: {
          'User-Agent': UA,
          'Accept': json ? 'application/json,text/plain,*/*' : 'application/rss+xml,application/xml,text/xml,*/*',
          'Accept-Language': 'en-IN,en;q=0.9',
          ...headers
        }
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = json ? await res.json() : await res.text();
      note(url, true);
      return out;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await sleep(280 * Math.pow(2, attempt));
    }
  }
  note(url, false, lastErr);
  throw lastErr;
}

/* Cached fetch. `ttl` in ms. Stale data is served if the upstream fails, so a
   blip never blanks the site. */
async function cached(key, ttl, producer) {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttl) return hit.value;
  try {
    const value = await producer();
    cache.set(key, { at: now, ttl, value });
    return value;
  } catch (err) {
    if (hit) {
      hit.stale = true;
      return hit.value;           // serve stale rather than fail
    }
    throw err;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = {
  raw,
  json: (url, opts) => raw(url, { ...opts, json: true }),
  text: (url, opts) => raw(url, { ...opts, json: false }),
  cached,
  cacheStats: () => ({ entries: cache.size }),
  clearCache: () => cache.clear(),
  health: () => Object.fromEntries(health),
  UA
};
