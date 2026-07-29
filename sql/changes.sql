-- ============================================================================
-- Change tracking -- what moved between two disclosures.
-- ----------------------------------------------------------------------------
-- This is the piece nobody else can copy from a screenshot: not what a fund
-- holds, but what it did.
--
-- Works only once a scheme has more than one portfolio_date. push() deletes
-- per (amc, portfolio_date, frequency), so loading July does NOT remove June --
-- older months simply need to be loaded. Until then every function here
-- returns empty rather than failing, and the UI hides the section.
--
-- Run after sql/engine_core.sql. Refresh mv_previous alongside the others.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- mv_previous -- each scheme's SECOND-latest disclosure.
--
-- Ranked over distinct dates, not rows, so a scheme with 8,000 holdings on one
-- date still counts that date once.
-- ----------------------------------------------------------------------------
drop materialized view if exists mv_previous cascade;

create materialized view mv_previous as
with dates as (
    select distinct amc, scheme_name, portfolio_date from mf_holdings
),
ranked as (
    select amc, scheme_name, portfolio_date,
           dense_rank() over (partition by amc, scheme_name
                              order by portfolio_date desc) rk
    from dates
)
select h.amc,
       h.scheme_name,
       h.portfolio_date,
       h.isin,
       h.instrument_name,
       h.industry_rating,
       h.pct_to_nav,
       h.market_value_lacs,
       h.quantity,
       h.is_security
from mf_holdings h
join ranked r on r.amc = h.amc
             and r.scheme_name = h.scheme_name
             and r.portfolio_date = h.portfolio_date
             and r.rk = 2;

create index on mv_previous (amc, scheme_name);
create index on mv_previous (isin);
analyze mv_previous;


-- ----------------------------------------------------------------------------
-- fund_changes -- one fund, position by position.
--
-- action:
--   NEW     -- not held at the previous date
--   EXIT    -- held then, gone now
--   ADDED   -- weight up
--   TRIMMED -- weight down
--   HELD    -- unchanged within 0.01pp
--
-- Weight change alone can mislead: if the whole book rises, an untouched
-- position's weight barely moves while its value climbs. qty_change_pct is the
-- cleaner signal where quantity is disclosed, so both are returned.
-- ----------------------------------------------------------------------------
create or replace function fund_changes(p_scheme_code text, lim int default 300)
returns table (action          text,
               instrument      text,
               isin            text,
               sector          text,
               pct_now         numeric,
               pct_before      numeric,
               pct_change      numeric,
               value_now_cr    numeric,
               value_before_cr numeric,
               qty_change_pct  numeric,
               date_now        date,
               date_before     date)
language sql stable security definer set search_path = public
as $$
    with me as (
        select distinct amc, scheme_name from mv_current
        where scheme_code = p_scheme_code limit 1
    ),
    -- mv_current does not carry quantity, so it comes from the source row.
    -- Joined on id, not (scheme, isin) -- a scheme can list the same ISIN twice
    -- (two series of one bond), and joining on the key would fan those out.
    n as (select c.*, h.quantity
            from mv_current c
            join me on me.amc = c.amc and me.scheme_name = c.scheme_name
            left join mf_holdings h on h.id = c.id
           where c.is_security and c.isin is not null),
    p as (select v.* from mv_previous v
           join me on me.amc = v.amc and me.scheme_name = v.scheme_name
           where v.is_security and v.isin is not null),
    j as (
        select coalesce(n.isin, p.isin)                        as isin,
               coalesce(n.instrument, s.instrument, p.instrument_name) as instrument,
               coalesce(n.sector, s.sector, p.industry_rating) as sector,
               n.pct_to_nav                                    as pct_now,
               p.pct_to_nav                                    as pct_before,
               n.market_value_lacs                             as v_now,
               p.market_value_lacs                             as v_before,
               n.quantity                                      as q_now,
               p.quantity                                      as q_before,
               n.portfolio_date                                as d_now,
               p.portfolio_date                                as d_before
        from n full outer join p on p.isin = n.isin
        left join mv_security s on s.isin = coalesce(n.isin, p.isin)
    )
    select case
             when pct_before is null then 'NEW'
             when pct_now    is null then 'EXIT'
             when pct_now - pct_before >  0.01 then 'ADDED'
             when pct_now - pct_before < -0.01 then 'TRIMMED'
             else 'HELD'
           end,
           instrument, isin, sector,
           round(pct_now, 3), round(pct_before, 3),
           round(coalesce(pct_now, 0) - coalesce(pct_before, 0), 3),
           round(v_now / 100, 2), round(v_before / 100, 2),
           case when q_before > 0 and q_now is not null
                then round((q_now / q_before - 1) * 100, 1) end,
           (select max(portfolio_date) from n),
           (select max(portfolio_date) from p)
    from j
    order by abs(coalesce(pct_now, 0) - coalesce(pct_before, 0)) desc nulls last
    limit least(coalesce(lim, 300), 1000)
$$;


-- ----------------------------------------------------------------------------
-- fund_change_summary -- the headline for a fund's activity.
--
-- churn_pct (half the sum of absolute weight changes) is a one-sided turnover
-- proxy: 0 means an untouched book, 20 means a fifth of it rotated.
-- ----------------------------------------------------------------------------
create or replace function fund_change_summary(p_scheme_code text)
returns table (has_history  boolean,
               date_now     date,
               date_before  date,
               new_count    int,
               exit_count   int,
               added_count  int,
               trimmed_count int,
               new_pct      numeric,
               exit_pct     numeric,
               churn_pct    numeric,
               aum_now_cr   numeric,
               aum_before_cr numeric,
               aum_change_pct numeric)
language sql stable security definer set search_path = public
as $$
    with c as (select * from fund_changes(p_scheme_code, 5000)),
    me as (select distinct amc, scheme_name from mv_current
            where scheme_code = p_scheme_code limit 1),
    an as (select sum(c.market_value_lacs) v from mv_current c
            join me on me.amc = c.amc and me.scheme_name = c.scheme_name),
    ab as (select sum(v.market_value_lacs) v from mv_previous v
            join me on me.amc = v.amc and me.scheme_name = v.scheme_name)
    select exists (select 1 from c where date_before is not null),
           max(date_now), max(date_before),
           count(*) filter (where action = 'NEW')::int,
           count(*) filter (where action = 'EXIT')::int,
           count(*) filter (where action = 'ADDED')::int,
           count(*) filter (where action = 'TRIMMED')::int,
           round(sum(pct_now)    filter (where action = 'NEW'), 2),
           round(sum(pct_before) filter (where action = 'EXIT'), 2),
           round(sum(abs(pct_change)) / 2, 2),
           round((select v from an) / 100, 2),
           round((select v from ab) / 100, 2),
           round(((select v from an) / nullif((select v from ab), 0) - 1) * 100, 2)
    from c
$$;


-- ----------------------------------------------------------------------------
-- market_changes -- what the whole market bought and sold.
--
-- p_action: 'bought' | 'sold' | 'new' | 'exit'
-- Aggregated across every fund with two snapshots, so this is the flow view:
-- which names money moved into, and out of, between disclosures.
-- ----------------------------------------------------------------------------
create or replace function market_changes(p_action text default 'bought',
                                          lim      int  default 40,
                                          p_amc    text default null,
                                          p_category text default null)
returns table (isin           text,
               instrument     text,
               sector         text,
               funds_moved    int,
               value_change_cr numeric,
               value_now_cr   numeric,
               avg_pct_change numeric)
language sql stable security definer set search_path = public
as $$
    with scope as (
        select distinct c.amc, c.scheme_name
        from mv_current c
        where (p_amc is null or c.amc = p_amc)
          and (p_category is null or c.category = p_category)
          and exists (select 1 from mv_previous v
                       where v.amc = c.amc and v.scheme_name = c.scheme_name)
    ),
    n as (select c.isin, c.amc, c.scheme_name, c.pct_to_nav, c.market_value_lacs
            from mv_current c join scope s on s.amc = c.amc and s.scheme_name = c.scheme_name
           where c.is_security and c.isin is not null),
    p as (select v.isin, v.amc, v.scheme_name, v.pct_to_nav, v.market_value_lacs
            from mv_previous v join scope s on s.amc = v.amc and s.scheme_name = v.scheme_name
           where v.is_security and v.isin is not null),
    j as (
        select coalesce(n.isin, p.isin) isin,
               coalesce(n.market_value_lacs, 0) - coalesce(p.market_value_lacs, 0) dv,
               coalesce(n.pct_to_nav, 0) - coalesce(p.pct_to_nav, 0) dp,
               n.market_value_lacs vnow,
               (p.isin is null) is_new,
               (n.isin is null) is_exit
        from n full outer join p
          on p.isin = n.isin and p.amc = n.amc and p.scheme_name = n.scheme_name
    ),
    agg as (
        select isin,
               count(*) filter (where case p_action
                     when 'new'  then is_new
                     when 'exit' then is_exit
                     when 'sold' then dv < 0
                     else dv > 0 end)::int          as funds_moved,
               round(sum(dv) / 100, 2)              as value_change_cr,
               round(sum(coalesce(vnow, 0)) / 100, 2) as value_now_cr,
               round(avg(dp), 3)                    as avg_pct_change
        from j
        group by isin
    ),
    picked as (
        select * from agg
        where funds_moved > 0
        order by case when p_action in ('sold', 'exit') then value_change_cr
                      else -value_change_cr end
        limit least(coalesce(lim, 40), 200)
    )
    select k.isin, s.instrument, s.sector,
           k.funds_moved, k.value_change_cr, k.value_now_cr, k.avg_pct_change
    from picked k
    left join mv_security s on s.isin = k.isin
    order by case when p_action in ('sold', 'exit') then k.value_change_cr
                  else -k.value_change_cr end
$$;


grant execute on function fund_changes(text, int)                to anon, authenticated;
grant execute on function fund_change_summary(text)              to anon, authenticated;
grant execute on function market_changes(text, int, text, text)  to anon, authenticated;


-- ============================================================================
-- REFRESH -- add mv_previous to the after-load sequence
-- ============================================================================
-- refresh materialized view mv_previous;
-- analyze mv_previous;


-- ============================================================================
-- CHECK -- how many schemes actually have a second snapshot yet
-- ============================================================================
select count(distinct (amc, scheme_name)) as schemes_with_history
from mv_previous;

select amc, count(distinct scheme_name) as schemes,
       min(portfolio_date) as prev_date
from mv_previous group by 1 order by 2 desc;
