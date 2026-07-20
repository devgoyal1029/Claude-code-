/**
 * Persistent background 3D scene — the connective tissue of the whole page.
 * One scene, fixed full-viewport, driven by GLOBAL scroll progress (0..1) via
 * setProgress(). As you scroll the page like a movie:
 *   - the camera dollies in subtly
 *   - the "verdict orb" (navy core + gold wireframe shell) fades IN at the hero
 *     and the final CTA, and recedes through the middle so content stays clean
 *   - the gold particle field SPREADS into chaos around the problem section,
 *     then re-forms into order (clarity), and keeps drifting throughout
 *   - colour drifts gold -> cool -> gold
 *
 * Targets are set on scroll; the render loop eases current->target so motion is
 * always buttery, never jumpy. Perf: DPR capped at 2, particle count scales with
 * viewport, render pauses when the tab is hidden, full dispose() on teardown.
 */

import * as THREE from "three";

const CFG = {
  baseSpin: 0.0014, parallax: 0.16, parallaxEase: 0.05,
  ease: 0.06, entranceMs: 1300,
  core: 0x0a1c30, gold: 0xc9982a, goldBright: 0xf3cd63, cool: 0x2a6cff,
};

export async function mountScene(canvas, wrap) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));   // cap for perf
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 6.2);

  const group = new THREE.Group();
  scene.add(group);

  // core + faceted gold shell
  const coreMat = new THREE.MeshStandardMaterial({ color: CFG.core, metalness: 0.65, roughness: 0.28, emissive: CFG.gold, emissiveIntensity: 0.07, transparent: true, opacity: 1, flatShading: true });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 1), coreMat);
  group.add(core);
  const shellMat = new THREE.MeshBasicMaterial({ color: CFG.gold, wireframe: true, transparent: true, opacity: 0.28 });
  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.62, 1), shellMat);
  group.add(shell);

  // particle field — base positions kept so we can SPREAD them on scroll
  const count = innerWidth < 700 ? 520 : 1000;
  const base = new Float32Array(count * 3);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 2.1 + Math.random() * 1.8, t = Math.acos(2 * Math.random() - 1), ph = Math.random() * Math.PI * 2;
    base[i * 3] = r * Math.sin(t) * Math.cos(ph);
    base[i * 3 + 1] = r * Math.sin(t) * Math.sin(ph);
    base[i * 3 + 2] = r * Math.cos(t);
  }
  pos.set(base);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pMat = new THREE.PointsMaterial({ color: CFG.goldBright, size: 0.022, transparent: true, opacity: 0.72, sizeAttenuation: true, depthWrite: false });
  const particles = new THREE.Points(pGeo, pMat);
  group.add(particles);
  const tmpColA = new THREE.Color(CFG.goldBright), tmpColB = new THREE.Color(CFG.cool), curCol = new THREE.Color(CFG.goldBright);

  // lights
  scene.add(new THREE.AmbientLight(0x22354d, 0.7));
  const key = new THREE.PointLight(CFG.goldBright, 90, 40); key.position.set(4, 5, 5); scene.add(key);
  const rim = new THREE.PointLight(CFG.cool, 60, 40); rim.position.set(-6, -2, 2); scene.add(rim);

  // sizing
  function resize() {
    const w = wrap.clientWidth || innerWidth, h = wrap.clientHeight || innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize(); window.addEventListener("resize", resize);

  // pointer parallax
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  function onMove(e) { ptr.tx = (e.clientX / innerWidth - 0.5) * 2; ptr.ty = (e.clientY / innerHeight - 0.5) * 2; }
  window.addEventListener("pointermove", onMove, { passive: true });

  // --- scroll-driven targets (eased toward in the loop) ---
  const cur = { spread: 1, coreOp: 1, camZ: 6.2, colorMix: 0, orbX: 0 };
  const tgt = { ...cur };
  function setProgress(p) {
    // particle spread: bump to chaos around the "problem" band (~0.1–0.32) then settle
    const chaos = Math.exp(-Math.pow((p - 0.2) / 0.12, 2));       // gaussian peak at 0.2
    tgt.spread = 1 + 0.75 * chaos;
    // orb visible at hero & final, recedes through the middle (keeps content clean)
    tgt.coreOp = Math.max(smoothStep(0.12, 0.0, p), smoothStep(0.78, 0.95, p)) * 0.9 + 0.1;
    tgt.camZ = 6.2 - 0.7 * p;                                     // gentle dolly-in
    tgt.colorMix = 0.5 * Math.sin(p * Math.PI);                   // gold -> cool -> gold
    tgt.orbX = Math.sin(p * Math.PI * 1.5) * 0.5;                 // subtle lateral drift
  }
  setProgress(0);
  Object.assign(cur, tgt);

  // pause when tab hidden
  let running = true;
  const onVis = () => { running = document.visibilityState === "visible"; };
  document.addEventListener("visibilitychange", onVis);

  // render loop
  const start = performance.now();
  let raf = 0;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!running) return;

    // ease current toward scroll targets
    cur.spread += (tgt.spread - cur.spread) * CFG.ease;
    cur.coreOp += (tgt.coreOp - cur.coreOp) * CFG.ease;
    cur.camZ += (tgt.camZ - cur.camZ) * CFG.ease;
    cur.colorMix += (tgt.colorMix - cur.colorMix) * CFG.ease;
    cur.orbX += (tgt.orbX - cur.orbX) * CFG.ease;

    // entrance fade-in
    const k = Math.min(1, (now - start) / CFG.entranceMs);
    const ease = 1 - Math.pow(1 - k, 3);

    // spread via cheap transform scale — NO per-frame buffer upload
    particles.scale.setScalar(cur.spread);

    // colour drift
    curCol.copy(tmpColA).lerp(tmpColB, cur.colorMix);
    pMat.color.copy(curCol);

    // opacities
    coreMat.opacity = cur.coreOp * ease;
    shellMat.opacity = (0.1 + 0.2 * cur.coreOp) * ease;
    pMat.opacity = 0.72 * ease;

    // camera + transforms
    camera.position.z = cur.camZ;
    group.position.x = cur.orbX;
    group.rotation.y += CFG.baseSpin;
    particles.rotation.y -= CFG.baseSpin * 0.4;

    // pointer parallax
    ptr.x += (ptr.tx - ptr.x) * CFG.parallaxEase;
    ptr.y += (ptr.ty - ptr.y) * CFG.parallaxEase;
    group.rotation.x = ptr.y * CFG.parallax;
    camera.position.x = ptr.x * 0.4; camera.position.y = -ptr.y * 0.3;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(tick);

  function dispose() {
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pointermove", onMove);
    document.removeEventListener("visibilitychange", onVis);
    core.geometry.dispose(); coreMat.dispose(); shell.geometry.dispose(); shellMat.dispose();
    pGeo.dispose(); pMat.dispose(); renderer.dispose();
  }

  return { setProgress, dispose };
}

function smoothStep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
