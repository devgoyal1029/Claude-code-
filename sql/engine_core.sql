-- ============================================================================
-- Analytical core -- three materialised views everything else reads from.
-- ----------------------------------------------------------------------------
-- Cross-fund questions ("which stock does the whole market hold most?") scan
-- every row of mf_holdings. Doing that per request is wasteful when the
-- underlying data only changes once a month, so the heavy shaping happens
-- here, once, at load time.
--
-- REFRESH AFTER EVERY LOAD -- see the bottom of this file, and sql/after_load.sql
--
-- Depends on: asset_class() (sql/dashboard_api.sql), scheme_alias, scheme_base
-- ============================================================================


-- ============================================================================
-- 1. mv_security -- one canonical row per ISIN
-- ----------------------------------------------------------------------------
-- The same security is spelled differently by every AMC: "Larsen and Toubro
-- Ltd." / "Larsen & Toubro Ltd." / "LARSEN & TOUBRO LIMITED". Ranking stocks
-- market-wide needs one name per ISIN, so we take the spelling used by the
-- most funds. Same for the sector label ("IT - Software" vs "Software").
--
-- mode() WITHIN GROUP is exactly the right tool: most frequent value, ties
-- broken arbitrarily but deterministically enough for a display label.
-- ============================================================================
drop materialized view if exists mv_current cascade;
drop materialized view if exists mv_security cascade;

create materialized view mv_security as
select h.isin,
       mode() within group (order by h.instrument_name) as instrument,
       mode() within group (order by h.industry_rating) as sector,
       count(distinct h.amc)                            as spelled_by_amcs,
       count(distinct h.instrument_name)                as name_variants
from mf_holdings h
where h.isin is not null
  and h.instrument_name is not null
group by h.isin;

create unique index on mv_security (isin);
create index on mv_security (sector);


-- ============================================================================
-- 2. mv_current -- the market as it stands today
-- ----------------------------------------------------------------------------
-- One row per (scheme, holding) at each scheme's OWN latest disclosure date.
-- Dates deliberately differ across schemes -- ICICI discloses half-yearly,
-- Axis was a month behind, Nippon publishes a fortnightly -- and forcing a
-- single date would silently drop whole AMCs.
--
-- Carries scheme_code, category and fund AUM so downstream queries never have
-- to re-derive them.
-- ============================================================================
create materialized view mv_current as
with latest as (
    select amc, scheme_name, max(portfolio_date) as pd
    from mf_holdings
    group by 1, 2
),
rows as (
    select h.*
    from mf_holdings h
    join latest l
      on l.amc = h.amc and l.scheme_name = h.scheme_name and l.pd = h.portfolio_date
),
fund as (
    select amc, scheme_name,
           sum(market_value_lacs) filter (where market_value_lacs > 0) as aum_lacs,
           sum(pct_to_nav)                                             as pct_sum
    from rows
    group by 1, 2
),
codes as (
    -- one representative scheme_code per holdings scheme; the array keeps the rest
    select a.amc, a.source_name,
           min(b.scheme_code::text)                          as scheme_code,
           array_agg(distinct b.scheme_code::text)           as scheme_codes,
           (array_agg(m.category) filter (where m.category is not null))[1] as category
    from scheme_alias a
    join scheme_base b on b.k = a.k
    left join scheme_key_meta m on m.k = a.k
    group by a.amc, a.source_name
)
select r.id,
       r.amc,
       r.scheme_name,
       c.scheme_code,
       c.scheme_codes,
       c.category,
       r.portfolio_date,
       r.isin,
       coalesce(s.instrument, r.instrument_name, r.isin, '(unnamed)') as instrument,
       coalesce(s.sector, r.industry_rating, 'Unclassified')          as sector,
       r.industry_rating                                             as raw_rating,
       asset_class(r.section, r.is_security, r.industry_rating, r.coupon_pct) as asset_type,
       r.pct_to_nav,
       r.market_value_lacs,
       round(r.market_value_lacs / 100, 2)                            as value_cr,
       r.coupon_pct,
       r.yield_pct,
       r.is_security,
       round(f.aum_lacs / 100, 2)                                     as fund_aum_cr,
       round(f.pct_sum, 2)                                            as fund_pct_sum
from rows r
left join mv_security s on s.isin = r.isin
left join fund f        on f.amc = r.amc  and f.scheme_name = r.scheme_name
left join codes c       on c.amc = r.amc  and c.source_name = r.scheme_name;

create index on mv_current (isin);
create index on mv_current (sector);
create index on mv_current (category);
create index on mv_current (amc);
create index on mv_current (scheme_code);
create index on mv_current (amc, scheme_name);
create index on mv_current (asset_type);
create index on mv_current (is_security) where is_security;


-- ============================================================================
-- 3. mv_fund_stats -- one row per fund, every headline metric precomputed
-- ----------------------------------------------------------------------------
-- This is what makes leaderboards and the screener instant: ranking 1,156
-- funds by concentration becomes an index scan instead of 1,156 aggregations.
-- ============================================================================
drop materialized view if exists mv_fund_stats cascade;

create materialized view mv_fund_stats as
with sec as (
    select *, row_number() over (partition by amc, scheme_name
                                 order by pct_to_nav desc nulls last) rn
    from mv_current
    where is_security
),
topsec as (
    select distinct on (amc, scheme_name)
           amc, scheme_name, sector, pct
    from (select amc, scheme_name, sector, sum(pct_to_nav) pct
          from mv_current where is_security
          group by 1, 2, 3) t
    order by amc, scheme_name, pct desc
)
select c.amc,
       c.scheme_name,
       min(c.scheme_code)                                          as scheme_code,
       min(c.category)                                             as category,
       max(c.portfolio_date)                                       as portfolio_date,
       max(c.fund_aum_cr)                                          as aum_cr,
       count(*)::int                                               as holdings,
       count(*) filter (where c.is_security)::int                  as securities,
       count(distinct c.sector) filter (where c.is_security)::int   as sectors,

       round((select sum(pct_to_nav) from sec
               where sec.amc = c.amc and sec.scheme_name = c.scheme_name and rn <= 5), 2)  as top_5_pct,
       round((select sum(pct_to_nav) from sec
               where sec.amc = c.amc and sec.scheme_name = c.scheme_name and rn <= 10), 2) as top_10_pct,
       round((select sum(pct_to_nav) from sec
               where sec.amc = c.amc and sec.scheme_name = c.scheme_name and rn <= 20), 2) as top_20_pct,
       round(max(c.pct_to_nav) filter (where c.is_security), 2)     as largest_pct,

       round(sum(c.pct_to_nav) filter (where not c.is_security), 2) as cash_pct,
       round(sum(c.pct_to_nav) filter (where c.asset_type = 'Equity'), 2) as equity_pct,
       round(sum(c.pct_to_nav) filter (where c.asset_type = 'Debt'), 2)   as debt_pct,

       round(sum(c.pct_to_nav * c.pct_to_nav) filter (where c.is_security), 1) as hhi,
       round((10000 / nullif(sum(c.pct_to_nav * c.pct_to_nav)
              filter (where c.is_security), 0))::numeric, 1)        as effective_stocks,

       (select sector from topsec t
         where t.amc = c.amc and t.scheme_name = c.scheme_name)     as top_sector,
       round((select pct from topsec t
         where t.amc = c.amc and t.scheme_name = c.scheme_name), 2) as top_sector_pct,

       round(sum(c.pct_to_nav), 2)                                  as pct_sum,
       bool_or(c.scheme_code is not null)                           as mapped
from mv_current c
group by c.amc, c.scheme_name;

create unique index on mv_fund_stats (amc, scheme_name);
create index on mv_fund_stats (scheme_code);
create index on mv_fund_stats (category);
create index on mv_fund_stats (aum_cr desc);
create index on mv_fund_stats (top_10_pct desc);


-- ============================================================================
-- REFRESH -- run in this order after every load, before anything else.
-- mv_current depends on mv_security; mv_fund_stats depends on mv_current.
-- ============================================================================
-- refresh materialized view mv_security;
-- refresh materialized view mv_current;
-- refresh materialized view mv_fund_stats;


-- ============================================================================
-- SANITY
-- ============================================================================
select (select count(*) from mv_security)   as securities_known,
       (select count(*) from mv_current)    as current_rows,
       (select count(*) from mv_fund_stats) as funds,
       (select count(*) from mv_fund_stats where mapped) as funds_with_code,
       (select round(sum(aum_cr)) from mv_fund_stats)    as total_aum_cr;

-- Names that vary most across AMCs -- a spot-check that mode() picked something
-- sensible, and a reminder never to join on instrument_name.
select isin, instrument, name_variants, spelled_by_amcs
from mv_security
order by name_variants desc
limit 15;
