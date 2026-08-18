# InvestVerdict — Complete Project Documentation (A to Z)

**Site:** InvestVerdict — "Clarity Before You Invest"
**What it is:** A browser-based, rule-driven personal financial planning tool for Indian investors — it interviews the user across 4 stages, runs 13 scoring engines, and produces a full financial-planner-grade report: asset allocation, SIP plan, retirement & FI analysis, insurance gaps, goal funding, tax levers, behavioural guardrails and a phased action plan — **without ever naming a fund, AMC, or stock** (SEBI-safe, educational-only).
**Stack:** Pure HTML + CSS + vanilla JavaScript + Chart.js (CDN). No backend, no build step, no data leaves the browser.
**Last verified:** 2026-08-18 · All ~2,000 automated checks passing (`node test/run-tests.js`).

> **एक नज़र में (Hinglish TL;DR):** Ye ek static website hai jo ek financial planner ki tarah kaam karti hai. User 4 steps me apni details bharta hai (profile, paisa, goals, risk mindset). Phir `methodology-engine.js` ke 13 rule-based engines har cheez ko 0–100 score dete hain, unse Equity/Debt/Gold/Cash allocation nikalta hai, aur `index.html` ka render layer ek poori report banata hai — SIP kitna karna hai, retirement corpus kitna chahiye, insurance kitna lena hai, kaunsa goal possible hai kaunsa nahi — sab **calculation trace ke saath** (koi black box nahi). Humne isko test kiya, 17 bugs mile aur fix kiye — sab neeche Section 12 me likhe hain taaki dubara na ho.

---

## Table of Contents

1. [Why we built it (purpose & philosophy)](#1-why)
2. [File-by-file structure](#2-files)
3. [How the app flows (start to end)](#3-flow)
4. [The intake form — every single input](#4-form)
5. [Input → score mapping (buildProfile)](#5-mapping)
6. [The 13 methodology engines (weights, bands, overrides)](#6-engines)
7. [The allocation process (3-ceiling method)](#7-allocation)
8. [The rupee-math layer (every formula)](#8-math)
9. [The Cash-Flow Priority Waterfall](#9-waterfall)
10. [The report — every section explained](#10-report)
11. [Central assumptions (single source of truth)](#11-assumptions)
12. [Mistakes we made — full list + rules so they never happen again](#12-mistakes)
13. [Testing — how we prove it works](#13-testing)
14. [Unused/legacy files](#14-legacy)
15. [Future roadmap ideas](#15-roadmap)

---

<a name="1-why"></a>
## 1. Why we built it (purpose & philosophy)

**The problem:** Most Indians get financial "advice" from commission-driven sellers (mis-sold ULIPs/endowments), random YouTube tips, or generic calculators that ignore their real cash flow. A fee-only planner is expensive and rare. And SEBI rules make it legally risky for a tool to recommend specific funds/stocks without an RIA licence.

**Our answer:** A tool that behaves like a disciplined, honest, fee-only planner but stays **category-level only**:

- It never names a fund, AMC, ticker, scheme or stock — instead it gives the user **parametric screening filters** (P/E ceiling, Sharpe floor, AUM minimum, etc.) tuned to their profile, so they can shortlist products themselves.
- Every number is **traceable** — the report includes a full calculation trace (every score = inputs × weights, shown line by line). No black box.
- It is **honest before it is optimistic** — the six core principles baked into the code (from our internal "Advisory Brief"):
  1. **Affordability first (the waterfall):** no SIP/premium/EF recommendation is shown as actionable until it is verified affordable, in strict sequence, after everything above it is funded. If nothing is affordable, the report says **₹0 — honestly** ("honest-zero rule").
  2. **One consistent story:** every section reads from the same computed figures — the exec summary, action plan, projections and reconciliation table can never disagree.
  3. **Count what the client already owns (Component A):** existing investments are grown forward at their own asset-class rates and included in every corpus/gap figure.
  4. **Viability, not fantasy:** a goal that needs 90% of income is flagged "not viable as scoped" with concrete alternatives (extend timeline / reduce target / mortgage structure), instead of a pretend SIP.
  5. **Reconcile self-reported data:** e.g. stated emergency-fund months are cross-checked against disclosed cash+FD, and discrepancies are surfaced, not silently resolved.
  6. **Single assumptions table:** every return/inflation/withdrawal rate in the whole report comes from ONE object (`ASSUMPTIONS`), printed in the report for auditability.
- **Risk is a ceiling, not an average:** a client's *need* for returns is never allowed to push equity above what their *capacity* and *psychology* can hold through a crash (the 3-ceiling method, Section 7).

It is explicitly **educational / simulation only — not registered investment advice** (stated in the code and the report).

---

<a name="2-files"></a>
## 2. File-by-file structure

| File | Size | Role |
|---|---|---|
| `index.html` | ~3,700 lines | **The entire app.** Form UI (4 stages), CSS, the orchestration + rupee-math + report-rendering JavaScript (one big inline `<script>`). |
| `methodology-engine.js` | ~600 lines | **The scoring brain** (v2.1). 13 pure, rule-based engines. Works in browser (`window.IVMethodology`) and Node (`module.exports`) — that dual export is what makes automated testing possible. |
| `test/harness.js` | — | Runs the real production code in Node: loads the engine + extracts the inline script from `index.html`, stubs the DOM, exposes `buildProfile`/`renderDashboard`/etc. for testing. |
| `test/run-tests.js` | — | 15 client scenarios, ~2,000 assertions. `node test/run-tests.js [--verbose]`. |
| `TESTING-AND-FIXES.md` | — | The bug-fix report from the full audit (summarised in Section 12 here). |
| `logo.png`, `logo-white.png` | — | Branding (navy/gold theme: `#0B1F3A` / `#C9A961`). |
| `pdf-export.js` | legacy | **NOT loaded by index.html.** Old jsPDF-based report generator, still written against the pre-v2 engine API. Needs a rewrite before re-use. The current "Download report (PDF)" button simply uses `window.print()`. |
| `iv-font.js` | legacy | Embedded TTF (for the ₹ glyph) used only by the legacy PDF exporter. |
| `index_backup_*.html`, `pdf-export_backup_*.js` | legacy | Pre-v2 backups, kept for history. |
| `default.php` | unrelated | Hostinger's default placeholder page — not part of the app. |

**External dependency:** Chart.js 4.4.1 from cdnjs (charts only — the report's numbers render even if the CDN fails; every chart call is guarded).

---

<a name="3-flow"></a>
## 3. How the app flows (start to end)

```
Stage 0 (Profile) → Stage 1 (Finances) → Stage 2 (Goals) → Stage 3 (Mindset)
        └── validateStage() gates every "Next" (mandatory fields)
                                   ↓  "Generate My Plan"
generatePlan()
  ├─ re-validates ALL stages (so Back-navigation can't skip anything)
  ├─ buildProfile()            — reads every form field → ~60-field profile object
  └─ runEngine(profile)
       ├─ animated loading screen (13 engine steps shown)
       ├─ IVMethodology.validateAgainstManualExample()   — engine self-test on every run
       ├─ IVMethodology.simulateInvestor(profile)        — all 13 engines → "trail"
       ├─ finalizeTrail(trail, profile)                  — behaviour penalties applied,
       │     then MES + core allocation + sub-allocation + master classification
       │     are RE-COMPUTED with the penalised behaviour score (consistency)
       └─ renderDashboard(profile, trail)
            ├─ buildCashFlowWaterfall(profile)   — THE affordability sequence (Section 9)
            ├─ retirementTarget / requiredSIP / Component A computed once, stored on profile
            ├─ validateReport()                  — sanity tripwires (sums, NaN, consistency)
            └─ ~25 report sections rendered (Section 10)
```

**After the report:** "Refine" buttons (`more conservative / more aggressive / longer horizon / shorter horizon / reset`) deep-copy the original profile, nudge the relevant inputs, and re-run the whole engine — so the user can explore without re-filling the form. `startOver()` clears everything.

---

<a name="4-form"></a>
## 4. The intake form — every single input

### Stage 0 — "Who are you?" (Basic profile)
| Field | id | Type | Feeds |
|---|---|---|---|
| First name | `s0-name` | text (required) | Report personalisation |
| Age | `s0-age` | number 18–80 (required) | Longevity, premiums, years-to-retirement |
| Life stage | `s0-life` | select (single / single-supporting-family / married-no-kids / married-young-kids / married-grown-kids / near-retirement) | Family responsibility, healthcare preparedness |
| Employment | `s0-emp` | select (salaried-private / salaried-govt / self-employed / business-owner / retired / student) | Income-stability base, income-replacement need |
| Financial dependents | `s0-dep` | slider 0–8 | Family responsibility, health premium, protection urgency |
| Target retirement age | `s0-retire` | number 30–80 | Years-to-retirement (floor 1), FC-03 override |
| Investing experience | `chips-exp` (required) | never / 1–2 / 3–5 / 5–10 / 10+ | Risk-tolerance input (10/25/55/75/95) |
| Wealth DNA | `chips-dna` (required) | security / growth / freedom / legacy / opportunity | Archetype + DNA scores |

### Stage 1 — "Your financial picture"
| Field | id | Notes |
|---|---|---|
| Monthly take-home income | `s1-income` (required) | The base of the whole plan (default 70,000 if somehow empty) |
| Income stability | `s1-stability` | fixed / variable / business / freelance / retired-pension — **adjusts** the employment stability base |
| Itemised expenses ×6 | `s1-exp-housing/emi/household/lifestyle/insurance/other` | Summed = monthlyExpenses. Blank ⇒ fallback 60% of income. **Deliberately NOT capped at income** (a deficit must stay visible). Live cash-flow readout below the fields. |
| Current monthly SIP | `s1-sip` | Blank ⇒ estimated at 85% of free cash |
| EMI months remaining | `s1-emi-months` | Powers the EMI-sunset module |
| Outstanding loan balance | `s1-loan-out` | Term-cover sizing, net worth |
| Current investments ×11 | `inv-mf/stocks/index/debt/fd/ppf/epf/nps/gold/cash/re` | Today's value per instrument — each grows at its own assumed rate (Component A) |
| Insurance surrender value | `inv-insval` | Triggers the ULIP/endowment review flag |
| Property rent / property EMI | `inv-re-rent`, `inv-re-emi` | Net rental cash-flow + yield analysis |
| Term cover held | `s1-term` | Protection gap is net of this |
| Health insurance | `s1-health` | none / employer / personal / both |
| Emergency fund | `s1-emfund` | 0 / 1 / 3 / 6 / 12 / 12+ months (12+ → 14) |

### Stage 2 — "What are you building towards?"
| Field | id | Notes |
|---|---|---|
| Primary goal | `chips-goal` (required) | wealth / retire / house / edu / emergency / tax / passive |
| Horizon | `s2-hor` slider 1–40 yr | Smart insight appears for ≤3 (warning) and ≥15 (encouragement) |
| Nearest financial need | `s2-nearest` slider 1–10 yr | Debt bucketing, urgency |
| Return expectation | `chips-return` (required) | low / moderate / high / very-high → 30/55/75/90 |
| Retirement monthly expenses (today's ₹) | `s2-ret-exp` | select: 30k / 60k / 125k / 300k — **drives the retirement & FI targets** |
| Existing retirement savings | `s2-ret-sav` | none / low / moderate / good / ready → corpus adequacy 10–95 |
| Retirement dependents | `chips-ret-dep` (required) | 0 / 1 / 2+ → retirement need 30/55/80 |
| Up to 3 specific goals | `g1..g3 -type/-amt/-yrs` | Retirement / House / Child Education / Marriage / Car / Wealth / Other — optional, powers the goal-by-goal funding table |
| Miss-consequence | `s2-consequence` | low/moderate/high/critical → 20/50/75/95 |
| Flexibility | `s2-flexibility` | very-flexible/flexible/rigid/locked → 90/65/35/10 (inverted in scoring) |

### Stage 3 — "How you think about risk" (all required chips)
| Question | id | Options → scores |
|---|---|---|
| Portfolio drops 30% in 3 months, you… | `chips-react` | sell-all 10 / reduce 35 / hold 65 / buy-more 90 |
| Comfort with ±20% swings | `chips-volatility` | very-low 10 / low 30 / moderate 55 / high 75 / very-high 95 |
| When everyone is panicking you… | `chips-decision` | follow 15 / ask-advisor 40 / research 70 / contrarian 90 |
| After a bad investment you… | `chips-regret` | exit-simple 20 / learn 65 / ignore 80 / double-down 90 |
| 6 bias self-assessments | `s3-loss-av/overconf/herd/recency/mental/confirm` | 5-point agree→disagree scale; BIAS_MAP: very-true 10 → very-false 95 (mental accounting uses its own map: 20/35/55/75/90 because compartmentalising IS the bias) |
| Relationship with money | `chips-money-rel` | security/freedom/legacy/score focus → +15 to the matching DNA dimension |

---

<a name="5-mapping"></a>
## 5. Input → score mapping (`buildProfile`) — the important derived values

- `yearsToRetirement = max(1, retireAge − age)`
- `monthlyExpenses` = sum of 6 items (never capped at income); `coreMonthlyExpenses = monthlyExpenses − EMI` (a temporary EMI must not inflate a 25×-forever corpus target); **emergency-fund target deliberately keeps the EMI** (an emergency doesn't pause your loan).
- `postWorkMonthlyExpense` = the user's OWN stated retirement expense estimate (fallback: core expenses).
- `savingsPct = clamp0..95(round((income − expenses)/income × 100))` — floored at 0 for the label only, never used to reconstruct rupees.
- `incomeStability` = employment base (85/90/55/60/70/35) **+ stated-stability adjustment** (fixed +5, variable −10, business −20, freelance −25), clamped 20–95.
- `debtToIncomePct = EMI / income`; `debtStrength = max(5, 100 − DTI × 1.4)`.
- `emergencyReserve = min(100, round(months/6 × 100))` — **6 months = 100** (calibrated to the report's own 6-month target).
- `netWorthEstimate = all investments + real estate − outstanding loans`; strength = `clamp(nwRatio×16 + 10)` where nwRatio = NW/annual income.
- `familyResp = clamp(90 − deps×12 + lifeStageAdj)` (single +5, supporting-family −8, young-kids −8, near-retirement −5).
- Wealth DNA: chosen dimension 85, others 35–50, money-relationship answer +15 to its dimension.
- ~20 more sub-scores (funding gap, healthcare, longevity, withdrawal sustainability, portfolio liquidity…) — each a one-line documented formula in `buildProfile`.
- The profile also carries snake_case copies (`years_horizon`, `emergency_fund_months`, …) because the engine reads those names — **both must stay in sync** (see Mistake H-1).

---

<a name="6-engines"></a>
## 6. The 13 methodology engines (`methodology-engine.js`)

Every engine = `weighted(inputs, WEIGHTS)` → 0–100 score + band + full trace line per component. Bands are contiguous 0–20/20–40/40–60/60–80/80–100 (no gaps — see Mistake H-2).

| # | Engine | Weights | Bands |
|---|---|---|---|
| 0 | **Behaviour Composite** | loss-aversion .20, overconfidence .15, herd .15, recency .15, confirmation .10, mental-accounting .10, regret .15 | Fragile → Highly Resilient |
| 1 | **Financial Capacity** | income .20, cash-flow .15, liquidity .15, net-worth .15, debt .15, horizon .10, family .10 · **Overrides:** FC-01 EF<3mo → band −1 · FC-02 DTI>50% → band −1 · FC-03 retirement ≤5yr → growth flag | Very Low → Very High Capacity |
| 2 | **Risk Tolerance** | loss-aversion .25, volatility .20, decision .15, behavioural-bias .15 (injected from Behaviour), experience .10, resilience .15 | Very Conservative → Aggressive |
| 3 | **Risk Requirement** | goal-return .25, funding-gap .20, horizon .20, retirement-need .15, asset-base .10, income-replacement .10 | Very Low → Very High |
| 4 | **Wealth DNA** | 5 dimensions × .20 → dominant dimension = archetype (Capital Protector / Growth Seeker / Balanced Builder / Legacy Creator / Opportunity Hunter) | — |
| 5 | **Master Classification** | FC .25, RT .20, RR .15, goal-structure .10, retirement .10, behaviour .10, DNA .10 | — |
| 6 | **Goal Criticality** | importance .25, urgency .20, consequence .25, dependency .15, **flexibility inverted (100−x)** .15 | Low → Critical |
| 7 | **Retirement Readiness** | corpus .25, savings-behaviour .15, income-sustainability .15, horizon .10, longevity .10, healthcare .10, withdrawal .10, stress .05 | Critical → Retirement Ready |
| 8 | **Liquidity Health** | emergency-reserve .30, cash-flow .15, income-reliability .15, near-term-goals .10, debt-pressure .10, family-dependency .10, portfolio-liquidity .10 | Critical → Excellent |
| 9 | **Portfolio Eligibility** (gatekeeper) | FC .25, RT .20, RR .15, GC .15, RetR .10, LH .10, DNA .05 | Preservation → Advanced Growth |
| 10 | **Master Equity Score (MES)** | capacity .30, tolerance .25, requirement .20, horizon-score .15, behaviour .10 · Horizon lookup (strict `<`): <3y→(20,−25) · <5→(40,−15) · <10→(60,0) · <15→(80,+5) · 15+→(100,+10). Validated: (80,70,75,15y,70) ⇒ **78.5 Growth** | Very Conservative → Aggressive |
| 11 | **Core Allocation** | 3-ceiling method — Section 7 | — |
| 12 | **Equity Sub-Allocation** | baseline by MES band + behaviour overrides — Section 7 | — |
| + | Debt sub-allocation (provisional buckets), Fund-Quality scorer (generic, currently unused in UI) | | |

**Post-engine behaviour penalties (`applyBehaviourPenalties` in index.html):** the raw crash/volatility/decision/regret answers subtract directly from the Behaviour score (sell-all −25, reduce −15, follow-the-crowd −10, ask-advisor −4, very-low comfort −15, low −8, exit-to-simple −10) and re-band it (Resilient ≥75 / Stable ≥60 / Cautious ≥45 / Reactive ≥30 / Highly Reactive). `finalizeTrail` then **recomputes MES, core allocation, sub-allocation AND master classification** with the penalised score so every displayed number agrees.

---

<a name="7-allocation"></a>
## 7. The allocation process (3-ceiling method)

The core idea: **a high need for returns must never buy more risk than the client can afford or psychologically hold.**

1. **Step 1 — Need-based equity (diagnostic only):** position-in-band interpolation of the Risk-Requirement score against the equity table (VC 10–30 / C 30–50 / M 50–70 / G 70–85 / A 85–100). Shown to the user, never used directly.
2. **Step 2 — Capacity ceiling:** Financial-Capacity band → 35/50/65/85/100, tightened by Liquidity band (Critical −10, Weak −5).
3. **Step 3 — Tolerance/behaviour ceiling:** Risk-Tolerance band → 35/50/65/85/100, tightened by Behaviour score (<20 → −10, <40 → −5).
4. **Step 4 — Final equity = MIN(step1, step2, step3) + time-horizon adjustment** (−25…+10 pts). The binding constraint (need/capacity/tolerance) is named in the trace.
5. **Step 5 — Disclosure:** if final equity is >17.5 pts below the need-based figure, the report openly tells the user their goal needs more risk than is safe for them, and that the answer is more SIP / more time / smaller target — **not more equity**.

Then: **Gold** by MES band (10/8/6/4/2%), **Cash** by Liquidity band (20/15/10/6/3%), equity capped to preserve those buffers, **Debt = remainder** (sanity-checked against the band's illustrative range).

**Equity sub-allocation** (Large/Mid/Small/International): baseline per MES band (e.g. Growth = 40/30/20/10, which reproduces the manual's worked example), then behaviour overrides (high loss-aversion → Large +15 / Small −10; high overconfidence → Intl +10; high regret-aversion → Small+Intl capped at 15%), floors at 0, normalisation to 100, concentration caps (Large ≤80, Small ≤25, Intl ≤25).

---

<a name="8-math"></a>
## 8. The rupee-math layer (every formula)

| Function | Formula / logic |
|---|---|
| `fvSIP(sip, y, r%)` | Ordinary-annuity SIP future value: `sip × ((1+r/12)^(12y) − 1)/(r/12)` |
| `reqSIP(target, y, r%)` | Inverse of fvSIP; **0% rate ⇒ target ÷ months** (guarded) |
| `stepUpFV(sip, y, r%, step%)` | Year-by-year: each year's contributions grow at r, contribution itself grows `step%`/yr |
| `fiCorpusTarget(exp, y)` | `exp × 12 × (100/SWR) × (1+inflation)^y` = 25× annual expenses, inflation-adjusted |
| `retirementTargetCorpus(p)` | fiCorpusTarget on the **user's stated post-work expenses** (EMI excluded) over yearsToRetirement — the single source every retirement figure reads |
| `blendedReturn(alloc)` | Weighted return of the actual E/D/G/C split from the assumptions table |
| `existingAssetsFutureValue(p, y)` | **Component A** — each held instrument grown at its own rate; disclosed as unearmarked (never double-counted against per-goal tables) |
| `requiredSIP` | `reqSIP(max(0, retirementTarget − ComponentA), yearsToRetirement, blended)` — Component A netted out first |
| `fiAnalysis / fiYearForSIP / fiYearStepUp` | First year where ComponentA + SIP corpus ≥ that year's inflation-adjusted 25× target; honest "50+ yrs" if never; a **zero SIP is allowed** (assets alone can cross) |
| `portfolioRisk(alloc)` | σ = √Σ(wᵢ·volᵢ)² × 0.95 (vols: equity 18, debt 4, gold 14, cash 1); worst/best year = ER ∓ 2σ; max drawdown ≈ equity% × 0.55 |
| `crashScenario` | Monthly compounding; at crash-year the equity portion takes the stated hit; SIP continues |
| `estimateEMI(P, r%, y)` | Standard amortisation formula |
| `estimateTermPremium` | ~₹2,500/Cr/yr + ₹100/yr per age-year above 30 (labelled ESTIMATE, only used for affordability sizing) |
| `estimateHealthPremium` | ~₹6,000/yr per ₹10L + ₹1,500/dependent |
| `recommendedTermCover(p)` | max( ceil(15× annual income to 25L), loans + 10yr expenses ) — single source used by banner, table and waterfall |
| `recommendedHealthCover(p)` | 25L if >1 dependent or age >45, else 15L |
| `goalViability(sip, …)` | required-SIP as % of income: ≤40% normal · ≤80% difficult · >80% **not viable**; computes alternative timeline & alternative target |
| `epfCorpusAtRetirement` | Balance grown at 8.25% + employer contribution stream (≈12% of basic≈50% CTC) |

---

<a name="9-waterfall"></a>
## 9. The Cash-Flow Priority Waterfall (`buildCashFlowWaterfall`)

Computed **once** per report and reused by every section (Principle 2). Strict sequence:

1. **True free cash flow** = income − true expenses (may be negative — stays negative).
2. **Identified expense cuts** — same flagging rule everywhere: lifestyle −25%, other −30%, household −7%. If cuts still don't reach breakeven → `structuralGapRemaining` (needs income/EMI/rent-level change — the report says exactly that).
3. **15% slack buffer** kept unallocated (irregular months) → the rest is `deployable`.
4. **Protection** — ideal cover **net of what the client already holds**; if unaffordable, proportionally scaled *interim* cover (term floored at 25L; health only if its minimum premium actually fits — never a cover with ₹0 budgeted).
5. **Emergency fund** — 1-month **interim milestone gates the SIP**: below it, ALL remaining cash goes to EF; after it, 30% EF top-up / 70% SIP until the full 6-month target.
6. **SIP steady-state** — the realistic sustained figure; this (not the user's aspiration, not "all free cash forever") is `projectionSIP`, the basis of **every** projection in the report. If the plan only fits because of assumed expense cuts, the report **discloses that explicitly**.
7. A **reconciliation table** shows premium + EF + SIP + buffer vs available cash — must balance to the rupee (and the test-suite asserts it).

Special honest-zero handling: SIP=0 ⇒ projections show ₹0, the SIP-split table is replaced by an explanation, and the exec summary's first actions become the unlock steps.

---

<a name="10-report"></a>
## 10. The report — every section explained (in order)

1. **Hero** — name, MES band, equity %, eligibility band, DNA archetype.
2. **⛔ Critical protection banner** (conditional) — appears when the protection-urgency score ≥60 (dependents + no term + no health + no EF); the ask is sized to what's actually affordable, labelled interim if scaled.
3. **Executive summary** — 5 stat chips + "Do this first" list that **mirrors the waterfall order exactly**.
4. **Score grid** — 8 engine scores with bands and bars.
5. **Allocation** — E/D/G/C bars + donut + methodology notes (the 3-ceiling trace) + equity sub-allocation grid + radar "financial fingerprint" + equity bar chart.
6. **Cash-flow snapshot** — income/expenses/SIP/buffer/net-worth + savings-rate benchmark vs Indian median.
7. **Cash-Flow Priority Waterfall** — the full sequenced plan + reconciliation table (Section 9).
8. **Expense bifurcation** — fixed / semi-fixed / discretionary classification, rupee savings per flagged cut, and what those cuts compound to.
9. **Current investments** — per-instrument table, alignment score vs target mix, EPF-at-retirement projection, idle-cash alert, ULIP/endowment surrender review, rental-property net-cash-flow & yield analysis.
10. **Goal-by-goal funding** — each goal inflated at its own rate (house 7% / education & events 6% / other 5%), funded in priority order from ONE budget; houses use the 20%-down-payment + mortgage-EMI structure; viability flags with concrete alternatives; near-term goals (<5y) get a debt-heavy split note.
11. **SIP upgrade roadmap** — today → post-milestone → post-EMI-clearance steps (defers to the waterfall, never re-derives).
12. **Why this equity %** — need vs capacity vs tolerance spread analysis + the Step-5 ceiling disclosure.
13. **Goal & corpus projection** — cautious/expected/optimistic table + growth chart + (for retirement goal) the full target/Component-A/Component-B/gap/required-SIP block with sanity flag on understated retirement expenses.
14. **Step-up bridge** — flat vs 10%-step-up corpus by year + the honest explanation of why the FI number can dwarf the fixed retirement target.
15. **SIP structure** — the rupee split across Large/Mid/Small/Intl/Debt/Gold/Cash, rounded to ₹50, reconciled to the exact SIP; sub-₹500 buckets folded into the nearest sibling with a "viable from ₹X" note; thin-debt-sleeve advice.
16. **EMI sunset** (conditional) — the month the EMI clears, the redirect instruction, and its rupee impact on the final corpus.
17. **Tax optimisation** — LTCG harvesting, post-2023 debt taxation, 80C stack, NPS 80CCD(1B), SGB, account-priority order.
18. **Screening criteria** — parametric filters for direct equity, equity MFs and debt funds computed from MES + horizon (P/E, beta, D/E, ROE, PEG, AUM, Sharpe, capture ratios, credit quality, duration…) with where-to-check sources.
19. **Advanced** — portfolio risk cards (ER, ±1σ, worst year, max drawdown), six what-if scenarios (step-up, delay cost, crash, inflation real-value), protection & EF gap table, liquid-asset reconciliation, and the 3-path FI table.
20. **Behavioural guardrails** — the crash pre-commitment: corpus at ~70% of the actual horizon, the drawdown in rupees, and a personalised rule based on the behaviour band ("sign & date this page").
21. **Playbook** — tax-efficient rebalancing order, ±6pt drift bands, annual review checklist, glossary.
22. **Action plan** — GATED phases: Phase 0 fix cash flow (conditional) → Phase 1 protection & liquidity → Phase 2 begin investing (explicitly gated on the EF milestone) → Phase 3 ongoing discipline.
23. **Assumptions table** — the whole `ASSUMPTIONS` object printed (Principle 6).
24. **Calculation trace** (collapsible) — every engine's line-by-line weighted math, overrides, allocation notes, sums.

---

<a name="11-assumptions"></a>
## 11. Central assumptions (single source of truth)

```js
ASSUMPTIONS = {
  inflation_pct: 6,               // base case (India CPI planning)
  inflation_high_stress_pct: 8,   // stress scenario
  safe_withdrawal_rate_pct: 4,    // ⇒ 25× annual expenses
  asset_returns_pct: { mf:12, stocks:12, index:11, debt:7, fd:6.5,
                       ppf:7.1, epf:8.25, nps:10, gold:8, cash:3.5, re:8 },
  goal_inflation_pct: { house:7, education:6, marriage:6, default:5 },
}
```
**Rule:** nothing anywhere in the report may hardcode a rate — every figure traces here, and this table is printed in the report so an auditor can verify consistency.

---

<a name="12-mistakes"></a>
## 12. Mistakes we made — FULL list + rules so they never happen again

### 12a. Historical bugs (made during original development, already fixed in v2.x)

| # | Mistake | Lesson |
|---|---|---|
| H-1 | The engine read snake_case fields (`years_horizon`, `emergency_fund_months`…) that the profile didn't provide — so **every investor silently got max-horizon treatment** and the EF/debt overrides never fired. | When two layers exchange an object, the field names are a **contract** — test it end-to-end, not each layer alone. |
| H-2 | Score bands had gaps (`[21,40],[41,60]`…) so a fractional score like 60.75 fell through and classified as the **top** band. | Ranges must be contiguous; write a boundary test (we now test 20, 60.75 etc.). |
| H-3 | MES horizon lookup used `<=` instead of `<` — 15 years scored 80 instead of 100, breaking the manual's worked example (78.5). | Keep a **golden reference case** and run it on every load (`validateAgainstManualExample`). |
| H-4 | `emMap[v] || 6` turned a genuine "0 — no emergency fund" answer into 6 months because **0 is falsy in JS**. | Never use `|| default` on values where 0/''/false are legitimate — use `hasOwnProperty` / `??`. |
| H-5 | Expenses were capped at income, silently hiding a real household deficit from every downstream figure. | Never "sanitise" reality away; floor only display labels, never the underlying rupees. |
| H-6 | A ₹0 affordable SIP was silently replaced by the user's aspirational SIP (or ₹5,000) in projections. | The **honest-zero rule**: an uncomfortable true number beats a comfortable fake one. |
| H-7 | Retirement target used current expenses **including the EMI** forever, and ignored the retirement-expense question the form itself asked. | Every collected input must be consumed; expense bases must match the question being answered. |
| H-8 | Two different "recommended term cover" and cash-rate numbers existed in different sections (copy-pasted logic drifting apart). | **Single source of truth** per figure; one function, called everywhere. |
| H-9 | Behaviour penalties were applied AFTER allocation was computed — the score grid showed 0/100 while the allocation trace used 32.8. | After mutating any input score, **recompute everything downstream** of it (`finalizeTrail`). |
| H-10 | Equity "need" was blended/averaged with capacity & tolerance, letting a desperate goal buy dangerous risk. | Risk dimensions are **ceilings (MIN)**, never averages. |
| H-11 | Behaviour overrides could push small-cap **negative** (Conservative baseline 5% − 10pt), cascading into negative rupee SIPs. | Floor at 0 and re-normalise; assert non-negativity in tests. |

### 12b. Bugs found in the 2026-08 full audit (all fixed — see TESTING-AND-FIXES.md)

| # | Mistake | Lesson |
|---|---|---|
| A-1 | Engine's `BANDS` export contained an accidental **arrow function** (`X: X => X`) instead of the table. | A typo can survive if the export is never exercised — test your public API surface too. |
| A-2 | `reqSIP` at 0% rate divided by zero → **NaN rendered to the user**. | Guard every division; test suite now greps ALL rendered HTML for NaN/Infinity/undefined. |
| A-3 | The "Income stability" question was **collected but never read** — commission earner scored like fixed-salary. | After building a form, grep every input id and prove each one is consumed. (Same lesson as H-7 — we repeated this class of mistake; that's why this rule is now a test.) |
| A-4 | "Life stage" select — same class: collected, never used. | Same rule. |
| A-5 | Rental property's rent & EMI — same class again: collected, never used. | Same rule. Three instances = systemic; the check must be automated, not remembered. |
| A-6 | Emergency-reserve scale (`months × 7`) scored a fully-funded 6-month fund at 42/100 while the same report said "Fully funded ✓". | Calibrate scores to the **same target the report preaches**; contradictions between sections are bugs. |
| A-7 | Behaviour penalty checked `'call-advisor'` — a value **no form option produces** (dead branch), while the genuinely fragile "follow the crowd and sell" answer carried no penalty. | Validate every literal against the actual form option values (the tests now assert every chip/select value has a map entry). |
| A-8 | Post-penalty bands (Cautious/Reactive/Highly Reactive) missing from the colour map — a "Highly Reactive" chip rendered neutral grey. | When you add new enum values, search every switch/map that consumes the enum. |
| A-9 | `finalizeTrail` recomputed MES/allocation but **not Master Classification** — trace disagreed with the grid. | Recompute ALL dependents (H-9's lesson, applied incompletely the first time). |
| A-10 | SIP fold-note divided by a 0% category → "viable once your SIP reaches **₹Infinity**+/month". | Every derived denominator can be zero after upstream flooring; edge-case tests must chain overrides together. |
| A-11 | Scaled interim protection could claim a health cover while budgeting **₹0/month premium** for it. | An amount shown to the user must always have its cost accounted for; assert cover⇔premium consistency. |
| A-12 | Crash guardrail said "around year 10" even on a **3-year** plan. | Never hardcode a horizon inside narrative text — derive it from the user's own inputs. |
| A-13 | "Build the emergency fund — **₹0/month** until the milestone", "reaches milestone in ~— months", "Funded from ₹−9,120/month". | Template strings must branch on zero/negative/null values — phrasing is part of correctness. |
| A-14 | Meaningless "Required + 10% step-up (**₹0/mo**)" row for a client whose assets already covered the target. | Every table row must answer a real question for THIS user; degenerate inputs need their own copy. |
| A-15 | A client at **exact breakeven** got a full protection+EF+SIP plan with no hint it was funded entirely by expense cuts not yet made. | If a recommendation depends on an assumed behaviour change, the dependency must be disclosed where the number is shown. |
| A-16 | The allocation donut was the ONLY chart not guarded by `window.Chart` — a CDN failure crashed the **entire report blank**. | Decoration must never take down data. Guard every third-party call; the report's numbers must render with zero external dependencies. |
| A-17 | Goal inflation rates (7/6/5%) were hardcoded locally, violating our own single-assumptions-table principle. | Principles need enforcement: any literal rate outside `ASSUMPTIONS` is a bug by definition. |

### 12c. The standing rules (apply to ALL future work on this project)

1. **Every form input must be consumed** — and there's a test-shaped way to prove it. Adding an input without wiring it is a bug even if nothing crashes.
2. **Never `|| default`** where 0 / '' / false are valid answers — use `??` or explicit key checks.
3. **One figure = one function.** If two sections need the same number, they call the same function. No local recomputes, no copy-paste.
4. **All rates live in `ASSUMPTIONS`.** A numeric literal that is a return/inflation/rate anywhere else fails review.
5. **After mutating any score, recompute everything downstream** — and list the downstream set in a comment next to the mutation.
6. **Honest zero:** if the math says ₹0 or "not viable", the report says it plainly and explains the unlock path. Never resurrect an aspirational number.
7. **MIN, not average**, when combining need/capacity/tolerance.
8. **Guard every division and every third-party dependency.** Charts are decoration; numbers must survive alone.
9. **Copy is code:** every template string must handle zero/negative/null branches. "₹0/month" and "₹Infinity" reaching a user are P1 bugs.
10. **Keep the golden example** (`validateAgainstManualExample`) green on every load, and run `node test/run-tests.js` before every change ships. Any new bug fixed ⇒ a regression test is added in the same commit.
11. **Sums must reconcile to the rupee** — allocation to 100%, SIP table to the exact SIP, waterfall to available cash. The tests assert all three.
12. **Don't touch the legacy files casually:** `pdf-export.js` targets the old engine API; wiring it back without a rewrite would print numbers that disagree with the report (the exact class of inconsistency this project exists to prevent).

---

<a name="13-testing"></a>
## 13. Testing — how we prove it works

- `test/harness.js` extracts the **real inline script** from `index.html` (no copy of the logic!), loads the real engine, stubs `document`/`window`/`Chart`, and exposes the full pipeline in Node.
- `test/run-tests.js` — 15 scenarios: typical saver · over-committed deficit household (heavy EMI, no insurance, 3 dependents) · near-retirement panic-seller (3-yr horizon) · wealthy accumulator past FI · young beginner (blank SIP) · exact-breakeven with unviable goals · deficit student · tiny-SIP conservative · refine flows · behaviour-override fold edge · freelance-vs-fixed stability · rental property negative carry · crowd-follower penalties.
- ~2,000 assertions: sums reconcile, ceilings respected, scores in range, waterfall never over-allocates, retirement target independently recomputed, requiredSIP actually closes the gap, hand-checked formulas (₹10,000/mo × 10y @12% ⇒ ₹23.0L; ₹50L @8.5%/20y ⇒ ₹43,391 EMI), and **no rendered section ever contains NaN / Infinity / undefined**.
- Run: `node test/run-tests.js` (add `--verbose` to read the actual rendered report text per scenario).

---

<a name="14-legacy"></a>
## 14. Unused / legacy files

- `pdf-export.js` + `iv-font.js`: the old designed-PDF exporter (jsPDF, cover page, donut, gauges). **Not loaded** by the current index.html; still calls the pre-v2 API (`calculateCompositeRisk`, `projection`, `computeAllocation`) and old profile field names. Rewrite required before re-enabling (see roadmap).
- `index_backup_20260614_1601.html`, `pdf-export_backup_20260614_1601.js`: pre-v2 snapshots.
- `default.php`: hosting placeholder, unrelated.

---

<a name="15-roadmap"></a>
## 15. Future roadmap ideas (discussed, not yet built)

1. **Debt & prepayment optimizer** (recommended next) — prepay-vs-invest, avalanche/snowball, refinance break-even; reuses the waterfall.
2. **Old vs New tax-regime optimizer** — annual-refresh traffic magnet.
3. **Insurance policy X-ray** — real IRR of ULIPs/endowments vs "term + SIP the difference".
4. **Retirement drawdown planner** — bucket strategy, SWR simulation, sequence-of-returns stress (the decumulation sequel to this accumulation tool).
5. **Portfolio health check via CAS upload** — allocation drift vs the engine's target, fund overlap, expense-ratio drag (biggest build, stickiest product).
6. **Rewrite the PDF export** against the v2 engine so the paid artifact = the polished report.

*All future modules must feed the same profile object, obey the same waterfall, and follow every rule in Section 12c.*

---

*Document generated 2026-08-18 from the audited, all-tests-passing codebase (branch `claude/financial-algo-testing-apir6t`). Companion file: `TESTING-AND-FIXES.md` (the raw audit report).*
