/* ============================================================================
   Scenario tests for the InvestVerdict financial-planning algorithm.
   Runs the real production code (methodology-engine.js + index.html script)
   across normal AND complicated client cases and asserts financial soundness.
   Usage: node test/run-tests.js [--verbose]
   ========================================================================== */
'use strict';
const { createApp, scenario, check, approx, commonInvariantChecks, stripTags, summary } = require('./harness');
const VERBOSE = process.argv.includes('--verbose');

function show(res, ids) {
  if (!VERBOSE) return;
  for (const id of ids) if (res.html[id]) console.log(`\n  ── #${id} ──\n  ` + stripTags(res.html[id]).slice(0, 600));
}

/* ═══ Unit checks on the pure financial math ═══ */
{
  console.log('━━━ Unit: financial math ━━━');
  const app = createApp({ ...{} }, {});
  const fv = app.call('fvSIP(10000, 10, 12)');
  approx(fv, 2300387, 500, 'fvSIP(10000,10yr,12%) matches standard SIP maturity ≈ ₹23.0L');
  const req = app.call('reqSIP(2300387, 10, 12)');
  approx(req, 10000, 5, 'reqSIP inverts fvSIP');
  check(Number.isFinite(app.call('reqSIP(1000000, 10, 0)')), 'reqSIP at 0% return is finite');
  approx(app.call('reqSIP(1200000, 10, 0)'), 10000, 1, 'reqSIP at 0% = target/months');
  const emi = app.call('estimateEMI(5000000, 8.5, 20)');
  approx(emi, 43391, 60, 'estimateEMI(50L, 8.5%, 20y) ≈ ₹43,391');
  const fiT = app.call('fiCorpusTarget(50000, 0)');
  approx(fiT, 50000 * 12 * 25, 1, 'fiCorpusTarget year 0 = 25× annual expenses');
  // step-up FV: 2 years, 12k then 13.2k monthly at 12% — recompute independently
  const su = app.call('stepUpFV(12000, 2, 12, 10)');
  const y1 = 12000 * ((Math.pow(1.01, 12) - 1) / 0.01) * 1.12;
  const y2 = 13200 * ((Math.pow(1.01, 12) - 1) / 0.01);
  approx(su, Math.round(y1 + y2), 2, 'stepUpFV 2-year hand calculation');
  // crash scenario must be below no-crash base
  const base = app.call('fvSIP(10000, 10, 10)');
  const crash = app.call('crashScenario(10000, 10, 10, 60, 5, 35)');
  check(crash < base, 'crash scenario ends below no-crash base');
  check(crash > base * 0.6, 'crash scenario recovers substantially (SIP continues)');
  // premium estimators sane
  const tp = app.call('estimateTermPremium(10000000, 32)');
  check(tp > 150 && tp < 1200, `1Cr term @32 ≈ realistic monthly premium (got ${tp})`);
  const hp = app.call('estimateHealthPremium(1500000, 2)');
  check(hp > 300 && hp < 2500, `15L health floater ≈ realistic monthly premium (got ${hp})`);
}

/* ═══ Engine-level checks ═══ */
{
  console.log('\n━━━ Unit: methodology engine ━━━');
  const eng = require('../methodology-engine.js');
  check(eng.validateAgainstManualExample(), 'manual worked example reproduces (MES 78.5 → 40/30/20/10)');
  // band boundary: fractional scores must classify (regression for old gap bug)
  check(eng.classify(60.75, eng.MES_BANDS) === 'Growth', 'score 60.75 classifies into Growth band (no gap)');
  check(eng.classify(20, eng.MES_BANDS) === 'Very Conservative', 'boundary 20 → lower band');
  // exported band tables usable
  check(Array.isArray(eng.BANDS.PORTFOLIO_ELIGIBILITY_BANDS), 'BANDS.PORTFOLIO_ELIGIBILITY_BANDS is a real table (not a function)');
  // time horizon lookup
  const mes3 = eng.masterEquityScore(80, 70, 75, 2, 70);
  check(mes3.equity_pct_point_adjustment === -25, '<3yr horizon → −25pt equity adjustment');
  const mes15 = eng.masterEquityScore(80, 70, 75, 15, 70);
  check(mes15.equity_pct_point_adjustment === 10, '15yr horizon → +10pt equity adjustment');
  // capacity override: emergency fund < 3 months reduces band
  const fcInputs = { income_strength: 80, cash_flow_strength: 80, liquidity_strength: 80, net_worth_strength: 80, debt_strength: 80, time_horizon: 80, family_responsibility: 80 };
  const fcLow = eng.financialCapacity(fcInputs, 1, 10, 20);
  const fcOk = eng.financialCapacity(fcInputs, 6, 10, 20);
  check(fcLow.band !== fcOk.band, 'FC-01 emergency-fund override reduces capacity band');
  // sub-allocation floors: conservative + high loss aversion must not go negative
  const sub = eng.equitySubAllocation('Conservative', { loss_aversion_control: 10 });
  check(sub.small_cap_pct >= 0 && sub.international_pct >= 0, 'sub-allocation never negative under behaviour overrides');
  approx(sub.large_cap_pct + sub.mid_cap_pct + sub.small_cap_pct + sub.international_pct, 100, 0.25, 'sub-allocation sums to 100 under overrides');
}

/* ═══ S1 — Typical salaried saver ═══ */
{
  const res = scenario('S1: Typical salaried saver (100k income, 52k exp, 20k SIP, 15y)');
  const { ca, wf } = commonInvariantChecks('S1', res);
  const p = res.profile, t = res.trail;
  check(p.monthlyExpenses === 52000, 'S1: itemised expenses total 52,000');
  check(p.savingsPct === 48, 'S1: savings rate 48%');
  check(ca.equity_pct >= 50, `S1: healthy long-horizon profile gets meaningful equity (got ${ca.equity_pct}%)`);
  check(wf.sip.steadyState > 20000, `S1: sustainable SIP above current 20k (got ${wf.sip.steadyState})`);
  check(t.master_equity_score.band !== 'Very Conservative', 'S1: not misclassified as very conservative');
  show(res, ['exec-summary', 'cashflow-waterfall', 'goal-projection']);
}

/* ═══ S2 — Over-committed, heavy EMI, no protection, 3 kids ═══ */
{
  const res = scenario('S2: Over-committed (60k income, 75k expenses incl 25k EMI, EF 0, 3 deps)', {
    's1-income': 60000, 's1-exp-housing': 18000, 's1-exp-emi': 25000, 's1-exp-household': 14000,
    's1-exp-lifestyle': 10000, 's1-exp-insurance': 0, 's1-exp-other': 8000,
    's1-sip': 10000, 's1-emi-months': 48, 's1-loan-out': 1200000,
    's1-emfund': '0', 's0-dep': 3, 's2-hor': 10,
    'g1-type': 'House', 'g1-amt': 5000000, 'g1-yrs': 3,
  }, { 'chips-goal': ['house'], 'chips-ret-dep': ['2+'] });
  const { wf } = commonInvariantChecks('S2', res);
  const p = res.profile;
  check(p.monthlyExpenses === 75000, 'S2: expenses NOT capped at income (75k kept)');
  check(wf.isCashFlowNegative, 'S2: cash-flow-negative correctly detected');
  check(wf.sip.steadyState === 0 || wf.postCutFreeCashFlow > 0, 'S2: no fictional SIP while under water');
  check(p.projectionSIP === wf.sip.steadyState, 'S2: projections built on waterfall SIP, not aspiration');
  check(p.emergency_fund_months === 0, 'S2: "no emergency fund" answer honoured (0, not defaulted to 6)');
  check(p.debtToIncomePct === Math.round(25000 / 60000 * 100), 'S2: debt-to-income from real EMI');
  const goalsHtml = stripTags(res.html['goal-separation'] || '');
  check(/not viable|difficult/i.test(goalsHtml), 'S2: 50L house in 3 yrs on 60k income flagged difficult/not-viable');
  check(res.trail.core_allocation.equity_pct <= 50, `S2: fragile profile equity capped (got ${res.trail.core_allocation.equity_pct}%)`);
  show(res, ['critical-banner', 'cashflow-waterfall', 'goal-separation']);
}

/* ═══ S3 — Near-retirement panic-seller, short horizon ═══ */
{
  const res = scenario('S3: Near-retirement panic-seller (57yo, retire 60, horizon 3, sell-all)', {
    's0-age': 57, 's0-retire': 60, 's0-dep': 0, 's0-life': 'near-retirement',
    's1-income': 150000, 's1-exp-housing': 0, 's1-exp-emi': 0, 's1-exp-household': 40000,
    's1-exp-lifestyle': 25000, 's1-exp-insurance': 5000, 's1-exp-other': 10000,
    's1-sip': 30000, 's1-emfund': '12+', 's2-hor': 3, 's2-nearest': 1,
    's2-ret-exp': '125000', 's2-ret-sav': 'good', 's1-term': 10000000, 's1-health': 'personal',
    'inv-fd': 4000000, 'inv-ppf': 2500000, 'inv-epf': 5000000, 'inv-mf': 2000000,
  }, {
    'chips-react': ['sell-all'], 'chips-volatility': ['very-low'], 'chips-decision': ['follow'],
    'chips-regret': ['exit-simple'], 'chips-goal': ['retire'], 'chips-ret-dep': ['1'],
    'chips-exp': ['10+'], 'chips-dna': ['security'], 'chips-money-rel': ['security-focus'],
  });
  const { ca } = commonInvariantChecks('S3', res);
  const t = res.trail;
  check(t.behaviour.penalty >= 40, `S3: heavy behaviour penalties applied (got ${t.behaviour.penalty})`);
  check(ca.equity_pct <= 30, `S3: panic-selling near-retiree gets low equity (got ${ca.equity_pct}%)`);
  check(ca.binding_constraint !== 'need', 'S3: ceiling (not need) binds for a panic-seller');
  check(t.risk_tolerance.band === 'Very Conservative' || t.risk_tolerance.band === 'Conservative',
    `S3: risk tolerance conservative (got ${t.risk_tolerance.band})`);
  const fcOverrides = t.financial_capacity.overrides.join(' ');
  check(/FC-03/.test(fcOverrides), 'S3: retirement-within-5-years override flagged');
  show(res, ['why-equity', 'guardrails']);
}

/* ═══ S4 — Wealthy aggressive accumulator (already at FI?) ═══ */
{
  const res = scenario('S4: Wealthy accumulator (3L income, 2Cr assets, 1L SIP, 20y horizon)', {
    's0-age': 40, 's0-retire': 60, 's0-dep': 2, 's1-income': 300000,
    's1-exp-housing': 40000, 's1-exp-household': 30000, 's1-exp-lifestyle': 20000,
    's1-exp-insurance': 5000, 's1-exp-other': 5000,
    's1-sip': 100000, 's1-emfund': '12', 's2-hor': 20, 's2-ret-exp': '125000',
    's2-ret-sav': 'good', 's1-term': 30000000, 's1-health': 'both',
    'inv-mf': 8000000, 'inv-stocks': 3000000, 'inv-index': 2000000, 'inv-epf': 3000000,
    'inv-ppf': 1500000, 'inv-fd': 1000000, 'inv-gold': 500000, 'inv-cash': 1000000,
  }, {
    'chips-exp': ['10+'], 'chips-react': ['buy-more'], 'chips-volatility': ['very-high'],
    'chips-decision': ['contrarian'], 'chips-regret': ['ignore'], 'chips-goal': ['retire'],
    'chips-return': ['high'], 'chips-ret-dep': ['2+'], 'chips-dna': ['opportunity'],
  });
  const { ca, wf } = commonInvariantChecks('S4', res);
  const p = res.profile, t = res.trail;
  check(ca.equity_pct >= 65, `S4: high capacity+tolerance+horizon → high equity (got ${ca.equity_pct}%)`);
  // 15× income = 5.5Cr recommended term; the 3Cr held means only the 2.5Cr TOP-UP is priced
  check(wf.ideal.termCover === Math.max(0, 55000000 - 30000000) || wf.ideal.termCover > 0,
    `S4: term priced as top-up net of existing 3Cr (got ${wf.ideal.termCover})`);
  check(wf.ideal.healthCover === 0, 'S4: both-covered health → no second floater budgeted');
  check(p.componentA_retirement > 40000000, `S4: Component A (2Cr grown 20y) is large (got ${p.componentA_retirement})`);
  // With 2Cr already invested, required extra SIP should be far below the affordable SIP
  check(p.requiredSIP < wf.sip.steadyState, `S4: requiredSIP (${p.requiredSIP}) below affordable (${wf.sip.steadyState})`);
  show(res, ['fi-number', 'investments-bifurcation']);
}

/* ═══ S5 — Young beginner, blank SIP, huge horizon ═══ */
{
  const res = scenario('S5: Young beginner (24yo, 50k income, SIP blank, 30y horizon)', {
    's0-age': 24, 's0-retire': 55, 's0-dep': 0, 's0-life': 'single',
    's1-income': 50000, 's1-exp-housing': 12000, 's1-exp-household': 8000,
    's1-exp-lifestyle': 8000, 's1-exp-other': 2000, 's1-sip': '', 's1-emfund': '1',
    's2-hor': 30, 's2-ret-exp': '30000', 's2-ret-sav': 'none',
  }, { 'chips-exp': ['never'], 'chips-ret-dep': ['0'], 'chips-dna': ['opportunity'],
       'chips-react': ['buy-more'], 'chips-volatility': ['high'] });
  const { ca, wf } = commonInvariantChecks('S5', res);
  check(ca.equity_pct >= 50, `S5: 30-year horizon beginner still gets growth allocation (got ${ca.equity_pct}%)`);
  check(wf.ef.current === res.profile.monthlyExpenses * 1, `S5: EF current = 1 month of expenses (got ${wf.ef.current} vs ${res.profile.monthlyExpenses})`);
  show(res, ['exec-summary', 'sip-structure']);
}

/* ═══ S6 — Breakeven budget + unviable near-term goals ═══ */
{
  const res = scenario('S6: Breakeven (income = expenses exactly), goals unviable', {
    's1-income': 70000, 's1-exp-housing': 20000, 's1-exp-emi': 15000, 's1-exp-household': 15000,
    's1-exp-lifestyle': 12000, 's1-exp-insurance': 3000, 's1-exp-other': 5000,
    's1-sip': 5000, 's1-emi-months': 14, 's1-loan-out': 600000, 's1-emfund': '1',
    'g1-type': 'House', 'g1-amt': 5000000, 'g1-yrs': 3,
    'g2-type': 'Car', 'g2-amt': 800000, 'g2-yrs': 2,
  });
  const { wf } = commonInvariantChecks('S6', res);
  check(wf.trueFreeCashFlow === 0, 'S6: breakeven detected (free cash 0)');
  check(!wf.isCashFlowNegative, 'S6: breakeven is not flagged negative');
  check(res.profile.showOvercommitWarning, 'S6: stated 5k SIP flagged as over-committed vs waterfall');
  show(res, ['cashflow-waterfall', 'goal-separation', 'emi-sunset']);
}

/* ═══ S7 — Deep deficit student ═══ */
{
  const res = scenario('S7: Student in deficit (10k income, 12k expenses, nothing else)', {
    's0-age': 21, 's0-emp': 'student', 's0-dep': 0, 's0-life': 'single',
    's1-income': 10000, 's1-exp-housing': 5000, 's1-exp-household': 4000,
    's1-exp-lifestyle': 2000, 's1-exp-other': 1000, 's1-sip': 0, 's1-emfund': '0',
    's2-hor': 25, 's2-ret-exp': '30000', 's2-ret-sav': 'none',
  }, { 'chips-exp': ['never'], 'chips-ret-dep': ['0'] });
  const { wf } = commonInvariantChecks('S7', res);
  check(wf.isCashFlowNegative, 'S7: deficit detected');
  check(res.profile.projectionSIP === 0, 'S7: honest-zero SIP — no fictional projections');
  const gp = stripTags(res.html['goal-projection'] || '');
  check(/No SIP is affordable yet/i.test(gp) || /₹0/.test(gp), 'S7: projection section says no SIP honestly');
  show(res, ['exec-summary', 'goal-projection']);
}

/* ═══ S8 — Conservative + tiny SIP (fold logic / ₹Infinity regression) ═══ */
{
  const res = scenario('S8: Small SIP conservative (fold logic, sub-₹500 buckets)', {
    's1-income': 30000, 's1-exp-housing': 8000, 's1-exp-household': 8000,
    's1-exp-lifestyle': 5000, 's1-exp-other': 2000, 's1-sip': 3000, 's1-emfund': '3',
    's2-hor': 7,
  }, { 'chips-react': ['reduce'], 'chips-volatility': ['low'], 'chips-exp': ['never'],
       'chips-dna': ['security'], 'chips-return': ['low'] });
  commonInvariantChecks('S8', res);
  const sipHtml = stripTags(res.html['sip-structure'] || '');
  check(!/Infinity/.test(sipHtml), 'S8: no ₹Infinity in SIP structure fold notes');
  if (res.profile.projectionSIP > 0) {
    // reconciliation: table total equals the SIP
    const m = sipHtml.match(/TOTAL\s+100%\s+₹([\d,]+)/);
    if (m) approx(parseInt(m[1].replace(/,/g, '')), res.profile.projectionSIP, 1, 'S8: SIP table reconciles to the rupee');
  }
  show(res, ['sip-structure']);
}

/* ═══ S9 — Refine flows don't corrupt state ═══ */
{
  const res = scenario('S9: Base for refine (sanity)');
  const app = res.app;
  app.call('lastRawProfile = ' + JSON.stringify(res.profile));
  app.call(`refine('conservative')`);
  const eqCons = app.call('lastTrail.core_allocation.equity_pct');
  app.call(`refine('aggressive')`);
  const eqAgg = app.call('lastTrail.core_allocation.equity_pct');
  check(eqCons <= res.trail.core_allocation.equity_pct + 0.11, `S9: conservative refine does not raise equity (${eqCons} vs ${res.trail.core_allocation.equity_pct})`);
  check(eqAgg >= eqCons, `S9: aggressive refine ≥ conservative refine (${eqAgg} vs ${eqCons})`);
  app.call(`refine('shorter-horizon')`);
  const eqShort = app.call('lastTrail.core_allocation.equity_pct');
  check(Number.isFinite(eqShort), 'S9: shorter-horizon refine computes');
}

/* ═══ S10 — Behaviour-override fold (₹Infinity regression) + rental property ═══ */
{
  const res = scenario('S10: Conservative + high loss aversion (small-cap floored to 0) + rental property', {
    's1-income': 40000, 's1-exp-housing': 10000, 's1-exp-household': 9000,
    's1-exp-lifestyle': 5000, 's1-exp-other': 2000, 's1-sip': 4000, 's1-emfund': '3',
    's2-hor': 6, 's3-loss-av': 'very-true',
    'inv-re': 3000000, 'inv-re-rent': 8000, 'inv-re-emi': 22000,
  }, { 'chips-react': ['reduce'], 'chips-volatility': ['low'], 'chips-dna': ['security'],
       'chips-return': ['low'], 'chips-exp': ['1-2'] });
  commonInvariantChecks('S10', res);
  const sub = res.trail.equity_sub_allocation;
  check(sub.small_cap_pct >= 0, `S10: small-cap never negative (got ${sub.small_cap_pct})`);
  const sipHtml = stripTags(res.html['sip-structure'] || '');
  check(!/Infinity/.test(sipHtml), 'S10: no ₹Infinity in fold notes when a category is floored to 0%');
  const invHtml = stripTags(res.html['investments-bifurcation'] || '');
  check(/cash flow/i.test(invHtml) && /−₹14,000\/mo|-₹14,000\/mo/.test(invHtml), 'S10: rental property net −₹14,000/mo surfaced');
  check(/cash-flow negative/i.test(invHtml), 'S10: negative-carry property warning shown');
  show(res, ['sip-structure', 'investments-bifurcation']);
}

/* ═══ S11 — Freelance income stability + breakeven cut-funding disclosure ═══ */
{
  // Same employment, different self-described stability must now change the scores.
  const resFixed = scenario('S11a: salaried + fixed stability', { 's1-stability': 'fixed' });
  const resFree = scenario('S11b: salaried + freelance-style irregular income', { 's1-stability': 'freelance' });
  check(resFree.profile.incomeStability < resFixed.profile.incomeStability,
    `S11: stated income stability affects the profile (${resFree.profile.incomeStability} < ${resFixed.profile.incomeStability})`);
  check(resFree.trail.financial_capacity.score < resFixed.trail.financial_capacity.score,
    'S11: financial capacity reflects irregular income');

  const resBE = scenario('S11c: exact breakeven — plan funded by cuts must say so', {
    's1-income': 70000, 's1-exp-housing': 20000, 's1-exp-emi': 15000, 's1-exp-household': 15000,
    's1-exp-lifestyle': 12000, 's1-exp-insurance': 3000, 's1-exp-other': 5000,
    's1-sip': 0, 's1-emfund': '1',
  });
  commonInvariantChecks('S11c', resBE);
  const wfHtml = stripTags(resBE.html['cashflow-waterfall'] || '');
  check(/funded partly by|expense trims/i.test(wfHtml), 'S11c: breakeven plan discloses cut-funding');
}

/* ═══ S12 — Guardrails horizon + herd-seller penalty ═══ */
{
  const res = scenario('S12: 3-year horizon + crowd-following seller', {
    's2-hor': 3,
  }, { 'chips-decision': ['follow'] });
  commonInvariantChecks('S12', res);
  const g = stripTags(res.html['guardrails'] || '');
  check(!/Around year 10/.test(g), 'S12: crash illustration not at year 10 on a 3-year plan');
  check(/Around year [23]\b/.test(g), 'S12: crash illustration within the actual horizon');
  check(res.trail.behaviour.penalty >= 10, `S12: crowd-following seller penalised (got ${res.trail.behaviour.penalty})`);
}

/* ═══ Result ═══ */
const { checks, failures } = summary();
console.log(`\n${'═'.repeat(60)}\n${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
