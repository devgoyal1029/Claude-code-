-- ============================================================================
-- Plan-level holdings expansion
-- ----------------------------------------------------------------------------
-- mf_holdings is SCHEME-level  ("ICICI Prudential Large Cap Fund")
-- schemes_master is PLAN-level ("ICICI Prudential Large Cap Fund - Direct Plan - Growth",
--                               "... - IDCW", "... - Regular Plan - Growth", ...)
--
-- This file attaches one scheme's holdings to EVERY plan variant of that scheme.
--
-- Prerequisites (already created, see MF_PROJECT_HANDOFF_PART2.md sections 4.1-4.4):
--   base_scheme(text), norm_key(text), scheme_base, scheme_alias, v_holdings
--
-- Run top-to-bottom. Safe to re-run.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 0. Indexes
--    scheme_alias (amc, source_name) is already the PK.
--    scheme_base (k) already indexed. scheme_code lookup is new.
-- ----------------------------------------------------------------------------
create index if not exists idx_scheme_base_code on scheme_base (scheme_code);


-- ----------------------------------------------------------------------------
-- 1. v_scheme_plans
--    One row per (holdings scheme  x  plan variant).
--    This is the mapping layer -- no holdings yet, so it stays small
--    (~1,121 schemes x their plans).
--
--    NOTE: drop order matters. v_holdings_all_plans depends on this view, so it
--    must be dropped first. And `create or replace view` cannot rename or
--    reorder columns, hence the explicit drops.
-- ----------------------------------------------------------------------------
drop view if exists v_holdings_all_plans;
drop view if exists v_scheme_plans;

create view v_scheme_plans as
with cat as (
    -- Some master rows carry a NULL category while a sibling plan of the same
    -- scheme carries it. Take the first non-null per key as the fallback.
    -- (Handoff Part 2, section 4.4: filtering category IS NOT NULL inside the
    --  main join silently dropped 19 mapped schemes.)
    select distinct on (k) k, category
    from scheme_base
    where category is not null
    order by k, scheme_code
)
select
    a.amc                             as amc,           -- as in mf_holdings
    a.source_name                     as scheme_name,   -- as in mf_holdings
    a.k,
    a.matched_by,
    b.scheme_code,                                      -- AMFI code, per PLAN
    b.full_name                       as plan_name,     -- "... - Direct Plan - Growth"
    b.base_name                       as master_scheme_name,
    b.plan_type,                                        -- Direct / Regular
    b.amc_name                        as master_amc,
    coalesce(b.category, c.category)  as category
from scheme_alias a
join scheme_base  b on b.k = a.k
left join cat     c on c.k = a.k;


-- ----------------------------------------------------------------------------
-- 2. v_holdings_all_plans
--    THE ANSWER TO THE ASK: every holding row, repeated once per plan variant.
--
--    Inner join by design -- a plan-level row cannot exist for an unmapped
--    scheme. For scheme-level analysis where unmapped schemes must still be
--    visible, keep using v_holdings (all-LEFT joins).
-- ----------------------------------------------------------------------------
create view v_holdings_all_plans as
select
    p.scheme_code,
    p.plan_name,
    p.plan_type,
    p.category,
    p.master_scheme_name,
    p.master_amc,
    h.*
from mf_holdings h
join v_scheme_plans p
       on p.amc         = h.amc
      and p.scheme_name = h.scheme_name;


-- ----------------------------------------------------------------------------
-- 3. holdings_by_code(scheme_code, date)
--    What a dashboard actually calls: user picks a plan, gets that scheme's
--    holdings. No fan-out, so no row explosion.
--
--    p_date NULL  ->  latest portfolio_date available for that scheme.
--    This defends against the documented #1 mistake: the table mixes
--    Mar-2026 (ICICI half-yearly), May-2026 (Axis), Jun-2026 (most),
--    Jul-2026 (Nippon fortnightly). Never query without pinning the date.
--
--    scheme_code is cast to text so this works whether master stores it as
--    text or integer.
-- ----------------------------------------------------------------------------
create or replace function holdings_by_code(p_scheme_code text, p_date date default null)
returns setof mf_holdings
language sql stable as $$
    with tgt as (
        select distinct a.amc, a.source_name
        from scheme_alias a
        join scheme_base b on b.k = a.k
        where b.scheme_code::text = p_scheme_code
    ),
    d as (
        select coalesce(p_date, max(h.portfolio_date)) as dt
        from mf_holdings h
        join tgt t on t.amc = h.amc and t.source_name = h.scheme_name
    )
    select distinct h.*
    from mf_holdings h
    join tgt t on t.amc = h.amc and t.source_name = h.scheme_name
    cross join d
    where h.portfolio_date = d.dt
      -- Empty section headings the parser let through: "Term Deposits",
      -- "Deposits (Placed as Margin)", and repeated column-header rows like
      -- "NAME OF THE INSTRUMENT". The AMC writes "Nil" beside them, meaning the
      -- category is empty -- they are labels, not positions. A real holding
      -- always carries at least one of ISIN, value or weight; these carry none,
      -- so no weight or rupee moves when they go (ICICI Active Momentum: 52
      -- rows -> 49, AUM 1691.07 both ways).
      --
      -- parser.py v6 stops them at the source; this stays as the guard, because
      -- a reload with an older parser would put them straight back.
      and not (h.isin is null
               and h.pct_to_nav is null
               and h.market_value_lacs is null)
$$;


-- ============================================================================
-- VERIFICATION -- run these, do not assume it worked
-- ============================================================================

-- 3.1 Size check. RUN THIS BEFORE building anything on the fan-out view.
select (select count(*) from mf_holdings)          as holdings_rows,
       (select count(*) from v_scheme_plans)       as scheme_plan_pairs,
       (select count(*) from v_holdings_all_plans) as fanned_out_rows;

-- 3.2 How many plan variants each scheme expanded into
select amc, scheme_name, count(*) as plan_variants
from v_scheme_plans
group by 1, 2
order by plan_variants desc
limit 25;

-- 3.3 The example from the ask: ICICI Large Cap -> all its variants
select scheme_code, plan_name, plan_type, category
from v_scheme_plans
where amc = 'ICICI' and scheme_name ilike '%large cap%'
order by plan_name;

-- 3.4 Same holdings must appear under every variant.
--     Every row of this must show an IDENTICAL holding count.
select p.scheme_code, p.plan_name, count(*) as holdings
from v_holdings_all_plans p
where p.master_scheme_name ilike '%Large Cap%'
  and p.master_amc ilike 'icici%'
  and p.portfolio_date = '2026-03-31'      -- ICICI is half-yearly
group by 1, 2
order by 2;

-- 3.5 Schemes that mapped to ZERO plans (alias exists, master row vanished)
select a.amc, a.source_name, a.k, a.matched_by
from scheme_alias a
left join scheme_base b on b.k = a.k
where b.k is null;

-- 3.6 CROSS-AMC CONTAMINATION -- the fan-out multiplies this bug, so check it.
--     A wrong alias now pollutes every plan variant, not just one row.
--     (Fixes the handoff snippet, which declared `prefix` but referenced
--      `m.master_prefix` and therefore would not run.)
with amc_map(amc, prefix) as (values
    ('ABSL','aditya birla sun life'), ('HDFC','hdfc'),   ('SBI','sbi'),
    ('ICICI','icici prudential'),     ('Nippon','nippon india'),
    ('Kotak','kotak'),                ('DSP','dsp'),     ('Motilal','motilal oswal'),
    ('Bandhan','bandhan'),            ('Mirae','mirae asset'), ('Axis','axis'),
    ('Tata','tata'),                  ('Quant','quant '), ('Quantum','quantum'),
    ('Abakkus','abakkus'),            ('360ONE','360 one')
)
select distinct p.amc, p.scheme_name, p.master_amc, p.master_scheme_name, p.matched_by
from v_scheme_plans p
join amc_map m on m.amc = p.amc
where lower(p.master_amc) not like m.prefix || '%'
  -- Nippon India was formerly Reliance Mutual Fund. Correct, not an error.
  and not (p.amc = 'Nippon' and lower(p.master_amc) like 'reliance%')
order by 1, 2;


-- ============================================================================
-- USAGE
-- ============================================================================

-- Holdings for one specific plan (latest date):
--     select * from holdings_by_code('120586');
-- Pinned to a date:
--     select * from holdings_by_code('120586', '2026-06-30');
-- From Supabase JS client:
--     supabase.rpc('holdings_by_code', { p_scheme_code: '120586' })

-- Sector breakup for a chosen plan:
--     select coalesce(industry_rating, 'Cash & Equivalents') as sector,
--            round(sum(pct_to_nav), 2) as pct
--     from holdings_by_code('120586')
--     group by 1 order by pct desc;

-- Overlap between two PLANS (join on ISIN, never on instrument_name):
--     select round(sum(least(a.pct_to_nav, b.pct_to_nav)), 2) as overlap_pct,
--            count(*) as common
--     from holdings_by_code('120586', '2026-06-30') a
--     join holdings_by_code('119551', '2026-06-30') b on b.isin = a.isin
--     where a.is_security;
