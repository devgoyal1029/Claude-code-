/**
 * Forecast assumptions — driver metadata, "Teach me" content (from the research),
 * historical anchors, and soft (educational) validation. PURE, no DOM.
 *
 * Percentage drivers are stored as DECIMALS (0.065 = 6.5%); the UI shows percent.
 * Days drivers (DSO/DIO/DPO) and absolute drivers (₹ borrowings) are plain numbers.
 */

const fy = (p) => { const m = String(p).match(/(\d{4})/); return m ? +m[1] : 0; };
const num = (x) => (x == null || Number.isNaN(Number(x)) ? null : Number(x));
const getv = (values, k, y) => (values[k] ? num(values[k][y]) : null);

// type: pct | days | abs
export const DRIVERS = [
  { key: "revenue_growth_pct", label: "Revenue growth", type: "pct",
    what: "How fast you expect sales to grow next year, in %.",
    where: "Your own 5-year revenue trend (the comparative screen) is the anchor. Then read the MD&A (Management Discussion & Analysis) for industry outlook, order book, capacity expansion and new launches. Cross-check with the sector and a peer or two.",
    how: "Start from the historical growth (CAGR), then nudge up/down for management guidance and how the industry is doing. Better: think volume × price, or by segment, not one blanket number.",
    validate: "Keep within a sane band of history and industry. If it's far above the company's own record (≈ more than 2× its historical growth), have a concrete reason — and find it in the MD&A." },
  { key: "cogs_pct_of_revenue", label: "COGS % of revenue", type: "pct",
    what: "Cost of goods sold as a % of revenue (the inverse of gross margin).",
    where: "Historical gross-margin trend (your common-size screen). MD&A comments on raw-material/input costs, pricing power and commodity cycles.",
    how: "Anchor on the historical margin; adjust only for specific cost pressure or efficiency management mentions.",
    validate: "Stay within the historical range unless there's a clear reason. Margins rarely improve permanently without a driver." },
  { key: "opex_pct_of_revenue", label: "Opex % of revenue", type: "pct",
    what: "Operating expenses (employee, selling, admin) as a % of revenue.",
    where: "Historical opex-to-sales. MD&A on cost initiatives, operating leverage, and expansion (new stores/plants raise costs).",
    how: "Set as % of revenue; split fixed vs variable if you can. A launch or expansion may temporarily raise it.",
    validate: "Don't drift the margin unrealistically above the best year in history." },
  { key: "depreciation_pct", label: "Depreciation % of PP&E", type: "pct",
    what: "Depreciation as a % of opening property, plant & equipment.",
    where: "The fixed-asset note in the annual report (depreciation ÷ gross block / PP&E). More capex → more future depreciation.",
    how: "Use the historical % of PP&E, or drive it off the asset schedule.",
    validate: "Stay close to the historical rate." },
  { key: "capex_pct_of_revenue", label: "Capex % of revenue", type: "pct",
    what: "Capital expenditure (new plants/equipment) as a % of revenue.",
    where: "The cash flow statement (historical capex). MD&A / chairman's letter often state expansion plans in ₹ Cr.",
    how: "Use management's stated capex plans if given; otherwise the historical capex intensity.",
    validate: "Flag if you ignore a stated big expansion, or assume capex far above history with no reason." },
  { key: "dso", label: "Receivable days (DSO)", type: "days",
    what: "Days Sales Outstanding — how many days customers take to pay. Receivables ÷ Revenue × 365.",
    where: "Computed from the historical balance sheet + P&L. MD&A may mention credit/collection policy changes.",
    how: "Use the historical average; hold steady unless there's a reason to change.",
    validate: "If receivables grow faster than sales, that's a warning sign — collections may be slowing." },
  { key: "dio", label: "Inventory days (DIO)", type: "days",
    what: "Days Inventory Outstanding — how long stock sits before it sells. Inventory ÷ COGS × 365.",
    where: "Historical balance sheet + P&L. MD&A on inventory/supply changes.",
    how: "Use the historical average.",
    validate: "A rising number can signal a working-capital build-up." },
  { key: "dpo", label: "Payable days (DPO)", type: "days",
    what: "Days Payable Outstanding — how long the company takes to pay suppliers. Payables ÷ COGS × 365.",
    where: "Historical balance sheet + P&L.",
    how: "Use the historical average.",
    validate: "Big swings change cash flow — keep it believable." },
  { key: "tax_rate", label: "Effective tax rate", type: "pct",
    what: "Effective tax rate = Tax ÷ Profit Before Tax.",
    where: "Historical effective rate. India's statutory corporate rate (~25%) is a sanity check.",
    how: "Use the historical effective rate; sanity-check against statutory.",
    validate: "Should be a believable band — not negative, not absurd." },
  { key: "interest_rate", label: "Interest rate on debt", type: "pct",
    what: "Interest rate paid on debt = Interest expense ÷ average debt.",
    where: "Historical interest ÷ debt. The debt schedule / borrowing plans in the annual report.",
    how: "Apply the rate to the OPENING debt balance (this avoids a circular calculation).",
    validate: "Keep near the historical effective rate." },
  { key: "dividend_payout_ratio", label: "Dividend payout", type: "pct",
    what: "Share of net profit paid out as dividends = Dividend ÷ Net profit.",
    where: "Historical dividend ÷ net profit. Some Indian companies state a formal dividend policy in the AR.",
    how: "Use the historical payout trend.",
    validate: "Payout above 100% of profit is unusual — double-check." },
  { key: "new_borrowing", label: "New borrowing (₹)", type: "abs",
    what: "New debt you expect the company to raise in the year (same units as the statements).",
    where: "The annual report's borrowing plans / debt schedule, and capex funding needs.",
    how: "Usually 0 unless there's a stated borrowing or a big capex to fund.",
    validate: "—" },
  { key: "repayment", label: "Debt repayment (₹)", type: "abs",
    what: "Debt the company repays during the year (same units as the statements).",
    where: "The debt schedule / repayment commitments in the AR.",
    how: "Use the scheduled repayments if stated; else 0.",
    validate: "—" },
];

/** Historical anchors used to softly validate assumptions. */
export function anchors(hist) {
  const ys = [...(hist.periods || [])].sort((a, b) => fy(a) - fy(b));
  const v = hist.values || {};
  const last = ys[ys.length - 1];
  const rev = ys.map((y) => getv(v, "revenue", y)).filter((x) => x != null);
  const n = rev.length;
  const cagr = (n >= 2 && rev[0] > 0) ? Math.pow(rev[n - 1] / rev[0], 1 / (n - 1)) - 1 : null;
  const ratio = (numK, denK) => ys.map((y) => {
    const a = getv(v, numK, y), b = getv(v, denK, y);
    return (b && a != null && b !== 0) ? a / b : null;
  }).filter((x) => x != null);
  const cogs = ratio("cogs", "revenue"), opex = ratio("operating_expenses", "revenue");
  const days = (numK, denK) => {
    const a = getv(v, numK, last), b = getv(v, denK, last);
    return (b && a != null && b !== 0) ? a / b * 365 : null;
  };
  const ebt = getv(v, "ebt", last), tax = getv(v, "tax", last);
  return {
    cagr,
    cogsMin: cogs.length ? Math.min(...cogs) : null,
    cogsMax: cogs.length ? Math.max(...cogs) : null,
    opexMin: opex.length ? Math.min(...opex) : null,
    dsoH: days("accounts_receivable", "revenue"),
    dioH: days("inventory", "cogs"),
    dpoH: days("accounts_payable", "cogs"),
    taxH: (ebt > 0 && tax != null) ? tax / ebt : null,
  };
}

const warn = (msg) => ({ status: "warn", msg });

/** Soft, educational validation for one driver value (decimal for pct). */
export function validateAssumption(key, value, A) {
  const v = Number(value);
  if (Number.isNaN(v)) return null;
  switch (key) {
    case "revenue_growth_pct":
      if (A.cagr != null) {
        const cap = Math.max(A.cagr * 2, A.cagr + 0.15);
        if (v > cap && v > 0.2)
          return warn(`Well above the company's historical growth (~${(A.cagr * 100).toFixed(1)}% CAGR). Make sure you have a reason (capacity expansion, new product) — check the MD&A.`);
        if (v < -0.1 && A.cagr > 0.02)
          return warn(`You're assuming a decline while history shows ~${(A.cagr * 100).toFixed(1)}% growth. Have a specific reason.`);
      }
      return null;
    case "cogs_pct_of_revenue":
      if (A.cogsMin != null && v < A.cogsMin - 0.03)
        return warn("Implies a gross margin above the best in the company's history. Margins rarely improve that much without a specific driver.");
      return null;
    case "opex_pct_of_revenue":
      if (A.opexMin != null && v < A.opexMin - 0.03)
        return warn("Opex this low pushes margins above history — double-check there's a real efficiency driver.");
      return null;
    case "tax_rate":
      if (v < 0 || v > 0.5) return warn("Effective tax rate looks off (India statutory ~25%). Keep it in a believable band.");
      return null;
    case "dividend_payout_ratio":
      if (v < 0) return warn("Payout can't be negative.");
      if (v > 1) return warn("Payout above 100% of profit is unusual — double-check.");
      return null;
    case "interest_rate":
      if (v < 0 || v > 0.3) return warn("Interest rate looks unusual — keep near the historical effective rate.");
      return null;
    case "dso":
      if (A.dsoH != null && v > A.dsoH * 1.15)
        return warn(`Higher than history (~${A.dsoH.toFixed(0)} days) — implies receivables growing faster than sales (slower collections).`);
      return null;
    case "dio":
      if (A.dioH != null && v > A.dioH * 1.2)
        return warn(`Higher than history (~${A.dioH.toFixed(0)} days) — possible inventory build-up.`);
      return null;
    case "dpo":
      if (v < 0) return warn("Payable days can't be negative.");
      return null;
    default:
      return null;
  }
}
