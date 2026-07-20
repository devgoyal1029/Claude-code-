/**
 * Model selector logic — PURE. The 5 models' metadata + a guided recommender.
 * Recommendation only; the client always chooses freely. Mismatched picks get
 * an educational warning (never a block).
 */

export const MODELS = [
  { key: "dcf", name: "DCF (Cash-Flow)", icon: "💎", href: "/dcf.html", live: true,
    bestFor: "Non-financial companies with predictable cash flows — FMCG, IT, pharma, manufacturing.",
    avoidWhen: "Banks/NBFCs/insurers (debt is their raw material), or pre-revenue / wildly erratic businesses." },
  { key: "ddm", name: "Dividend Discount", icon: "💰", href: "/ddm.html", live: true,
    bestFor: "Mature companies with a steady, meaningful dividend history; a primary method for banks.",
    avoidWhen: "Companies that pay little or no dividend, or whose payout is erratic." },
  { key: "comps", name: "Relative (Comps)", icon: "⚖️", href: "/comps.html", live: true,
    bestFor: "Always useful as a cross-check; primary when cash flows are hard to forecast.",
    avoidWhen: "No genuinely comparable listed peers exist (unique business model)." },
  { key: "bank", name: "Bank / Financials", icon: "🏦", href: "/bank.html", live: true,
    bestFor: "Banks, NBFCs and insurers — valued on the equity side via excess returns and P/B vs ROE.",
    avoidWhen: "Any non-financial company — its logic (book value driven) doesn't apply." },
  { key: "ipo", name: "IPO Valuation", icon: "🚀", href: "/ipo.html", live: true,
    bestFor: "Companies about to list or newly listed — judge whether the price band is reasonable.",
    avoidWhen: "Long-listed companies — use DCF/Comps/DDM directly instead." },
];

/**
 * recommend(answers) -> { recommended: [keys], reasons: {key: why} }
 * answers: { financial: bool|null, ipo: bool|null, dividends: bool|null }
 * Order of precedence mirrors real practice: company TYPE first (bank), then
 * SITUATION (IPO), then PAYOUT (DDM). Comps is always a cross-check.
 */
export function recommend(a = {}) {
  const rec = [], reasons = {};
  if (a.financial) {
    rec.push("bank");
    reasons.bank = "It's a financial company — standard FCFF DCF is invalid (interest is operating, not financing).";
    if (a.dividends) { rec.push("ddm"); reasons.ddm = "Banks with steady dividends are also valued well by DDM."; }
  } else if (a.ipo) {
    rec.push("ipo");
    reasons.ipo = "It's listing now — the question is whether the band is fairly priced vs peers and intrinsic value.";
    rec.push("comps");
    reasons.comps = "IPO pricing is mostly relative — peers are the benchmark.";
  } else {
    rec.push("dcf");
    reasons.dcf = "A non-financial operating company with forecastable cash flows — the classic DCF case.";
    if (a.dividends) { rec.push("ddm"); reasons.ddm = "A steady dividend history also makes DDM meaningful here."; }
  }
  if (!rec.includes("comps")) {
    rec.push("comps");
    reasons.comps = reasons.comps || "Always triangulate an intrinsic value against what the market pays for peers.";
  }
  return { recommended: rec, reasons };
}

/** Educational mismatch warning when the pick conflicts with the answers. */
export function mismatchWarning(modelKey, a = {}) {
  if (modelKey === "dcf" && a.financial)
    return "You picked DCF for a financial company. Standard FCFF DCF breaks for banks: interest is their operating cost, debt is raw material, and capex/working-capital are meaningless. Professionals value banks with the Excess-Return model, DDM and P/B-vs-ROE — try the Bank/Financials model.";
  if (modelKey === "ddm" && a.dividends === false)
    return "You picked DDM for a company that doesn't pay steady dividends. DDM only 'sees' value that is paid out — for a non-payer it will badly undervalue (or return nothing). Professionals would use DCF or Comps here.";
  if (modelKey === "bank" && a.financial === false)
    return "The Bank/Financials model is built on book value and regulatory capital — its logic doesn't apply to a non-financial company. DCF or Comps fit better.";
  if (modelKey === "ipo" && a.ipo === false)
    return "The IPO model adds listing mechanics (price band, fresh issue vs OFS, dilution). For an already-listed company those don't apply — DCF, DDM or Comps fit better.";
  return null;
}
