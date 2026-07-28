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
| 6 | `sql/engine_api.sql` | 16 cross-fund RPCs | 5 |

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
refresh materialized view mv_fund_stats;
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
- **No history beyond the latest snapshot.** Only one disclosure date per scheme is
  kept, so "what did this fund buy or sell" is not answerable yet. Retaining old
  `portfolio_date` rows instead of delete-then-insert would unlock it.
- **`api.mfapi.in` CORS is unverified** from a browser on your domain. If NAV charts
  stay empty while holdings load, check the console — that is the cause, and the fix
  is a Supabase Edge Function proxy.
