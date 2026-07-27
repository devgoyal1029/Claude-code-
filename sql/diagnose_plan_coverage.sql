-- ============================================================================
-- Why is scheme_plan_pairs only 4,060?
-- ----------------------------------------------------------------------------
-- Observed: 71,306 holdings rows -> 4,060 scheme x plan pairs -> 300,223 fanned.
--           4,060 / ~1,121 mapped schemes = 3.6 plan variants per scheme.
--
-- Expected: 4-6 for a plain equity fund (Direct/Regular x Growth/IDCW),
--           15-30 for a debt fund with Daily/Weekly/Monthly/Quarterly IDCW.
--
-- Hypothesis: base_scheme() does not strip every plan suffix AMFI uses, so
-- sibling plans of one scheme land on different `k` values. scheme_alias holds
-- exactly one k per (amc, source_name), so the non-matching siblings are
-- orphaned and never fan out.
--
-- Run A -> D. D is the one that quantifies the loss.
-- ============================================================================


-- Makes query D fast. norm_key is IMMUTABLE so it is indexable; text_pattern_ops
-- lets `like 'prefix%'` use the index instead of scanning 37,613 rows per scheme.
create index if not exists idx_sm_normkey
    on schemes_master (norm_key(scheme_name) text_pattern_ops);


-- ----------------------------------------------------------------------------
-- A. Distribution of plan counts.
--    A fat bar at 1-3 confirms the under-collapse. A spread peaking at 4-6
--    with a debt-fund tail at 12+ would mean the mapping is actually fine.
-- ----------------------------------------------------------------------------
select plan_variants, count(*) as schemes
from (
    select amc, scheme_name, count(*) as plan_variants
    from v_scheme_plans
    group by 1, 2
) t
group by 1
order by 1;


-- ----------------------------------------------------------------------------
-- B. Deep-dive on one scheme. This is the direct test.
--    Every row here belongs to the SAME fund, so every row should show the
--    SAME k. Any row with a different k is a lost variant, and its `base`
--    column shows exactly which suffix base_scheme() failed to strip.
--
--    ICICI Large Cap is a deliberate pick: master carries it as
--    "... (erstwhile Bluechip Fund)", which also exercises the nested-paren bug.
-- ----------------------------------------------------------------------------
select scheme_name,
       base_scheme(scheme_name)            as base,
       norm_key(base_scheme(scheme_name))  as k
from schemes_master
where scheme_name ilike 'ICICI Prudential Large Cap Fund%'
order by scheme_name;

-- Repeat for a debt fund, where the IDCW frequency variants live:
select scheme_name,
       base_scheme(scheme_name)            as base,
       norm_key(base_scheme(scheme_name))  as k
from schemes_master
where scheme_name ilike 'HDFC Corporate Bond Fund%'
order by scheme_name;


-- ----------------------------------------------------------------------------
-- C. Census of leftover suffixes across the whole master.
--    Anything listed here is a base_name that STILL ends in plan vocabulary,
--    i.e. base_scheme() gave up on it. Read the top rows as the to-do list for
--    extending the regex.
-- ----------------------------------------------------------------------------
select count(*) filter (
           where base_name ~* '(growth|idcw|dividend|payout|reinvest(ment)?|bonus)\s*$'
              or base_name ~* 'income distribution'
              or base_name ~* 'erstwhile'
       ) as still_has_plan_suffix,
       count(*) as total_master_rows
from scheme_base;

select base_name, count(*) as master_rows
from scheme_base
where base_name ~* '(growth|idcw|dividend|payout|reinvest(ment)?|bonus|option)\s*$'
   or base_name ~* 'income distribution'
group by 1
order by 2 desc
limit 40;


-- ----------------------------------------------------------------------------
-- D. THE NUMBER THAT MATTERS.
--    For every mapped scheme: how many master rows joined vs how many exist.
--    `lost` is how many plan variants the fan-out is silently missing.
--
--    Prefix matching is a diagnostic heuristic, not the fix -- it will
--    over-count where one fund's name prefixes another
--    ("HDFC Top 100 Fund" vs "HDFC Top 100 Fund of Funds"). Read it as an
--    upper bound and confirm against B before changing anything.
-- ----------------------------------------------------------------------------
with mapped as (
    select distinct a.amc, a.source_name, b.k, b.base_name
    from scheme_alias a
    join scheme_base b on b.k = a.k
)
select m.amc,
       m.source_name,
       (select count(*) from scheme_base x where x.k = m.k) as joined_now,
       (select count(*) from schemes_master s
         where norm_key(s.scheme_name) like norm_key(m.base_name) || '%') as reachable,
       (select count(*) from schemes_master s
         where norm_key(s.scheme_name) like norm_key(m.base_name) || '%')
         - (select count(*) from scheme_base x where x.k = m.k) as lost
from mapped m
order by lost desc
limit 30;

-- Same thing as a single total:
with mapped as (
    select distinct a.amc, a.source_name, b.k, b.base_name
    from scheme_alias a
    join scheme_base b on b.k = a.k
)
select sum((select count(*) from scheme_base x where x.k = m.k))            as joined_now,
       sum((select count(*) from schemes_master s
             where norm_key(s.scheme_name) like norm_key(m.base_name) || '%')) as reachable
from mapped m;


-- ============================================================================
-- E. SCHEME-CODE VERSION -- same test as B, keyed on scheme_code.
--    More reliable than name matching: no ilike pattern to get wrong.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- E1. Pick a test subject: the mapped schemes with the FEWEST plans attached.
--     These are the most broken, so they show the problem most clearly.
--     Copy a scheme_code from here into E2/E3.
-- ----------------------------------------------------------------------------
select p.amc,
       p.scheme_name,
       min(p.scheme_code::text) as sample_scheme_code,
       count(*)                 as plans_now
from v_scheme_plans p
group by 1, 2
order by plans_now asc, p.scheme_name
limit 30;

-- Debt funds carry the most IDCW frequency variants (Daily/Weekly/Monthly/
-- Quarterly), so the gap is widest there. Good hunting ground:
select p.amc, p.scheme_name, min(p.scheme_code::text) as sample_scheme_code,
       count(*) as plans_now
from v_scheme_plans p
where p.scheme_name ~* 'bond|duration|debt|gilt|income|savings|liquid|money market'
group by 1, 2
order by plans_now asc
limit 30;


-- ----------------------------------------------------------------------------
-- E2. THE TEST. Put one scheme_code in `params` and run.
--
--     Takes that plan's fund, finds every sibling plan of the same fund, and
--     marks which ones share its key.
--       status = 'joined' -> fans out correctly today
--       status = 'LOST'   -> orphaned; `base_after_strip` shows the suffix
--                            base_scheme() failed to remove
--
--     If this returns nothing at all, the scheme_code did not match --
--     check whether master stores it as text with padding.
-- ----------------------------------------------------------------------------
with params as (
    select '<PASTE_SCHEME_CODE_HERE>'::text as scheme_code
),
seed as (
    select s.scheme_name,
           base_scheme(s.scheme_name)           as base_name,
           norm_key(base_scheme(s.scheme_name)) as k
    from schemes_master s, params p
    where s.scheme_code::text = p.scheme_code
)
select sm.scheme_code,
       sm.scheme_name,
       base_scheme(sm.scheme_name)           as base_after_strip,
       norm_key(base_scheme(sm.scheme_name)) as k,
       case when norm_key(base_scheme(sm.scheme_name)) = seed.k
            then 'joined' else 'LOST' end     as status
from schemes_master sm
cross join seed
where norm_key(sm.scheme_name) like norm_key(seed.base_name) || '%'
order by status, sm.scheme_name;

-- Compact summary of the same thing:
with params as (
    select '<PASTE_SCHEME_CODE_HERE>'::text as scheme_code
),
seed as (
    select base_scheme(s.scheme_name)           as base_name,
           norm_key(base_scheme(s.scheme_name)) as k
    from schemes_master s, params p
    where s.scheme_code::text = p.scheme_code
)
select seed.base_name,
       count(*) filter (where norm_key(base_scheme(sm.scheme_name)) = seed.k) as joined,
       count(*)                                                              as total_siblings,
       count(*) - count(*) filter (where norm_key(base_scheme(sm.scheme_name)) = seed.k) as lost
from schemes_master sm
cross join seed
where norm_key(sm.scheme_name) like norm_key(seed.base_name) || '%'
group by seed.base_name;


-- ============================================================================
-- F. FAST VERSIONS -- use these, the earlier prefix-join ones time out.
-- ----------------------------------------------------------------------------
-- Why the timeout: base_scheme() is plpgsql (a loop around regexp_replace).
-- Joining schemes_master to itself by name prefix calls it ~42M times.
--
-- The fix is to stop recomputing: scheme_base ALREADY stores k and base_name
-- for every schemes_master row. Read the columns instead.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- F1. THE REGEX TO-DO LIST. No joins, one scan, instant.
--     Master rows whose base_name STILL ends in plan vocabulary = rows where
--     base_scheme() gave up. Grouped by the leftover trailing chunk and ranked
--     by how many rows each pattern costs.
-- ----------------------------------------------------------------------------
select regexp_replace(base_name, '^.*[-–]\s*', '') as leftover_suffix,
       count(*)                                    as master_rows,
       min(full_name)                              as example_full_name
from scheme_base
where base_name ~* '(growth|idcw|dividend|payout|reinvest(ment)?|bonus|option)\s*$'
   or base_name ~* 'income distribution'
group by 1
order by 2 desc
limit 50;


-- F2. Scale of the problem, one row.
select count(*) filter (
           where base_name ~* '(growth|idcw|dividend|payout|reinvest(ment)?|bonus)\s*$'
              or base_name ~* 'income distribution'
       ) as leftover_rows,
       count(*) as total_master_rows
from scheme_base;


-- ----------------------------------------------------------------------------
-- F3. Exact loss attribution, optimised. Only run if F1/F2 leave doubt.
--     Materialises norm_key(full_name) once (37,613 rows) instead of computing
--     it inside a nested loop, then range-scans a text_pattern_ops index.
--     ~1,121 index probes instead of 42M function calls.
-- ----------------------------------------------------------------------------
drop table if exists _plan_probe;
create table _plan_probe as
select k, base_name, full_name, scheme_code, norm_key(full_name) as fk
from scheme_base;
create index on _plan_probe (fk text_pattern_ops);
analyze _plan_probe;

with mapped as (
    select distinct b.k, norm_key(b.base_name) as bk
    from scheme_base b
    join scheme_alias a on a.k = b.k
)
select p.base_name       as base_after_strip,
       count(*)          as master_rows,
       min(p.full_name)  as example_full_name
from _plan_probe p
join mapped m on p.fk like m.bk || '%'
where p.k <> m.k          -- sibling of a mapped scheme, but a different key
group by 1
order by 2 desc
limit 40;

-- cleanup when done:
-- drop table _plan_probe;


-- ----------------------------------------------------------------------------
-- E3. END-TO-END PROOF. Two scheme_codes from the SAME fund -- one Growth,
--     one IDCW (take both from E2's output).
--
--     Growth returns rows and IDCW returns 0  ->  hypothesis confirmed.
--     Both return the same count                ->  that fund is fine.
-- ----------------------------------------------------------------------------
select 'growth' as plan, count(*) as holdings from holdings_by_code('<GROWTH_CODE>')
union all
select 'idcw',           count(*)             from holdings_by_code('<IDCW_CODE>');
