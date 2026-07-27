-- ============================================================================
-- v_fund_picker -- the ONLY list a UI should offer the user
-- ----------------------------------------------------------------------------
-- Coverage reality: schemes_master holds 37,613 plan rows, but holdings exist
-- for 4,060 of them (~11%). The rest belong to the ~29 AMCs never loaded
-- (Invesco, HSBC, UTI, Franklin, PPFAS, ...) plus ~35 unmapped schemes.
--
-- Feed the scheme picker from this view and every selection resolves to real
-- holdings. Feed it from schemes_master and 89% of picks return nothing.
--
-- Grain: one row per FUND, not per plan. All plan variants of a fund share the
-- same portfolio -- plan only changes NAV and returns, never holdings -- so
-- showing 4,060 plan rows is noise. The codes are kept in an array for lookup.
--
-- Depends on: v_scheme_plans (sql/plan_level_holdings.sql)
-- ============================================================================

drop view if exists v_fund_picker;

create view v_fund_picker as
with hs as (
    select amc,
           scheme_name,
           max(portfolio_date) as latest_portfolio_date,
           count(distinct portfolio_date) as date_count
    from mf_holdings
    group by 1, 2
)
select p.amc,
       p.scheme_name,                                    -- join key into mf_holdings
       min(p.master_scheme_name)               as display_name,
       min(p.category)                         as category,
       count(distinct p.scheme_code)           as plan_count,
       array_agg(distinct p.scheme_code::text) as scheme_codes,
       min(p.scheme_code::text)                as sample_scheme_code,
       h.latest_portfolio_date,
       h.date_count
from v_scheme_plans p
join hs h on h.amc = p.amc and h.scheme_name = p.scheme_name
group by p.amc, p.scheme_name, h.latest_portfolio_date, h.date_count;


-- ============================================================================
-- CHECKS
-- ============================================================================

-- Row count here = how many funds the UI can offer. Expect ~1,121.
select count(*) as funds_offerable from v_fund_picker;

-- Per-AMC coverage, and which portfolio date each AMC sits on.
-- Dates differ by design: ICICI is half-yearly (Mar), Axis was May,
-- Nippon has a Jul fortnightly, everyone else Jun.
select amc,
       count(*)                    as funds,
       sum(plan_count)             as plan_codes,
       max(latest_portfolio_date)  as latest_date
from v_fund_picker
group by 1
order by funds desc;

-- Every code in the picker must resolve. This must return 0 rows.
select f.amc, f.scheme_name, f.sample_scheme_code
from v_fund_picker f
where not exists (
    select 1 from holdings_by_code(f.sample_scheme_code) limit 1
);


-- ============================================================================
-- USAGE
-- ============================================================================

-- Populate the picker (search on display_name):
--     select scheme_name, display_name, amc, category, sample_scheme_code
--     from v_fund_picker
--     where display_name ilike '%' || :search || '%'
--     order by display_name
--     limit 50;

-- Then fetch holdings. Two equivalent routes:
--   by code  -- when the UI tracked a scheme_code
--     select * from holdings_by_code(:scheme_code);
--   by name  -- cheaper, when the UI already has amc + scheme_name
--     select * from mf_holdings
--     where amc = :amc and scheme_name = :scheme_name
--       and portfolio_date = :latest_portfolio_date;
--
-- Always pin portfolio_date. The table mixes Mar/May/Jun/Jul 2026 and an
-- unpinned query silently blends two disclosures of the same fund.
