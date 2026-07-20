# Reliance Industries — Stock Dashboard

A live stock data dashboard for **Reliance Industries (RELIANCE.NS, NSE)**, built
with a Flask backend that pulls data from Yahoo Finance via `yfinance`, and a
single-file vanilla HTML/CSS/JS frontend that renders it. Styled to match the
InvestVerdict brand (navy + gold, Bebas Neue / DM Sans).

## Features

- **Company header** — name, ticker, live price, day change (green/red), market cap, day & 52-week ranges.
- **Price chart** — Chart.js line chart of closing price with 1M / 6M / 1Y / 5Y / MAX ranges.
- **Company profile** — sector, industry, valuation stats, business summary, website.
- **Financial statements** — Income Statement, Balance Sheet, Cash Flow (annual), full tables in ₹ Crore.
- **Key ratios** — P/E, P/B, ROE, ROCE, Debt/Equity, Current Ratio, margins, EPS (computed from statements + info).
- **Shareholding** — major holders + institutional holders.
- **Dividends & splits** — full history.
- **Analyst recommendations** and **latest news**.

Each section is its own `/api/...` JSON endpoint. Every Yahoo call is wrapped in
try/except and returns `{"error": "..."}` on failure so the UI degrades
gracefully instead of crashing. Missing/NaN fields become `null` and render as `—`.

## Requirements

- Python 3.9+
- Packages in `requirements.txt` (`flask`, `flask-cors`, `yfinance`, `pandas`)

## Run

```bash
cd reliance_dashboard
pip install -r requirements.txt
python3 app.py
```

Then open **http://127.0.0.1:5055** in your browser.

> The app defaults to port **5055** (port 5000 on macOS is usually taken by the
> AirPlay Receiver). To use a different port: `PORT=8000 python3 app.py`.

> **Note:** data is fetched live from Yahoo Finance, so an internet connection is
> required. Yahoo occasionally rate-limits or returns empty fields for some
> metrics — when that happens the affected section shows a `—` or a friendly
> error message rather than failing the whole page.

## API endpoints

| Endpoint | Data |
|---|---|
| `GET /api/profile` | Company profile + quote snapshot |
| `GET /api/history` | Full daily OHLCV price history (`period="max"`) |
| `GET /api/income` | Annual income statement |
| `GET /api/balance` | Annual balance sheet |
| `GET /api/cashflow` | Annual cash flow |
| `GET /api/ratios` | Computed key financial ratios |
| `GET /api/shareholding` | Major + institutional holders |
| `GET /api/dividends` | Dividend & split history |
| `GET /api/recommendations` | Analyst recommendations |
| `GET /api/news` | Latest news headlines |

## Changing the ticker

The ticker is hardcoded near the top of `app.py`:

```python
TICKER = "RELIANCE.NS"
```

Change it to any Yahoo Finance symbol (e.g. `TCS.NS`, `AAPL`) and restart.

## Project layout

```
reliance_dashboard/
├── app.py               # Flask backend + all API endpoints
├── requirements.txt
├── README.md
└── templates/
    └── index.html       # single-file frontend (HTML/CSS/JS)
```
