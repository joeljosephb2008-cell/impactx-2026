// REWIND: customer app + judge console. All decisions come from Engine (engine.js); this file only draws.
(function () {
  const E = Engine, S = Scenario, { LANGS, STR } = I18N;
  const APP = 'returnease';
  const $ = s => document.querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NOW = S.NOW, O = S.ORDER, O2 = S.ORDER2;
  const inr = E.fmtINR;
  const when = iso => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const day = iso => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
  const PAY = { card: ['#16131F', '💳'], wallet: ['#3DDC97', '👛'], voucher: ['#FFC53D', '🎟️'], upi: ['#5B8CFF', '📲'] };
  const orderOf = id => [O, O2].find(o => o.items.some(i => i.id === id));
  const itemOf = id => orderOf(id).items.find(i => i.id === id);
  const payOf = (order, id) => order.payments.find(p => p.id === id);

  // ---------------------------------------------------------------- UI state (not saved)
  const ui = { lang: 'en', theme: 'light', user: null, name: '', chat: [], chatOpen: false, tests: null, reviews: [], saving: '', wiz: null, menu: false, authTab: 'in', authErr: '', splash: true, reports: [] };
  try { ui.lang = localStorage.getItem('rewind-lang') || 'en'; ui.theme = localStorage.getItem('rewind-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); } catch (e) {}
  const t = k => (STR[ui.lang] && STR[ui.lang][k]) || STR.en[k] || k;

  // ---------------------------------------------------------------- saved state (per user)
  let st = null;
  function seed() {
    const items = JSON.parse(JSON.stringify(S.ITEMS_IN_RETURN));
    const s = { v: 3, items, extra: [], ledger: E.createLedger(), audit: E.createAudit(), tickets: [], appeals: {}, faults: { stale: false, timeout: false, offline: false }, queue: [], faultLog: [], tamperBackup: null };
    const allocB = E.allocate(O, { items: [{ itemId: 'B' }] }, { order: 'proportional', now: '2026-10-21T04:30:00.000Z' });
    items.B.alloc = allocB;
    allocB.legs.forEach(l => { Object.assign(items.B.refundLegs[l.instrumentId], { amount: l.amount, leg: l }); });
    const evs = [];
    items.A.item.forEach(h => evs.push({ at: h.at, actor: /PICKUP|COLLECTED|TRANSIT/.test(h.state) ? 'courier' : /INSPECTION|RECEIVED/.test(h.state) ? 'warehouse' : 'customer', action: h.state, data: { items: h.state.startsWith('INSPECTION') ? 'A' : 'A+B', attempt: h.attempt, note: h.note || h.why } }));
    items.B.item.filter(h => h.state.startsWith('INSPECTION')).forEach(h => evs.push({ at: h.at, actor: 'warehouse', action: h.state, data: { items: 'B' } }));
    Object.entries(items.B.refundLegs).forEach(([pm, leg]) => leg.history.slice(1).forEach(h => evs.push({ at: h.at, actor: 'payments', action: 'REFUND_' + h.state, data: { items: 'B', instrument: pm, amount: leg.amount, arn: h.arn } })));
    evs.sort((a, b) => a.at.localeCompare(b.at)).forEach(e => E.auditAppend(s.audit, e.actor, e.action, e.data, e.at));
    Object.entries(items.B.refundLegs).forEach(([pm, leg]) => { leg.ref = E.issueRefund(s.ledger, `${S.RETURN_ID}:B:${pm}`, leg.amount, leg.history[3].at).refund.ref; });
    return s;
  }
  let saveTimer;
  function save() {
    clearTimeout(saveTimer); ui.saving = 'saving';
    saveTimer = setTimeout(async () => { ui.saving = await API.saveState(st); const el = $('#saved'); if (el) el.textContent = ui.saving === 'cloud' ? '☁︎ Saved' : '● Saved on this device'; }, 500);
  }
  const log = (actor, action, data) => E.auditAppend(st.audit, actor, action, data, new Date().toISOString());

  // ---------------------------------------------------------------- derived
  function legsOf(id) { const r = rec(id); return r ? Object.entries(r.refundLegs || {}).map(([pm, l]) => ({ pm, ...l, state: E.current(l.history).state })) : []; }
  function rec(id) { return st.items[id] || (st.extra.find(r => r.items[id]) || { items: {} }).items[id]; }
  function srcFor(leg) {
    const s = JSON.parse(JSON.stringify(leg.sources || {}));
    if (st.faults.stale && s.provider) s.provider.seenAt = '2026-10-23T02:30:00.000Z';
    if (st.faults.timeout && s.provider) s.provider.timeout = true;
    return s;
  }
  function verdictOf(id, leg) { const o = orderOf(id); return E.reconcile({ type: payOf(o, leg.pm).type, ref: leg.ref }, srcFor(leg), NOW); }
  function progress(id) {
    const r = rec(id), cur = E.current(r.item).state, legs = legsOf(id);
    let idx = /REQUESTED|PICKUP|DROPOFF/.test(cur) ? 0 : /COLLECTED|TRANSIT/.test(cur) ? 1 : 2;
    if (legs.length) idx = legs.every(l => l.state === 'CREDITED_CONFIRMED') ? 4 : 3;
    let status = idx === 4 ? 'done' : /HOLD|DISPUTED/.test(cur) ? 'hold' : 'moving';
    if (idx === 3) {
      const vs = legs.filter(l => l.state !== 'CREDITED_CONFIRMED').map(l => verdictOf(id, l).verdict);
      status = vs.includes('STUCK') ? 'stuck' : vs.includes('UNKNOWN') ? 'unknown' : 'waiting';
    }
    if (r.option === 'exchange' || r.option === 'replacement') status = idx >= 2 ? 'done' : status;
    return { cur, idx, status, fails: r.item.filter(h => h.state === 'PICKUP_FAILED').length, legs };
  }
  function allocFor(id) {
    const r = rec(id); if (r.alloc) return r.alloc;
    const o = orderOf(id), prior = {};
    if (o === O) st.items.B.alloc.legs.forEach(l => { prior[l.instrumentId] = l.amount; });
    const dec = r.decision;
    return E.allocate(o, { items: [{ itemId: id, ...(dec && dec.refundPct < 100 ? { deductionPct: 100 - dec.refundPct, deductionReason: dec.reason } : {}) }] }, { order: 'proportional', now: NOW }, prior);
  }
  function headline(id) {
    const r = rec(id), p = progress(id), it = itemOf(id);
    if (r.option === 'exchange') return { msg: `Exchange booked: new ${it.short.toLowerCase()} arrives with the pickup agent. No money moves.`, why: 'You chose exchange; stock reserved.', conf: 'high', src: 'Order system', at: E.current(r.item).at };
    if (p.status === 'hold') { const due = E.addDays(r.inspection.openedAt, r.inspection.slaHours / 24); return { msg: E.message('item', 'INSPECTION_DISPUTED', { item: it.short, when: when(due) }), why: 'Warehouse flagged “used: sole wear”. You sent handover photos, so a separate team reviews it within 72 hours. No money is held against you for the pickup delays.', conf: 'high', src: 'Warehouse + your photos', at: E.current(r.item).at }; }
    if (p.legs.length) {
      const parts = p.legs.map(l => {
        const ty = payOf(orderOf(id), l.pm).type;
        if (l.state === 'CREDITED_CONFIRMED') return `${inr(l.amount)} ${ty === 'voucher' ? 'voucher' : ty} ✓`;
        const v = verdictOf(id, l); const exp = E.EXPECTED[ty];
        if (v.verdict === 'UNKNOWN') return `${inr(l.amount)} ${ty}: status unknown right now`;
        const s = srcFor(l); return `${inr(l.amount)} ${ty}: ${v.verdict === 'STUCK' ? 'late, we are tracing it' : 'on the way, by ' + day(E.addDays((s.provider && s.provider.at) || NOW, exp.creditMax))}`;
      });
      const card = p.legs.find(l => l.state !== 'CREDITED_CONFIRMED');
      const v = card ? verdictOf(id, card) : { why: 'Provider confirmed every part reached you.', confidence: 'high' };
      return { msg: (p.status === 'done' ? 'All of your refund has arrived. ' : 'Refund: ') + parts.join(' · '), why: v.why + (v.notes && v.notes.length ? ' ' + v.notes.join(' ') : ''), conf: v.confidence, src: 'Platform + payment provider + seller', at: st.faults.stale ? '2026-10-23T02:30:00.000Z' : NOW, stale: st.faults.stale };
    }
    const ret = st.extra.find(x => x.items[id]); return { msg: E.message('item', p.cur, { item: it.short, when: r.pickupSlot || 'the booked slot', why: '', code: ret ? 'DROP-' + sha256(ret.id).slice(0, 6).toUpperCase() : '' }), why: 'Latest event from the courier.', conf: 'high', src: 'Courier', at: E.current(r.item).at };
  }

  // ---------------------------------------------------------------- graphics
  const LOGO = `<img src="img/wordmark.png" alt="returnease" class="wordmark-img" width="381" height="67">`;
  function heroArt() {
    return `<svg viewBox="0 0 360 150" class="hero-art" role="img" aria-label="A parcel travels from your home back to the store">
      <path id="route" d="M60 112 C 120 20, 230 150, 300 60" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="2 12" stroke-linecap="round" opacity=".55"/>
      <g transform="translate(28 92)"><path d="M0 22 L22 0 L44 22 V48 H0Z" fill="var(--sun)" stroke="var(--ink-fixed)" stroke-width="3"/><rect x="16" y="28" width="12" height="20" fill="var(--ink-fixed)"/></g>
      <g transform="translate(276 28)"><rect x="0" y="12" width="56" height="40" rx="4" fill="var(--mint)" stroke="var(--ink-fixed)" stroke-width="3"/><path d="M-4 14 L6 0 H50 L60 14Z" fill="var(--tomato)" stroke="var(--ink-fixed)" stroke-width="3"/><rect x="20" y="30" width="16" height="22" fill="var(--ink-fixed)"/></g>
      <g class="parcel"><rect x="-13" y="-13" width="26" height="26" rx="4" fill="#C98B4E" stroke="var(--ink-fixed)" stroke-width="3"/><path d="M-13 -3 H13 M0 -13 V13" stroke="var(--ink-fixed)" stroke-width="2.5"/>
        <animateMotion dur="5s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".6 0 .4 1"><mpath href="#route"/></animateMotion></g>
    </svg>`;
  }
  function donut(legs, total, center) {
    const R = 54, C = 2 * Math.PI * R; let off = 0;
    const segs = legs.map((l, i) => { const len = C * l.amount / Math.max(total, 1); const s = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${PAY[l.type][0]}" stroke-width="22" stroke-dasharray="${len} ${C}" stroke-dashoffset="${-off}" class="seg" style="--len:${len};--d:${i * 0.25}s" transform="rotate(-90 70 70)"/>`; off += len; return s; }).join('');
    return `<svg viewBox="0 0 140 140" class="donut" role="img" aria-label="Refund ${inr(total)} split: ${legs.map(l => inr(l.amount) + ' ' + l.type).join(', ')}"><circle r="${R}" cx="70" cy="70" fill="none" stroke="var(--line-soft)" stroke-width="22"/>${segs}<text x="70" y="66" text-anchor="middle" class="d-big">${esc(center)}</text><text x="70" y="86" text-anchor="middle" class="d-small">refund</text></svg>`;
  }
  function miniTrack(p) {
    return `<div class="mini" aria-label="Step ${p.idx + 1} of 5">${[0, 1, 2, 3, 4].map(i => `<span class="${i < p.idx ? 'on' : i === p.idx ? 'now ' + p.status : ''}"></span>`).join('')}</div>`;
  }
  const pill = s => `<span class="pill p-${s}">${esc(t(s === 'moving' ? 'moving' : s))}</span>`;
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = document.createElement('div'); box.className = 'confetti';
    const cols = ['#FF4D2E', '#FFC53D', '#3DDC97', '#5B8CFF', '#B26BFF'];
    for (let i = 0; i < 70; i++) { const p = document.createElement('i'); p.style.left = Math.random() * 100 + 'vw'; p.style.background = cols[i % 5]; p.style.animationDelay = Math.random() * .4 + 's'; p.style.setProperty('--x', (Math.random() * 200 - 100) + 'px'); p.style.setProperty('--r', Math.random() * 720 + 'deg'); box.appendChild(p); }
    document.body.appendChild(box); setTimeout(() => box.remove(), 2600);
  }
  function countUp() {
    document.querySelectorAll('[data-count]').forEach(el => {
      const target = +el.dataset.count, t0 = performance.now();
      const step = n => { const k = Math.min(1, (n - t0) / 900); el.textContent = inr(Math.round(target * (1 - Math.pow(1 - k, 3)))); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  function toast(msg, tone) { const el = document.createElement('div'); el.className = 'toast ' + (tone || ''); el.textContent = msg; $('#toasts').appendChild(el); setTimeout(() => el.remove(), 4000); $('#live').textContent = msg; }

  // ---------------------------------------------------------------- shell
  function header(route) {
    const home = !route[0] || route[0] === 'home';
    return `<header class="top">
      ${home ? '' : `<button class="ico" data-go="back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`}
      <a class="brand" href="#/home">${LOGO}<small class="tagl">${esc(t('tag2'))}</small></a>
      <div class="tools">
        <label class="lang"><span aria-hidden="true">🌐</span><span class="sr">Language</span><select id="lang">${LANGS.map(([c, n]) => `<option value="${c}" ${c === ui.lang ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        ${themeBtn()}
        <button class="ico info-i" data-act="info" aria-label="How this works">i</button>
        ${ui.user ? `<button class="avatar" data-act="menu" aria-label="Account menu" aria-expanded="${ui.menu}">${esc((ui.name || 'U')[0].toUpperCase())}</button>` : ''}
      </div>
      ${ui.menu ? `<div class="menu" role="menu"><div class="menu-h"><b>${esc(ui.name)}</b><small>${esc(ui.user.email)}</small><small id="saved">${API.mode === 'cloud' ? '☁︎ Cloud account' : '● This-device account (offline mode)'}</small></div>
        <a href="#/reviews" role="menuitem">⭐ ${t('reviews')}</a><a href="#/judge" role="menuitem">🧪 ${t('judges')}</a><button data-act="signout" role="menuitem">↪ ${t('signout')}</button></div>` : ''}
    </header>`;
  }
  const TABS = [['home', 'home', 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'], ['tracking', 'track_title', 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'], ['start', 'new_return', 'M12 5v14M5 12h14'], ['reviews', 'reviews', 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'], ['report', 'report_tab', 'M12 3l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6zM12 8v5M12 16v.5']];
  function nav(route) {
    const r = route[0] || 'home', idx = Math.max(0, TABS.findIndex(x => x[0] === r));
    const onTab = TABS.some(x => x[0] === r);
    return `<nav class="tabbar" aria-label="Main" style="--i:${idx};--n:${TABS.length}"><span class="tab-pill ${onTab ? '' : 'hide'}" aria-hidden="true"></span>${TABS.map(([k, label, d]) => `<a href="#/${k}" class="${r === k ? 'on' : ''}" ${r === k ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${esc(label === 'track_title' ? t('p_tracking') : t(label))}</span></a>`).join('')}</nav>
      <button class="fab ${ui.chatOpen ? 'open' : ''}" data-act="chat" aria-label="${esc(t('chat_title'))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><circle cx="9" cy="10.5" r="1.2" fill="currentColor"/><circle cx="12" cy="10.5" r="1.2" fill="currentColor"/><circle cx="15" cy="10.5" r="1.2" fill="currentColor"/></svg></button>${ui.chatOpen ? chatPanel() : ''}`;
  }

  let lastRoute = '';
  function render() {
    document.documentElement.dataset.theme = ui.theme;
    document.documentElement.lang = ui.lang;
    const route = (location.hash.replace(/^#\/?/, '') || 'home').split('/');
    const infoBtn = ui.info ? infoModal() : '';
    if (!ui.user) { $('#app').innerHTML = (ui.splash ? splash() : '') + authView() + infoBtn; return; }
    const views = { home: vHome, item: vItem, start: vStart, reviews: vReviews, judge: vJudge, tracking: vTracking, exchange: vExchange, checkout: vCheckout, shipping: vShipping, report: vReport };
    const v = views[route[0]] || vHome;
    const changed = route.join('/') !== lastRoute; lastRoute = route.join('/');
    $('#app').innerHTML = header(route) + `${st.faults.offline ? '<p class="offline" role="status">You’re offline. Showing saved data; actions are queued and sent once when you’re back.</p>' : ''}<main id="main" tabindex="-1" class="${route[0] === 'judge' ? 'wide' : ''} ${changed ? 'page-in' : ''}">${v(route)}</main>` + nav(route) + infoBtn;
    countUp();
    const cl = $('#chatlog'); if (cl) cl.scrollTop = cl.scrollHeight;
  }

  // ---------------------------------------------------------------- SPLASH + LANDING (public) + AUTH
  const PRODUCTS = [['tracking', 'var(--sky)'], ['start', 'var(--tomato)'], ['exchange', 'var(--grape)'], ['checkout', 'var(--sun)'], ['shipping', 'var(--mint)'], ['report', '#E5383B']];
  const PKEY = { tracking: 'p_tracking', start: 'p_returns', exchange: 'p_exchange', checkout: 'p_checkout', shipping: 'p_shipping', report: 'p_report' };
  const PARTNERS = ['DakDash Couriers', 'Swiftline Logistics', 'PayNest', 'UPIly', 'StrideCo', 'Handloom Hub', 'SoundBay', 'TimeKart', 'Kartvaan Express', 'ShopSetu'];
  function faqBlock() {
    return `<section class="faq"><h2>${t('faq')}</h2>${[1, 2, 3, 4, 5, 6, 7].map(n => `<details class="faq-q"><summary>${esc(t('q' + n))}</summary><p>${esc(t('a' + n))}</p></details>`).join('')}</section>`;
  }
  function productsBlock(linked) {
    return `<div class="products">${PRODUCTS.map(([k, c], i) => `<a href="${linked ? '#/' + k : '#signin'}" class="product rise" style="--c:${c};animation-delay:${i * .07}s"><span class="p-art">${ART.product(k)}</span><b>${esc(t(PKEY[k]))}</b><small>${esc(t(PKEY[k] + '_d'))}</small><span class="p-go">→</span></a>`).join('')}</div>`;
  }
  function partnersBlock() {
    const row = PARTNERS.map(p => `<span>${esc(p)}</span>`).join('');
    return `<section class="partners"><p class="muted small">${esc(t('partners'))}</p><div class="marquee"><div class="track">${row}${row}</div></div></section>`;
  }
  function howBlock() {
    const steps = [['Check', 'See what you can return and how much comes back, before you ask.'], ['Hand over', 'Pickup or drop-off with timestamped photos and a receipt.'], ['Reconcile', 'Store, bank and seller records compared: waiting, stuck or done.'], ['Get paid', 'Each part of your money tracked until it is confirmed in your account.']];
    return `<div class="how">${steps.map(([h, d], i) => `<div class="how-s rise" style="animation-delay:${i * .1}s"><span class="how-n">${i + 1}</span><b>${h}</b><small>${esc(d)}</small></div>`).join('')}</div>`;
  }
  function infoModal() {
    return `<div class="modal" role="dialog" aria-modal="true" aria-label="How returnease works"><div class="modal-card"><button class="ico close" data-act="info" aria-label="Close">✕</button>
      <h2>ⓘ How returnease works</h2>${howBlock()}
      <ul class="small"><li>Logistics and money are tracked as separate steps, so “approved” never pretends to be “paid”.</li><li>Every status shows why, how sure we are, the source, and when it was updated, plus a button to report a problem.</li><li>All data in this prototype is simulated and labelled.</li></ul>
      <p class="hint">Judges: sign in with <b>judge@returnease.demo</b> / <b>Impactx@2026</b>. Account menu → <b>For judges</b> has fault injection, tests and the audit trail.</p></div></div>`;
  }
  function splash() {
    return `<section class="splash ${ui.splashLeaving ? 'leaving' : ''}" id="splash" aria-label="${esc(t('welcome'))} returnease">
      <div class="sp-orb o1"></div><div class="sp-orb o2"></div><div class="sp-orb o3"></div>
      <div class="sp-center"><p class="sp-welcome">${esc(t('welcome'))}</p><img src="img/wordmark.png" alt="returnease" class="sp-logo"><p class="sp-tag">${esc(t('tag2'))}</p></div>
      <div class="sp-lang"><label class="lang"><span class="sr">Language</span><select id="lang">${LANGS.map(([c, n]) => `<option value="${c}" ${c === ui.lang ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
      <button class="sp-swipe" data-act="enter"><span class="chev"></span><span class="chev"></span>${esc(t('swipe'))}</button></section>`;
  }
  function landing() {
    return `<header class="top"><a class="brand" href="#/">${LOGO}<small class="tagl">${esc(t('tag2'))}</small></a><div class="tools">
      <label class="lang"><span aria-hidden="true">🌐</span><span class="sr">Language</span><select id="lang">${LANGS.map(([c, n]) => `<option value="${c}" ${c === ui.lang ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      ${themeBtn()}<button class="ico info-i" data-act="info" aria-label="How this works">i</button></div></header>
      <main class="landing">
      <section class="l-hero sheet-up" id="signin"><div class="rise"><p class="eyebrow dark">IMPACTX 2026 · Team Sleepy Coders</p><h1 class="l-h1"><span class="grad">${esc(t('tag2'))}</span></h1>
        <p class="l-sub">${esc(t('hero_sub'))}</p>
        <div class="l-art">${heroArt()}<div class="float-card fc1">✓ ₹168.75 wallet</div><div class="float-card fc2">⏳ ₹750 · 29 Oct</div><div class="float-card fc3">🔒 No OTP. Ever.</div></div></div>
        <div class="auth-wrap">${authForm()}</div></section>
      <section id="products"><h2>${t('products')}</h2>${productsBlock(false)}</section>
      ${partnersBlock()}
      ${faqBlock()}
      <footer class="foot">${LOGO}<span>· Team Sleepy Coders (B Joel, Sameer SK, Tejasvi G, Nikitha V) · IMPACTX 2026 Challenge 15 · Simulated data</span></footer></main>`;
  }
  const themeBtn = () => `<button class="ico" data-act="theme" aria-label="Switch to ${ui.theme === 'dark' ? 'light' : 'dark'} theme">${ui.theme === 'dark' ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></g></svg>' : '<svg viewBox="0 0 24 24"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" fill="currentColor"/></svg>'}</button>`;
  function authView() { return landing(); }
  function authForm() {
    const up = ui.authTab === 'up';
    return `<form class="auth-card" id="authform" novalidate>
        <div class="seg" role="tablist"><button type="button" role="tab" aria-selected="${!up}" data-act="authtab" data-v="in">${t('signin')}</button><button type="button" role="tab" aria-selected="${up}" data-act="authtab" data-v="up">${t('signup')}</button></div>
        <button type="button" class="btn google big" data-act="google"><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.2.8 3.9 1.5l2.7-2.6C16.9 3 14.7 2 12 2 6.5 2 2 6.5 2 12s4.5 10 10 10c5.8 0 9.6-4.1 9.6-9.8 0-.7-.1-1.2-.2-1.7H12z"/></svg>${t('google')}</button>
        <div class="or"><span>${t('or')}</span></div>
        ${up ? `<label>${t('name')}<input name="name" autocomplete="name" required maxlength="60"></label>` : ''}
        <label>${t('email')}<input name="email" type="email" autocomplete="email" required value="${up ? '' : 'judge@returnease.demo'}"></label>
        <label>${t('password')}<input name="password" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" required minlength="6" value="${up ? '' : 'Impactx@2026'}"></label>
        ${ui.authErr ? `<p class="err" role="alert">${esc(ui.authErr)}</p>` : ''}
        <button class="btn primary big" id="authbtn">${up ? t('signup') : t('signin')} →</button>
        <p class="hint">Judges: <b>judge@returnease.demo</b> / <b>Impactx@2026</b> (pre-filled).</p>
        <p class="sim-note">Prototype · simulated orders, couriers and payments</p>
      </form>`;
  }
  async function afterLogin(user) {
    ui.user = user; ui.authErr = '';
    const prof = await API.profile(); ui.name = prof.name || 'Customer';
    st = (await API.loadState()) || seed();
    if (!st.v || st.v !== 3) st = seed();
    save(); ui.reviews = await API.reviews(); ui.reports = await API.reports();
    ui.chat = [{ who: 'bot', html: `${t('hi')} ${esc(ui.name.split(' ')[0])}! I can show your refund, track an item, explain an amount, start a return or switch language. Try a button below.`, chips: ['Where is my money?', 'Track my shoes', 'Why less money?', 'Start a return'] }];
    if (!location.hash.startsWith('#/') || location.hash === '#/') location.hash = '#/home';
    render();
  }

  // ---------------------------------------------------------------- HOME
  function retCard(id) {
    const it = itemOf(id), p = progress(id), h = headline(id);
    return `<a class="item-card rise" href="#/item/${id}" style="--c:${it.color}">
      <div class="ic-emoji">${ART.item(id)}</div>
      <div class="ic-body"><div class="row between"><b>${esc(it.name)}</b>${pill(p.status)}</div>
        <p class="ic-msg">${esc(h.msg)}</p>${miniTrack(p)}
        <div class="ic-steps"><span>${t('step_req')}</span><span>${t('step_arr')}</span></div></div></a>`;
  }
  function totals() {
    let total = 0, back = 0;
    ['A', 'B'].forEach(id => { const a = allocFor(id); total += a.total; legsOf(id).forEach(l => { if (l.state === 'CREDITED_CONFIRMED') back += l.amount; }); });
    return { total, back };
  }
  function vHome() {
    const tt = totals(), pct = Math.round(100 * tt.back / tt.total);
    const extra = st.extra.flatMap(r => Object.keys(r.items));
    return `<section class="hero rise"><div class="hero-txt"><p class="eyebrow">${t('hi')}, ${esc(ui.name.split(' ')[0])} 👋</p>
        <h1>${t('your_return')} <span class="tag">${S.RETURN_ID}</span></h1>
        <p class="big-money"><span data-count="${tt.back}">₹0</span> <small>${t('back_so_far')} ${t('of')} ${inr(tt.total)}</small></p>
        <div class="bar"><i style="--w:${pct}%"></i></div>
        <p class="scam">🔒 ${esc(t('scam'))}</p></div>${heroArt()}</section>
      <div class="cta-row"><a class="tile rise" href="#/start"><span class="t-ic">${ART.product('start')}</span><b>${t('start')}</b><small>${esc(t('tile_start_d'))}</small></a>
      <a class="tile rise" href="#/reviews"><span class="t-ic stars-ic">★★★</span><b>${t('rate')}</b><small>${ui.reviews.length} ${esc(t('reviews_saved'))}</small></a>
      <button class="tile rise" data-act="chat"><span class="t-ic chat-ic"><i></i><i></i><i></i></span><b>${t('need')}</b><small>${esc(t('chat_ph'))}</small></button></div>
      <h2>${t('items')}</h2><div class="cards">${['A', 'B'].map(retCard).join('')}${extra.map(retCard).join('')}</div>
      <h2>${t('products')}</h2>${productsBlock(true)}${faqBlock()}`;
  }

  // ---------------------------------------------------------------- ITEM
  function vItem(route) {
    const id = route[1]; if (!rec(id)) return vHome();
    const it = itemOf(id), r = rec(id), p = progress(id), h = headline(id);
    const steps = ['step_req', 'step_pick', 'step_check', 'step_sent', 'step_arr'];
    const notes = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    S.ATTEMPTS.forEach(a => { if (!st.items[id] || a.n === 3) return; const j = E.judgeAttempt(a); notes[0].push(`<span class="note bad">✕ ${when(a.at)}: courier said “${esc(a.courierClaim)}”. ${j.finding === 'COURIER_FAULT' ? 'Their GPS was ' + (a.gpsMetersFromAddress / 1000).toFixed(1) + ' km away: courier’s fault.' : 'Calls never reached you: not counted against you.'}</span>`); });
    const col = r.item.find(h2 => h2.state === 'COLLECTED'); if (col) notes[1].push(`<span class="note ok">✓ ${when(col.at)} · handover receipt ${esc(col.proof || '')}, photos saved</span>`);
    if (p.status === 'hold') notes[2].push(`<span class="note warn">⏸ Flagged “used: sole wear”. Your photos are under independent review.</span>`);
    if (r.decision) notes[2].push(`<span class="note ok">✓ Review: ${esc(r.decision.outcome)} · ${r.decision.refundPct}% refund</span>`);
    const timeline = steps.map((k, i) => `<li class="${i < p.idx ? 'done' : i === p.idx ? 'now ' + p.status : ''}" style="--d:${i * .12}s"><span class="dot"></span><div><b>${t(k)}</b>${notes[i].join('')}</div></li>`).join('');
    const a = allocFor(id);
    const legs = p.legs.length ? p.legs.map(l => ({ type: payOf(orderOf(id), l.pm).type, amount: l.amount, label: payOf(orderOf(id), l.pm).label, state: l.state, l })) : a.legs.map(l => ({ type: l.type, amount: l.amount, label: l.label, state: null }));
    const legRows = legs.map(l => {
      let st2 = 'Preview: not started';
      if (l.state === 'CREDITED_CONFIRMED') st2 = '✓ Arrived';
      else if (l.state) { const v = verdictOf(id, l.l); st2 = v.verdict === 'UNKNOWN' ? '? Status unknown' : v.verdict === 'STUCK' ? '! Late: tracing' : '⏳ On the way'; }
      const vexp = a.legs.find(x => x.type === 'voucher');
      return `<li><span class="sw" style="background:${PAY[l.type][0]}"></span><div><b>${inr(l.amount)}</b> → ${esc(l.label)}${l.type === 'voucher' && vexp ? `<small>Comes back as a voucher, valid till ${day(vexp.voucherExpiry.at)}</small>` : ''}</div><span class="leg-st">${st2}</span></li>`;
    }).join('');
    const card = p.legs.find(l => payOf(orderOf(id), l.pm).type === 'card' && l.state !== 'CREDITED_CONFIRMED');
    let three = '';
    if (card) {
      const s = srcFor(card), v = verdictOf(id, card);
      const icon = x => !x ? '—' : x.timeout ? '⚠️ no answer' : x.status;
      three = `<section class="panel rise"><h3>3 records, 1 answer</h3><div class="three">
        <div><span>🏬</span><small>Store</small><b>${icon(s.platform)}</b></div><div><span>🏦</span><small>Bank side</small><b>${icon(s.provider)}</b></div><div><span>🧾</span><small>Seller</small><b>${icon(s.seller)}</b></div></div>
        <p class="verdict v-${v.verdict.toLowerCase()}"><b>${t(v.verdict.toLowerCase())}</b>: ${esc(v.why)}</p>
        <details><summary>Next step for everyone</summary><ul>${Object.entries(v.actions).map(([k, x]) => `<li><b>${k === 'customer' ? 'You' : k}</b>: ${esc(x)}</li>`).join('')}</ul></details></section>`;
    }
    let action = '';
    if (p.status === 'hold') action = `<section class="panel rise"><h3>📸 Your photos vs the warehouse</h3><div class="photos"><figure>${shoe(true)}<figcaption>Yours · at pickup, 18 Oct</figcaption></figure><figure>${shoe(false)}<figcaption>Warehouse · 20 Oct</figcaption></figure></div>
      <p class="small">Review due <b>${when(E.addDays(r.inspection.openedAt, 3))}</b>. Possible outcomes: full refund, partial with reason, or not accepted (item sent back free).</p>
      <button class="btn primary" data-act="review" data-v="${id}">Demo: reviewer decides now</button></section>`;
    if (r.demo && E.current(r.item).state !== 'CLOSED' && p.idx < 4 && !(r.option !== 'refund' && p.idx >= 2)) action = `<section class="panel rise"><button class="btn ghost" data-act="advance" data-v="${id}">Demo: move to next step →</button><p class="small muted">Simulates the courier, warehouse and bank updates.</p></section>`;
    return `<section class="item-hero rise" style="--c:${it.color}"><div class="ih-emoji">${ART.item(id)}</div><div><h1>${esc(it.name)}</h1><p class="muted">${esc(it.seller)} · ${pill(p.status)}</p></div></section>
      <section class="panel status rise"><p class="status-msg">${esc(h.msg)}</p>
        <details class="why"><summary>${t('why')}</summary><p>${esc(h.why)}</p><div class="chips"><span class="chip c-${h.conf}">Confidence: ${h.conf}</span><span class="chip">Source: ${esc(h.src)}</span><span class="chip">As of ${when(h.at)}${h.stale ? ' (old data)' : ''}</span></div>
        <button class="btn ghost sm" data-act="report" data-v="${id}">${t('report')}</button></details></section>
      ${action}
      <div class="two"><section class="panel rise"><h3>${t('timeline')}</h3><ol class="tl">${timeline}</ol></section>
      <section class="panel rise"><h3>${t('money')}</h3><div class="money">${donut(legs, a.total, inr(a.total))}<ul class="legs">${legRows}</ul></div>
        <details><summary>${t('how_number')}</summary><table class="lines">${a.lines[0].steps.map(s => `<tr><td>${esc(s.label)}</td><td>${s.amount < 0 ? '−' : ''}${inr(Math.abs(s.amount))}</td></tr>`).join('')}<tr class="tot"><td>Refund</td><td>${inr(a.total)}</td></tr></table></details></section></div>
      ${three}
      ${p.idx >= 2 ? `<a class="btn primary block rise" href="#/reviews/${id}">★ ${t('rate')}</a>` : ''}`;
  }
  function shoe(clean) {
    return `<svg viewBox="0 0 220 120" role="img" aria-label="${clean ? 'Clean sole' : 'Scuffed sole'}"><rect width="220" height="120" fill="${clean ? '#E3F8EE' : '#FDE8E2'}"/><path d="M30 76 C 30 46, 70 36, 110 46 C 150 54, 190 58, 196 80 C 198 94, 180 100, 150 100 L 46 100 C 34 100, 30 92, 30 76 Z" fill="#FFF6E9" stroke="#16131F" stroke-width="4"/>${[0, 1, 2, 3, 4, 5].map(i => `<line x1="${56 + i * 22}" y1="92" x2="${62 + i * 22}" y2="80" stroke="#16131F" stroke-width="3"/>`).join('')}${clean ? '' : '<ellipse cx="88" cy="90" rx="30" ry="8" fill="#8C8577" opacity=".75"/><ellipse cx="150" cy="92" rx="22" ry="6" fill="#8C8577" opacity=".7"/>'}</svg>`;
  }

  // ---------------------------------------------------------------- START A RETURN
  const REASONS = [['SIZE', '📏', 'Size / fit'], ['DEFECT', '🔧', 'Faulty or damaged'], ['NOT_AS_SHOWN', '🖼️', 'Not as shown'], ['CHANGED', '💭', 'Changed my mind']];
  function vStart(route) {
    const w = ui.wiz;
    if (!w || !route[1]) {
      ui.wiz = null;
      const rows = [O2, O].flatMap(o => o.items.map(it => {
        const inRet = rec(it.id);
        const e = inRet ? { status: 'IN_RETURN', reasons: [{ text: 'Already in a return' }] } : E.eligibility(o, it, NOW, S.POLICIES);
        const cls = { ELIGIBLE: 'ok', CONDITIONAL: 'warn', NOT_ELIGIBLE: 'no', IN_RETURN: 'muted' }[e.status];
        const label = { ELIGIBLE: t('eligible'), CONDITIONAL: t('conditional'), NOT_ELIGIBLE: t('not_eligible'), IN_RETURN: '↩ ' + t('your_return') }[e.status];
        const can = e.status === 'ELIGIBLE' || e.status === 'CONDITIONAL';
        return `<${can ? 'button' : 'div'} class="pick rise ${can ? '' : 'off'}" ${can ? `data-act="pick" data-v="${it.id}"` : ''} style="--c:${it.color}"><span class="pk-e">${ART.item(it.id)}</span><span class="pk-b"><b>${esc(it.name)}</b><small>${esc(it.seller)} · ${inr(it.price)}</small><small class="why-l">${e.reasons.map(x => esc(x.text)).join(' · ')}</small></span><span class="pill p-${cls}">${esc(label)}</span></${can ? 'button' : 'div'}>`;
      })).join('');
      return `<h1>${t('start')}</h1><p class="muted">Every item is checked on its own: return window, condition, seller rules and free gifts, before you ask.</p><div class="picks">${rows}</div>`;
    }
    const it = itemOf(w.id), o = orderOf(w.id);
    const head = `<div class="wiz-h"><span class="pk-e big">${ART.item(w.id)}</span><div><b>${esc(it.name)}</b><div class="dots">${[1, 2, 3].map(n => `<i class="${n <= w.step ? 'on' : ''}"></i>`).join('')}</div></div></div>`;
    if (w.step === 1) return head + `<h2>${t('reason')}</h2><div class="reasons">${REASONS.map(([k, e, l]) => `<button class="reason ${w.reason === k ? 'on' : ''}" data-act="reason" data-v="${k}"><span>${e}</span>${l}</button>`).join('')}</div>`;
    if (w.step === 2) {
      const est = E.allocate(o, { items: [{ itemId: w.id }] }, { order: 'proportional', now: NOW });
      const cmp = E.compareOptions(it, w.reason === 'SIZE' ? 'SIZE' : w.reason === 'DEFECT' ? 'DEFECT' : 'OTHER', est, S.STOCK[w.id] || S.STOCK.A);
      return head + `<h2>${t('refund')} · ${t('exchange')} · ${t('replacement')}</h2><p class="muted small">${esc(cmp.note)}</p><div class="opts">${cmp.options.map(op => `<button class="opt ${w.option === op.id ? 'on' : ''}" data-act="option" data-v="${op.id}" ${/Out of stock/.test(op.time) ? 'disabled' : ''}><b>${esc(t(op.id))}</b><span>💰 ${esc(op.money)}</span><span>⏱ ${esc(op.time)}</span>${op.stockNote ? `<span>📦 ${esc(op.stockNote)}</span>` : ''}</button>`).join('')}</div>
        <p class="reco">💡 <b>Suggestion:</b> ${esc(cmp.why)}</p>`;
    }
    const est = E.allocate(o, { items: [{ itemId: w.id }] }, { order: 'proportional', now: NOW });
    const slots = ['Tomorrow, 9 AM – 12 PM', 'Tomorrow, 2 PM – 6 PM', 'Drop at a partner store (any time)'];
    return head + `<h2>Pickup</h2><div class="reasons">${slots.map((s, i) => `<button class="reason ${w.slot === i ? 'on' : ''}" data-act="slot" data-v="${i}"><span>${i === 2 ? '🏪' : '🚚'}</span>${s}</button>`).join('')}</div>
      ${w.option === 'refund' ? `<section class="panel"><h3>${t('money')}</h3><div class="money">${donut(est.legs, est.total, inr(est.total))}<ul class="legs">${est.legs.map(l => `<li><span class="sw" style="background:${PAY[l.type][0]}"></span><div><b>${inr(l.amount)}</b> → ${esc(l.label)}<small>Usually ${E.EXPECTED[l.type].creditMin}–${E.EXPECTED[l.type].creditMax} days after the check</small></div></li>`).join('')}</ul></div></section>` : `<p class="panel">No money moves: your ${esc(t(w.option)).toLowerCase()} is handed over when the agent collects this item.</p>`}
      <label class="consent"><input type="checkbox" id="consent" ${w.consent ? 'checked' : ''}> Share my address and phone with the courier only for this pickup.</label>
      <button class="btn primary big block" data-act="confirm">${t('confirm')} ✓</button>`;
  }

  // ---------------------------------------------------------------- PRODUCT PAGES
  const allIds = () => ['A', 'B', ...st.extra.flatMap(r => Object.keys(r.items))];
  function bigTrack(id) {
    const p = progress(id), it = itemOf(id), steps = ['step_req', 'step_pick', 'step_check', 'step_sent', 'step_arr'];
    return `<a class="track-card rise" href="#/item/${id}" style="--c:${it.color}"><div class="row between"><div class="row"><span class="pk-e">${ART.item(id)}</span><div><b>${esc(it.name)}</b><small class="muted block">${esc(it.seller)}${p.fails ? ` · <span class="red">${p.fails} failed pickups, not your fault</span>` : ''}</small></div></div>${pill(p.status)}</div>
      <div class="bt">${steps.map((k, i) => `<div class="bt-s ${i < p.idx ? 'done' : i === p.idx ? 'now ' + p.status : ''}" style="--d:${i * .15}s"><i></i><span>${t(k)}</span></div>`).join('')}</div></a>`;
  }
  function vTracking() {
    return `<section class="p-hero rise" style="--c:var(--sky)"><span class="p-art big">${ART.product('tracking')}</span><div><h1>${esc(t('p_tracking'))}</h1><p class="muted">${esc(t('p_tracking_d'))}</p></div></section>${allIds().map(bigTrack).join('')}
      <a class="tile rise" href="#/shipping"><span class="t-ic">${ART.product('shipping')}</span><b>Shipments and drop-off codes</b><small>Outgoing parcels, exchanges and handover proof</small></a>`;
  }
  function vExchange() {
    const ids = O2.items.map(i => i.id).filter(id => !rec(id));
    return `<section class="p-hero rise" style="--c:var(--grape)"><span class="p-art big">${ART.product('exchange')}</span><div><h1>Exchange, don’t wait</h1><p class="muted">Wrong size or colour? The new one comes with the pickup agent. No refund waiting, no new payment.</p></div></section>
      <div class="how">${[['1', 'Pick the item'], ['2', 'Choose the new size'], ['3', 'Swap at your door']].map(([n, x], i) => `<div class="how-s rise" style="animation-delay:${i * .1}s"><span class="how-n">${n}</span><b>${x}</b></div>`).join('')}</div>
      <h2>Items you can exchange</h2><div class="picks">${ids.length ? ids.map(id => { const it = itemOf(id), stock = S.STOCK[id]; return `<button class="pick rise" data-act="pickx" data-v="${id}" style="--c:${it.color}"><span class="pk-e">${ART.item(id)}</span><span class="pk-b"><b>${esc(it.name)}</b><small>${stock.otherSize.qty ? `${stock.otherSize.qty} left in ${stock.otherSize.size}${stock.otherSize.priceDiff ? ' · pay ' + inr(stock.otherSize.priceDiff) + ' more' : ''}` : 'Other size out of stock: replacement or refund instead'}</small></span><span class="p-go">→</span></button>`; }).join('') : '<p class="muted">Nothing left to exchange right now.</p>'}</div>`;
  }
  const CART = [
    { n: 'Yoga mat, 6 mm', e: 'M', price: 129900, rule: ['ok', '10-day return · free pickup'] },
    { n: 'Steel water bottle, 1 L', e: 'K', price: 44900, rule: ['ok', '10-day return · exchange available'] },
    { n: 'Face serum, 30 ml', e: 'R', price: 69900, rule: ['no', 'Not returnable once opened (hygiene)'] },
  ];
  function vCheckout() {
    const total = CART.reduce((s, c) => s + c.price, 0), pref = ui.refpref || 'original';
    return `<section class="p-hero rise" style="--c:var(--sun)"><span class="p-art big">${ART.product('checkout')}</span><div><h1>Checkout with no surprises</h1><p class="muted">Return rules for every item, shown before you pay. Demo cart, simulated payment.</p></div></section>
      <div class="two"><section class="panel rise"><h3>Your cart</h3>${CART.map(c => `<div class="cart-row"><span class="pk-e">${ART.item(c.e)}</span><div><b>${esc(c.n)}</b><span class="pill p-${c.rule[0]}">${esc(c.rule[1])}</span></div><b>${inr(c.price)}</b></div>`).join('')}
        <div class="cart-row tot"><span></span><b>Total</b><b>${inr(total)}</b></div></section>
      <section class="panel rise"><h3>If you ever return something, refund to…</h3>
        <button class="opt ${pref === 'original' ? 'on' : ''}" data-act="refpref" data-v="original"><b>💳 Where I paid from</b><span>Card 5–7 days · UPI 1–3 days after the check</span></button>
        <button class="opt ${pref === 'credit' ? 'on' : ''}" data-act="refpref" data-v="credit" style="margin-top:.6rem"><b>👛 Store wallet, instantly</b><span>Usable only on this store. You can change this later.</span></button>
        <p class="small muted">🔒 ${esc(t('scam'))}</p>
        <button class="btn primary big block" data-act="placeorder">Place order (simulated) · ${inr(total)}</button></section></div>`;
  }
  function vShipping() {
    const drops = st.extra.filter(r => Object.values(r.items).some(i => i.pickupSlot === 'drop-off'));
    const exch = st.extra.filter(r => Object.values(r.items).some(i => i.option === 'exchange' || i.option === 'replacement'));
    let rn = 0;
    const road = (from = 'Warehouse', to = 'Your home', done = false) => { const id = 'rl' + (rn++); return `<div class="route ${done ? 'done' : ''}" role="img" aria-label="Parcel moving from ${from} to ${to}">
      <svg viewBox="0 0 600 90" class="route-svg"><defs><filter id="${id}g" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <linearGradient id="${id}l" x1="0" x2="1"><stop offset="0" stop-color="#FF4D2E"/><stop offset=".5" stop-color="#7B5CFF"/><stop offset="1" stop-color="#3DDC97"/></linearGradient></defs>
        <line x1="40" y1="45" x2="560" y2="45" stroke="var(--line)" stroke-width="6" stroke-linecap="round"/>
        <line x1="40" y1="45" x2="560" y2="45" stroke="url(#${id}l)" stroke-width="6" stroke-linecap="round" class="route-fill"/>
        <circle cx="40" cy="45" r="11" fill="#FF4D2E" filter="url(#${id}g)" class="pulse-dot"/><circle cx="560" cy="45" r="11" fill="#3DDC97" filter="url(#${id}g)" class="pulse-dot d2"/>
        <g filter="url(#${id}g)"><circle r="13" fill="#7B5CFF" opacity=".35"><animate attributeName="r" values="10;20;10" dur="1.6s" repeatCount="indefinite"/></circle><circle r="8" fill="#6E8BFF"/>
          <animateMotion dur="${done ? '0.01s' : '4.5s'}" repeatCount="${done ? '1' : 'indefinite'}" fill="freeze" path="M40 45 H 560"/></g></svg>
      <div class="route-labels"><span><i class="dot red"></i>${from}</span><span><i class="dot purple"></i>On the way</span><span><i class="dot green"></i>${to}</span></div></div>`; };
    return `<section class="p-hero rise" style="--c:var(--mint)"><span class="p-art big">${ART.product('shipping')}</span><div><h1>${esc(t('p_shipping'))}</h1><p class="muted">${esc(t('p_shipping_d'))}</p></div></section>
      <section class="panel rise"><div class="row between"><h3>Order ${O2.id} · Watch + Bedsheet</h3><span class="pill p-done">Delivered ${day(O2.deliveredAt)}</span></div>${road('Warehouse', 'Your home', false)}</section>
      ${exch.map(r => Object.entries(r.items).map(([id, x]) => `<section class="panel rise"><div class="row between"><h3>New ${esc(itemOf(id).short.toLowerCase())} (${x.option})</h3><span class="pill p-moving">Ships with pickup</span></div>${road('Seller', 'Your home')}</section>`).join('')).join('')}
      ${drops.map(r => `<section class="panel rise"><h3>Drop-off code · ${r.id}</h3><div class="barcode" aria-label="Drop-off code">${sha256(r.id).slice(0, 28).split('').map(c => `<i style="width:${(parseInt(c, 16) % 3) + 2}px"></i>`).join('')}</div><p class="code">DROP-${sha256(r.id).slice(0, 6).toUpperCase()}</p><p class="small muted">Show this at any partner store. You get a receipt with a photo of the item.</p></section>`).join('')}
      <section class="panel rise"><div class="row between"><h3>Return ${S.RETURN_ID} · Shoes + Kurta</h3><span class="pill p-done">At warehouse</span></div>${road('Your home', 'Warehouse', true)}</section>
      <section class="panel rise"><h3>Proof of handover · ${S.RETURN_ID}</h3><p>Receipt <b>HOV-5512</b> · 18 Oct, 11:05 AM · GPS 12 m from your address · 3 photos by you, 2 by the agent.</p><p class="small muted">This is what protects you if an item is later called “used” or “missing”.</p></section>`;
  }

  // ---------------------------------------------------------------- REPORT FRAUD
  const FRAUD_KINDS = ['Someone asked for my OTP or PIN', 'Fake “returnease support” call or message', 'Asked to install a screen-sharing app', 'Fake refund link or QR code', 'Courier asked for extra money', 'Item swapped or tampered with', 'Something else'];
  function vReport() {
    const f = ui.rep || (ui.rep = { kind: null });
    const mine = ui.reports.map(r => `<li class="rv rise"><span class="rep-dot"></span><div><b>${esc(r.kind)}</b> <span class="muted small">${day(r.created_at)}</span>${r.details ? `<p class="small">${esc(r.details)}</p>` : ''}${r.phone_or_link ? `<p class="small muted">${esc(r.phone_or_link)}</p>` : ''}<span class="pill p-moving">Received · team reviewing</span></div></li>`).join('');
    return `<section class="p-hero rise report-hero" style="--c:#E5383B"><span class="p-art big">${ART.product('report')}</span><div><h1>${esc(t('report_title'))}</h1><p class="muted">${esc(t('report_sub'))}</p></div></section>
      <div class="alert-strip rise">🔒 ${esc(t('scam'))} · Cyber fraud helpline <b>1930</b> · <b>cybercrime.gov.in</b></div>
      <form class="panel rise" id="repform"><h3>What happened?</h3><div class="kinds">${FRAUD_KINDS.map(k => `<button type="button" class="kind ${f.kind === k ? 'on' : ''}" data-act="kind" data-v="${esc(k)}">${esc(k)}</button>`).join('')}</div>
        <label class="field">Phone number, link or name used (optional)<input id="rep-who" maxlength="200" placeholder="e.g. +91 98xxxxxx12 or the link they sent"></label>
        <label class="field">Details (optional)<textarea id="rep-det" rows="3" maxlength="1000" placeholder="What did they say or ask for?"></textarea></label>
        <p class="small muted">Never type your OTP, PIN or card number here.</p>
        <button class="btn danger big block" data-act="sendreport">${esc(t('report_btn'))}</button></form>
      <h2>${esc(t('report_title'))} · history</h2><ul class="rvs">${mine || '<li class="muted">No reports yet.</li>'}</ul>`;
  }

  // ---------------------------------------------------------------- REVIEWS
  const TAGS = ['Pickup on time', 'Refund was fast', 'Clear updates', 'Courier problem', 'Refund was slow', 'Unfair inspection', 'Product as described', 'Product quality poor'];
  function stars(name, val) { return `<div class="stars" role="radiogroup" aria-label="${esc(name)}">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" aria-checked="${val === n}" aria-label="${n} star" class="${n <= (val || 0) ? 'on' : ''}" data-act="star" data-k="${name}" data-v="${n}">★</button>`).join('')}</div>`; }
  function vReviews(route) {
    const ids = ['A', 'B', ...st.extra.flatMap(r => Object.keys(r.items))];
    const sel = route[1] || ui.revItem || ids[0]; ui.revItem = sel;
    const f = ui.revForm && ui.revForm.id === sel ? ui.revForm : (ui.revForm = { id: sel, ok: null, rs: 0, ps: 0, tags: [], comment: '' });
    const it = itemOf(sel);
    const mine = ui.reviews.map(r => `<li class="rv rise"><span class="pk-e">${ART.item(r.item_id)}</span><div><b>${esc(r.item_name || r.item_id)}</b> <span class="muted small">${day(r.created_at)}</span>
      <div class="small">${r.return_ok ? '✅ Return done with no problem' : '⚠️ Had a problem'} · Return ${'★'.repeat(r.return_stars || 0)} · Product ${'★'.repeat(r.product_stars || 0)}</div>
      ${(r.tags || []).length ? `<div class="chips">${r.tags.map(x => `<span class="chip">${esc(x)}</span>`).join('')}</div>` : ''}${r.comment ? `<p class="small">“${esc(r.comment)}”</p>` : ''}</div></li>`).join('');
    return `<h1>${t('reviews')}</h1>
      <div class="rv-items">${ids.map(id => `<a href="#/reviews/${id}" class="rv-pick ${id === sel ? 'on' : ''}">${ART.item(id)} ${esc(itemOf(id).short)}</a>`).join('')}</div>
      <form class="panel rise" id="revform"><h2>${ART.item(sel)} ${esc(it.name)}</h2>
        <p class="q">${t('return_ok')}</p><div class="yn"><button type="button" class="${f.ok === true ? 'on' : ''}" data-act="ok" data-v="1">👍 ${t('yes')}</button><button type="button" class="${f.ok === false ? 'on' : ''}" data-act="ok" data-v="0">👎 ${t('no')}</button></div>
        <p class="q">${t('return_exp')}</p>${stars('rs', f.rs)}
        <p class="q">${t('product')}</p>${stars('ps', f.ps)}
        <div class="chips pickable">${TAGS.map(x => `<button type="button" class="chip ${f.tags.includes(x) ? 'on' : ''}" data-act="tag" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <label class="field">Comment (optional)<textarea id="rvc" maxlength="500" rows="2">${esc(f.comment)}</textarea></label>
        <button class="btn primary big block" data-act="submitrev">${t('submit')}</button></form>
      <h2>My reviews</h2><ul class="rvs">${mine || '<li class="muted">No reviews yet.</li>'}</ul>`;
  }

  // ---------------------------------------------------------------- CHAT ASSISTANT (rule-based, grounded in the user's own data)
  const INTENTS = [
    { k: ['otp', 'pin', 'scam', 'fraud', 'call', 'ओटीपी', 'ఓటీపీ'], f: () => ({ text: '<b>That’s a scam.</b> We never ask for OTP, PIN, card number or screen-sharing to refund you. Report it at cybercrime.gov.in or call 1930.' }) },
    { k: ['human', 'agent', 'complain', 'complaint', 'person', 'escalat', 'शिकायत', 'ఫిర్యాదు'], f: () => { const id = 'CMP-' + (100000 + st.tickets.length * 7 + 31); st.tickets.push({ id, at: new Date().toISOString() }); log('customer', 'ESCALATED', { ticket: id }); save(); return { text: `Done. Complaint <b>${id}</b> created with all your dates and references attached. A person replies within 48 h (e-commerce grievance rules require acknowledgement within 48 h).` }; } },
    { k: ['money', 'refund', 'paisa', 'paise', 'पैसा', 'पैसे', 'రిఫండ్', 'డబ్బు', 'பணம்', 'ಹಣ', 'പണം', 'টাকা', 'where'], f: () => { const tt = totals(); return { text: `You’ve got <b>${inr(tt.back)}</b> back of <b>${inr(tt.total)}</b>.`, card: ['A', 'B'].map(id => `<div class="cc"><span>${ART.item(id)}</span><div><b>${esc(itemOf(id).short)}</b><small>${esc(headline(id).msg)}</small></div></div>`).join(''), acts: [['Open shoes', '#/item/A'], ['Open kurta', '#/item/B']] }; } },
    { k: ['less', 'coupon', 'deduct', 'why', 'कम', 'తక్కువ'], f: () => { const a = allocFor('B'); return { text: 'Your coupon gave ₹500 off the whole order, so each item carries a share by price. Kurta:', card: `<table class="lines">${a.lines[0].steps.map(s => `<tr><td>${esc(s.label)}</td><td>${s.amount < 0 ? '−' : ''}${inr(Math.abs(s.amount))}</td></tr>`).join('')}<tr class="tot"><td>Refund</td><td>${inr(a.total)}</td></tr></table>` }; } },
    { k: ['voucher', 'gift card', 'वाउचर', 'వోచర్'], f: () => { const v = allocFor('B').legs.find(l => l.type === 'voucher'); return { text: `The voucher part (${inr(v.amount)}) comes back as a voucher, not to the bank. It’s valid till <b>${day(v.voucherExpiry.at)}</b>${v.voucherExpiry.extended ? ' (extended so you get at least 30 days)' : ''}.` }; } },
    { k: ['pickup', 'courier', 'missed', 'unreachable', 'पिकअप', 'పికప్'], f: () => ({ text: 'Pickup failed twice. Attempt 1: the courier’s GPS was 1.8 km away (their fault). Attempt 2: calls never reached you. <b>Neither counts against you.</b> Collected on 18 Oct with receipt HOV-5512.', acts: [['See timeline', '#/item/A']] }) },
    { k: ['shoe', 'shoes', 'जूते', 'షూ'], f: () => ({ text: esc(headline('A').msg), acts: [['Open shoes', '#/item/A']] }) },
    { k: ['kurta', 'कुर्ता', 'కుర్తా'], f: () => ({ text: esc(headline('B').msg), acts: [['Open kurta', '#/item/B']] }) },
    { k: ['track', 'status', 'ट्रैक', 'స్టేటస్'], f: () => ({ text: 'Here are your items:', card: ['A', 'B', ...st.extra.flatMap(r => Object.keys(r.items))].map(id => `<div class="cc"><span>${ART.item(id)}</span><div><b>${esc(itemOf(id).short)}</b> ${pill(progress(id).status)}</div></div>`).join(''), acts: [['Go home', '#/home']] }) },
    { k: ['exchange', 'size', 'replace', 'बदल', 'మార్చ'], f: () => ({ text: 'For a size problem, an exchange is usually fastest: the new size comes with the pickup agent and no money is stuck. You can still choose a refund.', acts: [['Start a return', '#/start']] }) },
    { k: ['start', 'return', 'new', 'लौट', 'రిటర్న్'], f: () => ({ text: 'Let’s check which items you can return.', acts: [['Start a return', '#/start']] }) },
    { k: ['review', 'rate', 'rating', 'समीक्षा', 'సమీక్ష'], f: () => ({ text: 'Tell us how the return went.', acts: [['Write a review', '#/reviews']] }) },
    { k: ['dark', 'night', 'light', 'theme'], f: () => { ui.theme = /light/.test(lastQ) ? 'light' : 'dark'; try { localStorage.setItem('rewind-theme', ui.theme); } catch (e) {} return { text: `Switched to ${ui.theme} mode.` }; } },
    { k: ['language', 'telugu', 'hindi', 'tamil', 'భాష', 'भाषा'], f: () => ({ text: 'Pick a language:', langs: true }) },
    { k: ['hi', 'hello', 'hey', 'namaste', 'नमस्ते', 'నమస్తే'], f: () => ({ text: `${t('hi')} ${esc(ui.name.split(' ')[0])}! What do you need?`, chips: ['Where is my money?', 'Track my shoes', 'Talk to a person'] }) },
  ];
  let lastQ = '';
  function chatPanel() {
    return `<section class="chat" role="dialog" aria-label="${esc(t('chat_title'))}"><header><b>💬 ${t('chat_title')}</b><button class="ico" data-act="chat" aria-label="Close">✕</button></header>
      <div class="chatlog" id="chatlog" aria-live="polite">${ui.chat.map(m => `<div class="msg ${m.who}">${m.html}${m.card ? `<div class="mcard">${m.card}</div>` : ''}${m.acts ? `<div class="macts">${m.acts.map(([l, h]) => `<a class="btn sm primary" href="${h}" data-act="closechat">${esc(l)} →</a>`).join('')}</div>` : ''}${m.langs ? `<div class="macts">${LANGS.map(([c, n]) => `<button class="btn sm ghost" data-act="setlang" data-v="${c}">${n}</button>`).join('')}</div>` : ''}${m.chips ? `<div class="macts">${m.chips.map(c => `<button class="chip" data-act="ask" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}</div>`).join('')}</div>
      <form id="chatform" class="chatin"><input id="chatq" autocomplete="off" placeholder="${esc(t('chat_ph'))}" aria-label="Message" maxlength="300"><button class="btn primary" aria-label="Send">➤</button></form></section>`;
  }
  function ask(q) {
    lastQ = q.toLowerCase();
    ui.chat.push({ who: 'me', html: esc(q) });
    const hit = INTENTS.find(i => i.k.some(k => lastQ.includes(k)));
    const r = hit ? hit.f() : { text: 'I can help with: refunds, tracking, pickup problems, amounts, vouchers, exchanges, reviews, language, or a human.', chips: ['Where is my money?', 'Why less money?', 'Talk to a person'] };
    ui.chat.push({ who: 'bot', html: r.text, card: r.card, acts: r.acts, langs: r.langs, chips: r.chips });
    API.logChat('user', q); API.logChat('bot', r.text.replace(/<[^>]+>/g, ''));
    render(); setTimeout(() => { const i = $('#chatq'); if (i) i.focus(); }, 0);
  }

  // ---------------------------------------------------------------- JUDGE CONSOLE
  function vJudge() {
    const v = E.auditVerify(st.audit), tr = ui.tests, f = E.fraudAssess(S.CUSTOMER.profile);
    const faults = [['stale', 'Stale provider data'], ['timeout', 'Service timeout'], ['offline', 'Connectivity loss'], ['conflict', 'Conflicting update'], ['ooo', 'Out-of-order event'], ['malformed', 'Malformed input'], ['dup', 'Duplicate refund retry'], ['tamper', 'Tamper with audit log']];
    const ring = tr ? `<svg viewBox="0 0 140 140" class="ring" role="img" aria-label="${tr.passed} of ${tr.total} passed"><circle cx="70" cy="70" r="54" fill="none" stroke="var(--line-soft)" stroke-width="16"/><circle cx="70" cy="70" r="54" fill="none" stroke="var(--mint)" stroke-width="16" stroke-dasharray="${339.3 * tr.rate} 340" transform="rotate(-90 70 70)" class="seg" style="--len:${339.3 * tr.rate}"/><text x="70" y="78" text-anchor="middle" class="d-big">${Math.round(tr.rate * 100)}%</text></svg>` : '';
    return `<h1>🧪 ${t('judges')}</h1><p class="muted">Hard-mode evidence: faults, tests, audit trail, fairness, threat model and data card. Synthetic data, clearly labelled.</p>
      <div class="jgrid">
      <section class="panel"><h3>Inject a fault</h3><div class="faults">${faults.map(([k, n]) => `<button class="fault ${st.faults[k] ? 'on' : ''}" data-act="fault" data-v="${k}" aria-pressed="${!!st.faults[k]}">${n}</button>`).join('')}</div>
        ${ui.malformed ? `<label class="field">Event JSON<textarea id="evjson" rows="3">{"machine":"item","to":"received","at":"yesterday","amount":-5}</textarea></label><button class="btn primary sm" data-act="submitEvent">Submit event</button>` : ''}
        <ol class="flog">${st.faultLog.slice(-8).reverse().map(l => `<li class="${l.ok ? 'ok' : 'bad'}"><b>${esc(l.title)}</b> ${esc(l.text)}</li>`).join('') || '<li class="muted">No faults yet. Try one, then check the customer screens.</li>'}</ol></section>
      <section class="panel"><div class="row between"><h3>Evaluation harness</h3><button class="btn primary sm" data-act="tests">Run all tests</button></div>
        ${tr ? `<div class="row">${ring}<div><div class="huge">${tr.passed}/${tr.total}</div><small class="muted">scripted cases passed</small></div></div>${Object.values(tr.metrics).map(m => `<div class="metric"><b>${esc(m.name)}</b><div>${esc(m.value)}</div></div>`).join('')}<details><summary>All cases</summary><ul class="tests">${tr.cases.map(c => `<li class="${c.pass ? 'ok' : 'bad'}">${c.pass ? '✓' : '✗'} <code>${c.id}</code> ${esc(c.name)}</li>`).join('')}</ul></details>` : '<p class="muted">56 cases: allocation, state machines, reconciliation, idempotency, disputes, fairness, wording, audit.</p>'}</section>
      <section class="panel"><div class="row between"><h3>Audit trail</h3><span class="chip ${v.ok ? 'c-high' : 'c-low'}">${v.ok ? 'Chain intact · ' + v.length : 'BROKEN at #' + v.brokenAt}</span></div>
        <div class="chain">${st.audit.slice(-8).map(e => `<div class="blk ${!v.ok && e.seq >= v.brokenAt ? 'broken' : ''}"><small><b>#${e.seq}</b> ${esc(e.actor)} · ${when(e.at)}</small><div>${esc(e.action)}</div><code>${e.hash.slice(0, 14)}…</code></div>`).join('')}</div>
        ${st.tamperBackup ? '<button class="btn ghost sm" data-act="restore">Restore entry</button>' : ''}</section>
      <section class="panel"><h3>Fair fraud check (Elite)</h3><p>Lakshmi: 12 returns in 90 days → volume rule <b>L${f.naiveLevel}</b>, after fairness check <b>L${f.level} · ${esc(f.rung.name)}</b>.</p><ul class="small">${f.fairness.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <table class="lines small"><tr><th>ID</th><th>Returns</th><th>Volume rule</th><th>Ours</th><th>Truth</th><th></th></tr>${S.RETURNERS.map(r => { const a = E.fraudAssess(r), ap = st.appeals[r.id]; return `<tr><td>${r.id}</td><td>${r.returns90}</td><td>L${a.naiveLevel}</td><td><b>L${ap === 'overturned' ? 0 : a.level}</b>${ap ? ' (' + ap + ')' : ''}</td><td>${r.legit ? 'genuine' : 'abuse'}</td><td>${a.level >= 2 && !ap ? `<button class="btn ghost sm" data-act="appeal" data-v="${r.id}">Appeal</button>` : ''}</td></tr>`; }).join('')}</table></section>
      <section class="panel"><h3>Threat model</h3><ol class="small">${S.THREATS.map(x => `<li><b>${esc(x.risk)}</b>: ${esc(x.mitigation)} <code>${esc(x.test)}</code></li>`).join('')}</ol></section>
      <section class="panel"><h3>Data card · ${S.DATA_CARD.length} planted conflicts</h3><ol class="small">${S.DATA_CARD.map(d => `<li><b>${d[0]}</b> ${esc(d[1])} → <i>${esc(d[2])}</i></li>`).join('')}</ol></section>
      </div><button class="btn ghost" data-act="reset">↻ Reset my demo data</button>`;
  }
  function fault(title, text, ok) { st.faultLog.push({ title, text, ok }); log('judge', 'FAULT_' + title.toUpperCase().replace(/\W+/g, '_'), { text }); }
  function injectFault(k) {
    if (k === 'stale' || k === 'timeout') { st.faults[k] = !st.faults[k]; fault(k, st.faults[k] ? 'Kurta card refund now shows “status unknown”, low confidence. Open My return → Kurta.' : 'Cleared.', true); }
    else if (k === 'offline') {
      st.faults.offline = !st.faults.offline;
      if (!st.faults.offline && st.queue.length) { const q = st.queue.splice(0), seen = new Set(); q.forEach(x => { const key = x.name + x.v; if (seen.has(key)) return; seen.add(key); ACTIONS[x.name](x.v); }); fault('Back online', `Replayed ${seen.size} queued action(s) once (${q.length - seen.size} duplicate(s) dropped).`, true); }
      else fault('Connectivity loss', st.faults.offline ? 'Offline banner on; actions queue locally.' : 'Back online.', true);
    } else if (k === 'conflict') { try { E.transition('item', [{ state: 'IN_TRANSIT', at: '2026-10-18T12:30:00.000Z' }], 'INSPECTION_PASSED', NOW); } catch (e) { fault('Conflicting update', 'Rejected: ' + e.message, true); } }
    else if (k === 'ooo') { try { E.transition('item', [{ state: 'COLLECTED', at: '2026-10-18T05:35:00.000Z' }], 'IN_TRANSIT', '2026-10-18T05:00:00.000Z'); } catch (e) { fault('Out-of-order event', 'Rejected: ' + e.message, true); } }
    else if (k === 'malformed') ui.malformed = true;
    else if (k === 'dup') { const leg = st.items.B.refundLegs['pm-card']; const r = E.issueRefund(st.ledger, `${S.RETURN_ID}:B:pm-card`, leg.amount, NOW); fault('Duplicate refund', r.duplicate ? `Blocked. Same key → original ${r.refund.ref}. Refunds issued: ${Object.keys(st.ledger.byKey).length}, attempts: ${st.ledger.attempts.length}.` : 'Issued?!', r.duplicate); }
    else if (k === 'tamper') { const x = st.audit[4]; if (!st.tamperBackup) { st.tamperBackup = { seq: x.seq, data: x.data }; x.data = JSON.stringify({ ...JSON.parse(x.data), amount: 1 }); } const v = E.auditVerify(st.audit); fault('Tamper', v.ok ? 'Not detected?!' : `Detected: chain breaks at #${v.brokenAt}.`, !v.ok); }
  }

  // ---------------------------------------------------------------- actions
  function runReview(id) {
    const r = rec(id), x = r.inspection;
    const d = E.judgeInspection(x.claim, x.evidence, x.openedAt, x.slaHours, NOW);
    const next = { PASSED: 'INSPECTION_PASSED', PARTIAL: 'INSPECTION_PARTIAL', REJECTED: 'INSPECTION_REJECTED' }[d.outcome];
    r.item = E.transition('item', r.item, next, NOW, { why: d.reason });
    r.decision = { ...d, seq: log('reviewer-teamB', next, { item: id, refundPct: d.refundPct }).seq };
    if (d.refundPct > 0) issueLegs(id);
    toast(`Review: ${d.outcome}, ${d.refundPct}% refund.`, 'good'); confetti();
  }
  function issueLegs(id) {
    const r = rec(id), a = allocFor(id), o = orderOf(id); r.alloc = a; r.refundLegs = r.refundLegs || {};
    const retId = st.items[id] ? S.RETURN_ID : st.extra.find(x => x.items[id]).id;
    a.legs.forEach(l => {
      const key = `${retId}:${id}:${l.instrumentId}`, res = E.issueRefund(st.ledger, key, l.amount, NOW);
      if (res.duplicate) return;
      const instant = l.type === 'wallet' || l.type === 'voucher';
      let h = [{ state: 'NOT_STARTED', at: NOW }]; h = E.transition('refund', h, 'APPROVED', NOW); h = E.transition('refund', h, 'INITIATED', NOW);
      if (instant) { h = E.transition('refund', h, 'PROVIDER_PROCESSED', NOW); h = E.transition('refund', h, 'CREDITED_CONFIRMED', NOW); }
      r.refundLegs[l.instrumentId] = { amount: l.amount, leg: l, ref: res.refund.ref, history: h, sources: { platform: { status: 'INITIATED', at: NOW, seenAt: NOW }, provider: instant ? { status: 'CREDITED', at: NOW, seenAt: NOW } : { status: 'PENDING', at: NOW, seenAt: NOW }, seller: { status: 'PENDING', at: NOW, seenAt: NOW } } };
      log('payments', 'REFUND_INITIATED', { item: id, instrument: l.instrumentId, amount: l.amount, key });
    });
  }
  function advance(id) {
    const r = rec(id), cur = E.current(r.item).state;
    const path = { REQUESTED: 'PICKUP_SCHEDULED', PICKUP_SCHEDULED: 'COLLECTED', DROPOFF_SELECTED: 'COLLECTED', COLLECTED: 'IN_TRANSIT', IN_TRANSIT: 'RECEIVED', RECEIVED: 'INSPECTION_PASSED' };
    if (path[cur]) { r.item = E.transition('item', r.item, path[cur], NOW); log('courier', path[cur], { item: id }); if (path[cur] === 'INSPECTION_PASSED' && r.option === 'refund') issueLegs(id); return; }
    // money steps: provider processes, then bank credits
    Object.values(r.refundLegs || {}).forEach(l => {
      const s = E.current(l.history).state;
      if (s === 'INITIATED') { l.history = E.transition('refund', l.history, 'PROVIDER_PROCESSED', NOW); l.sources.provider = { status: 'PROCESSED', at: NOW, seenAt: NOW }; }
      else if (s === 'PROVIDER_PROCESSED') { l.history = E.transition('refund', l.history, 'CREDITED_CONFIRMED', NOW); l.sources.provider = { status: 'CREDITED', at: NOW, seenAt: NOW }; }
    });
    if (progress(id).idx === 4) confetti();
  }
  const ACTIONS = {
    review: id => runReview(id),
    advance: id => advance(id),
    report: id => { const tk = 'CMP-' + (200000 + st.tickets.length * 11 + 7); st.tickets.push({ id: tk, item: id, at: new Date().toISOString() }); log('customer', 'CORRECTION_REQUESTED', { item: id, ticket: tk }); toast(`Thanks. Ticket ${tk}: a person checks this within 24 h.`); },
    appeal: v => { const r = S.RETURNERS.find(x => x.id === v); if (r.confirmedAbuse > 0) { st.appeals[v] = 'upheld'; toast(`${v}: friction stays (${r.confirmedAbuse} confirmed abuse cases).`); } else { st.appeals[v] = 'overturned'; toast(`${v}: appeal accepted, friction removed.`, 'good'); } log('reviewer', 'APPEAL_' + st.appeals[v].toUpperCase(), { customer: v }); },
  };
  function act(name, v) { if (st.faults.offline) { st.queue.push({ name, v }); toast('Offline: queued. Sent once when you reconnect.'); return; } ACTIONS[name](v); }

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act],[data-go]'); if (!el) { if (ui.menu && !e.target.closest('.menu')) { ui.menu = false; render(); } return; }
    if (el.dataset.go === 'back') { history.length > 1 ? history.back() : (location.hash = '#/home'); return; }
    const a = el.dataset.act, v = el.dataset.v;
    if (a === 'closechat') { ui.chatOpen = false; return; }
    if (el.tagName === 'BUTTON') e.preventDefault();
    try {
      switch (a) {
        case 'theme': ui.theme = ui.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('rewind-theme', ui.theme); } catch (x) {} API.savePrefs({ theme: ui.theme }); break;
        case 'menu': ui.menu = !ui.menu; break;
        case 'info': ui.info = !ui.info; break;
        case 'enter': return enterApp();
        case 'google': try { await API.google(); } catch (x) { ui.authErr = x.message; } break;
        case 'kind': ui.rep.kind = v; break;
        case 'sendreport': {
          const det = ($('#rep-det').value || '').trim(), who = ($('#rep-who').value || '').trim();
          if (!ui.rep.kind) { toast('Pick what happened first.', 'bad'); return; }
          if (/\b\d{4,8}\b/.test(det) && /otp|pin/i.test(det)) { toast('Please remove any OTP or PIN from the details.', 'bad'); return; }
          await API.report({ kind: ui.rep.kind, details: det.slice(0, 1000), phone_or_link: who.slice(0, 200) });
          ui.reports = await API.reports(); log('customer', 'FRAUD_REPORTED', { kind: ui.rep.kind }); ui.rep = null; save(); confetti(); toast('Report sent. Thank you for keeping others safe.', 'good'); break;
        }
        case 'placeorder': toast('Order placed (simulated). Return rules saved with your order.', 'good'); confetti(); break;
        case 'refpref': ui.refpref = v; break;
        case 'pickx': ui.wiz = { id: v, step: 1, reason: null, option: null, slot: 0, consent: false, preferExchange: true }; location.hash = '#/start/' + v; return;
        case 'signout': API.signOut(); ui.user = null; ui.menu = false; st = null; location.hash = '#/'; break;
        case 'authtab': ui.authTab = v; ui.authErr = ''; break;
        case 'chat': ui.chatOpen = !ui.chatOpen; break;
        case 'ask': return ask(v);
        case 'setlang': ui.lang = v; try { localStorage.setItem('rewind-lang', v); } catch (x) {} ui.chat.push({ who: 'bot', html: `✓ ${LANGS.find(l => l[0] === v)[1]}` }); break;
        case 'pick': ui.wiz = { id: v, step: 1, reason: null, option: null, slot: 0, consent: false }; location.hash = '#/start/' + v; return;
        case 'reason': ui.wiz.reason = v; ui.wiz.step = 2; break;
        case 'option': ui.wiz.option = v; ui.wiz.step = 3; break;
        case 'slot': ui.wiz.slot = +v; break;
        case 'confirm': {
          const w = ui.wiz; if (!$('#consent').checked) { toast('Please tick the consent box first.', 'bad'); return; }
          const id = 'RT-' + (30000 + st.extra.length + 1);
          const h0 = [{ state: 'REQUESTED', at: NOW }]; const h1 = E.transition('item', h0, w.slot === 2 ? 'DROPOFF_SELECTED' : 'PICKUP_SCHEDULED', NOW);
          st.extra.push({ id, orderId: orderOf(w.id).id, items: { [w.id]: { reason: w.reason, option: w.option, demo: true, item: h1, refundLegs: {}, pickupSlot: ['tomorrow 9 AM–12 PM', 'tomorrow 2–6 PM', 'drop-off'][w.slot] } } });
          log('customer', 'RETURN_CREATED', { id, item: w.id, option: w.option, reason: w.reason }); ui.wiz = null; confetti(); toast(`${id} created. Pickup booked.`, 'good'); save(); location.hash = '#/item/' + w.id; return;
        }
        case 'ok': ui.revForm.ok = v === '1'; break;
        case 'star': ui.revForm[el.dataset.k] = +v; break;
        case 'tag': { const tg = ui.revForm.tags; const i = tg.indexOf(v); i >= 0 ? tg.splice(i, 1) : tg.push(v); break; }
        case 'submitrev': {
          const f = ui.revForm; f.comment = ($('#rvc').value || '').slice(0, 500);
          if (f.ok === null || !f.rs || !f.ps) { toast('Please answer yes/no and give both star ratings.', 'bad'); return; }
          await API.addReview({ item_id: f.id, item_name: itemOf(f.id).name, return_ok: f.ok, return_stars: f.rs, product_stars: f.ps, tags: f.tags, comment: f.comment });
          ui.reviews = await API.reviews(); ui.revForm = null; log('customer', 'REVIEW_SAVED', { item: f.id }); save(); confetti(); toast(t('thanks'), 'good'); break;
        }
        case 'fault': injectFault(v); save(); break;
        case 'submitEvent': { let errs; try { errs = E.validateEvent(JSON.parse($('#evjson').value)); } catch (x) { errs = ['Not valid JSON']; } fault('Malformed input', errs.length ? 'Rejected: ' + errs.join('; ') : 'Valid shape; still guarded by the state machine.', true); ui.malformed = false; save(); break; }
        case 'tests': ui.tests = TestHarness.runAll(E, S); log('judge', 'TESTS_RUN', { passed: ui.tests.passed, total: ui.tests.total }); save(); break;
        case 'restore': { const x = st.audit.find(y => y.seq === st.tamperBackup.seq); x.data = st.tamperBackup.data; st.tamperBackup = null; toast('Restored; chain verifies again.', 'good'); save(); break; }
        case 'reset': st = seed(); save(); toast('Demo data reset to 24 Oct, 10:00 AM.'); break;
        default: if (ACTIONS[a]) { act(a, v); save(); }
      }
    } catch (err) { toast(err.message, 'bad'); }
    render();
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'lang') { ui.lang = e.target.value; try { localStorage.setItem('rewind-lang', ui.lang); } catch (x) {} if (ui.user) API.savePrefs({ lang: ui.lang }); render(); }
  });
  document.addEventListener('submit', async e => {
    e.preventDefault();
    if (e.target.id === 'chatform') { const q = $('#chatq').value.trim(); if (q) ask(q); return; }
    if (e.target.id === 'authform') {
      const fd = new FormData(e.target), btn = $('#authbtn'); btn.disabled = true; btn.textContent = '…';
      try { const u = ui.authTab === 'up' ? await API.signUp(String(fd.get('name') || '').trim(), fd.get('email'), fd.get('password')) : await API.signIn(fd.get('email'), fd.get('password')); await afterLogin(u); }
      catch (err) { ui.authErr = err.message; render(); }
    }
  });
  window.addEventListener('hashchange', () => { ui.menu = false; if (!location.hash.startsWith('#/start/')) ui.wiz = ui.wiz && location.hash.startsWith('#/start') ? null : ui.wiz; render(); window.scrollTo(0, 0); });
  window.addEventListener('offline', () => { if (st) { st.faults.offline = true; render(); } });
  window.addEventListener('online', () => { if (st && st.faults.offline) { injectFault('offline'); save(); render(); } });

  function enterApp() {
    if (!ui.splash || ui.splashLeaving) return;
    ui.splashLeaving = true; render();
    setTimeout(() => { ui.splash = false; ui.splashLeaving = false; render(); }, 650);
  }
  let ty = null, tx = null;
  document.addEventListener('touchstart', e => { ty = e.touches[0].clientY; tx = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', e => {
    if (ty === null) return;
    const dy = e.changedTouches[0].clientY - ty, dx = e.changedTouches[0].clientX - tx; ty = null;
    if (ui.splash && dy < -40) return enterApp();
    // swipe left/right on the main area moves between tabs
    if (ui.user && Math.abs(dx) > 70 && Math.abs(dy) < 50 && !ui.chatOpen && e.target.closest('main')) {
      const r = (location.hash.replace(/^#\/?/, '') || 'home').split('/')[0], i = TABS.findIndex(x => x[0] === r);
      if (i >= 0) { const n = i + (dx < 0 ? 1 : -1); if (TABS[n]) location.hash = '#/' + TABS[n][0]; }
    }
  }, { passive: true });
  window.addEventListener('wheel', e => { if (ui.splash && e.deltaY > 25) enterApp(); }, { passive: true });
  document.addEventListener('keydown', e => { if (ui.splash && ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'PageDown'].includes(e.key) && !e.target.closest('select')) { e.preventDefault(); enterApp(); } });

  (async () => { render(); const u = await API.restore(); if (u) await afterLogin(u); else render(); })();
})();
