"""
Reliance Industries stock dashboard — Flask backend.

Fetches live data from Yahoo Finance via yfinance and exposes one JSON
endpoint per dashboard section. Every yfinance call is wrapped so a failure
returns {"error": "..."} instead of crashing the request.

Run:
    pip install -r requirements.txt
    python app.py
    open http://127.0.0.1:5000
"""

import math
import datetime as _dt

from flask import Flask, jsonify, render_template
from flask_cors import CORS
import pandas as pd
import yfinance as yf

TICKER = "RELIANCE.NS"

app = Flask(__name__)
CORS(app)

# Reuse a single Ticker object; yfinance caches network responses on it.
_stock = yf.Ticker(TICKER)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def clean(value):
    """Make any pandas/numpy/native value JSON-safe.

    NaN/NaT/inf -> None, numpy scalars -> native, Timestamps -> ISO strings.
    """
    if value is None:
        return None
    # pandas NaT / numpy nan
    try:
        if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, (pd.Timestamp, _dt.datetime, _dt.date)):
        try:
            return value.isoformat()
        except Exception:
            return str(value)
    if value is pd.NaT:
        return None
    # numpy scalar -> python scalar
    if hasattr(value, "item"):
        try:
            v = value.item()
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                return None
            return v
        except Exception:
            pass
    if isinstance(value, float) and pd.isna(value):
        return None
    return value


# yfinance returns statement rows in an arbitrary/near-reversed order. These
# templates put them back into conventional top-down statement structure. Any
# row not listed here is appended (in yfinance's order) after the known rows.
INCOME_ORDER = [
    "Total Revenue", "Operating Revenue", "Cost Of Revenue",
    "Reconciled Cost Of Revenue", "Gross Profit", "Operating Expense",
    "Selling General And Administration", "Selling And Marketing Expense",
    "General And Administrative Expense", "Rent And Landing Fees",
    "Other Operating Expenses", "Operating Income", "EBITDA",
    "Normalized EBITDA", "Reconciled Depreciation", "EBIT",
    "Net Interest Income", "Interest Income", "Interest Expense",
    "Interest Income Non Operating", "Interest Expense Non Operating",
    "Net Non Operating Interest Income Expense", "Total Other Finance Cost",
    "Other Non Operating Income Expenses", "Special Income Charges",
    "Other Special Charges", "Write Off", "Total Unusual Items",
    "Total Unusual Items Excluding Goodwill", "Pretax Income", "Tax Provision",
    "Tax Rate For Calcs", "Tax Effect Of Unusual Items",
    "Net Income Continuous Operations", "Net Income Discontinuous Operations",
    "Net Income Including Noncontrolling Interests", "Minority Interests",
    "Net Income From Continuing Operation Net Minority Interest",
    "Net Income From Continuing And Discontinued Operation", "Net Income",
    "Otherunder Preferred Stock Dividend", "Net Income Common Stockholders",
    "Diluted NI Availto Com Stockholders", "Normalized Income",
    "Total Expenses", "Basic EPS", "Diluted EPS", "Basic Average Shares",
    "Diluted Average Shares", "Rent Expense Supplemental",
]
BALANCE_ORDER = [
    "Total Assets", "Total Non Current Assets", "Net PPE", "Gross PPE",
    "Accumulated Depreciation", "Properties", "Land And Improvements",
    "Buildings And Improvements", "Machinery Furniture Equipment",
    "Other Properties", "Construction In Progress",
    "Goodwill And Other Intangible Assets", "Goodwill",
    "Other Intangible Assets", "Investmentin Financial Assets",
    "Long Term Equity Investment", "Investmentsin Associatesat Cost",
    "Investmentsin Joint Venturesat Cost",
    "Financial Assets Designatedas Fair Value Through Profitor Loss Total",
    "Available For Sale Securities", "Non Current Deferred Taxes Assets",
    "Non Current Prepaid Assets", "Other Non Current Assets", "Current Assets",
    "Cash Cash Equivalents And Short Term Investments",
    "Cash And Cash Equivalents", "Cash Equivalents", "Cash Financial",
    "Other Short Term Investments", "Accounts Receivable", "Other Receivables",
    "Inventory", "Raw Materials", "Work In Process", "Finished Goods",
    "Other Inventories", "Prepaid Assets", "Restricted Cash",
    "Other Current Assets", "Total Liabilities Net Minority Interest",
    "Total Non Current Liabilities Net Minority Interest",
    "Long Term Debt And Capital Lease Obligation", "Long Term Debt",
    "Long Term Capital Lease Obligation", "Long Term Provisions",
    "Non Current Deferred Taxes Liabilities",
    "Tradeand Other Payables Non Current", "Other Non Current Liabilities",
    "Current Liabilities", "Current Debt And Capital Lease Obligation",
    "Current Debt", "Current Capital Lease Obligation", "Current Provisions",
    "Payables", "Accounts Payable", "Dividends Payable", "Other Payable",
    "Other Current Liabilities", "Total Equity Gross Minority Interest",
    "Stockholders Equity", "Common Stock Equity", "Capital Stock",
    "Common Stock", "Additional Paid In Capital", "Retained Earnings",
    "Other Equity Interest", "Minority Interest", "Total Capitalization",
    "Total Debt", "Net Debt", "Capital Lease Obligations", "Working Capital",
    "Invested Capital", "Tangible Book Value", "Net Tangible Assets",
    "Share Issued", "Ordinary Shares Number",
]
CASHFLOW_ORDER = [
    "Operating Cash Flow", "Net Income From Continuing Operations",
    "Depreciation And Amortization", "Depreciation", "Deferred Tax",
    "Provisionand Write Offof Assets", "Other Non Cash Items",
    "Gain Loss On Investment Securities", "Gain Loss On Sale Of PPE",
    "Gain Loss On Sale Of Business", "Net Foreign Currency Exchange Gain Loss",
    "Change In Working Capital", "Change In Receivables", "Change In Inventory",
    "Change In Payable", "Taxes Refund Paid", "Investing Cash Flow",
    "Capital Expenditure", "Capital Expenditure Reported", "Purchase Of PPE",
    "Sale Of PPE", "Net PPE Purchase And Sale", "Purchase Of Investment",
    "Sale Of Investment", "Net Investment Purchase And Sale",
    "Dividends Received Cfi", "Interest Received Cfi",
    "Net Other Investing Changes", "Financing Cash Flow",
    "Long Term Debt Issuance", "Long Term Debt Payments",
    "Net Long Term Debt Issuance", "Net Short Term Debt Issuance",
    "Net Issuance Payments Of Debt", "Issuance Of Debt", "Repayment Of Debt",
    "Common Stock Issuance", "Net Common Stock Issuance",
    "Issuance Of Capital Stock", "Cash Dividends Paid", "Interest Paid Cff",
    "Net Other Financing Charges", "Changes In Cash",
    "Other Cash Adjustment Outside Changein Cash", "Beginning Cash Position",
    "End Cash Position", "Free Cash Flow",
]


def classify_unit(label):
    """Return the display unit for a statement row so the frontend formats it
    correctly: money in Crore, EPS per share, tax rate as a %, share counts.
    """
    l = label.lower()
    if "eps" in l:
        return "pershare"
    if "tax rate" in l:
        return "ratio"
    if "shares number" in l or "average shares" in l or l == "share issued":
        return "shares"
    return "cr"


def dataframe_to_table(df, order=None):
    """Convert a statement-style DataFrame (rows=line items, cols=dates) into
    a JSON-friendly dict: {columns: [...], rows: [{label, unit, values: [...]}]}.

    Rows are reordered into conventional statement structure per ``order`` and
    each row is tagged with a display ``unit`` (cr / pershare / ratio / shares).
    """
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return {"error": "No data available from Yahoo Finance."}

    # Reorder into conventional structure: known rows first, then the rest.
    if order:
        known = [x for x in order if x in df.index]
        rest = [x for x in df.index if x not in known]
        df = df.reindex(known + rest)

    # Columns are usually Timestamps (period end dates). Format as YYYY-MM-DD.
    columns = []
    for col in df.columns:
        if isinstance(col, (pd.Timestamp, _dt.datetime, _dt.date)):
            columns.append(col.strftime("%Y-%m-%d"))
        else:
            columns.append(str(col))

    rows = []
    for label, series in df.iterrows():
        rows.append(
            {
                "label": str(label),
                "unit": classify_unit(str(label)),
                "values": [clean(v) for v in series.tolist()],
            }
        )
    return {"columns": columns, "rows": rows}


def records_from_df(df, index_name="date"):
    """Convert a DataFrame to a list of row dicts, index -> index_name column."""
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return []
    out = []
    for idx, row in df.iterrows():
        rec = {index_name: clean(idx)}
        for col in df.columns:
            rec[str(col)] = clean(row[col])
        out.append(rec)
    return out


def safe(fn):
    """Run a data-fetching function, converting any exception into an
    {"error": ...} JSON response so the frontend degrades gracefully.
    """
    try:
        return jsonify(fn())
    except Exception as exc:  # noqa: BLE001 - deliberately broad
        return jsonify({"error": f"{type(exc).__name__}: {exc}"}), 200


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    return render_template("index.html", ticker=TICKER)


@app.route("/api/profile")
def api_profile():
    def build():
        info = _stock.info or {}

        def g(*keys):
            for k in keys:
                if k in info and info[k] not in (None, "", "Infinity"):
                    return clean(info[k])
            return None

        return {
            "ticker": TICKER,
            "longName": g("longName", "shortName"),
            "sector": g("sector"),
            "industry": g("industry"),
            "website": g("website"),
            "summary": g("longBusinessSummary"),
            "currency": g("currency") or "INR",
            "exchange": "NSE" if g("exchange") == "NSI" else g("exchange", "fullExchangeName"),
            "marketCap": g("marketCap"),
            "currentPrice": g("currentPrice", "regularMarketPrice"),
            "previousClose": g("previousClose", "regularMarketPreviousClose"),
            "open": g("open", "regularMarketOpen"),
            "dayHigh": g("dayHigh", "regularMarketDayHigh"),
            "dayLow": g("dayLow", "regularMarketDayLow"),
            "fiftyTwoWeekHigh": g("fiftyTwoWeekHigh"),
            "fiftyTwoWeekLow": g("fiftyTwoWeekLow"),
            "trailingPE": g("trailingPE"),
            "forwardPE": g("forwardPE"),
            "trailingEps": g("trailingEps"),
            "dividendYield": g("dividendYield"),
            "beta": g("beta"),
            "volume": g("volume", "regularMarketVolume"),
            "averageVolume": g("averageVolume"),
        }

    return safe(build)


@app.route("/api/history")
def api_history():
    def build():
        hist = _stock.history(period="max", auto_adjust=False)
        if hist is None or hist.empty:
            return {"error": "No price history available."}
        hist = hist.reset_index()
        # Normalise the date column name (can be 'Date' or 'Datetime').
        date_col = "Date" if "Date" in hist.columns else hist.columns[0]
        out = []
        for _, r in hist.iterrows():
            d = r[date_col]
            out.append(
                {
                    "date": d.strftime("%Y-%m-%d")
                    if isinstance(d, (pd.Timestamp, _dt.datetime, _dt.date))
                    else str(d),
                    "open": clean(r.get("Open")),
                    "high": clean(r.get("High")),
                    "low": clean(r.get("Low")),
                    "close": clean(r.get("Close")),
                    "volume": clean(r.get("Volume")),
                }
            )
        return {"ticker": TICKER, "prices": out}

    return safe(build)


@app.route("/api/income")
def api_income():
    return safe(lambda: dataframe_to_table(_stock.income_stmt, INCOME_ORDER))


@app.route("/api/balance")
def api_balance():
    return safe(lambda: dataframe_to_table(_stock.balance_sheet, BALANCE_ORDER))


@app.route("/api/cashflow")
def api_cashflow():
    return safe(lambda: dataframe_to_table(_stock.cashflow, CASHFLOW_ORDER))


@app.route("/api/ratios")
def api_ratios():
    def build():
        info = _stock.info or {}
        inc = _stock.income_stmt
        bal = _stock.balance_sheet

        def latest(df, *labels):
            """Most recent value for the first matching row label."""
            if df is None or not isinstance(df, pd.DataFrame) or df.empty:
                return None
            for lbl in labels:
                if lbl in df.index:
                    series = df.loc[lbl].dropna()
                    if not series.empty:
                        return float(series.iloc[0])
            return None

        net_income = latest(inc, "Net Income", "Net Income Common Stockholders")
        total_revenue = latest(inc, "Total Revenue", "Operating Revenue")
        operating_income = latest(inc, "Operating Income", "EBIT")
        ebit = latest(inc, "EBIT", "Operating Income")

        total_equity = latest(
            bal, "Stockholders Equity", "Total Stockholder Equity",
            "Common Stock Equity",
        )
        total_assets = latest(bal, "Total Assets")
        current_liab = latest(bal, "Current Liabilities", "Total Current Liabilities")
        current_assets = latest(bal, "Current Assets", "Total Current Assets")
        total_debt = latest(bal, "Total Debt")
        if total_debt is None:
            ltd = latest(bal, "Long Term Debt") or 0.0
            std = latest(bal, "Current Debt", "Short Term Debt") or 0.0
            total_debt = (ltd + std) or None

        def div(a, b):
            if a is None or b is None or b == 0:
                return None
            return a / b

        roce = None
        if ebit is not None and total_assets is not None and current_liab is not None:
            denom = total_assets - current_liab
            roce = div(ebit, denom)
            if roce is not None:
                roce *= 100

        ratios = {
            "P/E (trailing)": clean(info.get("trailingPE")),
            "P/B": clean(info.get("priceToBook")),
            "ROE %": (div(net_income, total_equity) * 100)
            if div(net_income, total_equity) is not None else None,
            "ROCE %": roce,
            "Debt / Equity": div(total_debt, total_equity),
            "Current Ratio": div(current_assets, current_liab),
            "Net Profit Margin %": (div(net_income, total_revenue) * 100)
            if div(net_income, total_revenue) is not None else None,
            "Operating Margin %": (div(operating_income, total_revenue) * 100)
            if div(operating_income, total_revenue) is not None else None,
            "EPS (trailing)": clean(info.get("trailingEps")),
        }
        # Round floats for presentation.
        ratios = {
            k: (round(v, 2) if isinstance(v, float) else v)
            for k, v in ratios.items()
        }
        return {"ratios": ratios}

    return safe(build)


@app.route("/api/shareholding")
def api_shareholding():
    def build():
        result = {}
        try:
            mh = _stock.major_holders
            if isinstance(mh, pd.DataFrame) and not mh.empty:
                # Newer yfinance returns a single-column df indexed by metric.
                if mh.shape[1] == 1:
                    col = mh.columns[0]
                    result["major"] = [
                        {"label": str(idx), "value": clean(mh.loc[idx, col])}
                        for idx in mh.index
                    ]
                else:
                    result["major"] = [
                        {"label": clean(r.iloc[1]), "value": clean(r.iloc[0])}
                        for _, r in mh.iterrows()
                    ]
            else:
                result["major"] = []
        except Exception as exc:  # noqa: BLE001
            result["major_error"] = str(exc)

        try:
            ih = _stock.institutional_holders
            result["institutional"] = records_from_df(ih, index_name="row") \
                if isinstance(ih, pd.DataFrame) else []
            # institutional_holders has a default RangeIndex; drop the 'row' key.
            for rec in result.get("institutional", []):
                rec.pop("row", None)
        except Exception as exc:  # noqa: BLE001
            result["institutional_error"] = str(exc)
            result.setdefault("institutional", [])

        return result

    return safe(build)


@app.route("/api/dividends")
def api_dividends():
    def build():
        out = {"dividends": [], "splits": []}
        try:
            div = _stock.dividends
            if isinstance(div, pd.Series) and not div.empty:
                out["dividends"] = [
                    {"date": d.strftime("%Y-%m-%d"), "amount": clean(v)}
                    for d, v in div.items()
                ]
        except Exception as exc:  # noqa: BLE001
            out["dividends_error"] = str(exc)
        try:
            sp = _stock.splits
            if isinstance(sp, pd.Series) and not sp.empty:
                out["splits"] = [
                    {"date": d.strftime("%Y-%m-%d"), "ratio": clean(v)}
                    for d, v in sp.items()
                ]
        except Exception as exc:  # noqa: BLE001
            out["splits_error"] = str(exc)
        return out

    return safe(build)


@app.route("/api/recommendations")
def api_recommendations():
    def build():
        rec = _stock.recommendations
        if not isinstance(rec, pd.DataFrame) or rec.empty:
            return {"recommendations": []}
        return {"recommendations": records_from_df(rec, index_name="index")}

    return safe(build)


@app.route("/api/news")
def api_news():
    def build():
        news = _stock.news or []
        items = []
        for n in news:
            # yfinance has shifted between a flat dict and a nested
            # {"content": {...}} shape; handle both.
            content = n.get("content", n) if isinstance(n, dict) else {}
            title = content.get("title") or n.get("title")
            publisher = (
                content.get("provider", {}).get("displayName")
                if isinstance(content.get("provider"), dict)
                else n.get("publisher")
            )
            link = None
            cu = content.get("canonicalUrl") or content.get("clickThroughUrl")
            if isinstance(cu, dict):
                link = cu.get("url")
            link = link or n.get("link")

            pub_date = content.get("pubDate") or content.get("displayTime")
            if not pub_date and n.get("providerPublishTime"):
                try:
                    pub_date = _dt.datetime.fromtimestamp(
                        n["providerPublishTime"]
                    ).isoformat()
                except Exception:
                    pub_date = None

            if title:
                items.append(
                    {
                        "title": title,
                        "publisher": publisher,
                        "link": link,
                        "date": pub_date,
                    }
                )
        return {"news": items}

    return safe(build)


if __name__ == "__main__":
    # Port 5000 on macOS is often taken by AirPlay Receiver, so default to 5055.
    # Override with:  PORT=8000 python3 app.py
    import os
    # Debug (Werkzeug debugger = remote code execution if ever exposed) is
    # opt-in via FLASK_DEBUG=1, never the default.
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(debug=debug, port=int(os.environ.get("PORT", 5055)))
