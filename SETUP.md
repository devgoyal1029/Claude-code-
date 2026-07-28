# Fund Analyzer — setup

Run the SQL in order, then upload one HTML file. Nothing to build, no npm.

---

## 1. SQL — run in this exact order

Supabase → SQL Editor → paste file → Run. Each file is safe to re-run.

| # | File | Creates | Depends on |
|---|---|---|---|
| 1 | `sql/plan_level_holdings.sql` | `v_scheme_plans`, `v_holdings_all_plans`, `holdings_by_code()` | `scheme_base`, `scheme_alias` |
| 2 | `sql/fund_picker.sql` | `v_fund_picker` | 1 |
| 3 | `sql/dashboard_api.sql` | `asset_class()`, `search_schemes()`, 7 holdings RPCs | 1, 2 |
| 4 | `sql/search_fix.sql` | `scheme_key_meta`, `search_schemes()` v2 | 3 |
| 5 | `sql/engine_core.sql` | `mv_security`, `mv_current`, `mv_fund_stats` | 4 |
| 6 | `sql/engine_api.sql` | 18 cross-fund RPCs | 5 |
| 7 | `sql/xray.sql` | portfolio look-through RPCs | 5 |
| 8 | `sql/changes.sql` | `mv_previous`, change-tracking RPCs | 5 |
| 9 | `sql/returns_and_caps.sql` | `scheme_nav_monthly`, `security_meta`, leaderboard + style-drift RPCs | 5 |

Steps 7–9 are independent of each other; all three need step 5.

Two of them start empty and fill in later:
- **Changes** needs a second `portfolio_date` per scheme. `push()` deletes per
  (amc, date, frequency), so loading an older month does not disturb the current one —
  just load previous months.
- **Leaders / style drift** need `colab/nav_monthly_ingest.py` and
  `colab/marketcap_tags.py` to be run.

Until then those RPCs return empty and the dashboard hides the sections rather than
showing a broken page.

**Order is not optional.** Step 5 reads `scheme_key_meta`, which step 4 creates — running
5 first fails with "relation scheme_key_meta does not exist".

Step 5 is the slow one (it scans all of `mf_holdings` three times). Expect 30–90 seconds.

### Check after each step

```sql
-- after 3
select * from search_schemes('flexi cap', 5);

-- after 4  (no row should show a NULL amc_name)
select * from search_schemes('hdfc mid', 10);

-- after 5
select (select count(*) from mv_security)   as securities,
       (select count(*) from mv_current)    as rows,
       (select count(*) from mv_fund_stats) as funds,
       (select round(sum(aum_cr)) from mv_fund_stats) as total_aum_cr;

-- after 6
select * from market_overview();
select * from top_stocks(10, 'value');
```

`total_aum_cr` in the ₹40–50 lakh crore range is about right for 16 AMCs. Far off in
either direction means something upstream is wrong — check before building on it.

---

## 2. Dashboard

1. Open `dashboard/index.html`, confirm `SUPABASE_ANON_KEY` is the **anon / public** key.
   Never the service_role key — this file runs in the browser and everything in it is
   readable by anyone.
2. Upload to Hostinger `public_html/`. Rename to `index.html` if it should be the site
   root, or drop it in a subfolder like `public_html/analyzer/`.
3. Open it. If search returns results, the whole chain works.

Test locally first by double-clicking the file — it talks to Supabase over HTTPS and
needs no web server.

---

## 3. After every new data load

Run `sql/after_load.sql`. Two things happen there that are easy to forget:

```sql
-- new scheme names get their scheme_code mapping
insert into scheme_alias (amc, source_name, k, matched_by)
select distinct h.amc, h.scheme_name, b.k, 'auto'
from mf_holdings h join scheme_base b on b.k = norm_key(h.scheme_name)
on conflict do nothing;

-- the analytical layer is materialised, so it will not see new rows until refreshed
refresh materialized view mv_security;
refresh materialized view mv_current;
refresh materialized view mv_previous;
refresh materialized view mv_fund_stats;

-- REFRESH discards planner statistics, so skipping this makes queries that were
-- fast yesterday start hitting the statement timeout
analyze mv_security;
analyze mv_current;
analyze mv_previous;
analyze mv_fund_stats;
```

The dashboard HTML never changes. Everything else downstream is a view or a function
and picks up new data on its own.

---

## What runs where

```
Browser ──► api.mfapi.in          NAV history; returns and risk computed client-side
        └─► Supabase RPC          holdings, market analytics
```

NAV history is deliberately not stored. Daily NAV for 37,613 schemes would not fit the
free tier, and fetching per-fund means returns work for **every** AMFI scheme rather
than only the ~4,060 with a loaded portfolio.

---

## Known gaps

- **Holdings cover ~11% of AMFI codes.** 16 of ~45 AMCs are loaded. The search badges
  every result `Portfolio` or `NAV only`, and portfolio tabs are hidden for the latter,
  so this never surfaces as a broken page.
- **HDFC and Nippon have NULL `section`/`sub_section`** — loaded with an older parser,
  re-load never run. `asset_class()` falls back to coupon and rating shape for those
  rows. Re-parsing them with the v4 parser fixes it with no code change.
- **AUM is derived** from `sum(market_value_lacs)`, not an official figure. Fine for
  ranking, not for reporting. Funds flagged `needs_review` (arbitrage, equity-savings,
  dynamic allocation — their weights do not sum to 100) will be off.
- **Sector labels are not standardised** across AMCs: "IT - Software" vs "Software".
  Debt schemes report credit ratings in the same column, so ratings appear in sector
  lists too.
- **Change tracking is built but starved.** `sql/changes.sql` compares each scheme's
  latest disclosure against its previous one, but only one date per scheme is loaded so
  far, so it returns nothing. `push()` deletes per (amc, date, frequency) — loading older
  months does not disturb the current one, and the Changes tab appears on its own once a
  scheme has two.
- **Market-cap tagging and leaderboards need their Colab runs.** `security_meta` and
  `scheme_nav_monthly` are empty until `colab/marketcap_tags.py` and
  `colab/nav_monthly_ingest.py` have run.
- **`api.mfapi.in` CORS is unverified** from a browser on your domain. If NAV charts
  stay empty while holdings load, check the console — that is the cause, and the fix
  is a Supabase Edge Function proxy.
