"""
JioBlackRock -> mf_holdings, off their own Strapi-backed API

The disclosure page (https://www.jioblackrockamc.com/statutory-disclosure/
disclosures/monthly-portfolio-disclosure) is a Next.js app whose file list is
built client-side by a SERVER ACTION, so there is no .xlsx link to scrape. The
action returns JSON where each record has file.url pointing at a public CDN
(jioinvest.cdn.jio.com). We call the action directly, exactly as the page does.

    Cell 1 : colab/parser.py
    Cell 2 : this file
    Then   : sql/after_load.sql in Supabase

CHANGE EACH MONTH: only TARGET (the YYYY-MM you want). Leave it None to auto-pick
the latest month the site has published. The action id is re-read from the page
on every run, so a site redeploy does not break it.
"""

import subprocess, sys
subprocess.run([sys.executable, "-m", "pip", "install", "-q",
                "requests", "pandas", "openpyxl", "xlrd", "supabase"], check=False)

import io, re, json, time
import requests, pandas as pd
from supabase import create_client

SUPABASE_URL = "https://ulunrpbayvlazzxpqrpj.supabase.co"
SUPABASE_KEY = "PASTE_SERVICE_ROLE_KEY_HERE"      # service_role

AMC       = "JioBR"       # short code -- keep it EXACTLY this every month
FREQUENCY = "monthly"
TARGET    = None          # "2026-06" style YYYY-MM, or None = latest available

PAGE = "https://www.jioblackrockamc.com/statutory-disclosure/disclosures/monthly-portfolio-disclosure"

S = requests.Session()
S.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"})


# ---- key guard: a wrong-project key fails only at push, after all work ----
def check_key(url, key):
    import base64
    if key.startswith("PASTE_"):
        raise SystemExit("SUPABASE_KEY placeholder hai.")
    body = key.split(".")[1]; body += "=" * (-len(body) % 4)
    c = json.loads(base64.urlsafe_b64decode(body))
    want = url.split("//")[1].split(".")[0]
    print(f"key: role={c.get('role')}  project={c.get('ref')}  (expected {want})")
    if c.get("ref") != want:
        raise SystemExit(f"WRONG PROJECT -- key '{c.get('ref')}' ki hai. Kuch push nahi hua.")
    if c.get("role") != "service_role":
        raise SystemExit(f"'{c.get('role')}' key hai; likhne ke liye service_role chahiye.")


check_key(SUPABASE_URL, SUPABASE_KEY)
for _fn in ("parse_workbook", "verify", "make_push"):
    if _fn not in globals():
        raise SystemExit(f"'{_fn}' undefined -- pehle parser.py wala cell chalao.")

sb = create_client(SUPABASE_URL, SUPABASE_KEY)
push = make_push(sb)


# ---- 1. call the server action, read the file list ----
print("\n" + "=" * 60 + "\n1. FILE LIST (server action)")
html = S.get(PAGE, timeout=120).text
m = re.search(r'createServerReference\)\("([a-f0-9]{20,})"[^)]*"getDisclosureL3Data"', html)
action = m.group(1) if m else "70515daed85b22e9b12b90e52bedc499c23dd3859f"

r = S.post(PAGE, timeout=120,
           headers={"Next-Action": action, "Content-Type": "text/plain;charset=UTF-8",
                    "Accept": "text/x-component"},
           data=b'["monthly-portfolio-disclosure"]')
i = r.text.find('{"data":')
if i < 0:
    raise SystemExit("data nahi mila -- action badla hoga, invesco_probe style se dobara dekho")
records = json.JSONDecoder().raw_decode(r.text[i:])[0]["data"]
print(f"  {len(records)} document(s)")

files = []
for rec in records:
    f = rec.get("file") or {}
    url = (f.get("url") or "").replace("\\/", "/")
    if re.search(r"\.(xlsx|xls)$", url, re.I):
        files.append({"url": url, "date": rec.get("date", "")})

buckets = {}
for it in files:
    ym = it["date"][:7] if re.match(r"\d{4}-\d{2}", it["date"]) else "?"
    buckets[ym] = buckets.get(ym, 0) + 1
print("  available (YYYY-MM):")
for ym in sorted(buckets, reverse=True):
    print(f"    {ym}  {buckets[ym]:3d}")

target = TARGET or max(b for b in buckets if b != "?")
files = [it for it in files if it["date"].startswith(target)]
print(f"\n  TARGET = {target}  ->  {len(files)} file(s)")
if not files:
    raise SystemExit("Is month par kuch nahi -- TARGET badlo.")


# ---- 2. download, parse, check ----
print("\n" + "=" * 60 + "\n2. DOWNLOAD + PARSE")
frames, skipped = [], []
for k, it in enumerate(sorted(files, key=lambda x: x["url"]), 1):
    fname = it["url"].rsplit("/", 1)[-1]
    try:
        rr = S.get(it["url"], timeout=180)
    except Exception as e:
        skipped.append((fname, f"download: {e}")); continue
    if rr.status_code != 200 or rr.content[:200].lstrip()[:1] == b"<":
        skipped.append((fname, "bad response")); continue
    try:
        df = parse_workbook(io.BytesIO(rr.content), AMC, FREQUENCY, fname)
    except Exception as e:
        skipped.append((fname, f"parse: {e}")); continue
    if df.empty or df["portfolio_date"].isna().any():
        skipped.append((fname, "empty/nulldate")); continue
    med = df.groupby("scheme_name")["pct_to_nav"].sum().median()
    if pd.notna(med) and not (20 < med < 400):
        skipped.append((fname, f"scale {med:.1f}")); continue
    frames.append(df)
    print(f"  [{k:2d}/{len(files)}] {len(df):4,} rows  {sorted(df['scheme_name'].unique())[0][:52]}")
    time.sleep(0.2)

if skipped:
    print(f"\n{len(skipped)} skipped")
    for n, why in skipped: print(f"  {why:22s} {n}")
if not frames:
    raise SystemExit("\nKuch parse nahi hua.")


# ---- 3. one push ----
df = pd.concat(frames, ignore_index=True).drop_duplicates(
    subset=["amc", "scheme_name", "portfolio_date", "isin", "instrument_name", "market_value_lacs"])
print()
verify(df, AMC)
print()
push(df)
print("\nPushed. Ab Supabase mein sql/after_load.sql chalao, phir:")
print("  select count(distinct scheme_name) from mf_holdings where amc = 'JioBR';")
