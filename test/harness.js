/* ============================================================================
   InvestVerdict test harness — runs the REAL production code end-to-end in Node.
   Extracts the <script> block from index.html, executes it in a VM sandbox with
   a stub DOM, then drives buildProfile → simulateInvestor → finalizeTrail →
   renderDashboard for a scenario and returns every score, allocation, waterfall
   figure and rendered HTML section for assertion.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function extractAppScript() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  // the last, main <script> block (no src attribute)
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!blocks.length) throw new Error('No inline <script> block found in index.html');
  return blocks[blocks.length - 1];
}

function makeElementStub(id, form) {
  const el = {
    _id: id,
    innerHTML: '',
    textContent: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {},
    style: {},
    addEventListener() {},
    focus() {},
    scrollIntoView() {},
    getContext() {
      return new Proxy({}, { get: () => () => {} });
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
  };
  Object.defineProperty(el, 'value', {
    get() { return Object.prototype.hasOwnProperty.call(form, id) ? String(form[id]) : ''; },
    set(v) { form[id] = v; },
  });
  return el;
}

/* Build a sandbox running the page script. `form` maps element id -> value,
   `chips` maps chip-group id -> selected data-val. */
function createApp(form, chips) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElementStub(id, form));
      return elements.get(id);
    },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    addEventListener() {},
  };
  class FakeChart {
    constructor() {}
    destroy() {}
  }
  const sandbox = {
    console, Math, Date, JSON, Number, Object, Array, String, parseInt, parseFloat,
    isNaN, isFinite, setTimeout: (fn) => fn(), alert() {}, confirm() { return true; },
    addEventListener() {}, scrollTo() {},
    document,
    Chart: FakeChart,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // Load the real methodology engine, then the real page script.
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'methodology-engine.js'), 'utf8'), sandbox, { filename: 'methodology-engine.js' });
  vm.runInContext(extractAppScript(), sandbox, { filename: 'index-inline.js' });
  // Redirect chip readers at the selected values for this scenario.
  vm.runInContext(`
    getChips = function (groupId) { return __CHIPS[groupId] ? [].concat(__CHIPS[groupId]) : []; };
    getChip = function (groupId) { return getChips(groupId)[0] || null; };
  `, sandbox);
  sandbox.__CHIPS = chips;

  return {
    sandbox,
    elements,
    run() {
      const out = vm.runInContext(`(function(){
        const profile = buildProfile();
        IVMethodology.validateAgainstManualExample();
        const trail = IVMethodology.simulateInvestor(profile);
        finalizeTrail(trail, profile);
        renderDashboard(profile, trail);
        return { profile, trail };
      })()`, sandbox);
      const html = {};
      for (const [id, el] of elements) if (el.innerHTML) html[id] = el.innerHTML;
      return { profile: out.profile, trail: out.trail, html };
    },
    call(expr) { return vm.runInContext(expr, sandbox); },
  };
}

/* ---------- assertion helpers -------------------------------------------- */
let failures = 0, checks = 0;
function check(cond, label) {
  checks++;
  if (!cond) { failures++; console.log('  ❌ FAIL: ' + label); }
  return cond;
}
function approx(a, b, tol, label) {
  return check(Math.abs(a - b) <= tol, `${label} (got ${a}, expected ${b} ±${tol})`);
}

function stripTags(s) { return String(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); }

function commonInvariantChecks(name, res) {
  const { profile: p, trail: t, html } = res;
  const ca = t.core_allocation, sub = t.equity_sub_allocation;
  approx(ca.equity_pct + ca.debt_pct + ca.gold_pct + ca.cash_pct, 100, 0.25, `${name}: core allocation sums to 100`);
  approx(sub.large_cap_pct + sub.mid_cap_pct + sub.small_cap_pct + sub.international_pct, 100, 0.25, `${name}: equity sub-allocation sums to 100`);
  for (const [k, v] of Object.entries({ equity: ca.equity_pct, debt: ca.debt_pct, gold: ca.gold_pct, cash: ca.cash_pct }))
    check(v >= 0 && v <= 100, `${name}: ${k} in [0,100] (got ${v})`);
  // ceilings respected (small time-horizon adjustment allowed on top)
  check(ca.equity_pct <= Math.max(ca.capacity_ceiling_pct, 10) + 10.01, `${name}: equity ≤ capacity ceiling + horizon adj (${ca.equity_pct} vs ${ca.capacity_ceiling_pct})`);
  check(ca.equity_pct <= Math.max(ca.tolerance_ceiling_pct, 10) + 10.01, `${name}: equity ≤ tolerance ceiling + horizon adj (${ca.equity_pct} vs ${ca.tolerance_ceiling_pct})`);
  // every engine score in range
  for (const key of ['behaviour','financial_capacity','risk_tolerance','risk_requirement','wealth_dna','goal_criticality','retirement_readiness','liquidity_health','master_classification','portfolio_eligibility','master_equity_score'])
    check(t[key].score >= 0 && t[key].score <= 100, `${name}: ${key} score in [0,100] (got ${t[key].score})`);
  // waterfall reconciliation
  const wf = p.waterfall;
  check(wf, `${name}: waterfall computed`);
  if (wf) {
    if (wf.postCutFreeCashFlow > 0) {
      approx(wf.monthlyBuffer + wf.deployable, wf.postCutFreeCashFlow, 1, `${name}: buffer + deployable = post-cut free cash`);
      check(wf.totalRecommendedOutflowNow <= wf.deployable + 1, `${name}: recommended outflow ≤ deployable (${wf.totalRecommendedOutflowNow} vs ${wf.deployable})`);
    } else {
      check(wf.sip.steadyState === 0 && wf.sip.affordableNow === 0, `${name}: no SIP recommended when free cash ≤ 0`);
    }
    check(wf.protection.combinedPremium >= 0, `${name}: protection premium non-negative`);
    // If a health cover is claimed, a premium must be budgeted for it (and vice versa)
    check((wf.protection.healthCover > 0) === (wf.protection.healthPremium > 0), `${name}: health cover claimed iff premium budgeted (cover ${wf.protection.healthCover}, premium ${wf.protection.healthPremium})`);
  }
  // retirement math cross-check (independent recomputation)
  const expectTarget = Math.round((p.postWorkMonthlyExpense) * 12 * 25 * Math.pow(1.06, p.yearsToRetirement));
  approx(p.retirementTarget, expectTarget, Math.max(2, expectTarget * 0.0001), `${name}: retirement target = 25× expenses inflated`);
  // requiredSIP actually closes the gap
  if (p.requiredSIP > 0) {
    const er = res.blended;
    const r = er / 100 / 12, n = p.yearsToRetirement * 12;
    const fv = p.requiredSIP * ((Math.pow(1 + r, n) - 1) / r);
    const total = fv + p.componentA_retirement;
    check(total >= p.retirementTarget * 0.995, `${name}: requiredSIP + Component A reaches target (${Math.round(total)} vs ${p.retirementTarget})`);
  }
  // rendered output must never contain NaN / Infinity / undefined / ₹NaN
  for (const [id, content] of Object.entries(html)) {
    const text = stripTags(content);
    for (const bad of ['NaN', 'Infinity', 'undefined', '₹-2147', 'null']) {
      check(!text.includes(bad), `${name}: rendered #${id} contains "${bad}" → "${text.slice(Math.max(0, text.indexOf(bad) - 60), text.indexOf(bad) + 60)}"`);
    }
  }
  return { ca, sub, wf };
}

/* ---------- scenario definitions ------------------------------------------ */
const baseChips = {
  'chips-exp': ['3-5'], 'chips-dna': ['growth'], 'chips-goal': ['wealth'],
  'chips-return': ['moderate'], 'chips-ret-dep': ['1'],
  'chips-react': ['hold'], 'chips-volatility': ['moderate'],
  'chips-decision': ['research'], 'chips-regret': ['learn'],
  'chips-money-rel': ['freedom-focus'],
};
const baseForm = {
  's0-name': 'Test', 's0-age': 32, 's0-retire': 60, 's0-dep': 1,
  's0-life': 'married-no-kids', 's0-emp': 'salaried-private', 's1-stability': 'fixed',
  's1-income': 100000,
  's1-exp-housing': 20000, 's1-exp-emi': 0, 's1-exp-household': 15000,
  's1-exp-lifestyle': 10000, 's1-exp-insurance': 2000, 's1-exp-other': 5000,
  's1-sip': 20000, 's1-emi-months': 0, 's1-loan-out': 0,
  's1-term': 0, 's1-health': 'none', 's1-emfund': '6',
  's2-hor': 15, 's2-nearest': 3, 's2-ret-exp': '60000', 's2-ret-sav': 'moderate',
  's2-consequence': 'moderate', 's2-flexibility': 'flexible',
  's3-loss-av': 'neutral', 's3-overconf': 'neutral', 's3-herd': 'neutral',
  's3-recency': 'neutral', 's3-mental': 'neutral', 's3-confirm': 'neutral',
};

function scenario(name, formOverride, chipsOverride) {
  const form = Object.assign({}, baseForm, formOverride);
  const chips = Object.assign({}, JSON.parse(JSON.stringify(baseChips)), chipsOverride || {});
  const app = createApp(form, chips);
  const res = app.run();
  res.blended = app.call(`blendedReturn(${JSON.stringify(res.trail.core_allocation)})`);
  res.app = app;
  console.log(`\n━━━ ${name} ━━━`);
  return res;
}

module.exports = { createApp, scenario, check, approx, commonInvariantChecks, stripTags, summary: () => ({ checks, failures }) };
