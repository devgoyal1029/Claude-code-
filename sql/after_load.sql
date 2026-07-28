-- ============================================================================
-- Run this after every push to mf_holdings -- new AMC, new month, re-load.
-- ----------------------------------------------------------------------------
-- Everything downstream of scheme_alias is a view or a function, so it picks
-- up new data on its own. scheme_alias is a real table (it has to survive the
-- monthly delete-then-insert on mf_holdings), so it is the one thing that
-- needs refreshing by hand.
--
-- PART A is the normal case and is usually all you need.
-- PART B is only for funds AMFI has not listed yet.
-- ============================================================================


-- ============================================================================
-- PART A -- after any load
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A1. Map the new scheme names. Idempotent -- existing aliases are untouched,
--     including the manual ones, because of the ON CONFLICT.
-- ----------------------------------------------------------------------------
insert into scheme_alias (amc, source_name, k, matched_by)
select distinct h.amc, h.scheme_name, b.k, 'auto'
from mf_holdings h
join scheme_base b on b.k = norm_key(h.scheme_name)
on conflict do nothing;


-- ----------------------------------------------------------------------------
-- A2. What did NOT map. These schemes hold data but will not appear in the
--     dashboard's search results as "Portfolio", and holdings_by_code will
--     not reach them.
--
--     Expect roughly 35 rows even on a clean run: 23 close-ended (SBI/ICICI
--     FMP series, Nippon Quarterly Interval) that AMFI's master genuinely does
--     not carry and never will, plus a dozen funds too new to be listed.
--     Anything beyond that is worth looking at.
-- ----------------------------------------------------------------------------
select h.amc,
       h.scheme_name,
       count(*)                 as rows,
       max(h.portfolio_date)    as latest
from mf_holdings h
left join scheme_alias a
       on a.amc = h.amc and a.source_name = h.scheme_name
where a.k is null
group by 1, 2
order by 1, 2;


-- ----------------------------------------------------------------------------
-- A3. Cross-AMC guard. A wrong alias now fans out across every plan variant
--     of the fund, so a single bad match pollutes far more than one row.
--
--     ADD ANY NEW AMC to the map below, otherwise it is silently skipped and
--     never checked. The short codes in mf_holdings ('ABSL', '360ONE') do not
--     prefix-match master's full names, which is why the map is explicit.
-- ----------------------------------------------------------------------------
with amc_map(amc, prefix) as (values
    ('ABSL','aditya birla sun life'), ('HDFC','hdfc'),   ('SBI','sbi'),
    ('ICICI','icici prudential'),     ('Nippon','nippon india'),
    ('Kotak','kotak'),                ('DSP','dsp'),     ('Motilal','motilal oswal'),
    ('Bandhan','bandhan'),            ('Mirae','mirae asset'), ('Axis','axis'),
    ('Tata','tata'),                  ('Quant','quant '), ('Quantum','quantum'),
    ('Abakkus','abakkus'),            ('360ONE','360 one')
    -- ('Invesco','invesco'), ('HSBC','hsbc'), ('UTI','uti'), ...
)
select distinct p.amc, p.scheme_name, p.master_amc, p.master_scheme_name, p.matched_by
from v_scheme_plans p
join amc_map m on m.amc = p.amc
where lower(p.master_amc) not like m.prefix || '%'
  -- Nippon India was formerly Reliance Mutual Fund. Correct, not an error.
  and not (p.amc = 'Nippon' and lower(p.master_amc) like 'reliance%')
order by 1, 2;


-- ----------------------------------------------------------------------------
-- A4. Rebuild the analytical layer. REQUIRED -- these are materialised, so new
--     holdings are invisible to every market-wide query until they refresh.
--
--     Order matters: mv_current reads mv_security, mv_fund_stats reads
--     mv_current.
-- ----------------------------------------------------------------------------
refresh materialized view mv_security;
refresh materialized view mv_current;
refresh materialized view mv_previous;
refresh materialized view mv_fund_stats;

-- REFRESH resets the planner statistics too, so re-analyze or queries that were
-- fast yesterday start timing out.
analyze mv_security;
analyze mv_current;
analyze mv_previous;
analyze mv_fund_stats;


-- ----------------------------------------------------------------------------
-- A5. Confirm the dashboard sees the new funds.
-- ----------------------------------------------------------------------------
select amc,
       count(*)                   as funds,
       sum(plan_count)            as plan_codes,
       max(latest_portfolio_date) as latest_date
from v_fund_picker
group by 1
order by funds desc;

-- Nothing else to do. v_scheme_plans, v_fund_picker, v_holdings_all_plans,
-- search_schemes, holdings_by_code and every holdings_* RPC read through to
-- the new rows immediately. The dashboard HTML does not change.


-- ============================================================================
-- PART B -- only when a fund is too new for AMFI's master
-- ----------------------------------------------------------------------------
-- Symptom: a scheme stays in the A2 list even though the fund clearly exists.
-- Its holdings loaded fine, but schemes_master has no row to map onto, so it
-- has no scheme_code and cannot be searched.
--
-- Refresh schemes_master from AMFI first (colab/amfi_nav.py parses the same
-- file), then rebuild the derived layer below.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- B1. Rebuild scheme_base IN PLACE.
--
--     Do NOT drop and recreate it. v_holdings, v_scheme_plans, v_fund_picker,
--     v_holdings_all_plans and scheme_key_meta all depend on it now, and a
--     DROP would take the whole stack with it. TRUNCATE + INSERT keeps every
--     dependent object and every index intact.
-- ----------------------------------------------------------------------------
begin;

truncate scheme_base;

insert into scheme_base (k, base_name, scheme_code, plan_type, amc_name, category, full_name)
select norm_key(base_scheme(scheme_name)),
       base_scheme(scheme_name),
       scheme_code, plan_type, amc_name, category,
       scheme_name
from schemes_master;

commit;

-- B2. The metadata fallback is materialised, so it does not follow along.
refresh materialized view scheme_key_meta;

-- B3. Now re-run A1 to pick up the newly listed funds, then A2 to see what is
--     left. Some of the previously unmapped schemes should disappear.


-- ============================================================================
-- QUICK STATUS -- run any time
-- ============================================================================
select (select count(*) from mf_holdings)                          as holdings_rows,
       (select count(distinct (amc, scheme_name)) from mf_holdings) as schemes_loaded,
       (select count(*) from scheme_alias)                          as mapped,
       (select count(*) from v_fund_picker)                         as funds_searchable,
       (select count(*) from v_scheme_plans)                        as plan_codes,
       (select count(*) from scheme_base)                           as master_rows;
