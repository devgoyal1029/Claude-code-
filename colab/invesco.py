"""
Invesco -> mf_holdings, off their own API

The disclosure page is a Next.js app that builds its file list client-side, so
there is nothing to scrape from the HTML. The contract is written in their JS
bundle, and this uses it exactly as their own page does:

    GET /api/ClassificationCompleteMonthlyHoldings
        -> [{FunClassificationValue: "equity", ...}, ...]   the category slugs

    GET /api/CompleteMonthlyHoldings?year=YYYY&classification=<slug>
        -> one record per scheme, with a column PER MONTH:
           JanUrl / JanName, FebUrl / FebName, ... DecUrl / DecName

That per-month column shape is the thing worth knowing. There is no DocumentUrl
field, which is why a generic "find the download link" walk over this response
comes back empty.

    Cell 1 : colab/parser.py
    Cell 2 : this file
    Then   : sql/after_load.sql in Supabase

Invesco publishes one workbook per scheme, so a month is ~60 files across seven
categories. They are concatenated and pushed once -- push() deletes by
(amc, portfolio_date, frequency), so pushing them individually would have each
file wipe the ones before it.
"""

import subprocess, sys
subprocess.run([sys.executable, "-m", "pip", "install", "-q",
                "requests", "pandas", "openpyxl", "xlrd", "supabase"], check=False)

import io, re, json, time
import requests, pandas as pd
from supabase import create_client

SUPABASE_URL = "https://ulunrpbayvlazzxpqrpj.supabase.co"
SUPABASE_KEY = "PASTE_SERVICE_ROLE_KEY_HERE"      # service_role

AMC       = "Invesco"
FREQUENCY = "monthly"
YEAR      = 2026
MONTH     = "Jun"        # three-letter prefix: Jan Feb Mar ... Dec

HOST = "https://www.invescomutualfund.com"

S = requests.Session()
S.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "Referer": f"{HOST}/literature-forms/monthly-holdings/equity",
})


# ----------------------------------------------------------------------------
# Key guard -- a key from another project fails with a bare "401 Invalid API
# key" only at the push, after every file has been fetched and parsed. It has
# happened twice here. Both the project ref and the role are in the JWT.
# ----------------------------------------------------------------------------
def check_key(url, key):
    import base64
    if key.startswith("PASTE_"):
        raise SystemExit("SUPABASE_KEY is still the placeholder.")
    body = key.split(".")[1]; body += "=" * (-len(body) % 4)
    c = json.loads(base64.urlsafe_b64decode(body))
    want = url.split("//")[1].split(".")[0]
    print(f"key: role={c.get('role')}  project={c.get('ref')}  (expected {want})")
    if c.get("ref") != want:
        raise SystemExit(f"WRONG PROJECT -- key belongs to '{c.get('ref')}'. Nothing pushed.")
    if c.get("role") != "service_role":
        raise SystemExit(f"This is the '{c.get('role')}' key; writes need service_role.")


check_key(SUPABASE_URL, SUPABASE_KEY)

for _fn in ("parse_workbook", "verify", "make_push"):
    if _fn not in globals():
        raise SystemExit(f"'{_fn}' undefined -- run the parser.py cell first.")

sb   = create_client(SUPABASE_URL, SUPABASE_KEY)
push = make_push(sb)

MONTH_KEY = re.compile(r"^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)url$", re.I)


# ============================================================================
# 1. Categories, then one call per category
# ============================================================================
print("\n" + "=" * 74)
print("1. API")
print("=" * 74)

cls = S.get(f"{HOST}/api/ClassificationCompleteMonthlyHoldings", timeout=90).json()
slugs = [c["FunClassificationValue"] for c in cls
         if c.get("FunClassificationValue", "").lower() != "select"]
print(f"  {len(slugs)} categories: {', '.join(slugs)}")

items, shape_shown = {}, False

for slug in slugs:
    u = f"{HOST}/api/CompleteMonthlyHoldings?year={YEAR}&classification={slug}"
    try:
        r = S.get(u, timeout=120)
        recs = r.json() if r.ok else []
    except Exception as e:
        print(f"  {slug:22s} failed: {e}")
        continue
    if not isinstance(recs, list):
        recs = [recs]

    # Print the first record's keys once. If Invesco renames a column, this is
    # where it shows -- far better than a silent zero.
    if recs and not shape_shown:
        shape_shown = True
        print(f"\n  record keys: {', '.join(list(recs[0].keys())[:24])}\n")

    hit = 0
    for rec in recs:
        if not isinstance(rec, dict):
            continue
        for k, v in rec.items():
            m = MONTH_KEY.match(k)
            if not m or not isinstance(v, str) or not v.strip():
                continue
            if m.group(1).lower() != MONTH.lower()[:3]:
                continue
            if not re.search(r"\.(xlsx|xls)(\?|$)", v, re.I):
                continue
            url  = v if v.startswith("http") else HOST + "/" + v.lstrip("/")
            name = rec.get(k[:3] + "Name") or rec.get("SchemeName") or url
            items.setdefault(url, {"url": url, "name": str(name), "cat": slug})
            hit += 1
    print(f"  {slug:22s} {len(recs):4d} record(s)  {hit:4d} {MONTH} workbook(s)")

print(f"\n{len(items)} unique workbook(s) for {MONTH}-{YEAR}")
if not items:
    raise SystemExit(
        f"Nothing for {MONTH}-{YEAR}. Either that month is not published yet, or a "
        "column was renamed -- check the 'record keys' line above.")


# ============================================================================
# 2. Download, parse, check
# ============================================================================
print("\n" + "=" * 74)
print("2. DOWNLOAD + PARSE")
print("=" * 74)

frames, skipped = [], []

for i, it in enumerate(sorted(items.values(), key=lambda x: x["name"]), 1):
    fname = it["url"].rsplit("/", 1)[-1].split("?")[0]
    try:
        r = S.get(it["url"], timeout=180)
    except Exception as e:
        skipped.append((fname, f"download failed: {e}")); continue
    if r.status_code != 200:
        skipped.append((fname, f"http {r.status_code}")); continue
    # A moved file comes back as an HTML error page with status 200, which would
    # parse to zero rows and read like a parser fault.
    if r.content[:200].lstrip()[:1] == b"<":
        skipped.append((fname, "served HTML, not a workbook")); continue

    try:
        df = parse_workbook(io.BytesIO(r.content), AMC, FREQUENCY, fname)
    except Exception as e:
        skipped.append((fname, f"parse error: {e}")); continue
    if df.empty:
        skipped.append((fname, "zero rows")); continue
    if df["portfolio_date"].isna().any():
        skipped.append((fname, "null portfolio date")); continue

    # The one failure that corrupts rather than omits: the 100x scale decision
    # going the wrong way makes every weight and every AUM a hundred times off,
    # and nothing downstream complains. A real book sums near 100; arbitrage can
    # reach 130. Outside 20..400 the %NAV column was misread.
    med = df.groupby("scheme_name")["pct_to_nav"].sum().median()
    if pd.notna(med) and not (20 < med < 400):
        skipped.append((fname, f"scale wrong (median {med:.1f})")); continue

    frames.append(df)
    print(f"  [{i:3d}/{len(items)}] {len(df):5,} rows  "
          f"{sorted(df['scheme_name'].unique())[0][:56]}")
    time.sleep(0.2)

if skipped:
    print(f"\n{len(skipped)} skipped")
    for n, why in skipped:
        print(f"  {why:34s} {n}")

if not frames:
    raise SystemExit("\nNothing parsed. Nothing pushed.")


# ============================================================================
# 3. One push for the whole house
# ============================================================================
df = pd.concat(frames, ignore_index=True)
before = len(df)
df = df.drop_duplicates(subset=["amc", "scheme_name", "portfolio_date", "isin",
                                "instrument_name", "market_value_lacs"])
if before != len(df):
    print(f"\n{before - len(df):,} duplicate row(s) dropped")

print()
ok, n_sch = verify(df, AMC)
print("  dates           " + ", ".join(sorted(
    pd.Timestamp(d).strftime("%d-%b-%Y") for d in df["portfolio_date"].dropna().unique())))
print(f"  files parsed    {len(frames)} of {len(items)}")

if n_sch >= 5 and ok / n_sch < 0.70:
    raise SystemExit(f"\nSTOPPED -- only {ok}/{n_sch} schemes sum to ~100%.")

print()
push(df)

print("\n" + "=" * 74)
print("Pushed. Now run sql/after_load.sql in Supabase, then confirm:")
print("  select count(distinct scheme_name) from mf_holdings where amc = 'Invesco';")
