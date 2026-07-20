/**
 * Landing orchestrator — SMOOTH-FIRST rebuild.
 *
 * Lessons applied after jank reports:
 *   - NO continuous requestAnimationFrame, NO Lenis. Work happens ONLY on real
 *     scroll/resize/pointer events, throttled to one frame (rAF flag).
 *   - All motion uses compositor-only properties (transform/opacity) so the main
 *     thread never blocks scrolling.
 *   - The heavy WebGL background is OPT-IN via ?3d=1 (capable machines / review);
 *     by default the cinematic feel comes from the CSS orb + gradient driven by
 *     cheap transforms — buttery on mid-range devices.
 *
 * The tool route imports none of this.
 */

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(pointer: coarse)").matches;

function isLowPower() {
  const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  if (navigator.connection && navigator.connection.saveData) return true;
  if (mem <= 2 || cores <= 2) return true;
  if (coarse && innerWidth < 820 && mem <= 4) return true;
  return false;
}
// The faceted 3D orb is the centerpiece — ON by default for capable devices
// (the old jank sources are fixed). Reduced-motion / low-power keep the CSS orb.
// Force-disable with ?no3d for testing on weak hardware.
const want3D = !reduced && !isLowPower() && !new URLSearchParams(location.search).has("no3d");

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

const nav = document.getElementById("nav");
const bg = document.getElementById("bg-gradient");
const orb = document.getElementById("fallback-orb");
const problem = document.getElementById("problem");
const stateMessy = document.getElementById("state-messy");
const stateClear = document.getElementById("state-clear");
const tFrom = document.querySelector(".t-from");
const how = document.getElementById("how");
const stepProgress = document.getElementById("step-progress");
const fxA = document.getElementById("fxA");
const fxB = document.getElementById("fxB");

let scene = null;
const ptr = { x: 0, y: 0 };

/* ---------- reveals (IntersectionObserver, no scroll cost) ---------- */
function initReveals() {
  const els = document.querySelectorAll(".reveal-on-scroll");
  if (reduced) { els.forEach((e) => e.classList.add("in")); return; }
  const io = new IntersectionObserver((ents) => {
    for (const e of ents) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { threshold: 0.15, rootMargin: "0px 0px -8% 0px" });
  els.forEach((e) => io.observe(e));
}

/* ---------- pointer FX: magnetic buttons, tool tilt, orb parallax ---------- */
function initPointerFX() {
  if (reduced || coarse) return;
  document.querySelectorAll(".magnetic").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - (r.left + r.width / 2)) * .3}px, ${(e.clientY - (r.top + r.height / 2)) * .3}px)`;
    });
    el.addEventListener("pointerleave", () => { el.style.transform = ""; });
  });
  const frame = document.getElementById("tool-frame");
  if (frame) {
    const wrap = frame.closest(".showcase-inner") || frame.parentElement;
    wrap.addEventListener("pointermove", (e) => {
      const r = frame.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / r.width, dy = (e.clientY - (r.top + r.height / 2)) / r.height;
      frame.style.transform = `perspective(1000px) rotateY(${dx * 9}deg) rotateX(${-dy * 9}deg)`;
    });
    wrap.addEventListener("pointerleave", () => { frame.style.transform = "perspective(1000px)"; });
  }
  // orb follows the pointer subtly (transform only)
  window.addEventListener("pointermove", (e) => {
    ptr.x = e.clientX / innerWidth - 0.5; ptr.y = e.clientY / innerHeight - 0.5; requestTick();
  }, { passive: true });
}

/* ---------- cached metrics (measured off the hot path) ---------- */
const M = { max: 1, problemTop: 0, problemH: 1, howTop: 0, howH: 1 };
function measure() {
  const sy = window.scrollY || 0;
  M.max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  if (problem) { const r = problem.getBoundingClientRect(); M.problemTop = r.top + sy; M.problemH = problem.offsetHeight; }
  if (how) { const r = how.getBoundingClientRect(); M.howTop = r.top + sy; M.howH = how.offsetHeight; }
}

/* ---------- the single, event-driven render pass ---------- */
let ticking = false, lastBgY = -1, lastShrink = null;
function render() {
  ticking = false;
  const y = window.scrollY || document.documentElement.scrollTop;
  const p = clamp(y / M.max);

  const shrink = y > 40;
  if (shrink !== lastShrink) { nav.classList.toggle("shrink", shrink); lastShrink = shrink; }

  const bgY = Math.round(8 + p * 42);
  if (bgY !== lastBgY) { bg.style.setProperty("--bgY", bgY + "%"); lastBgY = bgY; }

  // orb: compositor-only transform (scale echoes the problem "chaos", drifts with scroll + pointer)
  if (orb && !reduced) {
    const chaos = Math.exp(-Math.pow((p - 0.2) / 0.12, 2));
    const scale = (1 + chaos * 0.16 - p * 0.04).toFixed(3);
    const tx = (ptr.x * 30).toFixed(1), ty = (ptr.y * 22 + p * 36).toFixed(1);
    orb.style.transform = `translate(-50%,-50%) translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
  }

  // FX parallax: two layers move at different rates (depth) — one transform each
  if (!reduced) {
    if (fxA) fxA.style.transform = `translate3d(0, ${(-p * 130).toFixed(1)}px, 0)`;
    if (fxB) fxB.style.transform = `translate3d(0, ${(-p * 300).toFixed(1)}px, 0)`;
  }

  if (scene) scene.setProgress(p);

  if (problem && !reduced && y + innerHeight > M.problemTop && y < M.problemTop + M.problemH) {
    const sub = clamp((y - M.problemTop) / ((M.problemH - innerHeight) || 1));
    const messy = 1 - smooth(0.12, 0.55, sub), clear = smooth(0.4, 0.82, sub);
    stateMessy.style.opacity = messy.toFixed(2);
    stateClear.style.opacity = clear.toFixed(2);
    stateClear.style.transform = `scale(${(0.96 + clear * 0.04).toFixed(3)})`;
    if (tFrom) tFrom.style.opacity = (0.85 - clear * 0.65).toFixed(2);
  }

  if (how && stepProgress && y + innerHeight > M.howTop && y < M.howTop + M.howH) {
    stepProgress.style.width = Math.round(clamp((y + innerHeight * 0.85 - M.howTop) / (M.howH * 0.7)) * 100) + "%";
  }
}
function requestTick() { if (!ticking) { ticking = true; requestAnimationFrame(render); } }

/* ---------- optional WebGL (opt-in) ---------- */
async function initScene() {
  const wrap = document.getElementById("bg-canvas");
  if (!wrap) return;
  try {
    const canvas = document.createElement("canvas");
    wrap.appendChild(canvas);
    const { mountScene } = await import("./scene3d.mjs");
    scene = await mountScene(canvas, wrap);
    wrap.classList.add("has3d");
  } catch (e) { console.warn("3D scene failed; CSS background retained.", e); }
}

// listeners (passive, throttled to one frame)
addEventListener("scroll", requestTick, { passive: true });
addEventListener("resize", () => { measure(); requestTick(); }, { passive: true });
addEventListener("load", () => { measure(); requestTick(); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); requestTick(); });

// boot
measure();
initReveals();
initPointerFX();
requestTick();
if (want3D) (("requestIdleCallback" in window) ? requestIdleCallback(initScene, { timeout: 1500 }) : setTimeout(initScene, 300));
