-- ============================================================================
-- Compare -- funds and fund houses, side by side, in any mix
-- ----------------------------------------------------------------------------
-- An AMC is treated as one pooled portfolio: every holding across all its
-- schemes, summed by ISIN and re-expressed as a share of the house's whole
-- book. That puts a fund and an AMC on the same footing, so "HDFC Flexi Cap vs
-- SBI vs ICICI vs Nippon Large Cap" is a coherent question.
--
-- Limits are enforced here, not just in the UI: 10 funds and 5 AMCs. Overlap
-- is pairwise, so 15 entities is already 105 pairs.
--
-- Run after sql/engine_core.sql.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- compare_book -- the shared resolver every other function here builds on.
--
-- Funds arrive as scheme_codes and resolve through scheme_base -> scheme_alias,
-- so any plan of a fund works. AMCs arrive as the short code held in
-- mf_holdings ('HDFC', 'ABSL', '360ONE').
--
-- weight is always a percentage of THAT entity's own book, which is what makes
-- the two kinds comparable.
-- ----------------------------------------------------------------------------
create or replace function compare_book(p_funds text[] default null,
                                        p_amcs  text[] default null)
returns table (entity     text,
               kind       text,
               isin       text,
               instrument text,
               sector     text,
               asset_type text,
               weight     numeric,
               value_lacs numeric)
language sql stable security definer set search_path = public
as $$
    with f_in as (
        select code from unnest(coalesce(p_funds, '{}'::text[])) as t(code)
        limit 10
    ),
    a_in as (
        select amc from unnest(coalesce(p_amcs, '{}'::text[])) as t(amc)
        limit 5
    ),
    fund_ent as (
        select distinct on (f.code) f.code, a.amc, a.source_name
        from f_in f
        join scheme_base  b on b.scheme_code::text = f.code
        join scheme_alias a on a.k = b.k
        order by f.code, a.amc, a.source_name
    ),
    fund_rows as (
        select m.scheme_name as entity, 'Fund'::text as kind, m.isin,
               min(m.instrument) as instrument,
               min(m.sector)     as sector,
               min(m.asset_type) as asset_type,
               sum(m.pct_to_nav)        as weight,
               sum(m.market_value_lacs) as value_lacs
        from fund_ent e
        join mv_current m on m.amc = e.amc and m.scheme_name = e.source_name
        group by m.scheme_name, m.isin
    ),
    amc_tot as (
        select m.amc, sum(m.market_value_lacs) v
        from mv_current m join a_in a on a.amc = m.amc
        group by m.amc
    ),
    amc_rows as (
        select m.amc as entity, 'AMC'::text as kind, m.isin,
               min(m.instrument) as instrument,
               min(m.sector)     as sector,
               min(m.asset_type) as asset_type,
               -- share of the whole house, not of any one scheme
               sum(m.market_value_lacs) / nullif(max(t.v), 0) * 100 as weight,
               sum(m.market_value_lacs) as value_lacs
        from mv_current m
        join amc_tot t on t.amc = m.amc
        group by m.amc, m.isin
    )
    select * from fund_rows
    union all
    select * from amc_rows
$$;


-- ----------------------------------------------------------------------------
-- compare_summary -- one row per entity, the headline numbers.
--
-- effective_stocks (10000/HHI) is the one to read against holdings: an AMC
-- pooling 900 names can still behave like 40 positions if its schemes all
-- crowd the same book.
-- ----------------------------------------------------------------------------
create or replace function compare_summary(p_funds text[] default null,
                                           p_amcs  text[] default null)
returns table (entity           text,
               kind             text,
               aum_cr           numeric,
               securities       int,
               top_5_pct        numeric,
               top_10_pct       numeric,
               largest_pct      numeric,
               largest_name     text,
               hhi              numeric,
               effective_stocks numeric,
               sectors          int,
               top_sector       text,
               top_sector_pct   numeric,
               equity_pct       numeric,
               debt_pct         numeric,
               cash_pct         numeric,
               schemes          int)
language sql stable security definer set search_path = public
as $$
    with b as (select * from compare_book(p_funds, p_amcs)),
    sec as (
        select *, row_number() over (partition by entity order by weight desc nulls last) rn
        from b where asset_type not in ('Cash & Equivalents') and isin is not null
    ),
    tops as (
        select distinct on (entity) entity, sector, p
        from (select entity, sector, sum(weight) p from b
               where isin is not null group by 1, 2) t
        order by entity, p desc
    ),
    scheme_ct as (
        select m.amc as entity, count(distinct m.scheme_name)::int n
        from mv_current m
        where m.amc = any(coalesce(p_amcs, '{}'::text[]))
        group by m.amc
    )
    select b.entity,
           min(b.kind),
           round(sum(b.value_lacs) / 100, 2),
           count(*) filter (where b.isin is not null
                              and b.asset_type <> 'Cash & Equivalents')::int,
           round((select sum(weight) from sec where sec.entity = b.entity and rn <= 5), 2),
           round((select sum(weight) from sec where sec.entity = b.entity and rn <= 10), 2),
           round((select max(weight) from sec where sec.entity = b.entity), 2),
           (select instrument from sec where sec.entity = b.entity and rn = 1),
           round((select sum(weight * weight) from sec where sec.entity = b.entity), 1),
           round((10000 / nullif((select sum(weight * weight) from sec
                                   where sec.entity = b.entity), 0))::numeric, 1),
           count(distinct b.sector) filter (where b.isin is not null)::int,
           (select sector from tops where tops.entity = b.entity),
           round((select p from tops where tops.entity = b.entity), 2),
           round(sum(b.weight) filter (where b.asset_type = 'Equity'), 2),
           round(sum(b.weight) filter (where b.asset_type = 'Debt'), 2),
           round(sum(b.weight) filter (where b.asset_type = 'Cash & Equivalents'), 2),
           coalesce((select n from scheme_ct where scheme_ct.entity = b.entity), 1)
    from b
    group by b.entity
    order by 3 desc nulls last
$$;


-- ----------------------------------------------------------------------------
-- compare_sectors -- sector weight per entity, long format.
-- The UI pivots it into a grid.
-- ----------------------------------------------------------------------------
create or replace function compare_sectors(p_funds text[] default null,
                                           p_amcs  text[] default null,
                                           lim     int    default 20)
returns table (sector text, entity text, kind text, weight numeric)
language sql stable security definer set search_path = public
as $$
    with b as (select * from compare_book(p_funds, p_amcs) where isin is not null),
    agg as (select sector, entity, min(kind) kind, sum(weight) w from b group by 1, 2),
    top as (
        select sector from agg group by sector
        order by max(w) desc nulls last
        limit least(coalesce(lim, 20), 60)
    )
    select a.sector, a.entity, a.kind, round(a.w, 2)
    from agg a join top t on t.sector = a.sector
    order by a.sector, a.w desc
$$;


-- ----------------------------------------------------------------------------
-- compare_overlap -- pairwise overlap between every chosen entity.
--
-- Sum of min(weight) across shared ISINs, the same measure used elsewhere. Two
-- funds above 70% are close to one position; an AMC against one of its own
-- funds will read high by construction, since the fund is part of that pool.
-- ----------------------------------------------------------------------------
create or replace function compare_overlap(p_funds text[] default null,
                                           p_amcs  text[] default null)
returns table (entity_a text, kind_a text, entity_b text, kind_b text,
               overlap_pct numeric, common int)
language sql stable security definer set search_path = public
as $$
    with b as (
        select * from compare_book(p_funds, p_amcs)
        where isin is not null and asset_type <> 'Cash & Equivalents'
    )
    select x.entity, min(x.kind), y.entity, min(y.kind),
           round(sum(least(x.weight, y.weight)), 2),
           count(*)::int
    from b x
    join b y on y.isin = x.isin and y.entity > x.entity
    group by x.entity, y.entity
    order by 5 desc nulls last
$$;


-- ----------------------------------------------------------------------------
-- compare_holdings -- the securities that matter across the chosen entities.
--
-- Ranked by the highest weight any one entity gives the name, so a position
-- one fund holds heavily is not buried by names everyone holds lightly.
-- ----------------------------------------------------------------------------
create or replace function compare_holdings(p_funds text[] default null,
                                            p_amcs  text[] default null,
                                            lim     int    default 40)
returns table (isin text, instrument text, sector text,
               entity text, kind text, weight numeric, held_by int)
language sql stable security definer set search_path = public
as $$
    with b as (
        select * from compare_book(p_funds, p_amcs)
        where isin is not null and asset_type <> 'Cash & Equivalents'
    ),
    rank as (
        select isin, max(weight) mx, count(*)::int held_by
        from b group by isin
        order by mx desc nulls last
        limit least(coalesce(lim, 40), 200)
    )
    select b.isin, min(b.instrument), min(b.sector),
           b.entity, min(b.kind), round(b.weight, 3), max(r.held_by)
    from b join rank r on r.isin = b.isin
    group by b.isin, b.entity, b.weight
    order by max(r.mx) desc nulls last, b.isin, b.weight desc
$$;


grant execute on function compare_book(text[], text[])          to anon, authenticated;
grant execute on function compare_summary(text[], text[])       to anon, authenticated;
grant execute on function compare_sectors(text[], text[], int)  to anon, authenticated;
grant execute on function compare_overlap(text[], text[])       to anon, authenticated;
grant execute on function compare_holdings(text[], text[], int) to anon, authenticated;


-- ============================================================================
-- SMOKE TEST
-- ============================================================================
-- select * from compare_summary(array['153684'], array['HDFC','SBI']);
-- select * from compare_overlap(array['153684'], array['HDFC','SBI']);
-- select * from compare_sectors(array['153684'], array['HDFC','SBI'], 10);
