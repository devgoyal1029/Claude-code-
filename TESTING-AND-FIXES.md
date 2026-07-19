# InvestVerdict — Algorithm Test & Fix Report

Full audit + automated testing of the financial-planning algorithm
(`methodology-engine.js` + the inline script in `index.html`).

## How it was tested

`test/harness.js` executes the **real production code** in Node (the engine file plus
the exact `<script>` block extracted from `index.html`, with a stub DOM), then
`test/run-tests.js` drives the complete pipeline — form inputs → `buildProfile` →
`simulateInvestor` → `finalizeTrail` → `renderDashboard` — across 15 scenarios:

- typical salaried saver · over-committed household in deficit (negative cash flow,
  heavy EMI, no insurance, 3 dependents) · near-retirement panic-seller with a 3-year
  horizon · wealthy accumulator already past his FI number · young beginner with a blank
  SIP field · exact-breakeven budget with unviable goals · student in deficit · tiny-SIP
  conservative · refine-button flows · behaviour-override edge cases · freelance income ·
  rental property with negative carry.

~2,000 assertions cover: allocations summing to 100, ceilings respected, every engine
score in range, waterfall reconciliation (never recommends more outflow than free cash),
retirement target independently recomputed (25× expenses at 4% SWR, inflation-adjusted),
required-SIP actually closing the gap, standard SIP/EMI formulas against hand
calculations, and **no rendered section ever containing NaN / Infinity / undefined**.

Run: `node test/run-tests.js` (add `--verbose` to read the rendered report sections).

## Bugs found and fixed

| # | File | Bug | Fix |
|---|------|-----|-----|
| 1 | methodology-engine.js | `BANDS.PORTFOLIO_ELIGIBILITY_BANDS` exported an accidental **arrow function** instead of the band table | export the real table |
| 2 | index.html | `reqSIP()` divided by zero at a 0% rate → **NaN** rendered as the required SIP | 0% ⇒ target ÷ months |
| 3 | index.html | Stage-1 **“Income stability” answer was collected but never read** — a commission-only earner scored identically to a fixed-salary one | stated stability now adjusts the employment base for every downstream engine |
| 4 | index.html | Stage-0 **“Life stage” answer was collected but never used** | now refines family-responsibility and healthcare-preparedness scores |
| 5 | index.html | Emergency-reserve score used a `months × 7` scale, so the **fully-funded 6-month target scored only 42/100** while the same report said “Fully funded ✓” | 6 months = 100 |
| 6 | index.html | Behaviour penalty checked `crashReaction === 'call-advisor'` — **a value no form option produces** (dead branch); the genuinely fragile “follow the crowd and sell” decision answer carried no penalty | penalise `follow` (+10) / `ask-advisor` (+4); dead branch removed |
| 7 | index.html | Post-penalty behaviour bands (Cautious/Reactive/Highly Reactive) missing from `bandClass` — a “Highly Reactive” chip rendered neutral grey, not red | mapped |
| 8 | index.html | `finalizeTrail` re-ran MES/allocation with the penalised behaviour score but **left Master Classification computed from the un-penalised score** — trace disagreed with the score grid | recomputed |
| 9 | index.html | SIP-structure fold note divided by a 0% category → **“viable once your SIP reaches ₹Infinity+/month”** | 0% categories fold silently |
| 10 | index.html | Waterfall’s scaled (interim) protection could **claim a health cover while budgeting ₹0/month premium** for it | cover only claimed when the minimum premium fits the remaining budget |
| 11 | index.html | Crash guardrail said “Around year 10 your corpus…” **even on a 3-year plan** | illustrated at ~70% of the client’s actual horizon (max 10) |
| 12 | index.html | Exec summary said “Build the emergency fund — …, **₹0/month** until the milestone” for clients in deficit; action plan showed “reaches milestone in ~— months” and “Funded from ₹-9,120/month” | phrasing gated on actual funding |
| 13 | index.html | FI table showed a meaningless “Required + 10% step-up (**₹0/mo**)” row when existing assets already covered the target | steps up the client’s actual SIP instead, relabelled |
| 14 | index.html | A client at **exact breakeven** got a full protection+EF+SIP plan with no hint that it was funded entirely by expense cuts not yet made | explicit disclosure banner when outflows depend on the assumed trims; exec summary notes it too |
| 15 | index.html | The allocation **donut chart was the only chart not guarded** by a `window.Chart` check — if the Chart.js CDN failed, the entire report crashed blank | guarded |
| 16 | index.html | Goal-table inflation rates (7%/6%/5%) were **hardcoded locally**, violating the report’s own single-assumptions-table principle | moved into `ASSUMPTIONS.goal_inflation_pct` + printed in the assumptions table |
| 17 | index.html | Rental **property rent & EMI inputs were collected but never used** | property net cash flow + gross yield analysed; negative-carry warning |

## Verified correct (worth knowing)

- SIP future value, step-up FV, EMI and crash-scenario formulas all match independent
  hand calculations (e.g. ₹10,000/mo × 10y @12% → ₹23.0L; ₹50L @8.5%/20y → ₹43,391 EMI).
- Retirement target = 25× the client’s own stated post-work expenses (EMI correctly
  excluded), inflated to the retirement date; `requiredSIP` + existing-asset growth
  (Component A) reproduces the target to within rounding in every scenario.
- The three-ceiling equity process (need / capacity / tolerance-behaviour) always binds
  correctly — a panic-selling near-retiree lands ≤ 30% equity even with very high
  financial capacity, with the honest disclosure note explaining the gap.
- The cash-flow waterfall never recommends more monthly outflow than deployable free
  cash, keeps the 15% slack, honours the honest-zero SIP rule in deficit cases, and its
  reconciliation table always balances.
- Every chip/select option value in the form has a matching entry in its score map.

## Notes

- `pdf-export.js`, `iv-font.js` and the `*_backup_*` files are **not referenced by
  index.html** (the report button uses `window.print()`). `pdf-export.js` still targets
  the pre-v2 engine API (`calculateCompositeRisk`, `projection`, …) and would need a
  rewrite before being wired back in — left untouched.
- `default.php` is an unrelated hosting placeholder page.
