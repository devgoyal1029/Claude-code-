"""
Invesco  ->  mf_holdings, straight off their website

Invesco publishes one workbook PER SCHEME, spread across category tabs, instead
of one workbook with a sheet per scheme. Downloading sixty files by hand is not a
workflow, so this scrapes the disclosure pages, pulls every workbook it finds,
and pushes the whole house in one shot.

    Cell 1 : colab/parser.py     (paste once per Colab session)
    Cell 2 : this file
    Then   : sql/after_load.sql  in Supabase

It runs in two halves and prints what it found between them, because the link
shape on that site is not known in advance:

  DISCOVER -- fetch each category page, list every candidate workbook URL
  LOAD     -- download, parse, verify, push once for the whole house

If DISCOVER finds nothing, the page renders its list in JavaScript and there is
no href to scrape. The script says so and dumps the script/JSON hints it can see,
which is what you need to find the underlying data call. It does not guess.
"""

# Self-installing, because a fresh Colab session has no supabase client and a
# commented-out !pip line is a trap. subprocess rather than !pip so this works
# whether or not the cell is being run by IPython.
import subprocess, sys
subprocess.run([sys.executable, "-m", "pip", "install", "-q",
                "requests", "pandas", "openpyxl", "xlrd", "supabase"], check=False)

import io, re, json, time
import requests, pandas as pd
from urllib.parse import urljoin, urlparse
from supabase import create_client

SUPABASE_URL = "https://ulunrpbayvlazzxpqrpj.supabase.co"
SUPABASE_KEY = "PASTE_SERVICE_ROLE_KEY_HERE"      # service_role, not anon

AMC       = "Invesco"
FREQUENCY = "monthly"

# The category tabs. Equity alone is not the house -- debt and hybrid carry a
# large part of the book, and loading only equity would understate Invesco's AUM
# without anything looking wrong.
PAGES = [
    "https://www.invescomutualfund.com/literature-forms/monthly-holdings/equity",
    "https://www.invescomutualfund.com/literature-forms/monthly-holdings/debt",
    "https://www.invescomutualfund.com/literature-forms/monthly-holdings/hybrid",
    "https://www.invescomutualfund.com/literature-forms/monthly-holdings/other",
    "https://www.invescomutualfund.com/literature-forms/monthly-holdings",
]

# Set to a month string to keep only that month's files ("jun", "june-2026",
# "30-06-2026" -- whatever appears in the URLs, which DISCOVER will show you).
# Leave as None on the first run to see everything on offer.
MONTH_FILTER = None

# ----------------------------------------------------------------------------
# Key guard -- check the key BEFORE anything is downloaded or pushed.
#
# This has bitten twice: a key from a different Supabase project looks identical
# and fails with a bare "401 Invalid API key" only at the push, after every file
# has already been fetched and parsed. The project ref and the role both live in
# the JWT payload, so both are checkable up front without calling anything.
# ----------------------------------------------------------------------------
def check_key(url, key):
    import base64
    if key.startswith("PASTE_"):
        raise SystemExit("SUPABASE_KEY is still the placeholder. Paste the "
                         "service_role key from Settings > API.")
    try:
        body = key.split(".")[1]
        body += "=" * (-len(body) % 4)                # JWT strips the padding
        claims = json.loads(base64.urlsafe_b64decode(body))
    except Exception:
        raise SystemExit("SUPABASE_KEY is not a JWT. Copy it again, whole.")

    want = url.split("//")[1].split(".")[0]
    ref, role = claims.get("ref"), claims.get("role")
    print(f"key: role={role}  project={ref}  (expected {want})")

    if ref != want:
        raise SystemExit(f"WRONG PROJECT -- this key belongs to '{ref}', not "
                         f"'{want}'. Nothing was pushed.")
    if role != "service_role":
        raise SystemExit(f"This is the '{role}' key. Writing to mf_holdings "
                         "needs service_role -- anon is blocked by RLS.")


check_key(SUPABASE_URL, SUPABASE_KEY)

# parse_workbook, verify and make_push come from parser.py, which has to be run
# as its own cell first -- once per Colab session, again after any restart.
# Without this the failure is a bare NameError halfway down the file.
for _fn in ("parse_workbook", "verify", "make_push"):
    if _fn not in globals():
        raise SystemExit(
            f"'{_fn}' is not defined -- colab/parser.py has not been run in this "
            "session.\nPaste parser.py into its own cell, run it, then run this one.")

sb   = create_client(SUPABASE_URL, SUPABASE_KEY)
push = make_push(sb)                               # from parser.py

S = requests.Session()
S.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
})

WORKBOOK = re.compile(r"\.(xlsx|xls|zip)(\?|$)", re.I)
# Some sites serve the file through a handler with no extension at all
LOOKS_LIKE_DOC = re.compile(r"portfolio|holding|monthly|scheme", re.I)


# ============================================================================
# DISCOVER
# ============================================================================
def discover():
    found, pages_ok, hints = {}, 0, []

    for page in PAGES:
        try:
            r = S.get(page, timeout=90)
        except Exception as e:
            print(f"  {page}\n      request failed: {e}")
            continue
        if r.status_code != 200:
            print(f"  {page}\n      http {r.status_code}")
            continue
        pages_ok += 1
        html = r.text
        print(f"  {page}\n      http 200, {len(html):,} chars")

        # every href/src, plus bare URLs sitting inside inline JSON
        raw = re.findall(r'(?:href|src)\s*=\s*["\']([^"\']+)["\']', html, re.I)
        raw += re.findall(r'["\'](https?://[^"\'\s]+?\.(?:xlsx|xls|zip))["\']', html, re.I)
        raw += re.findall(r'["\'](/[^"\'\s]+?\.(?:xlsx|xls|zip))["\']', html, re.I)

        hit = 0
        for h in raw:
            if not WORKBOOK.search(h):
                continue
            u = urljoin(page, h.replace("&amp;", "&"))
            name = urlparse(u).path.rsplit("/", 1)[-1] or u
            if name not in found:
                found[name] = u
                hit += 1
        print(f"      {hit} workbook link(s)")

        # If nothing, keep whatever could point at the real data call.
        if hit == 0:
            for pat in (r'"[^"]*api[^"]*"', r'"[^"]*\.json[^"]*"',
                        r'"[^"]*(?:portfolio|holding)[^"]*"'):
                for m in re.findall(pat, html, re.I)[:12]:
                    if len(m) < 200:
                        hints.append(m.strip('"'))

    return found, pages_ok, sorted(set(hints))


print("=" * 74)
print("DISCOVER")
print("=" * 74)
links, pages_ok, hints = discover()

if MONTH_FILTER:
    before = len(links)
    links = {n: u for n, u in links.items()
             if MONTH_FILTER.lower() in (n + u).lower()}
    print(f"\nMONTH_FILTER {MONTH_FILTER!r}: {len(links)} of {before} links kept")

print(f"\n{len(links)} workbook(s) found across {pages_ok} page(s)")
for n in sorted(links)[:80]:
    print(f"  {n}")
if len(links) > 80:
    print(f"  ... and {len(links) - 80} more")

if not links:
    print("\nNothing to download. Either the pages are behind a block, or the file")
    print("list is rendered in JavaScript and no href exists in the HTML.")
    if hints:
        print("\nStrings from the page that may point at the real data call --")
        print("open one in a browser tab and see what it returns:")
        for h in hints[:40]:
            print(f"  {h}")
    print("\nFallback that always works: download the files by hand and use")
    print("colab/load.py with DEFAULT_AMC = \"Invesco\".")
    raise SystemExit


# ============================================================================
# LOAD -- download, parse, check
# ============================================================================
print("\n" + "=" * 74)
print("LOAD")
print("=" * 74)

frames, skipped = [], []

for i, name in enumerate(sorted(links), 1):
    url = links[name]
    try:
        r = S.get(url, timeout=180)
    except Exception as e:
        skipped.append((name, f"download failed: {e}")); continue
    if r.status_code != 200:
        skipped.append((name, f"http {r.status_code}")); continue
    # A moved file is usually served as an HTML error page with status 200, which
    # would parse to zero rows and read like a parser bug.
    if r.content[:200].lstrip()[:1] == b"<":
        skipped.append((name, "served HTML, not a workbook")); continue

    try:
        df = parse_workbook(io.BytesIO(r.content), AMC, FREQUENCY, name)
    except Exception as e:
        skipped.append((name, f"parse error: {e}")); continue
    if df.empty:
        skipped.append((name, "zero rows")); continue
    if df["portfolio_date"].isna().any():
        skipped.append((name, "null portfolio date")); continue

    # The one failure that corrupts rather than merely omits: the 100x scale
    # decision going the wrong way makes every weight and every AUM a hundred
    # times off, and nothing downstream complains. A real book sums near 100;
    # arbitrage can reach 130. Outside 20..400 the %NAV column was misread.
    med = df.groupby("scheme_name")["pct_to_nav"].sum().median()
    if pd.notna(med) and not (20 < med < 400):
        skipped.append((name, f"scale wrong (median {med:.1f})")); continue

    frames.append(df)
    sch = ", ".join(sorted(df["scheme_name"].unique())[:2])
    print(f"  [{i:3d}/{len(links)}] {len(df):5,} rows  {sch[:60]}")
    time.sleep(0.2)          # the site is not a CDN; do not hammer it

if skipped:
    print(f"\n{len(skipped)} file(s) skipped")
    for n, why in skipped:
        print(f"  {why:34s} {n}")

if not frames:
    print("\nNothing parsed. Nothing pushed.")
    raise SystemExit


# ============================================================================
# PUSH -- once for the whole house
#
# Required, not tidiness: push() deletes by (amc, portfolio_date, frequency)
# before inserting, so pushing sixty single-scheme frames in a loop would have
# each one wipe the fifty-nine before it and leave one scheme standing.
# ============================================================================
df = pd.concat(frames, ignore_index=True)
before = len(df)
df = df.drop_duplicates(subset=["amc", "scheme_name", "portfolio_date", "isin",
                                "instrument_name", "market_value_lacs"])
if before != len(df):
    print(f"\n{before - len(df):,} duplicate row(s) dropped")

print()
ok, n_sch = verify(df, AMC)
dates = sorted(pd.Timestamp(d).strftime("%d-%b-%Y")
               for d in df["portfolio_date"].dropna().unique())
print(f"  dates           {', '.join(dates)}")
print(f"  files parsed    {len(frames)} of {len(links)}")

if n_sch >= 5 and ok / n_sch < 0.70:
    print(f"\nSTOPPED -- only {ok}/{n_sch} schemes sum to ~100%. Check the %NAV "
          "column before pushing this.")
    raise SystemExit

print()
push(df)

print("\n" + "=" * 74)
print("Pushed. Now run sql/after_load.sql in Supabase -- until you do, these")
print("funds sit in mf_holdings but are invisible to every market-wide query,")
print("because the analytical layer is materialised.")
print("\nThen confirm, in Supabase:")
print("  select count(distinct scheme_name) from mf_holdings where amc = 'Invesco';")
