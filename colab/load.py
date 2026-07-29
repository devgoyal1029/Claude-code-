"""
Universal loader  --  drag files in, they land in mf_holdings

One cell, any number of AMCs, any number of months, in one go. Replaces the
per-AMC scripts: the AMC and the disclosure frequency are read off the filename,
the portfolio date is read out of the workbook itself, and nothing is pushed
until it has passed the same checks you would have run by hand.

    Cell 1 : colab/parser.py     (paste once per Colab session)
    Cell 2 : this file           (paste once, run every time)
    Then   : sql/after_load.sql  in Supabase

WHAT IT DOES NOT DO, deliberately: it will not invent an AMC code. A house is
identified by a short code ('HDFC', 'ICICI', 'Nippon') that must match what is
already in the database exactly -- 'HDFC' and 'HDFC MF' would become two
different fund houses, and every cross-fund number would quietly split in half.
Unrecognised files are listed and skipped, never guessed at.

LOADING AN OLDER MONTH IS SAFE. push() deletes per (amc, portfolio_date,
frequency), so June does not disturb July. That is how you light up the Changes
tab: load any house's previous month and every one of its schemes gains history.
"""

# Self-installing, because a fresh Colab session has no supabase client and a
# commented-out !pip line is a trap. subprocess rather than !pip so this works
# whether or not the cell is being run by IPython.
import subprocess, sys
subprocess.run([sys.executable, "-m", "pip", "install", "-q",
                "requests", "pandas", "openpyxl", "xlrd", "supabase"], check=False)

import io, re, requests, pandas as pd
from supabase import create_client
from google.colab import files

SUPABASE_URL = "https://ulunrpbayvlazzxpqrpj.supabase.co"
SUPABASE_KEY = "PASTE_SERVICE_ROLE_KEY_HERE"      # service_role, not anon

# ----------------------------------------------------------------------------
# Key guard -- check the key BEFORE anything is downloaded or pushed.
#
# This has bitten twice: a key from a different Supabase project looks identical
# and fails with a bare "401 Invalid API key" only at the push, after every file
# has already been fetched and parsed. The project ref and the role both live in
# the JWT payload, so both are checkable up front without calling anything.
# ----------------------------------------------------------------------------
def check_key(url, key):
    import base64, json
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

# ============================================================================
# 1. Which house is this file from?
#
# Order matters -- the first match wins, so longer and more specific patterns
# come first. 'sbi' would otherwise match inside 'hsbc'.
#
# To add a house: put the short code you want stored on the left and a pattern
# that appears in its filenames on the right. Keep the code SHORT and reuse it
# forever; it is the join key for every cross-fund query.
# ============================================================================
AMC_PATTERNS = [
    ("HSBC",    r"hsbc"),
    ("SBI",     r"\bsbi\b|all[- ]schemes"),
    ("ICICI",   r"icici|ipru"),
    ("HDFC",    r"hdfc"),
    ("Nippon",  r"nippon|nimf|reliance"),
    ("ABSL",    r"aditya|birla|absl"),
    ("Kotak",   r"kotak"),
    ("Axis",    r"axis"),
    ("DSP",     r"\bdsp\b"),
    ("Mirae",   r"mirae"),
    ("Bandhan", r"bandhan|idfc"),
    ("Tata",    r"tata"),
    ("Motilal", r"motilal|\bmo\b|moamc"),
    ("Quantum", r"quantum"),
    ("Quant",   r"quant"),            # after Quantum, or it swallows it
    ("Invesco", r"invesco"),
    ("UTI",     r"\buti\b"),
    ("Franklin", r"franklin|templeton"),
    ("Edelweiss", r"edelweiss"),
    ("PPFAS",   r"ppfas|parag"),
    ("Canara",  r"canara|robeco"),
    ("Sundaram", r"sundaram"),
    ("LIC",     r"\blic\b"),
    ("Baroda",  r"baroda|bnp"),
    ("JM",      r"\bjm\b"),
    ("Navi",    r"navi"),
    ("WhiteOak", r"whiteoak|white oak"),
    ("Samco",   r"samco"),
    ("Trust",   r"trustmf|trust mutual"),
    ("360ONE",  r"360|iifl"),
    ("Abakkus", r"abakkus"),
    ("Groww",   r"groww"),
    ("Zerodha", r"zerodha"),
    ("Bajaj",   r"bajaj"),
    ("Helios",  r"helios"),
    ("Old Bridge", r"old ?bridge"),
    ("Unifi",   r"unifi"),
]

# Filename says nothing useful? Map it by hand here: {"weird_name.xlsx": "HDFC"}
AMC_OVERRIDE = {}

# Set this when every file in this run belongs to one house and the filenames do
# not say so -- an AMC that publishes one file per scheme names them after the
# scheme ("largecap-fund-june-2026.xlsx"), and writing 60 AMC_OVERRIDE entries by
# hand is not a workflow. Leave as None to require the filename to identify it.
DEFAULT_AMC = None


def detect_amc(fname):
    if fname in AMC_OVERRIDE: return AMC_OVERRIDE[fname]
    low = fname.lower()
    for code, pat in AMC_PATTERNS:
        if re.search(pat, low): return code
    return DEFAULT_AMC


def detect_frequency(fname):
    low = fname.lower()
    if re.search(r"fortnight|15th|fn[- ]?portfolio", low): return "fortnightly"
    if re.search(r"half[- ]?year|halfyearly",        low): return "half-yearly"
    return "monthly"


# ============================================================================
# 2. Where the files come from -- URLs, uploads, or both
#
# URLs are the easier route where the AMC exposes one: nothing to download and
# re-upload, and re-running next month is a one-character edit. Paste them here.
# Leave the list empty to go straight to the upload box.
#
# These links change every month and some AMCs render their disclosure page in
# JavaScript, so there is no link to copy -- those you download by hand and
# drag in. Both paths run through exactly the same checks below.
# ============================================================================
SOURCES = [
    # "https://www.example-amc.com/monthly-portfolio-june-2026.xlsx",
]

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"}

uploaded = {}

for url in SOURCES:
    name = url.rsplit("/", 1)[-1].split("?")[0] or url
    try:
        r = requests.get(url, headers=UA, timeout=300)
        # An AMC that has moved the file usually serves an HTML error page with
        # status 200, which would then "parse" to zero rows and look like a
        # parser bug. Catch it here where the cause is obvious.
        if r.status_code != 200:
            print(f"  {name}: http {r.status_code} -- skipped"); continue
        if r.content[:200].lstrip()[:1] == b"<":
            print(f"  {name}: got HTML, not a workbook -- link is stale, skipped")
            continue
        uploaded[name] = r.content
        print(f"  {name}: {len(r.content):,} bytes")
    except Exception as e:
        print(f"  {name}: download failed -- {e}")

print("\nUpload any workbooks you downloaded by hand "
      "(any number, any AMC, any month) -- or cancel if the URLs above covered it:\n")
try:
    uploaded.update(files.upload())
except Exception:
    pass          # cancelled upload box is not an error

# What the database already calls each house. A file resolving to a code that is
# NOT here is a new house -- fine, but worth seeing before it gets created.
#
# Read through amc_summary(), which returns one row per house. A plain
# select on mf_holdings would be capped at 1,000 rows by PostgREST and hand back
# whichever AMC happened to sort first, making every other house look new.
try:
    known = {r["amc"] for r in sb.rpc("amc_summary", {}).execute().data}
except Exception as e:
    print(f"(could not read existing AMC list: {e})")
    known = set()

# ============================================================================
# 3. Parse and check -- nothing is pushed in this loop
# ============================================================================
parsed, skipped = [], []

for fname, blob in uploaded.items():
    amc  = detect_amc(fname)
    freq = detect_frequency(fname)
    print(f"\n{'=' * 70}\n{fname}")

    if not amc:
        print("  SKIPPED -- cannot tell which AMC this is.")
        print("  Fix: set DEFAULT_AMC if this whole run is one house, or add a")
        print("       pattern to AMC_PATTERNS, or")
        print(f'       AMC_OVERRIDE = {{"{fname}": "SHORTCODE"}}')
        skipped.append((fname, "unknown AMC"))
        continue

    print(f"  AMC {amc}   frequency {freq}" +
          ("" if amc in known else "   <-- NEW HOUSE, not in the database yet"))

    try:
        df = parse_workbook(io.BytesIO(blob), amc, freq, fname)
    except Exception as e:
        print(f"  SKIPPED -- parse failed: {e}")
        skipped.append((fname, f"parse error: {e}"))
        continue

    if df.empty:
        print("  SKIPPED -- parsed to zero rows. Wrong file, or a layout the "
              "parser does not recognise.")
        skipped.append((fname, "zero rows"))
        continue

    ok, n_sch = verify(df, f"  {amc}")
    dates = sorted(d for d in df["portfolio_date"].dropna().unique())
    print(f"  dates           {', '.join(pd.Timestamp(d).strftime('%d-%b-%Y') for d in dates)}")

    if df["portfolio_date"].isna().any():
        print("  SKIPPED -- some rows have no portfolio date.")
        skipped.append((fname, "null dates")); continue

    # The failure that actually corrupts data is the 100x scale decision going
    # the wrong way: every weight and every AUM comes out a hundred times off,
    # and nothing downstream complains. A real portfolio sums near 100 -- an
    # arbitrage or equity-savings book can reach 130 -- so a median outside
    # 20..400 means the scale was misread, not that the fund is unusual.
    med = df.groupby("scheme_name")["pct_to_nav"].sum().median()
    if pd.notna(med) and not (20 < med < 400):
        print(f"  SKIPPED -- scheme weights sum to a median of {med:.2f}, which is "
              "not a percentage. The %NAV column was misread.")
        skipped.append((fname, f"scale wrong (median {med:.1f})")); continue

    # The 100-percent check only means something across a set of schemes. On a
    # one-scheme file it would reject every arbitrage fund, which legitimately
    # sums past 102 -- so warn there instead of skipping. push() flags those rows
    # needs_review either way.
    if n_sch >= 5 and ok / n_sch < 0.70:
        print(f"  SKIPPED -- only {ok}/{n_sch} schemes sum to ~100%. Check the "
              "%NAV column before trusting this file.")
        skipped.append((fname, f"weights off ({ok}/{n_sch})")); continue
    if n_sch < 5 and ok < n_sch:
        print(f"  note: {n_sch - ok} of {n_sch} scheme(s) sum outside 98-102% "
              "(normal for arbitrage and equity-savings) -- flagged, not skipped.")

    parsed.append((fname, amc, df))

# ============================================================================
# 4. Combine per house, then push ONCE
#
# This is not a tidiness choice, it is required. push() deletes by
# (amc, portfolio_date, frequency) before inserting, so pushing 60 single-scheme
# files one after another would have each one wipe the 59 before it and leave a
# single scheme standing. Some AMCs -- Invesco among them -- publish one file per
# scheme rather than one workbook with a sheet per scheme, so this is the normal
# case, not an edge case.
#
# Concatenating first means one delete and one insert per (house, date), which is
# also what makes a re-run safe: it replaces that house's snapshot wholesale.
# ============================================================================
print(f"\n{'=' * 70}\nREADY TO PUSH\n")

by_amc = {}
for fname, amc, df in parsed:
    by_amc.setdefault(amc, []).append(df)

combined = {}
for amc, frames in by_amc.items():
    df = pd.concat(frames, ignore_index=True)
    # The same scheme arriving in two files at the same date would double every
    # weight. Drop exact duplicates on the natural key before it reaches the DB.
    before = len(df)
    df = df.drop_duplicates(
        subset=["amc", "scheme_name", "portfolio_date", "isin",
                "instrument_name", "market_value_lacs"])
    combined[amc] = df
    dup = before - len(df)
    print(f"  {amc:10s} {df['scheme_name'].nunique():4d} schemes  "
          f"{len(df):7,} rows   from {len(frames)} file(s)"
          + (f"   ({dup:,} duplicate rows dropped)" if dup else ""))

if skipped:
    print("\nSKIPPED")
    for fname, why in skipped:
        print(f"  {why:24s} {fname}")

if not combined:
    print("\nNothing to push.")
else:
    print()
    for amc, df in combined.items():
        push(df)

    print(f"\n{'=' * 70}")
    print("Pushed. Now run sql/after_load.sql in Supabase -- until you do, the")
    print("new funds are in mf_holdings but invisible to every market-wide")
    print("query, because the analytical layer is materialised.")
