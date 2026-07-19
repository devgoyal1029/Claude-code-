/* ============================================================================
   InvestVerdict — Client-facing PDF report generator
   Drop-in: exposes window.downloadPDF()  (also window.buildReportDoc() for preview)
   Requires: jsPDF 2.5.1 (window.jspdf.jsPDF) + html2canvas 1.4.1
   Reads from host page: lastProfile, riskLabel(score,short), fmtINR(n),
                         #charts-area, .report-section (each with one <h2>)
   ----------------------------------------------------------------------------
   ₹ handling:  real ₹ everywhere — native text uses the embedded IVSans font
                (window.IV_FONT from iv-font.js); captured sections render ₹ via DOM.
   ========================================================================== */

/* ---- Sans family used for all native text (set after font embed) ---------- */
let SANS = 'helvetica';

/* ---- Brand palette (RGB) -------------------------------------------------- */
const IV = {
  navy:       [11, 31, 58],
  navyDark:   [6, 16, 41],
  gold:       [201, 169, 97],
  goldBright: [221, 184, 117],
  goldDeep:   [139, 116, 56],
  cream:      [250, 247, 239],
  creamDeep:  [244, 236, 217],
  white:      [255, 255, 255],
  text:       [26, 35, 50],
  muted:      [92, 103, 121],
  sage:       [124, 148, 118],
  bronze:     [150, 112, 64]
};

// White-on-navy logo for the PDF's dark cover/header (local file = no CORS).
// Falls back to the remote URL, then to the vector logo, if the file is missing.
const IV_LOGO_URL = 'logo-white.png';
const IV_LOGO_FALLBACK_URL =
  'https://investverdict.com/wp-content/uploads/2026/05/cropped-cropped-cropped-ChatGPT-Image-May-3-2026-02_04_03-AM-e1777754150364.png';

/* ---- Page geometry (A4 portrait, mm) ------------------------------------- */
const PW = 210, PH = 297, MARGIN = 16;
const CONTENT_W = PW - MARGIN * 2;
const HEADER_H = 12;
const BODY_TOP = 22;          // first y for captured/native body content
const FOOTER_RULE_Y = 280;

/* ============================================================================
   Generic helpers
   ========================================================================== */

/** Load a remote image to a PNG data URL. Rejects gracefully so caller can fall back. */
function loadImageAsDataURL(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width;
        c.height = img.naturalHeight || img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve({
          dataUrl: c.toDataURL('image/png'),
          width: c.width,
          height: c.height,
          aspect: c.width / c.height
        });
      } catch (e) { reject(e); }            // tainted canvas → fall back
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

const toRoman = (n) => ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi'][n] || String(n);

/** Filled polygon from absolute [x,y] points via jsPDF relative-line path. */
function fillPoly(doc, pts, style = 'F') {
  if (pts.length < 2) return;
  const deltas = [];
  for (let i = 1; i < pts.length; i++)
    deltas.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
  doc.lines(deltas, pts[0][0], pts[0][1], [1, 1], style, true);
}

/** Annular sector (donut slice) as a filled polygon. Angles in radians. */
function annularSector(doc, cx, cy, rOut, rIn, a0, a1, fill, stroke) {
  const steps = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.12));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    pts.push([cx + rOut * Math.cos(a), cy + rOut * Math.sin(a)]);
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + (a1 - a0) * (i / steps);
    pts.push([cx + rIn * Math.cos(a), cy + rIn * Math.sin(a)]);
  }
  if (fill) doc.setFillColor(...fill);
  if (stroke) { doc.setDrawColor(...stroke); doc.setLineWidth(0.4); }
  fillPoly(doc, pts, stroke ? 'FD' : 'F');
}

const lerp = (a, b, t) => a + (b - a) * t;
const lerpColor = (c1, c2, t) =>
  [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t))];

/** Horizontal gradient bar drawn as thin slices (jsPDF has no native gradient). */
function gradientBar(doc, x, y, w, h, stops, r = 0) {
  const n = Math.max(24, Math.round(w * 2));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    // piecewise across stops
    const seg = t * (stops.length - 1);
    const idx = Math.min(stops.length - 2, Math.floor(seg));
    const c = lerpColor(stops[idx], stops[idx + 1], seg - idx);
    doc.setFillColor(...c);
    doc.rect(x + (w * i) / n, y, w / n + 0.3, h, 'F');
  }
  if (r > 0) {                                  // soft mask the rounded ends with page colour omitted; keep square for crispness
    /* rounded ends are visually negligible at this size; left square for alignment */
  }
}

/** Short money string with Cr / L / K suffix. Uses real ₹ (embedded font renders it). */
function fmtRs(n) {
  n = Math.round(Number(n) || 0);
  if (n >= 1e7) return '₹' + (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
  if (n >= 1e5) return '₹' + (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
  if (n >= 1e3) return '₹' + Math.round(n / 1e3) + 'K';
  return '₹' + n.toLocaleString('en-IN');
}

/* ---- Thematic line icons (programmatic, geometric) ----------------------- */
function drawIcon(doc, name, cx, cy, s, color) {
  doc.setDrawColor(...color); doc.setFillColor(...color);
  doc.setLineWidth(s * 0.07);
  const r = s / 2;
  switch (name) {
    case 'shield':
      fillPoly(doc, [[cx, cy - r], [cx + r, cy - r * 0.4], [cx + r * 0.7, cy + r * 0.7],
        [cx, cy + r], [cx - r * 0.7, cy + r * 0.7], [cx - r, cy - r * 0.4]], 'S');
      break;
    case 'chart':
      [[-0.6, 0.5], [-0.1, 0.9], [0.4, 1.3]].forEach((b, i) => {
        const bx = cx + (i - 1) * r * 0.7;
        doc.rect(bx - r * 0.18, cy + r - r * b[1], r * 0.36, r * b[1], 'F');
      });
      break;
    case 'sprout':
      doc.line(cx, cy + r, cx, cy - r * 0.2);
      doc.circle(cx - r * 0.45, cy - r * 0.1, r * 0.4, 'S');
      doc.circle(cx + r * 0.45, cy - r * 0.45, r * 0.4, 'S');
      break;
    case 'key':
      doc.circle(cx - r * 0.4, cy, r * 0.45, 'S');
      doc.line(cx - r * 0.05, cy, cx + r, cy);
      doc.line(cx + r * 0.6, cy, cx + r * 0.6, cy + r * 0.4);
      doc.line(cx + r, cy, cx + r, cy + r * 0.4);
      break;
    case 'heart':
      doc.circle(cx - r * 0.4, cy - r * 0.25, r * 0.45, 'F');
      doc.circle(cx + r * 0.4, cy - r * 0.25, r * 0.45, 'F');
      fillPoly(doc, [[cx - r * 0.82, cy - r * 0.05], [cx + r * 0.82, cy - r * 0.05], [cx, cy + r]], 'F');
      break;
    case 'compass':
      doc.circle(cx, cy, r, 'S');
      fillPoly(doc, [[cx, cy - r * 0.6], [cx + r * 0.25, cy], [cx, cy + r * 0.6], [cx - r * 0.25, cy]], 'F');
      break;
    case 'scale':
      doc.line(cx, cy - r, cx, cy + r);
      doc.line(cx - r, cy - r * 0.4, cx + r, cy - r * 0.4);
      doc.circle(cx - r, cy + r * 0.1, r * 0.3, 'S');
      doc.circle(cx + r, cy + r * 0.1, r * 0.3, 'S');
      break;
    case 'clock':
      doc.circle(cx, cy, r, 'S');
      doc.line(cx, cy, cx, cy - r * 0.55);
      doc.line(cx, cy, cx + r * 0.4, cy + r * 0.1);
      break;
    case 'flag':
      doc.line(cx - r * 0.5, cy - r, cx - r * 0.5, cy + r);
      fillPoly(doc, [[cx - r * 0.5, cy - r], [cx + r * 0.7, cy - r * 0.55], [cx - r * 0.5, cy - r * 0.1]], 'F');
      break;
    case 'book':
      doc.rect(cx - r * 0.75, cy - r * 0.6, r * 1.5, r * 1.2, 'S');
      doc.line(cx, cy - r * 0.6, cx, cy + r * 0.6);
      break;
    case 'dashboard':
    default:
      doc.rect(cx - r * 0.7, cy - r * 0.7, r * 0.55, r * 0.55, 'S');
      doc.rect(cx + r * 0.15, cy - r * 0.7, r * 0.55, r * 0.55, 'S');
      doc.rect(cx - r * 0.7, cy + r * 0.15, r * 0.55, r * 0.55, 'S');
      doc.rect(cx + r * 0.15, cy + r * 0.15, r * 0.55, r * 0.55, 'S');
  }
}

function iconForTitle(t) {
  t = (t || '').toLowerCase();
  if (/risk|profile|tolerance/.test(t)) return 'shield';
  if (/health|summary|overview|snapshot/.test(t)) return 'compass';
  if (/alloc|asset|portfolio|diversif/.test(t)) return 'scale';
  if (/project|growth|return|wealth|corpus/.test(t)) return 'chart';
  if (/retire|pension|sprout|long.?term/.test(t)) return 'sprout';
  if (/tax|deduct|80c|saving/.test(t)) return 'key';
  if (/insur|cover|protect|life|health cover/.test(t)) return 'heart';
  if (/goal|objective|milestone/.test(t)) return 'compass';
  if (/review|rebalance|monitor|cadence|schedule/.test(t)) return 'clock';
  if (/action|next step|recommend|roadmap/.test(t)) return 'flag';
  if (/closing|disclaim|note/.test(t)) return 'book';
  return 'chart';
}

/* ---- Decorative atoms ----------------------------------------------------- */
function cornerBrackets(doc, color, size = 8, inset = 8) {
  doc.setDrawColor(...color); doc.setLineWidth(0.9);
  const L = size;
  // TL
  doc.line(inset, inset, inset + L, inset); doc.line(inset, inset, inset, inset + L);
  // TR
  doc.line(PW - inset, inset, PW - inset - L, inset); doc.line(PW - inset, inset, PW - inset, inset + L);
  // BL
  doc.line(inset, PH - inset, inset + L, PH - inset); doc.line(inset, PH - inset, inset, PH - inset - L);
  // BR
  doc.line(PW - inset, PH - inset, PW - inset - L, PH - inset); doc.line(PW - inset, PH - inset, PW - inset, PH - inset - L);
}

function diamond(doc, cx, cy, r, color) {
  doc.setFillColor(...color);
  fillPoly(doc, [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]], 'F');
}

function withOpacity(doc, op, fn) {
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: op }));
  fn();
  doc.restoreGraphicsState();
}

/** Text on a circle (used by confidential seal). */
function circularText(doc, text, cx, cy, radius, color, fontSize, startDeg = -90) {
  doc.setFont(SANS, 'bold'); doc.setFontSize(fontSize); doc.setTextColor(...color);
  const chars = [...text]; const step = 360 / chars.length;
  chars.forEach((ch, i) => {
    const a = startDeg + i * step;
    const rad = a * Math.PI / 180;
    const x = cx + radius * Math.cos(rad);
    const y = cy + radius * Math.sin(rad);
    doc.text(ch, x, y, { angle: -(a + 90), align: 'center', baseline: 'middle' });
  });
}

/* ============================================================================
   Shared page chrome
   ========================================================================== */
function drawProgrammaticLogo(doc, x, y, width) {
  // Scales relative to `width`. Reference design width = 100mm.
  const u = width / 100;
  const navy = IV.navy, gold = IV.gold;
  // 5 ascending gold bars
  doc.setFillColor(...gold);
  const barW = 2.6 * u, gap = 1.2 * u, baseY = y + 11 * u;
  for (let i = 0; i < 5; i++) {
    const h = (3 + i * 1.9) * u;
    doc.rect(x + i * (barW + gap), baseY - h, barW, h, 'F');
  }
  // IV monogram
  const monoX = x + 5 * (barW + gap) + 3 * u;
  doc.setFont(SANS, 'bold'); doc.setTextColor(...navy);
  doc.setFontSize(20 * u);
  doc.text('IV', monoX, baseY, { baseline: 'alphabetic' });
  // gold check over the V
  const ivW = doc.getTextWidth('IV');
  doc.setDrawColor(...gold); doc.setLineWidth(0.7 * u);
  const ckx = monoX + ivW + 1.3 * u, cky = baseY - 7 * u;
  doc.line(ckx, cky + 1.3 * u, ckx + 1.6 * u, cky + 3 * u);
  doc.line(ckx + 1.6 * u, cky + 3 * u, ckx + 4.4 * u, cky - 1.2 * u);
  // wordmark
  doc.setFontSize(8.4 * u); doc.setTextColor(...navy);
  doc.text('INVESTVERDICT', monoX, baseY + 6.2 * u, { charSpace: 0.4 * u });
  // tagline
  doc.setFont(SANS, 'normal'); doc.setFontSize(4.6 * u); doc.setTextColor(...gold);
  doc.text('— CLARITY BEFORE YOU INVEST —', monoX, baseY + 10 * u, { charSpace: 0.3 * u });
}

function drawHeaderBar(doc, pageNum, totalPages, name, logoImg) {
  doc.setFillColor(...IV.navy);
  doc.rect(0, 0, PW, HEADER_H, 'F');
  doc.setDrawColor(...IV.gold); doc.setLineWidth(0.8);
  doc.line(0, HEADER_H + 0.4, PW, HEADER_H + 0.4);
  if (logoImg) {
    const h = 7, w = h * logoImg.aspect;
    doc.addImage(logoImg.dataUrl, 'PNG', MARGIN, 2.5, w, h);
  } else {
    doc.setFont(SANS, 'bold'); doc.setFontSize(10);
    doc.setTextColor(...IV.white); doc.text('INVEST', MARGIN, 8);
    const w1 = doc.getTextWidth('INVEST');
    doc.setTextColor(...IV.gold); doc.text('VERDICT', MARGIN + w1, 8);
  }
  doc.setFont(SANS, 'normal'); doc.setFontSize(8);
  doc.setTextColor(...IV.goldBright);
  doc.text('Prepared for ' + name, PW / 2, 7.6, { align: 'center' });
  doc.text('Page ' + pageNum + ' / ' + totalPages, PW - MARGIN, 7.6, { align: 'right' });
}

function drawFooter(doc, todayStr) {
  doc.setDrawColor(...IV.gold); doc.setLineWidth(0.3);
  doc.line(MARGIN, FOOTER_RULE_Y, PW - MARGIN, FOOTER_RULE_Y);
  doc.setFont(SANS, 'normal'); doc.setFontSize(7);
  doc.setTextColor(...IV.muted);
  doc.text('InvestVerdict · investverdict.com · Educational use only', MARGIN, FOOTER_RULE_Y + 4);
  doc.text(todayStr, PW - MARGIN, FOOTER_RULE_Y + 4, { align: 'right' });
  doc.setFontSize(6); doc.setTextColor(...IV.goldDeep);
  doc.text('NOT SEBI-REGISTERED INVESTMENT ADVICE — CONSULT A QUALIFIED ADVISOR BEFORE INVESTING',
    PW / 2, FOOTER_RULE_Y + 12, { align: 'center' });
}

function drawPageRoundel(doc, pageNum) {
  const cx = PW / 2, cy = 286, r = 4.6;
  doc.setDrawColor(...IV.gold); doc.setLineWidth(0.4);
  doc.circle(cx, cy, r, 'S');
  doc.circle(cx, cy, r - 1.1, 'S');
  doc.setFont('times', 'bold'); doc.setFontSize(9); doc.setTextColor(...IV.navy);
  const label = pageNum <= 2 ? toRoman(pageNum) : String(pageNum);
  doc.text(label, cx, cy + 0.2, { align: 'center', baseline: 'middle' });
}

/** Behind-content layer for body pages: white bg + faint diagonal watermark + side wordmark. */
function drawBodyBackdrop(doc) {
  doc.setFillColor(...IV.white); doc.rect(0, 0, PW, PH, 'F');
  withOpacity(doc, 0.06, () => {
    doc.setFont('times', 'bold'); doc.setFontSize(60); doc.setTextColor(...IV.gold);
    doc.text('CONFIDENTIAL', PW / 2, PH / 2 + 30, { align: 'center', angle: 45 });
  });
  withOpacity(doc, 0.10, () => {
    doc.setFont(SANS, 'bold'); doc.setFontSize(6.5); doc.setTextColor(...IV.goldDeep);
    doc.text('INVESTVERDICT', 5.5, PH / 2, { align: 'center', angle: 90, charSpace: 1.5 });
  });
}

/* ============================================================================
   Native infographics
   ========================================================================== */

/** 1. Risk meter — gradient bar (sage→gold→navy) with navy thumb + ticks. */
function drawRiskMeter(doc, x, y, w, score, label) {
  doc.setFont(SANS, 'bold'); doc.setFontSize(7.5); doc.setTextColor(...IV.goldDeep);
  doc.text('RISK PROFILE', x, y - 2.5, { charSpace: 1 });
  const barY = y, h = 5.5;
  gradientBar(doc, x, barY, w, h, [IV.sage, IV.gold, IV.navy]);
  doc.setDrawColor(...IV.creamDeep); doc.setLineWidth(0.3); doc.rect(x, barY, w, h, 'S');
  // ticks
  doc.setFont('courier', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...IV.muted);
  [20, 40, 60, 80].forEach(v => {
    const tx = x + w * (v / 100);
    doc.setDrawColor(...IV.muted); doc.setLineWidth(0.2);
    doc.line(tx, barY + h, tx, barY + h + 1.3);
    doc.text(String(v), tx, barY + h + 4, { align: 'center' });
  });
  // thumb
  const px = x + w * Math.max(0, Math.min(1, score / 100));
  doc.setFillColor(...IV.navy);
  fillPoly(doc, [[px, barY - 1.2], [px + 2.1, barY - 3.6], [px - 2.1, barY - 3.6]], 'F');
  doc.setFillColor(...IV.navyDark);
  doc.roundedRect(px - 2.1, barY - 3.6, 4.2, 3.4, 0.6, 0.6, 'F');
  // value pill
  doc.setFont(SANS, 'bold'); doc.setFontSize(8); doc.setTextColor(...IV.navy);
  doc.text(label + ' · ' + score + '/100', x + w, y - 2.5, { align: 'right' });
}

/** 2. Allocation donut — native vector arcs, centre SIP label, leader lines. */
function drawAllocationDonut(doc, cx, cy, rOut, segments, centreTop, centreBot) {
  let a = -Math.PI / 2;
  const total = segments.reduce((s, x) => s + x.v, 0);
  const rIn = rOut * 0.58;
  segments.forEach(seg => {
    const a1 = a + (seg.v / total) * Math.PI * 2;
    annularSector(doc, cx, cy, rOut, rIn, a, a1, seg.c, IV.white);
    seg._mid = (a + a1) / 2;
    a = a1;
  });
  // centre labels
  doc.setFont(SANS, 'bold'); doc.setFontSize(6.5); doc.setTextColor(...IV.goldDeep);
  doc.text(centreTop, cx, cy - 2.4, { align: 'center', charSpace: 0.6 });
  doc.setFont(SANS, 'bold'); doc.setFontSize(12); doc.setTextColor(...IV.navy);
  doc.text(centreBot, cx, cy + 3.2, { align: 'center' });
  // leader lines + outer labels
  doc.setFontSize(6.8);
  segments.forEach(seg => {
    const m = seg._mid;
    const x1 = cx + Math.cos(m) * rOut, y1 = cy + Math.sin(m) * rOut;
    const x2 = cx + Math.cos(m) * (rOut + 3.5), y2 = cy + Math.sin(m) * (rOut + 3.5);
    const right = Math.cos(m) >= 0;
    const x3 = right ? x2 + 4 : x2 - 4;
    doc.setDrawColor(...seg.c); doc.setLineWidth(0.35);
    doc.line(x1, y1, x2, y2); doc.line(x2, y2, x3, y2);
    doc.setFont(SANS, 'bold'); doc.setTextColor(...IV.text);
    doc.text(seg.label + '  ' + seg.v + '%', right ? x3 + 1 : x3 - 1, y2 + 0.8,
      { align: right ? 'left' : 'right' });
  });
}

/** 3. Goal feasibility gauge — semicircle red→gold→green, needle, two numerals. */
function drawGoalGauge(doc, cx, cy, r, pct, targetStr, projStr) {
  const stops = [[178, 88, 72], IV.gold, IV.sage];     // off-track → close → surplus
  const segN = 60;
  for (let i = 0; i < segN; i++) {
    const a0 = Math.PI + (i / segN) * Math.PI;
    const a1 = Math.PI + ((i + 1) / segN) * Math.PI;
    const t = i / (segN - 1);
    const seg = t * (stops.length - 1);
    const idx = Math.min(stops.length - 2, Math.floor(seg));
    const c = lerpColor(stops[idx], stops[idx + 1], seg - idx);
    annularSector(doc, cx, cy, r, r * 0.66, a0, a1, c, null);
  }
  // needle
const p = Math.max(0, Math.min(1, (isNaN(pct) || !isFinite(pct)) ? 0.5 : pct / 100));
const na = Math.PI + p * Math.PI;
  const nx = cx + Math.cos(na) * (r * 0.9), ny = cy + Math.sin(na) * (r * 0.9);
  doc.setDrawColor(...IV.navy); doc.setLineWidth(1.1); doc.line(cx, cy, nx, ny);
  doc.setFillColor(...IV.navy); doc.circle(cx, cy, 1.6, 'F');
  // labels
  doc.setFont(SANS, 'bold'); doc.setFontSize(7); doc.setTextColor(...IV.goldDeep);
  doc.text('GOAL FEASIBILITY', cx, cy - r - 3, { align: 'center', charSpace: 1 });
  doc.setFont('times', 'bold'); doc.setFontSize(15); doc.setTextColor(...IV.navy);
  doc.text(Math.round(pct) + '%', cx, cy - 2.5, { align: 'center' });
  doc.setFont(SANS, 'normal'); doc.setFontSize(6.6); doc.setTextColor(...IV.muted);
  doc.text('TARGET ' + targetStr, cx - r * 0.5, cy + 6, { align: 'center' });
  doc.text('PROJECTED ' + projStr, cx + r * 0.5, cy + 6, { align: 'center' });
}

/** 4. Projection cone — conservative/moderate/optimistic filled areas + ticks. */
function drawProjectionCone(doc, x, y, w, h, years, series) {
  // series: {cons:[], mod:[], opt:[]} arrays length years+1 (value per year 0..years)
  const maxV = Math.max(...series.opt) * 1.05 || 1;
  const X = (yr) => x + (yr / years) * w;
  const Y = (v) => y + h - (v / maxV) * h;
  // cone fill (between cons and opt)
  const top = []; const bot = [];
  for (let yr = 0; yr <= years; yr++) { top.push([X(yr), Y(series.opt[yr])]); }
  for (let yr = years; yr >= 0; yr--) { bot.push([X(yr), Y(series.cons[yr])]); }
  withOpacity(doc, 0.16, () => { doc.setFillColor(...IV.gold); fillPoly(doc, top.concat(bot), 'F'); });
  // moderate line
  doc.setDrawColor(...IV.navy); doc.setLineWidth(0.8);
  for (let yr = 0; yr < years; yr++) doc.line(X(yr), Y(series.mod[yr]), X(yr + 1), Y(series.mod[yr + 1]));
  // edge lines
  doc.setDrawColor(...IV.goldDeep); doc.setLineWidth(0.35);
  for (let yr = 0; yr < years; yr++) {
    doc.line(X(yr), Y(series.opt[yr]), X(yr + 1), Y(series.opt[yr + 1]));
    doc.line(X(yr), Y(series.cons[yr]), X(yr + 1), Y(series.cons[yr + 1]));
  }
  // axis
  doc.setDrawColor(...IV.creamDeep); doc.setLineWidth(0.3);
  doc.line(x, y + h, x + w, y + h);
  // ticks
  const ticks = [1, 3, 5, 7, 10].filter(t => t <= years);
  if (ticks[ticks.length - 1] !== years) ticks.push(years);
  doc.setFont(SANS, 'normal'); doc.setFontSize(6); doc.setTextColor(...IV.muted);
  ticks.forEach(t => {
    const tx = X(t);
    doc.setDrawColor(...IV.muted); doc.setLineWidth(0.2); doc.line(tx, y + h, tx, y + h + 1.2);
    doc.text('Y' + t, tx, y + h + 4, { align: 'center' });
    doc.setTextColor(...IV.goldDeep);
    doc.text(fmtRs(series.mod[t]), tx, y + h + 7, { align: 'center' });
    doc.setTextColor(...IV.muted);
  });
  doc.setFont(SANS, 'bold'); doc.setFontSize(7); doc.setTextColor(...IV.goldDeep);
  doc.text('PROJECTED CORPUS — 3 SCENARIOS', x, y - 2.5, { charSpace: 1 });
}

/** Glide-path strip: equity(gold)→debt(navy) over the horizon. */
function drawGlidePath(doc, x, y, w, years) {
  const n = Math.min(years, 12) || 6;
  const cw = w / n;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    doc.setFillColor(...lerpColor(IV.gold, IV.navy, t));
    doc.rect(x + i * cw, y, cw - 0.6, 5, 'F');
  }
  doc.setFont(SANS, 'normal'); doc.setFontSize(6); doc.setTextColor(...IV.muted);
  doc.text('EQUITY-LED', x, y + 9);
  doc.text('DEBT-LED', x + w, y + 9, { align: 'right' });
  doc.setFont(SANS, 'bold'); doc.setFontSize(7); doc.setTextColor(...IV.goldDeep);
  doc.text('GLIDE PATH', x, y - 2.5, { charSpace: 1 });
}

/* ============================================================================
   Main build
   ========================================================================== */
async function buildReportDoc() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  // Embed a Unicode font so the ₹ symbol renders natively (jsPDF's built-in
  // Helvetica has no rupee glyph). 'IVSans' becomes our sans family.
  SANS = 'helvetica';
  try {
    if (window.IV_FONT && window.IV_FONT.regular) {
      doc.addFileToVFS('IVSans-Regular.ttf', window.IV_FONT.regular);
      doc.addFont('IVSans-Regular.ttf', 'IVSans', 'normal');
      doc.addFileToVFS('IVSans-Bold.ttf', window.IV_FONT.bold || window.IV_FONT.regular);
      doc.addFont('IVSans-Bold.ttf', 'IVSans', 'bold');
      SANS = 'IVSans';
    }
  } catch (e) { SANS = 'helvetica'; }

  /* ---- profile + derived figures (USES THE SITE'S OWN ENGINE) ----------- */
  const p = (typeof lastProfile !== 'undefined' && lastProfile) ? lastProfile : {};
  const name = (p.name || 'Valued Client').trim();
  const horizon = parseInt(String(p.horizon || '15'), 10) || 15;
  const goal = p.primaryGoal || 'Long-term wealth creation';

  // SIP — same parsing as the site (never 0; site already estimates if blank)
  const sipNum = (() => {
    const s = String(p.monthlySIP || '').replace(/[^0-9]/g, '');
    return s ? parseInt(s) : 10000;
  })();
  const sipStr = 'Rs. ' + sipNum.toLocaleString('en-IN');

  // Composite risk from the site's 11-factor engine (NOT the raw slider)
  const risk = (typeof calculateCompositeRisk === 'function')
    ? calculateCompositeRisk(p)
    : { composite: Number(p.riskScore)||50, appetite: Number(p.riskScore)||50, capacity: 50, label: 'Moderate' };
  const score  = risk.composite;
  const rLabel = (typeof riskLabel === 'function') ? riskLabel(score, true) : (risk.label || 'Moderate');

  const today = new Date();
  const monYear = today.toLocaleString('en-IN', { month: 'long', year: 'numeric' }).toUpperCase();
  const todayStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const fileDate = today.toISOString().slice(0, 10);
  const yr = today.getFullYear();

  // Projections via the site's projection() so PDF == report
  const projFn = (typeof projection === 'function')
    ? projection
    : (sip, y, rate) => { const r = rate/100/12, n = y*12; return r ? Math.round(sip*((Math.pow(1+r,n)-1)/r)) : sip*n; };
  const projMod  = projFn(sipNum, horizon, 11);
  const projCons = projFn(sipNum, horizon, 8);
  const projOpt  = projFn(sipNum, horizon, 14);

  // Goal feasibility via site's engine
  const goalFeas = (typeof computeGoalFeasibility === 'function') ? computeGoalFeasibility(p, sipNum) : null;
  let target = goalFeas && goalFeas.target ? goalFeas.target : Math.round(projMod * 1.18);
  let feasibility = (goalFeas && goalFeas.target > 0)
    ? Math.min(118, (goalFeas.projected / goalFeas.target) * 100)
    : 85;
  if (isNaN(feasibility) || !isFinite(feasibility)) feasibility = 85;

  const coneSeries = { cons: [], mod: [], opt: [] };
  for (let y = 0; y <= horizon; y++) {
    coneSeries.cons.push(projFn(sipNum, y, 8));
    coneSeries.mod.push(projFn(sipNum, y, 11));
    coneSeries.opt.push(projFn(sipNum, y, 14));
  }

  // Allocation via the site's parametric engine → donut matches report exactly
  const alloc = (typeof computeAllocation === 'function')
    ? computeAllocation(p, risk)
    : (typeof getAllocation === 'function' ? getAllocation(score) : { eq:60, debt:25, gold:8, reits:5, alt:2 });
  const allocation = [
    { label: 'Equity', v: alloc.eq    || 0, c: IV.navy },
    { label: 'Debt',   v: alloc.debt  || 0, c: IV.gold },
    { label: 'Gold',   v: alloc.gold  || 0, c: IV.bronze },
    { label: 'REITs',  v: alloc.reits || 0, c: IV.sage },
    { label: 'Alt',    v: alloc.alt   || 0, c: IV.creamDeep }
  ].filter(s => s.v > 0);

  /* ---- logo (graceful fallback) ----------------------------------------- */
  let logoImg = null;
  try { logoImg = await loadImageAsDataURL(IV_LOGO_URL); }
  catch (e) {
    try { logoImg = await loadImageAsDataURL(IV_LOGO_FALLBACK_URL); } catch (e2) { logoImg = null; }
  }

  /* ================= PAGE 1 — COVER ================= */
  function drawCoverPage() {
    doc.setFillColor(...IV.navy); doc.rect(0, 0, PW, PH, 'F');
    // navy-on-navy hairline texture
    withOpacity(doc, 0.5, () => {
      doc.setDrawColor(...IV.navyDark); doc.setLineWidth(0.2);
      for (let i = -PH; i < PW; i += 6) doc.line(i, 0, i + PH, PH);
    });
    // faint serif drop-cap watermark of first initial
    withOpacity(doc, 0.08, () => {
      doc.setFont('times', 'bold'); doc.setFontSize(280); doc.setTextColor(...IV.gold);
      doc.text((name[0] || 'A').toUpperCase(), PW / 2, PH / 2 + 60, { align: 'center' });
    });
    // gold geometric ornaments (concentric arcs) top-left & bottom-right
    withOpacity(doc, 0.5, () => {
      doc.setDrawColor(...IV.gold); doc.setLineWidth(0.4);
      for (let r = 6; r <= 26; r += 5) {
        annularSector(doc, 0, 0, r, r - 0.3, 0, Math.PI / 2, null, IV.gold);
        annularSector(doc, PW, PH, r, r - 0.3, Math.PI, Math.PI * 1.5, null, IV.gold);
      }
    });
    cornerBrackets(doc, IV.gold, 8, 8);

    // logo
    if (logoImg) {
      const w = 100, h = w / logoImg.aspect;
      doc.addImage(logoImg.dataUrl, 'PNG', (PW - w) / 2, 38, w, h);
    } else {
      drawProgrammaticLogo(doc, (PW - 100) / 2, 40, 100);
    }
    // embossed double gold rule
    doc.setDrawColor(...IV.gold); doc.setLineWidth(0.6); doc.line(55, 86, PW - 55, 86);
    doc.setDrawColor(...IV.goldDeep); doc.setLineWidth(0.3); doc.line(55, 87.2, PW - 55, 87.2);

    // date
    doc.setFont('courier', 'normal'); doc.setFontSize(11); doc.setTextColor(...IV.gold);
    doc.text(monYear, PW / 2, 96, { align: 'center', charSpace: 1.5 });

    // headline
    doc.setFont('times', 'normal'); doc.setFontSize(48); doc.setTextColor(...IV.white);
    doc.text('Financial', PW / 2, 124, { align: 'center' });
    doc.text('Planning Report', PW / 2, 142, { align: 'center' });
    // italic gold subhead
    doc.setFont('times', 'italic'); doc.setFontSize(16); doc.setTextColor(...IV.goldBright);
    doc.text('Prepared exclusively for ' + name, PW / 2, 156, { align: 'center' });

    // PROFILE SNAPSHOT card
    const cx = 30, cy = 172, cw = PW - 60, ch = 62;
    doc.setFillColor(...IV.cream); doc.setDrawColor(...IV.gold); doc.setLineWidth(0.6);
    doc.roundedRect(cx, cy, cw, ch, 3, 3, 'FD');
    doc.setFont(SANS, 'bold'); doc.setFontSize(8); doc.setTextColor(...IV.goldDeep);
    doc.text('PROFILE SNAPSHOT', cx + 8, cy + 10, { charSpace: 1.5 });
    doc.setDrawColor(...IV.gold); doc.setLineWidth(0.3); doc.line(cx + 8, cy + 13, cx + cw - 8, cy + 13);
    const rows = [
      ['RISK PROFILE', rLabel + ' · ' + score + '/100'],
      ['PRIMARY GOAL', goal],
      ['INVESTMENT HORIZON', horizon + ' years'],
      ['MONTHLY SIP', sipStr]
    ];
    rows.forEach((r, i) => {
      const ry = cy + 22 + i * 9.5;
      doc.setFont(SANS, 'bold'); doc.setFontSize(7.5); doc.setTextColor(...IV.goldDeep);
      doc.text(r[0], cx + 8, ry, { charSpace: 0.8 });
      doc.setFont(SANS, 'bold'); doc.setFontSize(10); doc.setTextColor(...IV.navy);
      doc.text(String(r[1]), cx + cw - 8, ry, { align: 'right' });
    });

    // confidential seal (bottom-right)
    const sx = PW - 34, sy = 246, sr = 13;
    doc.setDrawColor(...IV.gold); doc.setLineWidth(0.5);
    doc.circle(sx, sy, sr, 'S'); doc.circle(sx, sy, sr - 2, 'S');
    circularText(doc, '· CONFIDENTIAL · ' + yr + ' ', sx, sy, sr - 4.6, IV.gold, 5);
    diamond(doc, sx, sy, 2.2, IV.gold);

    // bottom gold strip
    const gsY = PH - 30;
    doc.setFillColor(...IV.gold); doc.rect(0, gsY, PW, 18, 'F');
    doc.setFont(SANS, 'bold'); doc.setFontSize(11); doc.setTextColor(...IV.navy);
    doc.text('CLARITY BEFORE YOU INVEST', PW / 2, gsY + 8, { align: 'center', charSpace: 2 });
    doc.setFont(SANS, 'normal'); doc.setFontSize(7); doc.setTextColor(...IV.navyDark);
    doc.text('investverdict.com · Educational use only · Not SEBI-registered advice',
      PW / 2, gsY + 14, { align: 'center', charSpace: 0.4 });
    // final navy strip
    doc.setFillColor(...IV.navyDark); doc.rect(0, gsY + 18, PW, 12, 'F');
    doc.setFontSize(7); doc.setTextColor(...IV.goldBright);
    doc.text('CONFIDENTIAL · FOR THE NAMED RECIPIENT ONLY', PW / 2, gsY + 25.5,
      { align: 'center', charSpace: 1 });
  }

  /* ================= DASHBOARD (native infographics) ================= */
  function drawDashboardNative() {
    drawBodyBackdrop(doc);
    // eyebrow + title
    doc.setFont(SANS, 'bold'); doc.setFontSize(8); doc.setTextColor(...IV.goldDeep);
    doc.text('§ DASHBOARD', MARGIN, BODY_TOP + 4, { charSpace: 1.5 });
    doc.setFont('times', 'normal'); doc.setFontSize(30); doc.setTextColor(...IV.navy);
    doc.text('Plan at a Glance', MARGIN, BODY_TOP + 16);
    doc.setDrawColor(...IV.gold); doc.setLineWidth(0.8); doc.line(MARGIN, BODY_TOP + 20, MARGIN + 30, BODY_TOP + 20);
    doc.setFont('times', 'italic'); doc.setFontSize(11); doc.setTextColor(...IV.muted);
    doc.text('Your asset allocation, projection curves, and equity breakdown — at a single glance.',
      MARGIN, BODY_TOP + 27);

    // hero 2x2 stat cards
    const cards = [
      { v: sipStr, l: 'MONTHLY SIP', ic: 'chart' },
      { v: horizon + ' yrs', l: 'HORIZON', ic: 'clock' },
      { v: fmtRs(projMod), l: 'PROJECTED CORPUS', ic: 'sprout' },
      { v: rLabel, l: 'RISK PROFILE', ic: 'shield' }
    ];
    const gx = MARGIN, gy = BODY_TOP + 33, gw = (CONTENT_W - 6) / 2, gh = 26;
    cards.forEach((c, i) => {
      const x = gx + (i % 2) * (gw + 6), y = gy + Math.floor(i / 2) * (gh + 6);
      doc.setFillColor(...IV.cream); doc.setDrawColor(...IV.creamDeep); doc.setLineWidth(0.4);
      doc.roundedRect(x, y, gw, gh, 2, 2, 'FD');
      drawIcon(doc, c.ic, x + 7, y + 8, 5.5, IV.goldDeep);
      // gold L corner accent
      doc.setDrawColor(...IV.gold); doc.setLineWidth(0.8);
      doc.line(x + gw - 8, y + 2.5, x + gw - 2.5, y + 2.5);
      doc.line(x + gw - 2.5, y + 2.5, x + gw - 2.5, y + 8);
      doc.setFont(SANS, 'bold'); doc.setFontSize(15); doc.setTextColor(...IV.navy);
      doc.text(String(c.v), x + 13, y + 13, { baseline: 'middle' });
      doc.setFont(SANS, 'bold'); doc.setFontSize(6.8); doc.setTextColor(...IV.goldDeep);
      doc.text(c.l, x + 13, y + 21, { charSpace: 0.8 });
    });

    // risk meter
    drawRiskMeter(doc, MARGIN, gy + 2 * (gh + 6) + 12, CONTENT_W, score, rLabel);
    // goal gauge
    drawGoalGauge(doc, PW / 2, 232, 26, feasibility, fmtRs(target), fmtRs(projMod));
  }

  function drawDashboardNative2() {
    drawBodyBackdrop(doc);
    doc.setFont(SANS, 'bold'); doc.setFontSize(8); doc.setTextColor(...IV.goldDeep);
    doc.text('§ DASHBOARD  (continued)', MARGIN, BODY_TOP + 4, { charSpace: 1.5 });
    doc.setFont('times', 'normal'); doc.setFontSize(22); doc.setTextColor(...IV.navy);
    doc.text('Allocation & Projection', MARGIN, BODY_TOP + 14);
    doc.setDrawColor(...IV.gold); doc.setLineWidth(0.8); doc.line(MARGIN, BODY_TOP + 18, MARGIN + 26, BODY_TOP + 18);

    // donut left
    drawAllocationDonut(doc, MARGIN + 42, BODY_TOP + 58, 28, allocation, 'MONTHLY SIP', sipStr);
    // projection cone right/full below
    drawProjectionCone(doc, MARGIN, BODY_TOP + 100, CONTENT_W, 60, horizon, coneSeries);
    // glide path
    drawGlidePath(doc, MARGIN, BODY_TOP + 185, CONTENT_W, horizon);
  }

  /* ================= CAPTURE A DOM ELEMENT ================= */
  async function captureEl(el, bg) {
    if (!el) return null;
    try {
      const canvas = await html2canvas(el, {
        scale: 1.6, useCORS: true, backgroundColor: bg, logging: false,
        windowWidth: el.scrollWidth, windowHeight: el.scrollHeight
      });
      return canvas;
    } catch (e) { return null; }
  }

  /** Place a captured canvas, slicing across pages if taller than avail. Returns pages used. */
  function placeCapture(canvas, drawChrome) {
    if (!canvas) return [doc.getCurrentPageInfo().pageNumber];
    const imgW = CONTENT_W - 14;                 // leave right rail
    const x = MARGIN;
    const availH = FOOTER_RULE_Y - BODY_TOP - 4;
    const pxPerMm = canvas.width / imgW;
    const pageHpx = availH * pxPerMm;
    let sy = 0, part = 0; const used = [];
    while (sy < canvas.height - 1) {
      const hpx = Math.min(pageHpx, canvas.height - sy);
      const tmp = document.createElement('canvas');
      tmp.width = canvas.width; tmp.height = Math.round(hpx);
      tmp.getContext('2d').drawImage(canvas, 0, sy, canvas.width, hpx, 0, 0, canvas.width, hpx);
      if (part > 0) { doc.addPage(); drawBodyBackdrop(doc); if (drawChrome) drawChrome(part); }
      doc.addImage(tmp.toDataURL('image/jpeg', 0.85), 'JPEG', x, BODY_TOP, imgW, hpx / pxPerMm);
      used.push(doc.getCurrentPageInfo().pageNumber);
      sy += hpx; part++;
    }
    return used;
  }

  /* ================= SECTION CHROME ================= */
  function sectionChrome(idx, totalSecs, title, continued) {
    // right edge tab: gold for foundational (first half), navy for strategy
    const foundational = idx <= Math.ceil(totalSecs / 2);
    doc.setFillColor(...(foundational ? IV.gold : IV.navy));
    doc.rect(PW - 4, HEADER_H + 1, 4, PH - HEADER_H - 1, 'F');
    // section medallion
    const mcx = PW - 14, mcy = 34, mr = 7;
    doc.setFillColor(...IV.navy); doc.circle(mcx, mcy, mr, 'F');
    doc.setDrawColor(...IV.gold); doc.setLineWidth(0.5); doc.circle(mcx, mcy, mr + 1.2, 'S');
    doc.setFont('times', 'bold'); doc.setFontSize(11); doc.setTextColor(...IV.goldBright);
    doc.text(String(idx).padStart(2, '0'), mcx, mcy + 0.4, { align: 'center', baseline: 'middle' });
    // thematic icon under medallion
    drawIcon(doc, iconForTitle(title), mcx, mcy + 13, 5.5, IV.goldDeep);
    // top-right filigree dots
    doc.setFillColor(...IV.gold);
    for (let i = 0; i < 3; i++) doc.circle(PW - 9 - i * 2.4, 50 + i * 2.4, 0.5, 'F');
    // top-right corner brackets (decorative)
    doc.setDrawColor(...IV.gold); doc.setLineWidth(0.7);
    doc.line(PW - 8, 16, PW - 4, 16); doc.line(PW - 8, 16, PW - 8, 20);
    if (continued) {
      doc.setFont(SANS, 'bold'); doc.setFontSize(7); doc.setTextColor(...IV.goldDeep);
      doc.text('SECTION ' + String(idx).padStart(2, '0') + ' (continued)', MARGIN, BODY_TOP - 4,
        { charSpace: 1 });
    }
  }

  /* ================= CLOSING PAGE ================= */
  function drawClosingPage() {
    doc.setFillColor(...IV.navy); doc.rect(0, 0, PW, PH, 'F');
    withOpacity(doc, 0.5, () => {
      doc.setDrawColor(...IV.navyDark); doc.setLineWidth(0.2);
      for (let i = -PH; i < PW; i += 6) doc.line(i, 0, i + PH, PH);
    });
    cornerBrackets(doc, IV.gold, 8, 8);
    if (logoImg) {
      const w = 80, h = w / logoImg.aspect;
      doc.addImage(logoImg.dataUrl, 'PNG', (PW - w) / 2, 56, w, h);
    } else { drawProgrammaticLogo(doc, (PW - 80) / 2, 58, 80); }
    doc.setDrawColor(...IV.gold); doc.setLineWidth(0.5); doc.line(60, 96, PW - 60, 96);

    doc.setFont(SANS, 'bold'); doc.setFontSize(8); doc.setTextColor(...IV.gold);
    doc.text('§ CLOSING', PW / 2, 110, { align: 'center', charSpace: 2 });
    doc.setFont('times', 'italic'); doc.setFontSize(28); doc.setTextColor(...IV.white);
    doc.text('A note on caution.', PW / 2, 126, { align: 'center' });

    const disclaimer = 'This report has been generated by InvestVerdict for educational and ' +
      'informational purposes only. It does not constitute investment advice, nor is it a ' +
      'recommendation to buy or sell any securities. InvestVerdict is not a SEBI-registered ' +
      'investment advisor. No specific stocks, mutual funds, bonds, or individual securities are ' +
      'named or recommended — all references are to asset categories. All projections are ' +
      'illustrative estimates and do not guarantee future returns. Please consult a SEBI-registered ' +
      'investment advisor before making any financial decisions. Investment in securities markets ' +
      'is subject to market risks.';
    doc.setFont('times', 'normal'); doc.setFontSize(9); doc.setTextColor(...IV.goldBright);
    const lines = doc.splitTextToSize(disclaimer, 150);
    doc.text(lines, PW / 2, 142, { align: 'center', lineHeightFactor: 1.5 });

    // ornamental separator: three gold diamonds
    const sepY = 206;
    [-6, 0, 6].forEach(dx => diamond(doc, PW / 2 + dx, sepY, 1.1, IV.gold));
    // FINIS mark flanked by rules
    doc.setDrawColor(...IV.gold); doc.setLineWidth(0.4);
    doc.line(PW / 2 - 34, 214, PW / 2 - 14, 214); doc.line(PW / 2 + 14, 214, PW / 2 + 34, 214);
    doc.setFont('times', 'italic'); doc.setFontSize(12); doc.setTextColor(...IV.gold);
    doc.text('— FINIS —', PW / 2, 215.5, { align: 'center' });

    // signature flourish
    doc.setFont('times', 'italic'); doc.setFontSize(13); doc.setTextColor(...IV.white);
    doc.text('Yours in clarity,', MARGIN + 4, 232);
    doc.setDrawColor(...IV.goldBright); doc.setLineWidth(0.6);
    doc.lines([[6, -5, 12, 4, 18, -7], [8, 6, 14, -8, 20, 3]], MARGIN + 6, 240, [1, 1], 'S', false);

    // client name medallion
    const ncx = PW - 40, ncy = 236, nr = 13;
    doc.setFillColor(...IV.navyDark); doc.setDrawColor(...IV.gold); doc.setLineWidth(0.6);
    doc.circle(ncx, ncy, nr, 'FD');
    doc.setFont('times', 'italic'); doc.setFontSize(name.length > 12 ? 8 : 10);
    doc.setTextColor(...IV.white);
    doc.text(name, ncx, ncy, { align: 'center', baseline: 'middle', maxWidth: nr * 1.7 });

    // closing message + date
    doc.setFont('times', 'italic'); doc.setFontSize(13); doc.setTextColor(...IV.white);
    doc.text('Prepared with care for ' + name, PW / 2, 262, { align: 'center' });
    doc.setFont('courier', 'normal'); doc.setFontSize(9); doc.setTextColor(...IV.gold);
    doc.text(monYear, PW / 2, 270, { align: 'center', charSpace: 1.5 });

    // QR placeholder bottom-right
    const qx = PW - 38, qy = PH - 34, qs = 18, mod = qs / 7;
    doc.setDrawColor(...IV.gold); doc.setLineWidth(0.4); doc.rect(qx, qy, qs, qs, 'S');
    doc.setFillColor(...IV.goldBright);
    const pat = [
      [1,1,1,0,1,1,1],[1,0,1,0,1,0,1],[1,1,1,0,1,1,1],[0,0,0,1,0,0,0],
      [1,0,1,0,1,0,1],[1,1,0,1,0,1,1],[1,0,1,0,1,0,1]
    ];
    pat.forEach((row, r) => row.forEach((c, q) => { if (c) doc.rect(qx + q * mod, qy + r * mod, mod, mod, 'F'); }));
    doc.setFont(SANS, 'normal'); doc.setFontSize(6); doc.setTextColor(...IV.goldBright);
    doc.text('Scan for online version', qx + qs / 2, qy + qs + 3.5, { align: 'center' });
  }

  /* ======================================================================
     ASSEMBLE — two-pass (reserve TOC page, build body recording pages)
     ====================================================================== */
  const toc = [];                                  // {num, title, page, icon}

  // PAGE 1 cover
  drawCoverPage();
  // PAGE 2 reserved for TOC
  doc.addPage();
  // DASHBOARD — native page A
  doc.addPage(); drawDashboardNative();
  const dashStart = doc.getCurrentPageInfo().pageNumber;
  // DASHBOARD — native page B (continued)
  doc.addPage(); drawDashboardNative2();
  toc.push({ num: '00', title: 'Plan at a Glance — Dashboard', page: dashStart, icon: 'dashboard' });

  // Section + captured-charts assembly inside try/finally for pdf-capture class
  const sections = Array.from(document.querySelectorAll('.report-section'));
  document.body.classList.add('pdf-capture');
  try {
    // captured #charts-area appended onto dashboard flow as its own page (real app charts)
    const chartsEl = document.getElementById('charts-area');
    if (chartsEl) {
      const cCanvas = await captureEl(chartsEl, '#FAF7EF');
      if (cCanvas) {
        doc.addPage(); drawBodyBackdrop(doc);
        doc.setFont(SANS, 'bold'); doc.setFontSize(8); doc.setTextColor(...IV.goldDeep);
        doc.text('§ DASHBOARD  —  LIVE CHARTS', MARGIN, BODY_TOP + 4, { charSpace: 1.5 });
        // place beneath a slim eyebrow
        const imgW = CONTENT_W - 14;
        const ph = Math.min(FOOTER_RULE_Y - (BODY_TOP + 10) - 4, cCanvas.height * imgW / cCanvas.width);
        const pw = ph * cCanvas.width / cCanvas.height;
        doc.addImage(cCanvas.toDataURL('image/jpeg', 0.85), 'JPEG', MARGIN, BODY_TOP + 10,
          Math.min(imgW, pw), ph);
      }
    }

    // One page per section
    for (let i = 0; i < sections.length; i++) {
      const el = sections[i];
      const h2 = el.querySelector('h2');
      const title = h2 ? h2.textContent.trim() : ('Section ' + (i + 1));
      const num = String(i + 1).padStart(2, '0');
      doc.addPage(); drawBodyBackdrop(doc);
      const startPage = doc.getCurrentPageInfo().pageNumber;
      const canvas = await captureEl(el, '#0B1F3A');
      placeCapture(canvas, (part) => sectionChrome(i + 1, sections.length, title, true));
      sectionChrome(i + 1, sections.length, title, false);
      toc.push({ num, title, page: startPage, icon: iconForTitle(title) });
    }
  } finally {
    document.body.classList.remove('pdf-capture');
  }

  // CLOSING page
  doc.addPage(); drawClosingPage();
  const closingPage = doc.getCurrentPageInfo().pageNumber;
  toc.push({ num: 'Final', title: 'Closing & Disclaimer', page: closingPage, icon: 'book' });

  const total = doc.getNumberOfPages();

  /* ---- TOC pass (page 2) ------------------------------------------------ */
  doc.setPage(2);
  drawBodyBackdrop(doc);
  // vertical decorative gold rule down left margin
  doc.setDrawColor(...IV.gold); doc.setLineWidth(0.8); doc.line(MARGIN - 4, HEADER_H + 2, MARGIN - 4, PH - 14);
  doc.setLineWidth(0.3); doc.line(MARGIN - 2.6, HEADER_H + 2, MARGIN - 2.6, PH - 14);
  // eyebrow + title
  doc.setFont(SANS, 'bold'); doc.setFontSize(8); doc.setTextColor(...IV.goldDeep);
  doc.text('§ TABLE OF CONTENTS', MARGIN, BODY_TOP + 8, { charSpace: 1.5 });
  doc.setFont('times', 'normal'); doc.setFontSize(36); doc.setTextColor(...IV.navy);
  doc.text('Contents', MARGIN, BODY_TOP + 24);
  doc.setDrawColor(...IV.gold); doc.setLineWidth(0.9); doc.line(MARGIN, BODY_TOP + 29, MARGIN + 30, BODY_TOP + 29);

  let ty = BODY_TOP + 44;
  toc.forEach(item => {
    drawIcon(doc, item.icon, MARGIN + 3, ty - 1.4, 6, IV.goldDeep);
    doc.setFont(SANS, 'bold'); doc.setFontSize(11); doc.setTextColor(...IV.gold);
    doc.text(item.num, MARGIN + 10, ty);
    doc.setFont(SANS, 'normal'); doc.setFontSize(12); doc.setTextColor(...IV.navy);
    const titleX = MARGIN + 26;
    doc.text(item.title, titleX, ty);
    const tw = doc.getTextWidth(item.title);
    // gold dot leaders
    const pageStr = String(item.page);
    doc.setFont(SANS, 'bold'); doc.setFontSize(12);
    const numW = doc.getTextWidth(pageStr);
    const leadStart = titleX + tw + 3, leadEnd = PW - MARGIN - numW - 3;
    doc.setFillColor(...IV.gold);
    for (let lx = leadStart; lx < leadEnd; lx += 2.5) doc.circle(lx, ty - 1, 0.35, 'F');
    doc.setTextColor(...IV.navy);
    doc.text(pageStr, PW - MARGIN, ty, { align: 'right' });
    ty += 13;
  });

  /* ---- Final chrome stamping on body pages (2 .. total-1) --------------- */
  for (let pg = 2; pg <= total - 1; pg++) {
    doc.setPage(pg);
    drawHeaderBar(doc, pg, total, name, logoImg);
    drawFooter(doc, todayStr);
    drawPageRoundel(doc, pg);
  }

  const filename = 'InvestVerdict_' +
    name.replace(/\s+/g, '_').replace(/[^\w]/g, '') + '_' + fileDate + '.pdf';
  return { doc, filename };
}

/* ============================================================================
   Public entry point
   ========================================================================== */
async function downloadPDF() {
  try {
    const { doc, filename } = await buildReportDoc();
    doc.save(filename);
  } catch (e) {
    console.error('PDF generation failed:', e);
    alert('PDF error: ' + (e.message || e));
  }
}

window.downloadPDF = downloadPDF;
window.buildReportDoc = buildReportDoc;
