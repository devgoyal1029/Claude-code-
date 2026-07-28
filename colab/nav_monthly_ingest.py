"""
Month-end NAV for every fund with a loaded portfolio  ->  scheme_nav_monthly

Feeds return_leaderboard() and fund_returns_stored() (sql/returns_and_caps.sql).

Why monthly, and why one code per fund:
  Daily NAV for all 4,060 plan codes would be millions of rows and will not fit
  the free tier. Monthly is enough for CAGR and for ranking. The per-fund page
  still pulls DAILY history live from api.mfapi.in for its chart and risk
  metrics, so nothing is lost there.

Why Direct-Growth:
  It is the standard comparison basis -- no distributor commission -- so a
  leaderboard is not reordered by which plan happened to get stored.

Expect ~1,100 funds x ~120 months = roughly 130k rows.

Run sql/returns_and_caps.sql first (it creates the table).
"""

# ============================================================================
# CELL 1 -- pick one representative scheme_code per fund
# ============================================================================
import re, time, json, requests, pandas as pd
from concurrent.futures import ThreadPoolExecutor
from supabase import create_client

# service_role, not anon: scheme_nav_monthly has RLS with a read-only policy,
# so an anon key cannot insert.
SUPABASE_URL = "https://ulunrpbayvlazzxpqrpj.supabase.co"
SUPABASE_KEY = "PASTE_SERVICE_ROLE_KEY_HERE"

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

# PostgREST caps a single response at 1,000 rows. v_scheme_plans holds 4,060,
# so an unpaged read silently returned the first 1,000 -- which grouped down to
# 368 funds, and the other 750+ were never fetched. No error, just missing data.
def fetch_all(tbl, cols, step=1000):
    out, start = [], 0
    while True:
        chunk = (sb.table(tbl).select(cols)
                   .range(start, start + step - 1).execute().data)
        out += chunk
        print(f"  {tbl}: {len(out):,} rows")
        if len(chunk) < step:
            return out
        start += step

plans = pd.DataFrame(fetch_all("v_scheme_plans",
                               "amc,scheme_name,scheme_code,plan_name,plan_type"))
print(f"{len(plans):,} plan rows")
assert len(plans) > 3000, f"only {len(plans)} rows returned -- paging is not working"

def score(name):
    """Lower is better. Direct + Growth wins; IDCW and Regular are penalised."""
    n = (name or "").lower()
    s = 0
    if "direct" not in n:            s += 10
    if "growth" not in n:            s += 5
    if re.search(r"idcw|dividend|payout|reinvest|bonus", n): s += 20
    return s

plans["s"] = plans["plan_name"].map(score)
pick = (plans.sort_values(["amc", "scheme_name", "s", "scheme_code"])
              .groupby(["amc", "scheme_name"], as_index=False).first())

print(f"{len(pick):,} funds -> one code each")
print(pick[["amc", "scheme_name", "plan_name", "scheme_code"]].head(10).to_string(index=False))

# Sanity: most picks should be Direct Growth. A high count here means the
# plan_name text is not what the scorer expects -- inspect before running cell 2.
bad = pick[pick.s > 5]
print(f"\n{len(bad)} funds had no Direct-Growth plan available")
print(bad[["amc", "scheme_name", "plan_name"]].head(15).to_string(index=False))


# ============================================================================
# CELL 2 -- fetch history and downsample to month-end
# ============================================================================
MFAPI = "https://api.mfapi.in/mf/"
sess = requests.Session()
sess.headers["User-Agent"] = "Mozilla/5.0"

def fetch(code):
    code = str(code)
    for attempt in range(3):
        try:
            r = sess.get(MFAPI + code, timeout=45)
            if r.status_code != 200:
                return code, None, f"http {r.status_code}"
            d = r.json().get("data")
            if not d:
                return code, None, "empty"
            df = pd.DataFrame(d)
            df["month_end"] = pd.to_datetime(df["date"], format="%d-%m-%Y", errors="coerce")
            df["nav"] = pd.to_numeric(df["nav"], errors="coerce")
            df = df.dropna(subset=["month_end", "nav"])
            df = df[df["nav"] > 0]
            if df.empty:
                return code, None, "no valid rows"
            # last observation of each calendar month -- NAV is not published on
            # every date, so the true month end is whatever the fund last quoted
            df = (df.sort_values("month_end")
                    .groupby(df["month_end"].dt.to_period("M"), as_index=False)
                    .last()[["month_end", "nav"]])
            df["scheme_code"] = code
            return code, df, None
        except Exception as e:
            if attempt == 2:
                return code, None, str(e)[:60]
            time.sleep(1.5 * (attempt + 1))

codes = pick["scheme_code"].astype(str).tolist()
frames, failed = [], []

with ThreadPoolExecutor(max_workers=12) as ex:
    for i, (code, df, err) in enumerate(ex.map(fetch, codes), 1):
        if df is None:
            failed.append((code, err))
        else:
            frames.append(df)
        if i % 100 == 0:
            print(f"  {i}/{len(codes)}  ok={len(frames)}  failed={len(failed)}")

nav = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
print(f"\nfunds fetched   {len(frames):,}")
print(f"funds failed    {len(failed):,}")
print(f"rows            {len(nav):,}")
if len(nav):
    print(f"date range      {nav.month_end.min().date()} -> {nav.month_end.max().date()}")
    print(f"months per fund median {nav.groupby('scheme_code').size().median():.0f}")
print("\nfailures:", failed[:15])


# ============================================================================
# CELL 3 -- push
# ============================================================================
up = nav.copy()
up["month_end"] = up["month_end"].dt.strftime("%Y-%m-%d")
up["nav"] = up["nav"].round(4)
recs = json.loads(up[["scheme_code", "month_end", "nav"]].to_json(orient="records"))

# Full replace. upsert would work too, but a clean wipe avoids leaving rows
# behind for funds that dropped out of the picker since the last run.
sb.table("scheme_nav_monthly").delete().neq("scheme_code", "").execute()
for i in range(0, len(recs), 1000):
    sb.table("scheme_nav_monthly").insert(recs[i:i + 1000]).execute()
    if (i // 1000) % 20 == 0:
        print(f"  {i:,}/{len(recs):,}")
print(f"pushed {len(recs):,}")


# ============================================================================
# CELL 4 -- verify in Supabase
# ============================================================================
# select count(*) rows, count(distinct scheme_code) funds,
#        min(month_end), max(month_end)
# from scheme_nav_monthly;
#
# select * from return_leaderboard(36, 'Large Cap Fund', null, 20);
#
# Cross-check one fund against its own page: the 3Y CAGR from stored monthly
# NAV should land within a few basis points of the daily figure the dashboard
# computes live. A large gap means the month-end downsampling picked up a
# stale quote.
