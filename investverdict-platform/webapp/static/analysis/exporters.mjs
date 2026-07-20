/**
 * Feature 6 — export the CURRENT on-screen analysis.
 *  - Excel: client-side via SheetJS (window.XLSX, loaded from CDN in the page).
 *  - PDF: print-friendly via window.print() + a print stylesheet.
 *
 * The UI passes a `viewModel` describing exactly what is on screen (chosen base,
 * common-size vs YoY) so the export reflects the user's current selections.
 *
 * viewModel = {
 *   company, units, mode: "common"|"yoy",
 *   sections: [{ title, base, periods, rows: [
 *      { label, isBase, values:{yr}, secondary:{yr} }   // secondary = % or YoY%
 *   ]}]
 * }
 */

const fmtNum = (v) => (v == null ? "" : Number(v));
const fmtSecondary = (v, mode) => {
  if (v == null) return "";
  if (v === "n/m") return "n/m";
  return (Number(v).toFixed(1)) + "%";
};

/** Build an array-of-arrays grid for one statement (Particulars + value/secondary rows). */
function sheetAOA(section, mode) {
  const header = ["Particulars", ...section.periods];
  const aoa = [
    [section.title],
    [`Common-size base: ${section.base}`, "", `Mode: ${mode === "yoy" ? "YoY change" : "Common-size %"}`],
    header,
  ];
  for (const r of section.rows) {
    aoa.push([r.label, ...section.periods.map((y) => fmtNum(r.values[y]))]);
    const secLabel = mode === "yoy" ? "  YoY %" : "  % of base";
    aoa.push([secLabel, ...section.periods.map((y) => fmtSecondary(r.secondary[y], mode))]);
  }
  return aoa;
}

export function exportExcel(viewModel) {
  if (typeof window === "undefined" || !window.XLSX) {
    alert("Excel library (SheetJS) not loaded.");
    return;
  }
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const titleMap = { "Income Statement": "P&L", "Balance Sheet": "Balance Sheet", "Cash Flow": "Cash Flow" };
  for (const section of viewModel.sections) {
    const ws = XLSX.utils.aoa_to_sheet(sheetAOA(section, viewModel.mode));
    ws["!cols"] = [{ wch: 38 }, ...section.periods.map(() => ({ wch: 12 }))];
    XLSX.utils.book_append_sheet(wb, ws, (titleMap[section.title] || section.title).slice(0, 31));
  }
  const safe = (viewModel.company || "company").replace(/[^a-z0-9]+/gi, "_").slice(0, 40);
  XLSX.writeFile(wb, `${safe}_common_size.xlsx`);
}

/** PDF = browser print of a body.printing layout (print stylesheet handles the look). */
export function exportPDF() {
  document.body.classList.add("printing");
  const cleanup = () => { document.body.classList.remove("printing"); window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  window.print();
  // Safety: also clear shortly after, in case afterprint doesn't fire.
  setTimeout(cleanup, 1500);
}
