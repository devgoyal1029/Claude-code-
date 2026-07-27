-- ============================================================================
-- search_schemes v2 -- fills in the AMC and category that schemes_master
-- leaves NULL on roughly half its rows.
-- ----------------------------------------------------------------------------
-- Symptom: searching "hdfc mid" returned rows where the AMC line read "—".
-- The codes came in consecutive pairs (105757/105758, 118988/118989) -- the
-- IDCW Payout / Reinvestment twins of one plan -- and one of each pair carries
-- no amc_name or category.
--
-- Fix: every plan of a fund shares a key `k`, and at least one of them has the
-- metadata. Take the first non-NULL per key and fall back to it.
--
-- Also switches the source from schemes_master to scheme_base. Same 37,613
-- rows, but scheme_base already stores `k`, which turns the has_holdings check
-- into a plain index lookup on scheme_alias instead of a scan through
-- v_scheme_plans.
--
-- Run after sql/dashboard_api.sql.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Trigram index for the ILIKE '%q%' search.
-- ----------------------------------------------------------------------------
create index if not exists idx_scheme_base_fullname_trgm
    on scheme_base using gin (full_name gin_trgm_ops);


-- ----------------------------------------------------------------------------
-- Per-fund metadata fallback. One row per key, ~10k rows, so the join is cheap.
--
-- MATERIALIZED: scheme_base only changes when schemes_master is refreshed from
-- AMFI, so this does not need to be live. Refresh it whenever scheme_base is
-- rebuilt:
--     refresh materialized view scheme_key_meta;
-- ----------------------------------------------------------------------------
drop materialized view if exists scheme_key_meta;

create materialized view scheme_key_meta as
select k,
       (array_agg(amc_name order by scheme_code)
          filter (where amc_name is not null))[1] as amc_name,
       (array_agg(category order by scheme_code)
          filter (where category is not null))[1] as category
from scheme_base
group by k;

create unique index on scheme_key_meta (k);


-- ----------------------------------------------------------------------------
-- search_schemes v2
-- ----------------------------------------------------------------------------
create or replace function search_schemes(q text, lim int default 25)
returns table (scheme_code   text,
               scheme_name   text,
               amc_name      text,
               category      text,
               has_holdings  boolean)
language sql stable security definer set search_path = public
as $$
    select b.scheme_code::text,
           b.full_name,
           coalesce(b.amc_name, m.amc_name),
           coalesce(b.category, m.category),
           exists (select 1 from scheme_alias a where a.k = b.k)
    from scheme_base b
    left join scheme_key_meta m on m.k = b.k
    where q is not null and length(btrim(q)) >= 2
      and b.full_name ilike '%' || btrim(q) || '%'
    order by (b.full_name ilike btrim(q) || '%') desc,   -- prefix hits first
             length(b.full_name),
             b.full_name
    limit least(coalesce(lim, 25), 100)
$$;

grant execute on function search_schemes(text, int) to anon, authenticated;
grant select on scheme_key_meta to anon, authenticated;


-- ============================================================================
-- CHECK -- the case that was broken. No row should show a NULL amc_name now.
-- ============================================================================
select * from search_schemes('hdfc mid', 10);

-- How much the fallback is actually doing:
select count(*) filter (where amc_name is null)  as amc_null,
       count(*) filter (where category is null)  as cat_null,
       count(*)                                  as total
from scheme_base;

select count(*) filter (where coalesce(b.amc_name, m.amc_name) is null) as amc_null_after,
       count(*) filter (where coalesce(b.category, m.category) is null) as cat_null_after,
       count(*)                                                        as total
from scheme_base b
left join scheme_key_meta m on m.k = b.k;
