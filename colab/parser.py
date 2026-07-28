"""
AMC portfolio-disclosure parser -- v5

Columns are matched by HEADER TEXT, not position, so one parser handles every
AMC's layout. Paste as one Colab cell; parse_workbook() and push() are what the
loaders call.

v5 changes one thing over the v4 described in MF_PROJECT_HANDOFF_PART2.md:
BOILER now catches objective lines, so the scheme name is read correctly for
the ~19 schemes that were carrying an objective sentence or a sheet code
instead of a name (Quant 7, Tata 6, Motilal 4, SBI 2). Those were previously
patched through scheme_alias, which fixed the mapping but left the ugly string
showing everywhere the AMC's own name is displayed.

Re-parse and re-push Quant, Tata, Motilal and SBI to pick this up. Everything
else is unchanged, so other AMCs do not need reloading.
"""

# !pip -q install requests pandas openpyxl xlrd supabase

import io, re, requests, pandas as pd

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
SKIP_RE = re.compile(r"^(sub\s*total|total|grand\s*total|net\s*assets\s*$|notes?\s*:|less\s*:)", re.I)
STOP_RE = re.compile(r"^(grand\s*total|hedging position|other than hedging|"
                     r"derivative (disclosure|position)|disclosure regarding derivative|"
                     r"total exposure|notes?\s*:|riskometer|portfolio classification|"
                     r"navs? per unit|dividend history|bonus history)", re.I)

# TOP-LEVEL banners only. "Government Securities" is a sub-heading inside
# DEBT INSTRUMENTS -- matching it here flattens the hierarchy.
SECTION_RE = re.compile(r"^(equity\s*[&a]|equity shares|equity related|debt instrument|"
                        r"money market|others?\s*$|derivativ|units? issued|foreign securit|"
                        r"mutual fund unit|cash\s*[&a]|gold\s*$|silver\s*$|treps|reits|invits)", re.I)

# A row with a value but no ISIN/quantity is usually a heading carrying a
# sub-total. Default is KEEP; only drop when the label reads as a heading.
HEADING_RE = re.compile(
    r"^(equity|debt|money market|others?\b|derivativ|units? issued|foreign|gold\b|silver\b|"
    r"mutual fund unit|reits?\b|invits?\b|cash\s*&|listed|unlisted|privately|securiti[sz]|"
    r"\(?[a-z]\)\s|commercial paper|certificate of deposit|treasury bill|"
    r"government securit|state government|central government|non[- ]convertible|"
    r"zero coupon|strips\b|bills re|alternative investment|preference share|"
    r"equity share|exchange traded fund|^bond|corporate debt|floating rate note|"
    r"fixed deposit|term deposit|units? of|^cds?$|^cp$|^deposits?\b|"
    r"^t[- ]?bills?|^ncds?$|^psu\b|^ptc\b|.*\btotals?\s*$)", re.I)

# Real holdings that legitimately carry no ISIN.
KEEP_NO_ISIN = re.compile(r"treps|tri-?party|reverse repo|net current asset|net receivable|"
                          r"net payable|cash\s*(&|and)|margin|deposit|corporate debt repo|net asset", re.I)

# Text that must never be mistaken for a scheme name.
#
# The last alternation is the v5 addition. Several AMCs put the scheme's
# investment objective on the row below the name, and it reads enough like a
# fund name to win: "Multi Cap Fund - An open ended equity scheme investing
# across large cap, mid cap, small cap stocks" was what Quant's schemes were
# being called. Tata writes "Investment in equity and equity related
# instruments comprised in ..." and "TRSF-CONSERVATIVE PLAN: * ...".
BOILER = re.compile(r"portfolio statement|figures as on|as on\s*:|back to index|registered office|"
                    r"^cin\b|e-?mail|asset management company|investment manager|^index$|"
                    r"disclosure|^notes?\b|mutual fund$|^scheme name|fund size|"
                    r"^an?\s+(open|close|closed)[\s\-]*end|^an?\s+open-?\s*end|"
                    r"risk-?o-?meter|riskometer|product is suitable|investors should|"
                    r"suitable for investors|please consult|^\s*[•·▪◦]|"
                    r"^investment in (equity|debt|securities)|^trsf|^an open ended|"
                    r"^this product|^the scheme", re.I)

LOOKS_FUND = re.compile(r"\b(fund|etf|scheme|plan|yojana|series|fof|fmp|elss|saver|index|"
                        r"advantage|opportunit|savings)\b", re.I)

DATE_RE = re.compile(r"(\d{1,2}[-/\s][A-Za-z]{3,9}[-/,\s]{1,2}\d{2,4}"
                     r"|[A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4}"
                     r"|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}-\d{2}-\d{2})")

FIELDS = [("isin", r"^\s*isin"),
          ("instrument_name", r"name of\s+(the\s+)?instrument|company\s*/\s*issuer|instrument\s*/\s*issuer"),
          ("coupon_pct", r"^\s*coupon"),
          ("industry_rating", r"industry|rating"),
          ("quantity", r"^\s*quantity|^\s*qty"),
          ("market_value_lacs", r"market\s*/?\s*fair\s*value|market\s*value|exposure/?market|mkt\.?\s*val"),
          ("pct_to_nav", r"%\s*to\s*(nav|aum|net\s*assets)"),
          ("yield_pct", r"^\s*(yield|ytm)")]
NUMERIC = ["coupon_pct", "quantity", "market_value_lacs", "pct_to_nav", "yield_pct"]

_norm = lambda v: re.sub(r"\s+", " ", str(v)).strip().lower()

def _num(v):
    if v is None or (isinstance(v, float) and pd.isna(v)): return None
    return pd.to_numeric(str(v).replace(",", "").replace("%", "").strip(), errors="coerce")

def _map_columns(row):
    cells = {c: _norm(v) for c, v in enumerate(row) if pd.notna(v)}
    colmap, taken = {}, set()
    for field, pat in FIELDS:
        for c in sorted(cells):
            if c in taken or field in colmap: continue
            if re.search(pat, cells[c]): colmap[field] = c; taken.add(c)
    return colmap

def _clean(t):
    t = re.sub(r"\s+", " ", str(t)).strip()
    return re.sub(r"\s*\((?=.{25,}).*", "", t).strip()

def _clean_name(t):
    t = re.sub(r"^portfolio of\s*", "", str(t), flags=re.I)
    t = re.sub(r"\s+as on\s+.*$", "", t, flags=re.I)
    t = re.sub(r"\s*-\s*an?\s+(open|close|closed)[\s\-]*end.*$", "", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip()

def parse_sheet(d, sheet=""):
    hdr = colmap = None
    for i in range(min(30, len(d))):
        cm = _map_columns(d.iloc[i].values)
        if {"isin", "instrument_name", "pct_to_nav"} <= set(cm): hdr, colmap = i, cm; break
    if hdr is None: return pd.DataFrame()

    c_name, c_pct = colmap["instrument_name"], colmap["pct_to_nav"]
    c_mv = colmap.get("market_value_lacs")
    c_isin, c_qty = colmap["isin"], colmap.get("quantity")

    scheme, cands = None, []
    for i in range(hdr):
        for v in d.iloc[i].values:
            if pd.isna(v): continue
            t = _clean(v)
            if 6 < len(t) < 160 and not BOILER.search(t):
                cands.append(t)
                if LOOKS_FUND.search(t): scheme = t
    scheme = _clean_name(scheme or (max(cands, key=len) if cands else sheet))

    as_on = None
    for i in range(min(hdr + 1, len(d))):
        # merged cells repeat a row's text; collapse before matching or a greedy
        # capture grabs "30-Jun-2026 Portfolio"
        t = " | ".join(dict.fromkeys(str(v) for v in d.iloc[i].values if pd.notna(v)))
        if not re.search(r"as on|as at|figures as|period ended|month ended|as of", t, re.I): continue
        for m in DATE_RE.finditer(t):
            raw = re.sub(r",(?=\S)", ", ", m.group(1).strip())
            as_on = pd.to_datetime(raw, dayfirst=bool(re.match(r"^\d{1,2}[-/]", raw)), errors="coerce")
            if pd.notna(as_on) and as_on.year > 1990: break
            as_on = None
        if as_on is not None: break

    rows, section, sub = [], None, None
    for i in range(hdr + 1, len(d)):
        r = d.iloc[i]
        name = r.iloc[c_name] if c_name < len(r) else None
        pct = r.iloc[c_pct] if c_pct < len(r) else None
        mv = r.iloc[c_mv] if c_mv is not None and c_mv < len(r) else None
        has_val = pd.notna(pct) or pd.notna(mv)
        label = "" if pd.isna(name) else re.sub(r"\s+", " ", str(name)).strip()

        iv = r.iloc[c_isin] if c_isin < len(r) else None
        has_isin = pd.notna(iv) and bool(ISIN_RE.match(str(iv).strip().upper()))
        has_qty = c_qty is not None and c_qty < len(r) and pd.notna(r.iloc[c_qty])

        # HDFC/Nippon/Kotak write headings in a column other than the name one.
        # ISINs are skipped so Motilal's blank-name rows keep a NULL name.
        if not label and not has_val:
            for v in r.values:
                if pd.notna(v) and isinstance(v, str) and len(str(v).strip()) > 2:
                    cand = re.sub(r"\s+", " ", str(v)).strip()
                    if not ISIN_RE.match(cand.upper()):
                        label = cand
                    break

        if label and STOP_RE.match(label): break
        if label and SKIP_RE.match(label): continue
        if label and not has_val:
            if SECTION_RE.match(label): section, sub = label, None
            else: sub = label
            continue
        if (has_val and not has_isin and not has_qty and label
                and HEADING_RE.match(label) and not KEEP_NO_ISIN.search(label)):
            if SECTION_RE.match(label): section, sub = label, None
            else: sub = label
            continue
        if not has_val or not (label or has_isin): continue

        rec = {f: (r.iloc[c] if c < len(r) else None) for f, c in colmap.items()}
        rec["instrument_name"] = re.sub(r"[£^#*@~+\s]+$", "", label).strip() or None
        rec.update(section=section, sub_section=sub, sheet=sheet,
                   scheme_name=scheme, portfolio_date=as_on)
        rows.append(rec)

    if not rows: return pd.DataFrame()
    h = pd.DataFrame(rows)
    h["isin"] = h["isin"].astype(str).str.strip().str.upper()
    h.loc[~h["isin"].str.match(ISIN_RE, na=False), "isin"] = None
    for c in NUMERIC: h[c] = h[c].map(_num) if c in h.columns else None
    h["is_security"] = h["isin"].notna()
    return h

def parse_workbook(src, amc="", frequency="", source=""):
    xl, frames = pd.ExcelFile(src), []
    for sh in xl.sheet_names:
        if _norm(sh) in {"index", "notes", "disclaimer", "contents"}: continue
        try: d = xl.parse(sh, header=None)
        except Exception: continue
        h = parse_sheet(d, sheet=sh)
        if not h.empty: frames.append(h)
    if not frames: return pd.DataFrame()
    out = pd.concat(frames, ignore_index=True)
    # Some AMCs write 9.18, others 0.0918. Decide once per FILE from the median
    # scheme total -- arbitrage funds legitimately exceed 100, so per-scheme
    # detection misfires. Get this wrong and every number is 100x off silently.
    med = out.groupby("scheme_name")["pct_to_nav"].sum().median()
    if pd.notna(med) and 0.5 < med < 1.6: out["pct_to_nav"] *= 100
    out.insert(0, "amc", amc)
    out["frequency"], out["source_file"] = frequency, source
    return out


# ============================================================================
# Verification -- run this before pushing, every time
# ============================================================================
def verify(df, label=""):
    n_sch = df["scheme_name"].nunique()
    sums = df.groupby("scheme_name")["pct_to_nav"].sum()
    ok = sums.between(98, 102).sum()
    bad_dates = df["portfolio_date"].isna().sum()
    ugly = [s for s in df["scheme_name"].unique()
            if len(str(s)) > 90 or re.match(r"^[A-Z]{2,}\d|^[A-Z]{5,}$", str(s))]
    print(f"{label or df['amc'].iloc[0]}")
    print(f"  rows            {len(df):,}")
    print(f"  schemes         {n_sch}")
    print(f"  %NAV sums to 100 {ok}/{n_sch}")
    print(f"  NULL dates      {bad_dates}")
    print(f"  suspect names   {len(ugly)}")
    for s in ugly[:8]: print(f"      {str(s)[:100]}")
    return ok, n_sch


# ============================================================================
# Push -- delete-then-insert per (amc, portfolio_date, frequency)
# ============================================================================
def make_push(sb):
    import json
    COLS = ["amc", "scheme_name", "sheet_code", "portfolio_date", "frequency", "section",
            "sub_section", "instrument_name", "isin", "industry_rating", "coupon_pct",
            "quantity", "market_value_lacs", "pct_to_nav", "yield_pct", "is_security",
            "needs_review", "source_file"]

    def push(df):
        # groupby drops NaN keys, so a NULL date would insert zero rows and
        # report no error at all. Assert before touching the database.
        n = df["portfolio_date"].isna().sum()
        assert n == 0, f"{n} rows have NULL portfolio_date"

        up = df.copy().rename(columns={"sheet": "sheet_code"})
        s = up.groupby(["amc", "scheme_name"])["pct_to_nav"].transform("sum")
        up["needs_review"] = ~s.between(98, 102)     # arbitrage/hybrid: flag, never drop
        up["portfolio_date"] = pd.to_datetime(up["portfolio_date"]).dt.strftime("%Y-%m-%d")
        for c in COLS:
            if c not in up.columns: up[c] = None
        up = up[COLS]

        for key, g in up.groupby(["amc", "portfolio_date", "frequency"]):
            amc, dt_, freq = key
            sb.table("mf_holdings").delete() \
              .eq("amc", amc).eq("portfolio_date", dt_).eq("frequency", freq).execute()
            rows = json.loads(g.to_json(orient="records"))   # NaN->null, numpy->native
            for i in range(0, len(rows), 500):
                sb.table("mf_holdings").insert(rows[i:i + 500]).execute()
            print(f"  {amc:8s} {dt_} {freq:12s} {len(rows):6,} rows")
    return push
