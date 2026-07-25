/* =============================================================================
 * components.js — shared chrome and render helpers used by every page:
 * header + mega menu, scrolling ticker tape, search overlay, sign-in /
 * newsletter / alert modals, metered paywall, watchlist, toasts, live-TV dock,
 * footer, theme switching, article cards and quote tables.
 * ========================================================================== */

(function () {
  'use strict';

  const CFG = window.IV_CONFIG;
  const DATA = window.IV_DATA;
  const LS = {
    get(k, d) { try { return JSON.parse(localStorage.getItem('iv.' + k)) ?? d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('iv.' + k, JSON.stringify(v)); } catch (_) {} }
  };

  /* ----------------------------------------------------------- formatting -- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmt(v, d) {
    if (v == null || !isFinite(v)) return '—';
    return (+v).toLocaleString(undefined, { minimumFractionDigits: d ?? 2, maximumFractionDigits: d ?? 2 });
  }
  function signed(v, d) { return (v > 0 ? '+' : '') + fmt(v, d); }
  function pctStr(v) { return (v > 0 ? '+' : '') + fmt(v, 2) + '%'; }
  function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; }
  function abbr(v) {
    const a = Math.abs(v || 0);
    if (a >= 1e12) return (v / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return fmt(v, 0);
  }
  function timeAgo(ts) {
    const s = Math.max(1, (Date.now() - ts) / 1000);
    if (s < 60) return Math.floor(s) + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    const d = Math.floor(s / 86400);
    if (d < 7) return d + 'd ago';
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function clockStr(ts) {
    return new Date(ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  const qhref = (sym) => 'quote.html?s=' + encodeURIComponent(sym);
  const ahref = (id) => 'article.html?id=' + encodeURIComponent(id);

  /* ---------------------------------------------------------------- theme -- */
  function initTheme() {
    const saved = LS.get('theme', CFG.features.theme);
    apply(saved);
    function apply(mode) {
      const dark = mode === 'dark' ||
        (mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      LS.set('theme', mode);
    }
    return {
      toggle() {
        const cur = document.documentElement.getAttribute('data-theme');
        apply(cur === 'dark' ? 'light' : 'dark');
        window.dispatchEvent(new Event('iv:theme'));
      }
    };
  }
  const theme = initTheme();

  /* ------------------------------------------------------------ watchlist -- */
  const Watchlist = {
    all() { return LS.get('watchlist', ['SPX', 'AAPL', 'NVDA', 'BTC', 'US10Y', 'CL1']); },
    has(s) { return this.all().includes(s); },
    toggle(s) {
      const list = this.all();
      const i = list.indexOf(s);
      if (i >= 0) list.splice(i, 1); else list.push(s);
      LS.set('watchlist', list);
      window.dispatchEvent(new CustomEvent('iv:watchlist', { detail: list }));
      toast(i >= 0 ? `${s} removed from watchlist` : `${s} added to watchlist`);
      return i < 0;
    }
  };

  /* --------------------------------------------------------------- alerts -- */
  const Alerts = {
    all() { return LS.get('alerts', []); },
    add(a) { const l = this.all(); l.push(Object.assign({ id: Date.now(), fired: false }, a)); LS.set('alerts', l); return l; },
    remove(id) { LS.set('alerts', this.all().filter(a => a.id !== id)); },
    check(quotes) {
      const l = this.all(); let changed = false;
      l.forEach(a => {
        if (a.fired) return;
        const q = Market.quote(a.sym); if (!q) return;
        const hit = a.dir === 'above' ? q.last >= a.px : q.last <= a.px;
        if (hit) { a.fired = true; a.firedAt = Date.now(); changed = true; toast(`ALERT · ${a.sym} ${a.dir} ${a.px} (${fmt(q.last, q.decimals)})`, 6000); }
      });
      if (changed) LS.set('alerts', l);
    }
  };

  /* ------------------------------------------------------------- motion --- */
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Restart-safe flash: strip the class, force reflow, re-add. */
  function flash(el, dir, upClass, downClass) {
    if (!el || reduced()) return;
    const u = upClass || 'flash-up', d = downClass || 'flash-down';
    el.classList.remove(u, d);
    void el.offsetWidth;
    el.classList.add(dir > 0 ? u : d);
  }

  /* Stagger the first paint of each block so the page assembles rather than
     appearing all at once. */
  function revealOnLoad() {
    if (reduced()) return;
    const blocks = document.querySelectorAll('main > .wrap > section, main .layout > div > section, main .layout > .rail > section, .lead, .strip');
    blocks.forEach((el, i) => {
      if (i > 11) return;
      el.style.animationDelay = (i * 45) + 'ms';
      el.classList.add('reveal');
    });
  }

  /* Masthead condenses once the page scrolls, and hides the mega menu. */
  function pinHeader() {
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    let last = -1;
    const onScroll = () => {
      const y = window.scrollY;
      const pinned = y > 24;
      if (pinned !== (last === 1)) { bar.classList.toggle('pinned', pinned); last = pinned ? 1 : 0; }
    };
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
  }

  /* --------------------------------------------------------------- toasts -- */
  function toast(msg, ms) {
    let host = document.querySelector('.toasts');
    if (!host) { host = document.createElement('div'); host.className = 'toasts'; document.body.appendChild(host); }
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.remove(), ms || 3200);
  }

  /* -------------------------------------------------------------- paywall -- */
  const Paywall = {
    isSubscriber() { return !!LS.get('subscriber', false); },
    subscribe(plan) { LS.set('subscriber', true); LS.set('plan', plan || 'digital'); },
    signOut() { LS.set('subscriber', false); },
    read() { return LS.get('read', []); },
    /* returns true when the wall should be shown */
    consume(articleId, premium) {
      if (!CFG.features.paywall || !premium || this.isSubscriber()) return false;
      const read = this.read();
      if (!read.includes(articleId)) { read.push(articleId); LS.set('read', read); }
      return read.length > CFG.features.freeArticles;
    },
    remaining() { return Math.max(0, CFG.features.freeArticles - this.read().length); }
  };

  /* --------------------------------------------------------------- header -- */
  function header(active) {
    const b = CFG.brand;
    const nav = CFG.sections.slice(0, 8).map(s =>
      `<a href="section.html?s=${s.id}" class="${active === s.id ? 'active' : ''}">${esc(s.label)}</a>`).join('');
    return `
<header class="topbar">
  <div class="topbar-inner">
    <button class="icon-btn menu-btn" id="menuBtn" aria-label="Menu">${icon('menu')}</button>
    <a class="brand" href="index.html">${esc(b.name)}</a>
    <nav class="topnav" id="topnav">
      ${nav}
      <a href="terminal.html" class="${active === 'terminal' ? 'active' : ''}">Terminal</a>
      <a href="video.html" class="${active === 'video' ? 'active' : ''}">Video</a>
      <a href="#" class="only-mobile" id="navSign">Sign In</a>
    </nav>
    <div class="topbar-actions">
      <button class="icon-btn" id="searchBtn" title="Search  (/)">${icon('search')}</button>
      <button class="icon-btn" id="tvBtn" title="Live TV">${icon('tv')}</button>
      <button class="icon-btn" id="themeBtn" title="Theme">${icon('moon')}</button>
      <a class="icon-btn" id="wlTopBtn" href="watchlist.html" title="Watchlist">${icon('star')}</a>
      <button class="btn btn-sm btn-sub" id="subBtn">${Paywall.isSubscriber() ? 'Account' : 'Subscribe'}</button>
      <button class="btn btn-sm btn-ghost" id="signBtn">Sign In</button>
    </div>
  </div>
  <div class="mega" id="mega">
    <div class="mega-inner">
      ${CFG.sections.map(s => `<div><h4>${esc(s.label)}</h4>${DATA.articlesBySection(s.id).slice(0, 3)
        .map(a => `<a href="${ahref(a.id)}">${esc(a.t)}</a>`).join('') || '<a href="#">Coming soon</a>'}</div>`).join('')}
      <div><h4>More</h4>
        <a href="markets.html">Markets Data</a><a href="terminal.html">Terminal</a>
        <a href="watchlist.html">Watchlist</a><a href="podcasts.html">Podcasts</a>
        <a href="newsletters.html">Newsletters</a><a href="subscribe.html">Subscribe</a>
      </div>
    </div>
  </div>
</header>
<div class="tape" id="tape"><div class="tape-track" id="tapeTrack"></div></div>
${CFG.features.breakingBanner ? breakingHtml() : ''}`;
  }

  function breakingHtml() {
    const a = DATA.latest(1)[0];
    if (LS.get('breakingDismissed', 0) > Date.now() - 6 * 3600e3) return '';
    return `<div class="breaking" id="breaking">
      <span class="lbl">Breaking</span>
      <a href="${ahref(a.id)}">${esc(a.t)}</a>
      <button id="breakingX" aria-label="Dismiss">×</button></div>`;
  }

  function icon(name) {
    const p = {
      menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/>',
      tv: '<rect x="3" y="6" width="18" height="12" rx="1"/><path d="M8 3l4 3 4-3"/>',
      moon: '<path d="M20 14.5A8 8 0 019.5 4a8.2 8.2 0 1010.5 10.5z"/>',
      star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
      close: '<path d="M5 5l14 14M19 5L5 19"/>'
    }[name] || '';
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  }

  /* --------------------------------------------------------------- footer -- */
  function footer() {
    const b = CFG.brand;
    const col = (title, links) => `<div><h5>${title}</h5>${links.map(([t, h]) => `<a href="${h}">${t}</a>`).join('')}</div>`;
    return `
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <a class="brand" href="index.html" style="color:var(--ink)"><span class="brand-mark" style="background:var(--ink);color:var(--bg)">${esc(b.mark)}</span>${esc(b.name)}</a>
        <p class="disclaimer" style="margin-top:12px">${esc(b.tagline)}. A demonstration product built with placeholder data. Nothing here is real market data, and nothing here is investment advice.</p>
      </div>
      ${col('Markets', [['Overview', 'markets.html'], ['Stocks', 'markets.html#equity'], ['Rates', 'markets.html#rate'], ['Currencies', 'markets.html#fx'], ['Commodities', 'markets.html#commodity'], ['Crypto', 'markets.html#crypto']])}
      ${col('Sections', CFG.sections.slice(0, 6).map(s => [s.label, 'section.html?s=' + s.id]))}
      ${col('Media', [['Video', 'video.html'], ['Podcasts', 'podcasts.html'], ['Newsletters', 'newsletters.html'], ['Live TV', '#tv']])}
      ${col('Company', [['Subscribe', 'subscribe.html'], ['Terminal', 'terminal.html'], ['Careers', '#'], ['Advertise', '#'], ['Press', '#']])}
    </div>
    <div class="footer-note">
      © ${b.year} ${esc(b.legal)}. All rights reserved. Prices are simulated and delayed by design.
      <span style="float:right">Data engine: ${CFG.features.liveData ? 'live feed' : 'simulation'} · tick ${CFG.features.tickMs}ms</span>
    </div>
  </div>
</footer>`;
  }

  /* ----------------------------------------------------------- ticker tape */
  function mountTape() {
    const track = document.getElementById('tapeTrack');
    if (!track) return;
    const syms = ['SPX', 'INDU', 'CCMP', 'RTY', 'VIX', 'UKX', 'DAX', 'NKY', 'HSI', 'US10Y', 'EURUSD', 'USDJPY', 'GBPUSD', 'DXY', 'CL1', 'CO1', 'GC1', 'HG1', 'BTC', 'ETH'];
    const render = () => {
      const items = syms.map(s => {
        const q = Market.quote(s); if (!q) return '';
        return `<a class="tape-item" href="${qhref(s)}" data-tsym="${s}">
          <span class="t-sym">${esc(s)}</span>
          <span class="t-px">${fmt(q.last, q.decimals)}</span>
          <span class="t-chg ${cls(q.pct)}">${pctStr(q.pct)}</span></a>`;
      }).join('');
      track.innerHTML = items + items;              // duplicated for seamless loop
      track.style.animation = `tape-scroll ${syms.length * 3.2}s linear infinite`;
    };
    render();
    const tape = document.getElementById('tape');
    tape.addEventListener('mouseenter', () => tape.classList.add('paused'));
    tape.addEventListener('mouseleave', () => tape.classList.remove('paused'));
    Market.subscribe((touched) => {
      const moved = new Set(touched.map(q => q.sym));
      track.querySelectorAll('[data-tsym]').forEach(el => {
        const q = Market.quote(el.dataset.tsym); if (!q) return;
        el.querySelector('.t-px').textContent = fmt(q.last, q.decimals);
        const c = el.querySelector('.t-chg');
        c.textContent = pctStr(q.pct);
        c.className = 't-chg ' + cls(q.pct);
        if (moved.has(q.sym)) flash(el, q.dir);   // whole cell pulses like a blotter
      });
    });
  }

  /* ------------------------------------------------------------ overlays -- */
  function ensureOverlay(id, inner, wide) {
    let o = document.getElementById(id);
    if (o) return o;
    o = document.createElement('div');
    o.className = 'overlay'; o.id = id;
    o.innerHTML = `<div class="sheet ${wide || ''}" style="position:relative">
      <button class="close" data-close>×</button>${inner}</div>`;
    document.body.appendChild(o);
    o.addEventListener('click', (e) => { if (e.target === o || e.target.hasAttribute('data-close')) o.classList.remove('open'); });
    return o;
  }
  const openOverlay = (o) => { o.classList.add('open'); };

  function searchOverlay() {
    const o = ensureOverlay('searchOverlay', `
      <input class="search-input" id="searchInput" placeholder="Search securities, people, stories…" autocomplete="off">
      <div class="search-results" id="searchResults"></div>`, 'search-sheet');
    const input = o.querySelector('#searchInput');
    const out = o.querySelector('#searchResults');
    let idx = -1;
    const draw = async () => {
      const term = input.value.trim();
      if (!term) {
        out.innerHTML = `<div class="search-group"><h5>Trending</h5>` +
          ['NVDA', 'SPX', 'BTC', 'US10Y', 'AAPL', 'CL1'].map(s => {
            const q = Market.quote(s);
            return `<a class="search-item" href="${qhref(s)}"><span class="s">${s}</span><span class="n">${esc(q.name)}</span><span class="p ${cls(q.pct)}">${pctStr(q.pct)}</span></a>`;
          }).join('') + '</div>';
        return;
      }
      const r = await API.search(term);
      out.innerHTML =
        (r.securities.length ? `<div class="search-group"><h5>Securities</h5>` + r.securities.map(q =>
          `<a class="search-item" href="${qhref(q.sym)}"><span class="s">${esc(q.sym)}</span><span class="n">${esc(q.name)}</span><span class="p ${cls(q.pct)}">${pctStr(q.pct)}</span></a>`).join('') + '</div>' : '') +
        (r.articles.length ? `<div class="search-group"><h5>Stories</h5>` + r.articles.map(a =>
          `<a class="search-item" href="${ahref(a.id)}"><span class="s">${esc(DATA.section(a.s).label)}</span><span class="n">${esc(a.t)}</span></a>`).join('') + '</div>' : '') ||
        `<div class="search-group"><h5>No matches</h5></div>`;
      idx = -1;
    };
    input.addEventListener('input', draw);
    input.addEventListener('keydown', (e) => {
      const items = [...out.querySelectorAll('.search-item')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        idx = Math.max(0, Math.min(items.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)));
        items.forEach(i => i.classList.remove('on'));
        if (items[idx]) { items[idx].classList.add('on'); items[idx].scrollIntoView({ block: 'nearest' }); }
      } else if (e.key === 'Enter' && items[idx]) { location.href = items[idx].href; }
      else if (e.key === 'Escape') o.classList.remove('open');
    });
    draw();
    openOverlay(o);
    setTimeout(() => input.focus(), 30);
  }

  function signInOverlay() {
    const subbed = Paywall.isSubscriber();
    const o = ensureOverlay('signOverlay', `
      <h3>${subbed ? 'Your account' : 'Sign in'}</h3>
      <p class="disclaimer">Authentication is stubbed for this prototype — no credentials leave the browser.</p>
      <label class="field"><span>Email</span><input type="email" id="siEmail" placeholder="you@example.com"></label>
      <label class="field"><span>Password</span><input type="password" id="siPass" placeholder="••••••••"></label>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn" id="siGo">${subbed ? 'Sign out' : 'Sign in'}</button>
        <a class="btn btn-ghost" href="subscribe.html">See plans</a>
      </div>
      <p class="meter" id="siMeter"></p>`);
    o.querySelector('#siMeter').textContent = subbed
      ? 'Subscriber access active on this device.'
      : `${Paywall.remaining()} free articles remaining this month.`;
    o.querySelector('#siGo').onclick = () => {
      if (subbed) { Paywall.signOut(); toast('Signed out'); }
      else { Paywall.subscribe('digital'); toast('Signed in — subscriber access enabled'); }
      setTimeout(() => location.reload(), 400);
    };
    openOverlay(o);
  }

  function newsletterOverlay() {
    const o = ensureOverlay('nlOverlay', `
      <h3>Get the newsletters</h3>
      <p class="disclaimer">Pick what lands in your inbox.</p>
      <div id="nlList" style="display:grid;gap:8px;margin:14px 0"></div>
      <label class="field"><span>Email</span><input type="email" id="nlEmail" placeholder="you@example.com"></label>
      <button class="btn" id="nlGo">Sign up</button>`);
    o.querySelector('#nlList').innerHTML = DATA.NEWSLETTERS.map(n =>
      `<label style="display:flex;gap:10px;align-items:flex-start;font-size:14px">
        <input type="checkbox" value="${n.id}" ${n.id === 'n1' ? 'checked' : ''}>
        <span><strong>${esc(n.t)}</strong> · <span class="disclaimer">${esc(n.cad)}</span><br><span style="color:var(--ink-2)">${esc(n.d)}</span></span>
      </label>`).join('');
    o.querySelector('#nlGo').onclick = async () => {
      const email = o.querySelector('#nlEmail').value;
      if (!/.+@.+\..+/.test(email)) return toast('Enter a valid email');
      const ids = [...o.querySelectorAll('#nlList input:checked')].map(i => i.value);
      await API.subscribeNewsletter(email, ids);
      toast(`Subscribed ${email} to ${ids.length} newsletter${ids.length === 1 ? '' : 's'}`);
      o.classList.remove('open');
    };
    openOverlay(o);
  }

  function alertOverlay(sym) {
    const q = Market.quote(sym);
    const o = ensureOverlay('alertOverlay', `
      <h3>Price alert</h3>
      <div id="alBody"></div>`);
    o.querySelector('#alBody').innerHTML = `
      <p class="disclaimer">Alerts evaluate against the live tape in this tab.</p>
      <label class="field"><span>Symbol</span><input id="alSym" value="${esc(sym || 'AAPL')}"></label>
      <label class="field"><span>Condition</span>
        <select id="alDir"><option value="above">Price rises above</option><option value="below">Price falls below</option></select></label>
      <label class="field"><span>Level</span><input id="alPx" class="mono" value="${q ? fmt(q.last * 1.02, q.decimals) : ''}"></label>
      <button class="btn" id="alGo">Create alert</button>
      <div id="alList" style="margin-top:18px"></div>`;
    const list = () => {
      o.querySelector('#alList').innerHTML = Alerts.all().length
        ? '<h5 style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)">Active</h5>' +
          Alerts.all().map(a => `<div class="mini-quote"><span class="l">${esc(a.sym)} ${a.dir} ${fmt(a.px, 2)}</span>
            <span class="r">${a.fired ? '<span class="up">fired</span>' : 'armed'} <button class="btn btn-sm btn-ghost" data-del="${a.id}">×</button></span></div>`).join('')
        : '';
      o.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { Alerts.remove(+b.dataset.del); list(); });
    };
    o.querySelector('#alGo').onclick = () => {
      const s = o.querySelector('#alSym').value.toUpperCase();
      if (!Market.quote(s)) return toast('Unknown symbol');
      Alerts.add({ sym: s, dir: o.querySelector('#alDir').value, px: parseFloat(o.querySelector('#alPx').value) });
      toast('Alert armed'); list();
    };
    list();
    openOverlay(o);
  }

  /* -------------------------------------------------------------- TV dock -- */
  function tvDock() {
    let d = document.getElementById('tvDock');
    if (!d) {
      d = document.createElement('div');
      d.id = 'tvDock'; d.className = 'tv-dock';
      d.innerHTML = `
        <div class="tv-screen"><div class="bars">${Array.from({ length: 28 }, (_, i) =>
          `<i style="animation-delay:${(i * 0.07).toFixed(2)}s"></i>`).join('')}</div></div>
        <div class="tv-meta"><span class="live">LIVE</span><span id="tvShow"></span><button class="x" id="tvX">×</button></div>
        <div class="tv-ticker" id="tvTick"></div>`;
      document.body.appendChild(d);
      d.querySelector('#tvX').onclick = () => d.classList.remove('open');
      const shows = ['The Open', 'Surveillance', 'Markets Now', 'The Close', 'Asia Trade'];
      const setShow = () => d.querySelector('#tvShow').textContent =
        shows[Math.floor(Date.now() / 60000) % shows.length] + ' · ' + clockStr(Date.now());
      setShow(); setInterval(setShow, 1000);
      Market.subscribe(() => {
        const q = Market.quote('SPX'), b = Market.quote('BTC');
        d.querySelector('#tvTick').textContent =
          `SPX ${fmt(q.last, 2)} ${pctStr(q.pct)}  ·  BTC ${fmt(b.last, 2)} ${pctStr(b.pct)}`;
      });
    }
    d.classList.toggle('open');
  }

  /* ---------------------------------------------------------- card render -- */
  function card(a, variant) {
    const sec = DATA.section(a.s);
    const au = DATA.author(a.a);
    const hl = { xl: 'hl-xl', l: 'hl-l', m: 'hl-m', s: 'hl-s' }[variant || 'm'] || 'hl-m';
    const showImg = variant !== 's';
    const showDek = variant === 'xl' || variant === 'l';
    return `<a class="card ${variant === 'row' ? 'row' : ''}" href="${ahref(a.id)}">
      ${showImg ? `<img class="thumb" loading="lazy" src="${DATA.image(a.id, 600, 400)}" alt="">` : ''}
      <div>
        <div class="eyebrow sec" style="--sec:${sec.accent}">${esc(sec.label)}</div>
        <h3 class="${hl} ${a.p ? 'premium' : ''}">${esc(a.t)}</h3>
        ${showDek ? `<p class="dek">${esc(a.d)}</p>` : ''}
        <div class="byline">${esc(au.name)}<span class="dot"></span>${timeAgo(a.ts)}${a.mins ? `<span class="dot"></span>${a.mins} min read` : ''}</div>
      </div></a>`;
  }

  /* -------------------------------------------------- live quote table --- */
  function quoteTable(host, symbols, opts) {
    const o = Object.assign({ spark: true, watch: true, cols: null }, opts || {});
    const cols = o.cols || ['sym', 'last', 'chg', 'pct', 'high', 'low', 'volume'];
    const head = {
      sym: 'Security', last: 'Last', chg: 'Chg', pct: '%Chg', high: 'High', low: 'Low',
      open: 'Open', volume: 'Volume', mcap: 'Mkt Cap', time: 'Time'
    };
    let sortKey = 'sym', asc = true;
    const el = typeof host === 'string' ? document.querySelector(host) : host;
    el.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr>
      ${cols.map(c => `<th data-k="${c}">${head[c] || c}</th>`).join('')}
      ${o.spark ? '<th>5D</th>' : ''}${o.watch ? '<th></th>' : ''}</tr></thead><tbody></tbody></table></div>`;
    const tbody = el.querySelector('tbody');

    function rows() {
      let list = Market.quotes(symbols);
      list.sort((a, b) => {
        const va = a[sortKey], vb = b[sortKey];
        const r = typeof va === 'string' ? String(va).localeCompare(String(vb)) : (va - vb);
        return asc ? r : -r;
      });
      tbody.innerHTML = list.map(q => `<tr data-sym="${q.sym}">
        ${cols.map(c => cell(q, c)).join('')}
        ${o.spark ? `<td><canvas class="spk" width="80" height="22" data-s="${q.sym}"></canvas></td>` : ''}
        ${o.watch ? `<td><button class="btn btn-sm btn-ghost wl" data-w="${q.sym}">${Watchlist.has(q.sym) ? '★' : '☆'}</button></td>` : ''}
      </tr>`).join('');
      if (o.spark) tbody.querySelectorAll('.spk').forEach(c =>
        Charts.spark(c, Market.history(c.dataset.s, '5D').map(b => b.c), { w: 80, h: 22 }));
      tbody.querySelectorAll('.wl').forEach(b => b.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        b.textContent = Watchlist.toggle(b.dataset.w) ? '★' : '☆';
      });
      tbody.querySelectorAll('tr').forEach(tr => tr.onclick = () => location.href = qhref(tr.dataset.sym));
    }
    function cell(q, c) {
      switch (c) {
        case 'sym': return `<td><span class="sym">${esc(q.sym)}</span> <span class="nm">${esc(q.name)}</span></td>`;
        case 'last': return `<td class="num" data-f="last">${fmt(q.last, q.decimals)}</td>`;
        case 'chg': return `<td class="num ${cls(q.chg)}" data-f="chg">${signed(q.chg, q.decimals)}</td>`;
        case 'pct': return `<td class="num ${cls(q.pct)}" data-f="pct">${pctStr(q.pct)}</td>`;
        case 'high': return `<td class="num" data-f="high">${fmt(q.high, q.decimals)}</td>`;
        case 'low': return `<td class="num" data-f="low">${fmt(q.low, q.decimals)}</td>`;
        case 'open': return `<td class="num">${fmt(q.open, q.decimals)}</td>`;
        case 'volume': return `<td class="num" data-f="volume">${abbr(q.volume)}</td>`;
        case 'mcap': return `<td class="num">${q.mcap ? abbr(q.mcap) : '—'}</td>`;
        case 'time': return `<td class="num" data-f="time">${clockStr(q.ts)}</td>`;
        default: return '<td></td>';
      }
    }
    el.querySelectorAll('th[data-k]').forEach(th => th.onclick = () => {
      const k = th.dataset.k;
      asc = sortKey === k ? !asc : (k === 'sym');
      sortKey = k;
      el.querySelectorAll('th').forEach(t => t.classList.remove('sorted', 'asc'));
      th.classList.add('sorted'); if (asc) th.classList.add('asc');
      rows();
    });
    rows();

    const unsub = Market.subscribe((touched) => {
      touched.forEach(q => {
        const tr = tbody.querySelector(`tr[data-sym="${cssq(q.sym)}"]`);
        if (!tr) return;
        const set = (f, v, klass) => {
          const td = tr.querySelector(`[data-f="${f}"]`);
          if (!td) return;
          td.textContent = v;
          if (klass !== undefined) td.className = 'num ' + klass;
        };
        set('last', fmt(q.last, q.decimals));
        set('chg', signed(q.chg, q.decimals), cls(q.chg));
        set('pct', pctStr(q.pct), cls(q.pct));
        set('high', fmt(q.high, q.decimals));
        set('low', fmt(q.low, q.decimals));
        set('volume', abbr(q.volume));
        set('time', clockStr(q.ts));
        flash(tr.querySelector('[data-f="last"]'), q.dir);
      });
    });
    return { refresh: rows, destroy: unsub };
  }
  const cssq = (s) => String(s).replace(/["\\]/g, '\\$&');

  /* ------------------------------------------------------------- mounting -- */
  function mount(active) {
    document.body.insertAdjacentHTML('afterbegin', header(active));
    document.body.insertAdjacentHTML('beforeend', footer());
    mountTape();

    const $ = (id) => document.getElementById(id);
    $('searchBtn').onclick = searchOverlay;
    $('themeBtn').onclick = theme.toggle;
    $('tvBtn').onclick = tvDock;
    $('signBtn').onclick = signInOverlay;
    $('subBtn').onclick = () => location.href = 'subscribe.html';
    const navSign = $('navSign');
    if (navSign) navSign.onclick = (e) => { e.preventDefault(); signInOverlay(); };
    $('menuBtn').onclick = () => $('topnav').classList.toggle('open');
    const bx = $('breakingX');
    if (bx) bx.onclick = () => { LS.set('breakingDismissed', Date.now()); $('breaking').remove(); };

    /* mega menu on hover over the nav */
    const mega = $('mega');
    let t;
    $('topnav').addEventListener('mouseenter', () => { t = setTimeout(() => mega.classList.add('open'), 220); });
    document.querySelector('.topbar').addEventListener('mouseleave', () => { clearTimeout(t); mega.classList.remove('open'); });

    /* keyboard shortcuts */
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea, select')) return;
      if (e.key === '/' ) { e.preventDefault(); searchOverlay(); }
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); searchOverlay(); }
      if (e.key === 't' && !e.metaKey && !e.ctrlKey) location.href = 'terminal.html';
      if (e.key === 'Escape') document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
    });

    Market.subscribe(q => Alerts.check(q));
    if (CFG.features.liveTv && LS.get('tvOpen', false)) tvDock();

    pinHeader();
    revealOnLoad();
  }

  window.UI = {
    esc, fmt, signed, pctStr, cls, abbr, timeAgo, clockStr, qhref, ahref,
    mount, card, quoteTable, toast, theme, Watchlist, Alerts, Paywall,
    searchOverlay, signInOverlay, newsletterOverlay, alertOverlay, tvDock, icon, LS,
    flash, reduced
  };
})();
