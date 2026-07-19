/* ============================================================================
   InvestVerdict Methodology Engine v2.1 — JavaScript
   ============================================================================
   Rule-based ASSET-ALLOCATION-ONLY engine from InvestVerdict Combined Master
   Manual (NISM 5A/5B/XA/XB + PMS-grounded).

   FIXES vs v1:
   - MES bug: timeHorizonLookup now uses strict < comparisons (not <=)
     so 15 yrs → score 100, adj +10, reproducing the manual's MES 78.5.
   - Validation passes without throwing.

   Never names a fund, AMC, ticker, scheme, or stock.
   Every score returns a full calculation trace (no black box).
   Works in browser (window.IVMethodology) AND Node (module.exports).

   NOT registered investment advice — educational/simulation only.
   ========================================================================== */
(function (root) {
  'use strict';

  // ---- utilities ----------------------------------------------------------
  const clamp = s => Math.max(0, Math.min(100, s));
  const round2 = n => Math.round(n * 100) / 100;
  const round1 = n => Math.round(n * 10) / 10;

  function classify(score, table) {
    score = clamp(score);
    for (const [lo, hi, label] of table) if (score >= lo && score <= hi) return label;
    return table[table.length - 1][2];
  }

  function makeBands(labels) {
    // Contiguous ranges (no gaps). classify() returns the first match, so an
    // exact boundary (e.g. 60) resolves to the lower band, and any fractional
    // score (e.g. 60.75) now lands correctly instead of falling through a gap
    // to the top band — the previous [21,40],[41,60]… left 20-21, 40-41,
    // 60-61, 80-81 unmatched, silently classifying them as the highest band.
    const ranges = [[0, 20], [20, 40], [40, 60], [60, 80], [80, 100]];
    return ranges.map((r, i) => [r[0], r[1], labels[i]]);
  }

  function weighted(components, weights) {
    let total = 0;
    const trace = [];
    for (const key in weights) {
      const w = weights[key];
      const v = Number(components[key] || 0);
      const contribution = v * w;
      total += contribution;
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      trace.push(`${label}: ${v.toFixed(1)} × ${(w * 100).toFixed(1)}% = ${contribution.toFixed(2)}`);
    }
    return [round2(total), trace];
  }

  // =========================================================================
  // TIER 0 — BEHAVIOUR COMPOSITE  (higher = better control of the bias)
  // =========================================================================
  const BEHAVIOUR_WEIGHTS = {
    loss_aversion_control: 0.20,
    overconfidence_control: 0.15,
    herd_behaviour_control: 0.15,
    recency_bias_control: 0.15,
    confirmation_bias_control: 0.10,
    mental_accounting_control: 0.10,
    regret_aversion_control: 0.15,
  };
  const BEHAVIOUR_BANDS = makeBands(['Fragile', 'Developing', 'Stable', 'Resilient', 'Highly Resilient']);

  function behaviourComposite(inputs) {
    const [score, trace] = weighted(inputs, BEHAVIOUR_WEIGHTS);
    return { score, band: classify(score, BEHAVIOUR_BANDS), trace, source: 'Vol 8A Pt2 Behaviour Composite' };
  }

  // =========================================================================
  // 1. FINANCIAL CAPACITY  (override rules FC-01..03)
  // =========================================================================
  const FINANCIAL_CAPACITY_WEIGHTS = {
    income_strength: 0.20,
    cash_flow_strength: 0.15,
    liquidity_strength: 0.15,
    net_worth_strength: 0.15,
    debt_strength: 0.15,
    time_horizon: 0.10,
    family_responsibility: 0.10,
  };
  const FINANCIAL_CAPACITY_BANDS = makeBands([
    'Very Low Capacity', 'Low Capacity', 'Moderate Capacity', 'High Capacity', 'Very High Capacity'
  ]);

  function financialCapacity(inputs, emergencyFundMonths, debtToIncomePct, yearsToRetirement) {
    const [score, trace] = weighted(inputs, FINANCIAL_CAPACITY_WEIGHTS);
    let band = classify(score, FINANCIAL_CAPACITY_BANDS);
    const overrides = [];
    let bandIdx = FINANCIAL_CAPACITY_BANDS.findIndex(b => b[2] === band);
    if (emergencyFundMonths < 3) {
      overrides.push('FC-01: Emergency fund < 3 months → capacity band reduced one level');
      bandIdx = Math.max(0, bandIdx - 1);
    }
    if (debtToIncomePct > 50) {
      overrides.push('FC-02: Debt-to-income > 50% → capacity band reduced one level');
      bandIdx = Math.max(0, bandIdx - 1);
    }
    if (yearsToRetirement <= 5) {
      overrides.push('FC-03: Retirement within 5 years → growth eligibility flagged for reduction');
    }
    return { score, raw_band: band, band: FINANCIAL_CAPACITY_BANDS[bandIdx][2], overrides, trace, source: 'Vol 9.1 Ch2' };
  }

  // =========================================================================
  // 2. RISK TOLERANCE
  // =========================================================================
  const RISK_TOLERANCE_WEIGHTS = {
    loss_aversion: 0.25,
    volatility_acceptance: 0.20,
    decision_stability: 0.15,
    behavioural_bias_score: 0.15,
    investment_experience: 0.10,
    behavioural_resilience: 0.15,
  };
  const RISK_TOLERANCE_BANDS = makeBands(['Very Conservative', 'Conservative', 'Moderate', 'Growth', 'Aggressive']);

  function riskTolerance(inputs) {
    const [score, trace] = weighted(inputs, RISK_TOLERANCE_WEIGHTS);
    return { score, band: classify(score, RISK_TOLERANCE_BANDS), trace, source: 'Vol 9.1 Ch3' };
  }

  // =========================================================================
  // 3. RISK REQUIREMENT
  // =========================================================================
  const RISK_REQUIREMENT_WEIGHTS = {
    goal_return_requirement: 0.25,
    funding_gap: 0.20,
    time_horizon: 0.20,
    retirement_need: 0.15,
    existing_asset_base: 0.10,
    income_replacement_need: 0.10,
  };
  const RISK_REQUIREMENT_BANDS = makeBands(['Very Low', 'Low', 'Moderate', 'High', 'Very High']);

  function riskRequirement(inputs) {
    const [score, trace] = weighted(inputs, RISK_REQUIREMENT_WEIGHTS);
    return { score, band: classify(score, RISK_REQUIREMENT_BANDS), trace, source: 'Vol 9.1 Ch4' };
  }

  // =========================================================================
  // 4. WEALTH DNA + MASTER CLASSIFICATION
  // =========================================================================
  const WEALTH_DNA_DIMS = [
    'security_orientation', 'growth_orientation', 'freedom_orientation',
    'legacy_orientation', 'opportunity_orientation'
  ];
  const WEALTH_DNA_WEIGHTS = {};
  WEALTH_DNA_DIMS.forEach(d => WEALTH_DNA_WEIGHTS[d] = 0.20);

  const ARCHETYPE_MAP = {
    security_orientation: 'Capital Protector',
    growth_orientation: 'Growth Seeker',
    freedom_orientation: 'Balanced Builder',
    legacy_orientation: 'Legacy Creator',
    opportunity_orientation: 'Opportunity Hunter',
  };

  const ARCHETYPE_DESC = {
    'Capital Protector': 'Safety-first investor who prioritises preservation over returns. Values stability, predictability and low volatility above all.',
    'Growth Seeker': 'Goal-oriented investor focused on long-term wealth accumulation through disciplined, diversified equity growth.',
    'Balanced Builder': 'Freedom-driven investor who builds steady wealth to achieve financial independence — balanced between growth and security.',
    'Legacy Creator': 'Multigenerational thinker who invests not just for self but for family, estate, and long-term impact.',
    'Opportunity Hunter': 'High-conviction investor who actively seeks market opportunities and is comfortable with higher risk for higher returns.',
  };

  const MASTER_CLASSIFICATION_WEIGHTS = {
    financial_capacity: 0.25,
    risk_tolerance: 0.20,
    risk_requirement: 0.15,
    goal_structure: 0.10,
    retirement_readiness: 0.10,
    behaviour_score: 0.10,
    wealth_dna_score: 0.10,
  };

  function wealthDna(inputs) {
    const [score, trace] = weighted(inputs, WEALTH_DNA_WEIGHTS);
    let dominant = WEALTH_DNA_DIMS[0];
    for (const d of WEALTH_DNA_DIMS) if ((inputs[d] || 0) > (inputs[dominant] || 0)) dominant = d;
    return {
      score, dominant_dimension: dominant, archetype: ARCHETYPE_MAP[dominant],
      archetype_desc: ARCHETYPE_DESC[ARCHETYPE_MAP[dominant]],
      trace, source: 'Vol 9.1 Ch5'
    };
  }

  function masterClassification(fc, rt, rr, goalStructure, retire, behaviour, wealthDnaScore) {
    const inputs = {
      financial_capacity: fc, risk_tolerance: rt, risk_requirement: rr,
      goal_structure: goalStructure, retirement_readiness: retire,
      behaviour_score: behaviour, wealth_dna_score: wealthDnaScore
    };
    const [score, trace] = weighted(inputs, MASTER_CLASSIFICATION_WEIGHTS);
    return { score, trace, source: 'Vol 9.1 Ch5' };
  }

  // =========================================================================
  // 5. GOAL CRITICALITY  (flexibility inverted before weighting)
  // =========================================================================
  const GOAL_CRITICALITY_WEIGHTS = {
    importance: 0.25, urgency: 0.20, consequence: 0.25, dependency: 0.15, flexibility: 0.15
  };
  const GOAL_CRITICALITY_BANDS = makeBands(['Low', 'Moderate', 'Important', 'High', 'Critical']);

  function goalCriticality(inputs) {
    const adj = Object.assign({}, inputs);
    adj.flexibility = 100 - (inputs.flexibility || 0);
    const [score, trace] = weighted(adj, GOAL_CRITICALITY_WEIGHTS);
    return {
      score, band: classify(score, GOAL_CRITICALITY_BANDS), trace, source: 'Vol 9.1 Ch6',
      note: 'Flexibility inverted (100 − input): a more flexible goal is less critical.'
    };
  }

  // =========================================================================
  // 6. RETIREMENT READINESS
  // =========================================================================
  const RETIREMENT_WEIGHTS = {
    corpus_adequacy: 0.25, savings_behaviour: 0.15, income_sustainability: 0.15,
    time_horizon: 0.10, longevity_preparedness: 0.10, healthcare_preparedness: 0.10,
    withdrawal_sustainability: 0.10, stress_resilience: 0.05,
  };
  const RETIREMENT_BANDS = makeBands(['Critical', 'Weak', 'Moderate', 'Strong', 'Retirement Ready']);

  function retirementReadiness(inputs) {
    const [score, trace] = weighted(inputs, RETIREMENT_WEIGHTS);
    return { score, band: classify(score, RETIREMENT_BANDS), trace, source: 'Vol 9.1 Ch7' };
  }

  // =========================================================================
  // 7. LIQUIDITY HEALTH
  // =========================================================================
  const LIQUIDITY_WEIGHTS = {
    emergency_reserve: 0.30, cash_flow_stability: 0.15, income_reliability: 0.15,
    near_term_goal_preparedness: 0.10, debt_pressure_control: 0.10,
    family_dependency_management: 0.10, portfolio_liquidity: 0.10,
  };
  const LIQUIDITY_BANDS = makeBands(['Critical', 'Weak', 'Moderate', 'Strong', 'Excellent']);

  function liquidityHealth(inputs) {
    const [score, trace] = weighted(inputs, LIQUIDITY_WEIGHTS);
    return { score, band: classify(score, LIQUIDITY_BANDS), trace, source: 'Vol 9.1 Ch8' };
  }

  // =========================================================================
  // 8. PORTFOLIO ELIGIBILITY  (gatekeeper before allocation)
  // =========================================================================
  const PORTFOLIO_ELIGIBILITY_WEIGHTS = {
    financial_capacity: 0.25, risk_tolerance: 0.20, risk_requirement: 0.15,
    goal_criticality: 0.15, retirement_readiness: 0.10, liquidity_health: 0.10, wealth_dna: 0.05,
  };
  const PORTFOLIO_ELIGIBILITY_BANDS = makeBands([
    'Preservation', 'Conservative', 'Balanced', 'Growth', 'Advanced Growth'
  ]);

  function portfolioEligibility(fc, rt, rr, gc, rrRet, lh, wd) {
    const inputs = {
      financial_capacity: fc, risk_tolerance: rt, risk_requirement: rr,
      goal_criticality: gc, retirement_readiness: rrRet, liquidity_health: lh, wealth_dna: wd
    };
    const [score, trace] = weighted(inputs, PORTFOLIO_ELIGIBILITY_WEIGHTS);
    return { score, band: classify(score, PORTFOLIO_ELIGIBILITY_BANDS), trace, source: 'Vol 9.1 Ch9' };
  }

  // =========================================================================
  // 9. MASTER EQUITY SCORE (MES) — FIXED: strict < comparisons
  //    15 yrs → score 100, adj +10  → MES 78.5 (manual worked example)
  // =========================================================================
  const MES_WEIGHTS = {
    risk_capacity: 0.30, risk_tolerance: 0.25, risk_requirement: 0.20,
    time_horizon_score: 0.15, behaviour_score: 0.10
  };
  const MES_BANDS = makeBands(['Very Conservative', 'Conservative', 'Moderate', 'Growth', 'Aggressive']);

  function timeHorizonLookup(years) {
    if (years < 3)  return [20, -25];
    if (years < 5)  return [40, -15];
    if (years < 10) return [60,   0];
    if (years < 15) return [80,   5];
    return [100, 10];   // 15+ years
  }

  function masterEquityScore(riskCapacity, riskTol, riskReq, yearsHorizon, behaviour) {
    const [ths, equityAdj] = timeHorizonLookup(yearsHorizon);
    const inputs = {
      risk_capacity: riskCapacity, risk_tolerance: riskTol, risk_requirement: riskReq,
      time_horizon_score: ths, behaviour_score: behaviour
    };
    const [score, trace] = weighted(inputs, MES_WEIGHTS);
    return {
      score, band: classify(score, MES_BANDS), trace,
      time_horizon_score: ths, equity_pct_point_adjustment: equityAdj,
      source: 'Vol 3A.1.1 Ch2-4 (Master Equity Score)'
    };
  }

  // =========================================================================
  // 10. CORE ALLOCATION — Equity / Debt / Gold / Cash
  // =========================================================================
  const EQUITY_BAND_TABLE = {
    'Very Conservative': [10, 30], 'Conservative': [30, 50], 'Moderate': [50, 70],
    'Growth': [70, 85], 'Aggressive': [85, 100],
  };
  const DEBT_BAND_TABLE = {
    'Very Conservative': [60, 80], 'Conservative': [40, 60], 'Moderate': [20, 40],
    'Growth': [10, 20], 'Aggressive': [0, 10],
  };
  const GOLD_BY_BAND = {
    'Very Conservative': 10, 'Conservative': 8, 'Moderate': 6, 'Growth': 4, 'Aggressive': 2
  };
  const CASH_BY_LIQUIDITY_BAND = {
    'Critical': 20, 'Weak': 15, 'Moderate': 10, 'Strong': 6, 'Excellent': 3
  };

  // Position-in-band interpolation, reused by all three ceiling steps below so "need",
  // "capacity ceiling" and "tolerance ceiling" are all computed the same principled way —
  // just against different scores and different (independent) ceiling tables.
  function equityFromScore(score) {
    const label = classify(score, MES_BANDS);
    const [lo, hi] = EQUITY_BAND_TABLE[label];
    const bandRange = MES_BANDS.find(b => b[2] === label);
    const pos = bandRange[1] > bandRange[0]
      ? Math.max(0, Math.min(1, (score - bandRange[0]) / (bandRange[1] - bandRange[0]))) : 0.5;
    return lo + pos * (hi - lo);
  }

  // Step 2 — capacity ceiling. Financial Capacity sets a hard cap on equity exposure
  // regardless of how much return the goal requires; Liquidity Health (emergency fund,
  // income stability, debt burden) tightens that cap further when the client has no buffer.
  const CAPACITY_EQUITY_CEILING = {
    'Very Low Capacity': 35, 'Low Capacity': 50, 'Moderate Capacity': 65,
    'High Capacity': 85, 'Very High Capacity': 100,
  };
  const LIQUIDITY_CEILING_ADJ = { 'Critical': -10, 'Weak': -5, 'Moderate': 0, 'Strong': 0, 'Excellent': 0 };

  // Step 3 — tolerance/behaviour ceiling. Risk Tolerance sets a hard cap on how volatile a
  // portfolio the client can psychologically hold; a low Behaviour Composite (prone to
  // panic-selling) tightens that cap further, because a client who states they'll sell
  // everything in a crash should not be placed in a portfolio volatile enough to trigger it.
  const TOLERANCE_EQUITY_CEILING = {
    'Very Conservative': 35, 'Conservative': 50, 'Moderate': 65, 'Growth': 85, 'Aggressive': 100,
  };
  function behaviourCeilingAdj(behaviourScore) {
    if (behaviourScore < 20) return -10;   // highly reactive — states they'd panic-sell
    if (behaviourScore < 40) return -5;
    return 0;
  }

  // =========================================================================
  // 10. CORE ALLOCATION — Equity / Debt / Gold / Cash
  //
  // METHODOLOGY FIX (Issue 6): equity is no longer a blended average across need,
  // capacity and tolerance — a high "need for return" (Risk Requirement) must never be
  // allowed to pull equity above what capacity or tolerance can safely support, because
  // that risks the client panic-selling at the worst possible time. Instead this runs a
  // three-step CEILING process and takes the LOWEST of the three:
  //   Step 1 — need-based equity (diagnostic only, from Risk Requirement alone)
  //   Step 2 — capacity ceiling (from Financial Capacity + Liquidity Health)
  //   Step 3 — tolerance/behaviour ceiling (from Risk Tolerance + Behaviour Composite)
  //   Step 4 — final = MIN(step1, step2, step3), then the (small) time-horizon adjustment
  //   Step 5 — disclosure flag when the final is materially below the need-based figure
  // =========================================================================
  function coreAllocation(mes, liquidityBand, financialCapacity, riskTolerance, riskRequirement, behaviour) {
    const band = mes.band; // still used for gold-ceiling calibration and the debt sanity-check band
    const adj = mes.equity_pct_point_adjustment;

    // Step 1 — need-based (diagnostic only; must NOT be used as the final weight)
    const needBasedEquity = equityFromScore(riskRequirement.score);

    // Step 2 — capacity ceiling
    const capacityCeiling = Math.max(10, Math.min(100,
      (CAPACITY_EQUITY_CEILING[financialCapacity.band] ?? 65) + (LIQUIDITY_CEILING_ADJ[liquidityBand] ?? 0)));

    // Step 3 — tolerance/behaviour ceiling
    const toleranceCeiling = Math.max(10, Math.min(100,
      (TOLERANCE_EQUITY_CEILING[riskTolerance.band] ?? 65) + behaviourCeilingAdj(behaviour.score)));

    // Step 4 — final = lowest of the three, then the (already-modest) time-horizon nudge
    const bindingStep = needBasedEquity <= capacityCeiling && needBasedEquity <= toleranceCeiling ? 'need'
      : capacityCeiling <= toleranceCeiling ? 'capacity' : 'tolerance';
    const preHorizonEquity = Math.min(needBasedEquity, capacityCeiling, toleranceCeiling);
    const rawEquity = preHorizonEquity + adj;

    const gold = GOLD_BY_BAND[band];
    const cash = CASH_BY_LIQUIDITY_BAND[liquidityBand];
    const notes = [
      `Need-based equity (Risk Requirement ${riskRequirement.score.toFixed(1)} alone) = ${needBasedEquity.toFixed(1)}% — diagnostic only, not used directly.`,
      `Capacity ceiling (Financial Capacity '${financialCapacity.band}' + Liquidity '${liquidityBand}') = ${capacityCeiling.toFixed(1)}%`,
      `Tolerance/behaviour ceiling (Risk Tolerance '${riskTolerance.band}' + Behaviour ${behaviour.score.toFixed(1)}) = ${toleranceCeiling.toFixed(1)}%`,
      `Final equity = MIN(need, capacity ceiling, tolerance ceiling) = ${preHorizonEquity.toFixed(1)}% (binding constraint: ${bindingStep}), then time-horizon adjustment ${adj >= 0 ? '+' : ''}${adj} pts → ${rawEquity.toFixed(1)}%`,
      `Gold = ${gold}% (band-calibrated, 0–15% ceiling, Vol1 Ch13)`,
      `Cash = ${cash}% (Liquidity Health band '${liquidityBand}', Vol1 Ch14)`,
    ];
    const remaining = 100 - gold - cash;
    let equityFinal = Math.max(0, Math.min(rawEquity, remaining));
    if (equityFinal < rawEquity)
      notes.push(`Equity capped at ${equityFinal.toFixed(1)}% (raw ${rawEquity.toFixed(1)}%) to preserve Gold + Cash buffers.`);
    const debtFinal = round2(remaining - equityFinal);
    const [dlo, dhi] = DEBT_BAND_TABLE[band];
    if (!(dlo - 5 <= debtFinal && debtFinal <= dhi + 5))
      notes.push(`Note: Debt ${debtFinal.toFixed(1)}% outside illustrative '${band}' debt range (${dlo}–${dhi}%) — driven by liquidity/gold/horizon inputs.`);

    // Step 5 — disclosure trigger: final materially below what the goal alone would need
    const needVsFinalGap = round1(needBasedEquity - equityFinal);
    const disclosureNeeded = needVsFinalGap > 17.5; // "more than roughly 15-20 points"

    return {
      equity_pct: round1(equityFinal), debt_pct: round1(debtFinal),
      gold_pct: gold, cash_pct: cash,
      total_check: round2(equityFinal + debtFinal + gold + cash),
      need_based_equity_pct: round1(needBasedEquity),
      capacity_ceiling_pct: round1(capacityCeiling),
      tolerance_ceiling_pct: round1(toleranceCeiling),
      binding_constraint: bindingStep,
      disclosure_needed: disclosureNeeded,
      need_vs_final_gap_pct: needVsFinalGap,
      notes, source: 'Vol1 Ch11-14 + Vol3A.1.1 Ch3-4',
    };
  }

  // =========================================================================
  // 11. EQUITY SUB-ALLOCATION — Large / Mid / Small / International
  // =========================================================================
  const EQUITY_SUBALLOC_BASELINE = {
    'Very Conservative': [78, 12, 2],
    'Conservative':      [68, 17, 5],
    'Moderate':          [52, 24, 12],
    'Growth':            [40, 30, 20],   // reproduces manual worked example exactly
    'Aggressive':        [28, 33, 24],
  };

  function equitySubAllocation(mesBand, behaviourInputs) {
    behaviourInputs = behaviourInputs || {};
    let [large, mid, small] = EQUITY_SUBALLOC_BASELINE[mesBand];
    let intl = 100 - large - mid - small;
    const notes = [`Baseline for '${mesBand}': Large ${large}% / Mid ${mid}% / Small ${small}% / Intl ${intl}%`];
    const warnings = [];
    const lowCtrl = k => (behaviourInputs[k] !== undefined ? behaviourInputs[k] : 100) < 40;

    if (lowCtrl('loss_aversion_control')) {
      large += 15; small -= 10;
      notes.push('Override: High Loss Aversion → Large +15pt, Small -10pt (Vol3A.1.1 Ch5)');
    }
    if (lowCtrl('overconfidence_control')) {
      intl += 10;
      notes.push('Override: High Overconfidence → International +10pt (Vol3A.1.1 Ch5)');
    }
    if (lowCtrl('regret_aversion_control')) {
      const combined = small + intl;
      if (combined > 15) {
        const scale = 15 / combined;
        const excess = combined - 15;
        small *= scale; intl *= scale; large += excess;
        notes.push('Override: High Regret Aversion → Small+Intl capped at 15%, excess to Large (Vol3A.1.1 Ch5)');
      }
    }

    // Clamp sub-allocations to 0 before normalising. A behaviour override (e.g.
    // "High Loss Aversion → Small −10pt") on a Conservative baseline where small
    // starts at only 5% would otherwise produce a negative small-cap percentage
    // which then cascades into a negative rupee amount and a negative viability
    // threshold in the SIP structure table. Floor at 0 and let normalisation
    // redistribute the total naturally — no explicit redistribution needed.
    if (small < 0) { notes.push(`Small-cap floored at 0% (override took it to ${round1(small)}%; redistributed via normalisation)`); small = 0; }
    if (intl < 0)  { notes.push(`International floored at 0% (override took it to ${round1(intl)}%; redistributed via normalisation)`); intl = 0; }
    if (mid < 0)   { notes.push(`Mid-cap floored at 0% (override took it to ${round1(mid)}%)`); mid = 0; }

    let total = large + mid + small + intl;
    large = large * 100 / total; mid = mid * 100 / total;
    small = small * 100 / total; intl = intl * 100 / total;

    if (large > 80) { const e = large - 80; large = 80; mid += e; warnings.push('Concentration: Large capped at 80%, excess → Mid (Vol3A.1.1 Ch9)'); }
    if (small > 25) { const e = small - 25; small = 25; large += e; warnings.push('Concentration: Small capped at 25%, excess → Large (Vol3A.1.1 Ch9)'); }
    if (intl > 25)  { const e = intl - 25;  intl = 25;  large += e; warnings.push('Concentration: International capped at 25%, excess → Large (Vol3A.1.1 Ch9)'); }

    return {
      large_cap_pct: round1(large), mid_cap_pct: round1(mid),
      small_cap_pct: round1(small), international_pct: round1(intl),
      total_check: round2(large + mid + small + intl),
      notes, warnings, source: 'Vol3A.1 + Vol3A.1.1 Ch5-9',
    };
  }

  // =========================================================================
  // 12. DEBT SUB-ALLOCATION (PROVISIONAL)
  // =========================================================================
  function debtSubAllocationProvisional(liquidityBand, yearsToNearestGoal) {
    let split;
    if (liquidityBand === 'Critical' || liquidityBand === 'Weak' || yearsToNearestGoal < 2)
      split = { liquidity_bucket_pct: 50, income_bucket_pct: 35, duration_bucket_pct: 15 };
    else if (yearsToNearestGoal < 5)
      split = { liquidity_bucket_pct: 30, income_bucket_pct: 45, duration_bucket_pct: 25 };
    else
      split = { liquidity_bucket_pct: 15, income_bucket_pct: 40, duration_bucket_pct: 45 };
    split.status = 'PROVISIONAL — Vol5 weights not yet documented.';
    split.source = 'Vol5 Ch1-4 (bucket names only)';
    return split;
  }

  // =========================================================================
  // 13. FUND / PRODUCT QUALITY SCORE (generic — no names ever)
  // =========================================================================
  const FUND_QUALITY_WEIGHTS = {
    cost_score: 0.15, risk_score: 0.20, consistency_score: 0.20, diversification_score: 0.15,
    liquidity_score: 0.10, transparency_score: 0.10, manager_quality_score: 0.10,
  };
  const FUND_QUALITY_BANDS = makeBands(['Below Standard', 'Adequate', 'Good', 'Very Good', 'Excellent']);

  function fundQualityScore(inputs) {
    const [score, trace] = weighted(inputs, FUND_QUALITY_WEIGHTS);
    return { score, band: classify(score, FUND_QUALITY_BANDS), trace, source: 'Vol6 Ch3-12' };
  }

  // =========================================================================
  // ORCHESTRATOR
  // =========================================================================
  function simulateInvestor(p) {
    const t = {};
    t.behaviour = behaviourComposite(p.behaviour_inputs);

    t.financial_capacity = financialCapacity(
      p.financial_capacity_inputs,
      p.emergency_fund_months,
      p.debt_to_income_pct,
      p.years_to_retirement
    );

    const rtInputs = Object.assign({}, p.risk_tolerance_inputs, {
      behavioural_bias_score: t.behaviour.score
    });
    t.risk_tolerance = riskTolerance(rtInputs);
    t.risk_requirement = riskRequirement(p.risk_requirement_inputs);
    t.wealth_dna = wealthDna(p.wealth_dna_inputs);
    t.goal_criticality = goalCriticality(p.goal_criticality_inputs);
    t.retirement_readiness = retirementReadiness(p.retirement_inputs);
    t.liquidity_health = liquidityHealth(p.liquidity_inputs);

    t.master_classification = masterClassification(
      t.financial_capacity.score, t.risk_tolerance.score, t.risk_requirement.score,
      p.goal_structure_score, t.retirement_readiness.score, t.behaviour.score, t.wealth_dna.score
    );
    t.portfolio_eligibility = portfolioEligibility(
      t.financial_capacity.score, t.risk_tolerance.score, t.risk_requirement.score,
      t.goal_criticality.score, t.retirement_readiness.score, t.liquidity_health.score, t.wealth_dna.score
    );
    t.master_equity_score = masterEquityScore(
      t.financial_capacity.score, t.risk_tolerance.score, t.risk_requirement.score,
      p.years_horizon, t.behaviour.score
    );
    t.core_allocation = coreAllocation(
      t.master_equity_score, t.liquidity_health.band,
      t.financial_capacity, t.risk_tolerance, t.risk_requirement, t.behaviour
    );
    t.equity_sub_allocation = equitySubAllocation(t.master_equity_score.band, p.behaviour_inputs);
    t.debt_sub_allocation = debtSubAllocationProvisional(t.liquidity_health.band, p.years_to_nearest_goal || 5);

    return t;
  }

  // Self-test (must pass before exposing API)
  function validateAgainstManualExample() {
    const mes = masterEquityScore(80, 70, 75, 15, 70);
    if (Math.abs(mes.score - 78.5) > 0.01) throw new Error('MES mismatch: got ' + mes.score + ', expected 78.5');
    if (mes.band !== 'Growth') throw new Error('MES band mismatch: ' + mes.band);
    const sub = equitySubAllocation(mes.band, {});
    if (sub.large_cap_pct !== 40 || sub.mid_cap_pct !== 30 || sub.small_cap_pct !== 20 || sub.international_pct !== 10)
      throw new Error('Equity sub-alloc mismatch: ' + JSON.stringify(sub));
    return true;
  }

  const API = {
    classify, makeBands, weighted,
    behaviourComposite, financialCapacity, riskTolerance, riskRequirement,
    wealthDna, masterClassification, goalCriticality, retirementReadiness, liquidityHealth,
    portfolioEligibility, masterEquityScore, coreAllocation, equitySubAllocation,
    debtSubAllocationProvisional, fundQualityScore, simulateInvestor, validateAgainstManualExample,
    ARCHETYPE_DESC,
    // BUG FIX: `PORTFOLIO_ELIGIBILITY_BANDS: PORTFOLIO_ELIGIBILITY_BANDS => ...` was an
    // accidental arrow function, so BANDS.PORTFOLIO_ELIGIBILITY_BANDS was not a band table.
    BANDS: { MES_BANDS, PORTFOLIO_ELIGIBILITY_BANDS, LIQUIDITY_BANDS },
  };

  // Expose band tables
  API.MES_BANDS = MES_BANDS;
  API.PORTFOLIO_ELIGIBILITY_BANDS = PORTFOLIO_ELIGIBILITY_BANDS;
  API.LIQUIDITY_BANDS = LIQUIDITY_BANDS;
  API.BEHAVIOUR_BANDS = BEHAVIOUR_BANDS;
  API.RETIREMENT_BANDS = RETIREMENT_BANDS;
  API.FINANCIAL_CAPACITY_BANDS = FINANCIAL_CAPACITY_BANDS;
  API.RISK_TOLERANCE_BANDS = RISK_TOLERANCE_BANDS;

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof root !== 'undefined') root.IVMethodology = API;

})(typeof window !== 'undefined' ? window : globalThis);
