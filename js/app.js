// Screens and interaction. Rules live in logic.js, sample data in data.js, text in i18n.js.

// ---------- State (saved in the browser so the demo survives a refresh) ----------
const STORE_KEY = 'returnease-v1';
const state = {
  lang: 'en', textSize: 1, contrast: false, lowData: false,
  returns: JSON.parse(JSON.stringify(SEED_RETURNS)),
  tickets: {},   // returnId -> { date, id }
  disputes: {},  // returnId:itemId -> date
};
try {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (saved) Object.assign(state, saved);
} catch (e) { /* storage blocked: demo still works, it just won't remember */ }
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {} }

const t = k => (STRINGS[state.lang] && STRINGS[state.lang][k]) || STRINGS.en[k] || k;
const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const orderById = id => ORDERS.find(o => o.id === id);
const itemById = (order, id) => order.items.find(i => i.id === id);

// ---------- Shared bits ----------
const STATUS_TONE = { delayed: 'bad', action: 'warn', onTrack: 'ok', done: 'done' };
function pill(kind) { return `<span class="pill ${STATUS_TONE[kind]}">${t(kind)}</span>`; }
function thumb(item) {
  const initials = item.name.split(/[ ,]+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  return `<div class="thumb" style="--tint:${item.tint}" aria-hidden="true">${initials}</div>`;
}
function methodTag(type) {
  const m = PAYMENT_METHODS[type];
  return `<span class="dot" style="background:${m.color}"></span>`;
}

// ---------- Router ----------
function route() {
  const [, page, id] = (location.hash || '#/').split('/');
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.page === (page || 'home')));
  stopReading();
  if (page === 'return') return renderWizard(id);
  if (page === 'track') return renderTracker(id);
  if (page === 'returns') return renderReturnsList();
  if (page === 'help') return renderHelp();
  renderHome();
}
window.addEventListener('hashchange', () => { route(); window.scrollTo(0, 0); });

function mount(html) { $('#main').innerHTML = html; $('#main').focus({ preventScroll: true }); }

// ---------- Home ----------
function returnCard(r) {
  const order = orderById(r.orderId);
  const kind = returnStatus(r);
  const names = r.items.map(ri => itemById(order, ri.itemId).name).join(' + ');
  return `<a class="card link-card" href="#/track/${r.id}">
    <div class="row between"><strong>${r.id}</strong>${pill(kind)}</div>
    <p class="muted small">${esc(names)}</p>
    <p class="small">${r.items.length} item${r.items.length > 1 ? 's' : ''} · started ${fmtDate(r.created)}</p>
  </a>`;
}

function renderHome() {
  const orders = ORDERS.map(o => {
    const items = o.items.map(i => {
      const e = eligibility(o, i, state.returns);
      let note;
      if (e.ok) note = `<span class="${e.daysLeft <= 2 ? 'warn-text' : 'muted'}">${e.daysLeft === 0 ? t('lastDay') + ': today' : e.daysLeft + ' ' + t('daysLeft')}</span>`;
      else if (e.why === 'inReturn') note = `<span class="muted">In a return</span>`;
      else if (e.why === 'windowClosed') note = `<span class="muted">${t('windowClosed')} ${fmtDate(e.lastDay)}</span>`;
      else note = `<span class="muted">${t('notReturnable')} (${e.why === 'hygiene' ? 'hygiene item' : 'store policy'})</span>`;
      return `<li class="item-line">${thumb(i)}<div><div>${esc(i.name)}</div><div class="small">${rupees(i.price)} · ${note}</div></div></li>`;
    }).join('');
    const canReturn = o.items.some(i => eligibility(o, i, state.returns).ok);
    const pay = o.payments.map(p => p.label.split('  ')[0]).join(' + ');
    return `<section class="card">
      <div class="row between"><strong>${o.id}</strong><span class="small muted">Delivered ${fmtDate(o.delivered)}</span></div>
      <p class="small muted">Paid by ${esc(pay)}${o.coupon ? ` · coupon ${o.coupon.code} (−${rupees(o.coupon.amount)})` : ''}</p>
      <ul class="items">${items}</ul>
      ${canReturn ? `<a class="btn primary block" href="#/return/${o.id}">${t('returnItems')}</a>`
                  : `<p class="small muted">No items in this order can be returned right now.</p>`}
    </section>`;
  }).join('');

  const active = state.returns.slice().sort((a, b) => b.created.localeCompare(a.created));
  mount(`
    <h1>${t('hello')}, ${USER.name}</h1>
    <p class="muted">${t('tagline')}</p>
    <div class="notice"><strong>Safety:</strong> We never ask for OTP, PIN or card number to give a refund. Anyone who does is a scammer.</div>
    <h2>${t('yourReturns')}</h2>
    ${active.length ? active.map(returnCard).join('') : `<p class="muted">${t('noReturns')}</p>`}
    <h2>${t('yourOrders')}</h2>
    ${orders}
  `);
}

function renderReturnsList() {
  mount(`<h1>${t('yourReturns')}</h1>${state.returns.length ? state.returns.map(returnCard).join('') : `<p class="muted">${t('noReturns')}</p>`}`);
}

// ---------- Return wizard ----------
let wiz = null;
function renderWizard(orderId) {
  const order = orderById(orderId);
  if (!order) { location.hash = '#/'; return; }
  if (!wiz || wiz.orderId !== orderId) {
    wiz = { orderId, step: 1, picked: {}, reasons: {}, photos: {}, pref: 'original', slot: 0, upi: '', consent: false, error: '' };
  }
  const steps = ['Items', 'Pickup & refund', 'Review'];
  const header = `<a class="back" href="#/">← ${t('back')}</a>
    <h1>${t('returnItems')} · ${order.id}</h1>
    <ol class="stepper" aria-label="Progress">${steps.map((s, i) => `<li class="${i + 1 === wiz.step ? 'now' : i + 1 < wiz.step ? 'past' : ''}">${i + 1}. ${s}</li>`).join('')}</ol>
    ${wiz.error ? `<p class="error" role="alert">${esc(wiz.error)}</p>` : ''}`;
  if (wiz.step === 1) mount(header + wizItems(order));
  if (wiz.step === 2) mount(header + wizPickup(order));
  if (wiz.step === 3) mount(header + wizReview(order));
}

function wizItems(order) {
  const rows = order.items.map(i => {
    const e = eligibility(order, i, state.returns);
    const on = !!wiz.picked[i.id];
    if (!e.ok) {
      const why = e.why === 'windowClosed' ? `${t('windowClosed')} on ${fmtDate(e.lastDay)}. If it's faulty, you can still claim the brand warranty.`
        : e.why === 'hygiene' ? 'Hygiene item: cannot be returned once delivered. If it arrived sealed but damaged, contact support.'
        : e.why === 'inReturn' ? 'Already in a return.' : t('notReturnable');
      return `<div class="pick disabled">${thumb(i)}<div><div>${esc(i.name)}</div><div class="small muted">${why}</div></div></div>`;
    }
    const needsPhoto = ['damaged', 'wrongItem', 'notAsDescribed'].includes(wiz.reasons[i.id]);
    return `<div class="pick ${on ? 'on' : ''}">
      <label class="row">
        <input type="checkbox" data-pick="${i.id}" ${on ? 'checked' : ''}>
        ${thumb(i)}
        <div><div>${esc(i.name)}</div><div class="small">${rupees(i.price)} · <span class="${e.daysLeft <= 2 ? 'warn-text' : 'muted'}">${e.daysLeft} ${t('daysLeft')}</span></div></div>
      </label>
      ${on ? `<label class="field">${t('reason')}
        <select data-reason="${i.id}">
          <option value="">Choose…</option>
          ${RETURN_REASONS.map(r => `<option value="${r}" ${wiz.reasons[i.id] === r ? 'selected' : ''}>${t('r_' + r)}</option>`).join('')}
        </select></label>
        ${needsPhoto ? `<button class="btn ghost small-btn" data-photo="${i.id}">${wiz.photos[i.id] ? '✓ Photo added (sample)' : '📷 Add a photo (helps approve faster)'}</button>` : ''}` : ''}
    </div>`;
  }).join('');
  return `<p class="muted">${t('chooseItems')}. ${t('chooseHint')}</p>${rows}
    <button class="btn primary block" data-go="2">${t('continue')}</button>`;
}

function pickedItems(order) { return order.items.filter(i => wiz.picked[i.id]); }

function wizPickup(order) {
  const slots = [[1, '9 AM – 12 PM'], [1, '2 PM – 6 PM'], [2, '9 AM – 12 PM']];
  const isCod = order.payments.some(p => p.type === 'cod');
  return `<h2>${t('pickupTitle')}</h2>
    <p class="small muted">One agent collects all ${pickedItems(order).length} item(s) together. Address: 12-4-56, Benz Circle, Vijayawada (saved).</p>
    ${slots.map(([d, s], i) => `<label class="radio"><input type="radio" name="slot" data-slot="${i}" ${wiz.slot === i ? 'checked' : ''}> ${fmtDate(addDays(todayStr(), d))}, ${s}</label>`).join('')}
    <label class="radio"><input type="checkbox" data-assist ${wiz.assist ? 'checked' : ''}> I need help packing (senior citizen / disability). Agent brings a bag.</label>
    <h2>Refund to</h2>
    <label class="radio"><input type="radio" name="pref" data-pref="original" ${wiz.pref === 'original' ? 'checked' : ''}>
      <span>${isCod ? 'My bank account / UPI (you paid cash)' : 'Where I paid from'} <span class="small muted">· takes a few days</span></span></label>
    <label class="radio"><input type="radio" name="pref" data-pref="wallet" ${wiz.pref === 'wallet' ? 'checked' : ''}>
      <span>Store wallet <span class="small muted">· instant, but only usable on this store</span></span></label>
    ${isCod && wiz.pref === 'original' ? `<label class="field">UPI ID for the refund
      <input data-upi value="${esc(wiz.upi)}" placeholder="name@bank" autocomplete="off" inputmode="email"></label>
      <p class="small muted">We check the name on this UPI ID matches yours before sending money (simulated). We never ask for your UPI PIN.</p>` : ''}
    <div class="row gap"><button class="btn ghost" data-go="1">${t('back')}</button><button class="btn primary grow" data-go="3">${t('continue')}</button></div>`;
}

function wizReview(order) {
  const items = pickedItems(order);
  const lines = items.map(i => {
    const r = itemRefund(order, i);
    return `<tr><td>${esc(i.name)}<div class="small muted">${t('r_' + wiz.reasons[i.id])}</div></td>
      <td class="num">${rupees(r.price)}${r.couponShare ? `<div class="small muted">−${rupees(r.couponShare)} coupon share</div>` : ''}</td>
      <td class="num"><strong>${rupees(r.refund)}</strong></td></tr>`;
  }).join('');
  const total = items.reduce((s, i) => s + itemRefund(order, i).refund, 0);
  const parts = splitRefund(order, total, wiz.pref);
  const pickupDay = addDays(todayStr(), wiz.slot === 2 ? 2 : 1);
  const refundStart = addDays(pickupDay, 2);
  const dest = parts.map(p => {
    const e = eta(p.type, refundStart);
    return `<li>${methodTag(p.type)} <span class="grow">${esc(p.label)}</span><strong>${rupees(p.amount)}</strong>
      <div class="small muted full">Expected ${e.from === e.to ? 'on ' + fmtDate(e.to) : fmtDate(e.from) + ' – ' + fmtDate(e.to)}</div></li>`;
  }).join('');
  return `<h2>${t('reviewTitle')}</h2>
    <table class="money"><thead><tr><th>Item</th><th class="num">Price</th><th class="num">Refund</th></tr></thead>
      <tbody>${lines}</tbody><tfoot><tr><td colspan="2">Total refund</td><td class="num"><strong>${rupees(total)}</strong></td></tr></tfoot></table>
    ${order.coupon ? `<details class="explain"><summary>Why is my refund less than the price?</summary>
      <p>You used coupon ${order.coupon.code} for ${rupees(order.coupon.amount)} off the whole order. That discount is shared across all items by price. When you return an item, its share of the discount is not refunded, because you didn't pay that part. Items you keep keep their discount.</p></details>` : ''}
    <h2>${t('whereMoney')}</h2>
    <ul class="dest">${dest}</ul>
    ${parts.length > 1 ? `<p class="small muted">You paid in ${parts.length} ways, so the refund goes back the same way. You will get ${parts.length} separate credits.</p>` : ''}
    <label class="radio consent"><input type="checkbox" data-consent ${wiz.consent ? 'checked' : ''}>
      I agree my address and phone are shared with the courier only for this pickup, and deleted after the return closes.</label>
    <div class="row gap"><button class="btn ghost" data-go="2">${t('back')}</button><button class="btn primary grow" data-submit>${t('confirm')}</button></div>`;
}

function submitReturn(order) {
  const id = 'RT-' + (10500 + state.returns.length + Math.floor(Math.random() * 400));
  const pickupDay = addDays(todayStr(), wiz.slot === 2 ? 2 : 1);
  const items = pickedItems(order).map(i => {
    const refund = itemRefund(order, i).refund;
    return {
      itemId: i.id, reason: wiz.reasons[i.id], refund,
      destination: splitRefund(order, refund, wiz.pref),
      steps: [{ key: 'requested', date: todayStr() }],
      demo: true,
    };
  });
  state.returns.push({
    id, orderId: order.id, created: todayStr(),
    pickup: { date: pickupDay, slot: ['9 AM – 12 PM', '2 PM – 6 PM', '9 AM – 12 PM'][wiz.slot] },
    items,
    updates: [{ date: todayStr(), channel: 'App', text: `Return ${id} created for ${items.length} item(s). One pickup on ${fmtDate(pickupDay)}.` }],
  });
  save(); wiz = null;
  location.hash = '#/track/' + id;
}

// ---------- Tracker ----------
function stepLabel(s) {
  return t('s_' + s.key);
}

function renderTracker(id) {
  const r = state.returns.find(x => x.id === id);
  if (!r) { location.hash = '#/'; return; }
  const order = orderById(r.orderId);
  const kind = returnStatus(r);
  const totalRefund = r.items.reduce((s, ri) => s + ri.refund, 0);

  const itemsHtml = r.items.map(ri => {
    const item = itemById(order, ri.itemId);
    const st = itemStatus(ri);
    const doneKeys = ri.steps.map(s => s.key);
    const path = st.kind === 'action' ? ['requested', 'pickup', 'picked', 'qcfail'] : STEP_ORDER;
    const timeline = path.map(k => {
      const s = ri.steps.find(x => x.key === k);
      const isLast = doneKeys[doneKeys.length - 1] === k;
      const cls = s ? (k === 'qcfail' ? 'fail' : 'done') : 'todo';
      return `<li class="${cls} ${isLast ? 'current' : ''}"><span class="tl-dot"></span><div>
        <div>${t('s_' + k)}</div>
        <div class="small muted">${s ? fmtDate(s.date) + (s.ref ? ' · ' + s.ref : '') : (k === 'credited' && ri.expectedBy ? 'Expected by ' + fmtDate(ri.expectedBy) : 'Pending')}</div>
      </div></li>`;
    }).join('');

    let box = '';
    if (st.kind === 'delayed') {
      const sent = ri.steps.find(s => s.key === 'initiated');
      const m = PAYMENT_METHODS[ri.destination[0].type];
      const ticket = state.tickets[r.id];
      box = `<div class="alert bad">
        <strong>${t('delayed')} by ${st.lateBy} days</strong>
        <p>The store sent ${rupees(ri.refund)} on ${fmtDate(sent.date)}. ${m.label} refunds usually arrive within ${m.maxDays} days, so it should have reached you by ${fmtDate(ri.expectedBy)}.</p>
        <p><strong>What this usually means:</strong> the money has left the store and is with your bank. Your bank can find it with this number:</p>
        <p class="ref">${esc(sent.ref)} <button class="btn ghost small-btn" data-copy="${esc(sent.ref.replace('ARN ', ''))}">Copy</button></p>
        <details class="explain"><summary>What to say to your bank</summary>
          <p>"A refund of ${rupees(ri.refund)} was sent to my ${m.label.toLowerCase()} on ${fmtDate(sent.date)} with ARN ${esc(sent.ref.replace('ARN ', ''))}. It has not reached my account. Please trace it."</p></details>
        <div class="row gap wrap">
          <button class="btn primary" data-received="${r.id}:${ri.itemId}">I got the money</button>
          ${ticket ? '' : `<button class="btn danger" data-escalate="${r.id}">${t('escalate')}</button>`}
        </div>
      </div>`;
    } else if (st.kind === 'action') {
      const disputed = state.disputes[r.id + ':' + ri.itemId];
      box = `<div class="alert warn">
        <strong>${t('s_qcfail')}</strong>
        <p>${esc(st.last.note || 'The item did not pass the warehouse check.')}</p>
        <p class="small">No refund for this item yet. You can accept and get it back, or challenge the decision.</p>
        ${disputed ? `<p class="ok-text"><strong>Challenge sent ${fmtDate(disputed)}.</strong> The pickup-time photo will be compared with the warehouse photo by a different team. Answer within 3 days.</p>` :
        `<div class="evidence"><div><div class="ph">Pickup photo<br><span class="small">6 Oct · agent's camera</span><br><span class="small">no dent visible</span></div></div>
          <div><div class="ph">Warehouse photo<br><span class="small">8 Oct · QC desk</span><br><span class="small">dent on base</span></div></div></div>
        <p class="small muted">Sample images. The photos are taken at pickup and at the warehouse so both sides can see when the damage happened.</p>
        <div class="row gap wrap"><button class="btn primary" data-dispute="${r.id}:${ri.itemId}">${t('dispute')}</button>
        <button class="btn ghost" data-acceptqc="${r.id}:${ri.itemId}">Accept, send it back to me</button></div>`}
      </div>`;
    } else if (st.kind === 'done') {
      box = `<div class="alert ok"><strong>${rupees(ri.refund)} reached you.</strong> This item is closed.</div>`;
    }

    const dest = ri.destination.length ? `<ul class="dest small">${ri.destination.map(d => `<li>${methodTag(d.type)} <span class="grow">${esc(d.label)}</span>${rupees(d.amount)}</li>`).join('')}</ul>` : '';
    const demoBtn = ri.demo && !['credited', 'qcfail'].includes(ri.steps[ri.steps.length - 1].key)
      ? `<button class="btn ghost small-btn demo" data-advance="${r.id}:${ri.itemId}">Demo: move to next step</button>` : '';

    return `<section class="card">
      <div class="row between"><div class="row">${thumb(item)}<div><strong>${esc(item.name)}</strong><div class="small muted">${t('r_' + ri.reason)}</div></div></div>${pill(st.kind)}</div>
      ${box}
      <ol class="timeline">${timeline}</ol>
      ${dest}
      ${demoBtn}
    </section>`;
  }).join('');

  const ticket = state.tickets[r.id];
  const ladder = ticket ? `<section class="card">
      <h2>Complaint ${ticket.id}</h2>
      <p class="small muted">Raised ${fmtDate(ticket.date)}. If one level does not fix it by the date shown, the next step unlocks.</p>
      <ol class="ladder">${escalationLadder(ticket.date).map((l, i) => `<li class="${i === 0 ? 'now' : ''}"><strong>${l.who}</strong>${l.by ? ` <span class="small muted">· answer due ${fmtDate(l.by)}</span>` : ''}<div class="small">${l.what}</div></li>`).join('')}</ol>
      <details class="explain"><summary>Ready-to-use complaint text</summary>
        <p>I returned items under order ${order.id} (return ${r.id}). A refund of ${rupees(r.items.find(i => itemStatus(i).kind === 'delayed')?.refund || totalRefund)} was sent on ${fmtDate((r.items.find(i => itemStatus(i).kind === 'delayed') || r.items[0]).steps.find(s => s.key === 'initiated')?.date || r.created)} but has not reached me. Complaint ${ticket.id} with the store was raised on ${fmtDate(ticket.date)}. I request the refund be traced and credited.</p></details>
      <p class="small muted">Prototype: nothing is actually filed with any authority.</p>
    </section>` : '';

  const updates = r.updates.slice().reverse().map(u => `<li><span class="chan">${u.channel}</span><div><div class="small muted">${fmtDate(u.date)}</div>${esc(u.text)}</div></li>`).join('');

  mount(`<a class="back" href="#/">← ${t('back')}</a>
    <div class="row between"><h1>${t('trackTitle')} ${r.id}</h1>${pill(kind)}</div>
    <p class="muted small">Order ${order.id} · ${r.items.length} item(s) · one pickup ${fmtDate(r.pickup.date)}, ${r.pickup.slot}</p>
    <div class="summary">
      <div><div class="small muted">Total refund</div><strong>${rupees(totalRefund)}</strong></div>
      <div><div class="small muted">Items done</div><strong>${r.items.filter(i => itemStatus(i).kind === 'done').length} / ${r.items.length}</strong></div>
    </div>
    ${itemsHtml}
    ${ladder}
    <section class="card"><h2>All updates in one place</h2>
      <p class="small muted">SMS, email and app messages together, so they can't contradict each other.</p>
      <ul class="updates">${updates}</ul></section>`);
}

// ---------- Help ----------
const FAQ = [
  { q: 'Where is my refund?', keys: ['where', 'refund', 'status', 'kaha', 'ఎక్కడ'], a: () => {
    const late = state.returns.find(r => returnStatus(r) === 'delayed');
    return late ? `Return ${late.id} has a late refund. <a href="#/track/${late.id}">Open it</a> to see the bank reference number and report the delay.` : 'All your refunds are on track. Open Returns to see each one.';
  } },
  { q: 'Why is my refund less than I paid?', keys: ['less', 'coupon', 'discount', 'kam', 'short'], a: () => 'If you used a coupon on the whole order, each item carries a share of the discount based on its price. Returning an item gives back what you actually paid for it: price minus its coupon share.' },
  { q: 'Why did I get two separate refunds?', keys: ['two', 'split', 'wallet', 'upi', 'multiple', 'partial'], a: () => 'You paid in more than one way (for example UPI + store wallet). Money goes back to each source in the same proportion, so you see separate credits that arrive at different speeds.' },
  { q: 'My item failed the quality check', keys: ['quality', 'qc', 'reject', 'failed', 'damage'], a: () => 'You can accept and get the item back, or challenge it. A challenge compares the photo taken at pickup with the warehouse photo, reviewed by a different team.' },
  { q: 'I paid cash. How do I get a refund?', keys: ['cash', 'cod'], a: () => 'For cash on delivery, give a UPI ID or bank account during the return. We check the account name matches yours before sending money. We never ask for a PIN or OTP.' },
  { q: 'Someone called asking for my OTP for a refund', keys: ['otp', 'call', 'scam', 'fraud', 'pin'], a: () => '<strong>That is a scam.</strong> Do not share it. Refunds never need an OTP, PIN or screen-sharing app. Report it at cybercrime.gov.in or call 1930.' },
];

let chat = [];
function renderHelp() {
  mount(`<h1>${t('navHelp')}</h1>
    <p class="small muted">Guided answers from fixed rules (not an AI, not legal advice). For anything else, talk to a person.</p>
    <div class="chips">${FAQ.map((f, i) => `<button class="chip" data-faq="${i}">${f.q}</button>`).join('')}</div>
    <div class="chat" aria-live="polite">${chat.map(m => `<div class="msg ${m.who}">${m.html}</div>`).join('')}</div>
    <form class="row gap" data-ask><input class="grow" name="q" placeholder="Type your question" aria-label="Your question"><button class="btn primary">Ask</button></form>
    <section class="card"><h2>Talk to a person</h2>
      <p class="small">Request a callback in English, Hindi or Telugu. Average wait: 10 minutes (sample).</p>
      <button class="btn ghost" data-callback>Request callback</button></section>`);
}
function answer(text) {
  const low = text.toLowerCase();
  const hit = FAQ.find(f => f.keys.some(k => low.includes(k)));
  chat.push({ who: 'me', html: esc(text) });
  chat.push({ who: 'bot', html: hit ? hit.a() : "I'm not sure about that one. Please request a callback below and a person will help." });
  renderHelp();
}

// ---------- Event handling (one listener for the whole app) ----------
document.addEventListener('click', e => {
  const el = e.target.closest('[data-go],[data-submit],[data-photo],[data-advance],[data-escalate],[data-received],[data-dispute],[data-acceptqc],[data-copy],[data-faq],[data-callback],[data-settings],[data-read],[data-reset],[data-close]');
  if (!el) return;
  const d = el.dataset;
  if (d.go) {
    const order = orderById(wiz.orderId); const to = +d.go;
    wiz.error = '';
    if (to > wiz.step && wiz.step === 1) {
      const items = pickedItems(order);
      if (!items.length) wiz.error = t('selectAtLeastOne');
      else if (items.some(i => !wiz.reasons[i.id])) wiz.error = t('pickReason');
    }
    if (to > wiz.step && wiz.step === 2) {
      const isCod = order.payments.some(p => p.type === 'cod');
      if (isCod && wiz.pref === 'original' && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(wiz.upi)) wiz.error = 'Enter a valid UPI ID like name@bank, or pick store wallet.';
    }
    if (!wiz.error) wiz.step = to;
    renderWizard(wiz.orderId);
    window.scrollTo(0, 0);
  }
  if ('submit' in d) {
    if (!wiz.consent) { wiz.error = 'Please tick the consent box so we can book the pickup.'; renderWizard(wiz.orderId); return; }
    submitReturn(orderById(wiz.orderId));
  }
  if (d.photo) { wiz.photos[d.photo] = !wiz.photos[d.photo]; renderWizard(wiz.orderId); }
  if (d.advance) {
    const [rid, iid] = d.advance.split(':');
    const r = state.returns.find(x => x.id === rid); const ri = r.items.find(x => x.itemId === iid);
    advanceItem(orderById(r.orderId), ri);
    const last = ri.steps[ri.steps.length - 1];
    r.updates.push({ date: todayStr(), channel: 'SMS', text: `${itemById(orderById(r.orderId), iid).name}: ${t('s_' + last.key)}${last.ref ? ' (' + last.ref + ')' : ''}.` });
    save(); renderTracker(rid);
  }
  if (d.escalate) {
    state.tickets[d.escalate] = { date: todayStr(), id: 'CMP-' + Math.floor(100000 + Math.random() * 899999) };
    const r = state.returns.find(x => x.id === d.escalate);
    r.updates.push({ date: todayStr(), channel: 'App', text: `Delay reported. Complaint ${state.tickets[d.escalate].id} sent to store support with the ARN attached.` });
    save(); renderTracker(d.escalate);
  }
  if (d.received) {
    const [rid, iid] = d.received.split(':');
    const r = state.returns.find(x => x.id === rid); const ri = r.items.find(x => x.itemId === iid);
    ri.steps.push({ key: 'credited', date: todayStr() });
    r.updates.push({ date: todayStr(), channel: 'App', text: 'You confirmed the refund reached your account.' });
    save(); renderTracker(rid);
  }
  if (d.dispute) {
    state.disputes[d.dispute] = todayStr();
    const r = state.returns.find(x => x.id === d.dispute.split(':')[0]);
    r.updates.push({ date: todayStr(), channel: 'App', text: 'Quality check decision challenged. Photos sent for independent review.' });
    save(); renderTracker(r.id);
  }
  if (d.acceptqc) {
    const r = state.returns.find(x => x.id === d.acceptqc.split(':')[0]);
    r.updates.push({ date: todayStr(), channel: 'App', text: 'You accepted the check result. The item will be shipped back to you free of charge.' });
    save(); renderTracker(r.id);
  }
  if (d.copy) { try { navigator.clipboard.writeText(d.copy); el.textContent = 'Copied'; } catch (err) { el.textContent = d.copy; } }
  if (d.faq) answer(FAQ[+d.faq].q);
  if ('callback' in d) { el.textContent = '✓ Callback requested (sample)'; el.disabled = true; }
  if ('settings' in d) $('#settings').showModal();
  if ('close' in d) $('#settings').close();
  if ('read' in d) toggleReading();
  if ('reset' in d) { try { localStorage.removeItem(STORE_KEY); } catch (err) {} location.hash = '#/'; location.reload(); }
});

document.addEventListener('change', e => {
  const d = e.target.dataset;
  if (d.pick) { wiz.picked[d.pick] = e.target.checked; renderWizard(wiz.orderId); }
  if (d.reason) { wiz.reasons[d.reason] = e.target.value; renderWizard(wiz.orderId); }
  if (d.slot) wiz.slot = +d.slot;
  if (d.pref) { wiz.pref = d.pref; renderWizard(wiz.orderId); }
  if ('assist' in d) wiz.assist = e.target.checked;
  if ('consent' in d) wiz.consent = e.target.checked;
  if ('lang' in d) { state.lang = e.target.value; applySettings(); route(); }
  if ('size' in d) { state.textSize = +e.target.value; applySettings(); }
  if ('contrast' in d) { state.contrast = e.target.checked; applySettings(); }
  if ('lowdata' in d) { state.lowData = e.target.checked; applySettings(); }
});
document.addEventListener('input', e => { if ('upi' in e.target.dataset) wiz.upi = e.target.value.trim(); });
document.addEventListener('submit', e => {
  if (e.target.matches('[data-ask]')) { e.preventDefault(); const q = e.target.q.value.trim(); if (q) answer(q); }
});

// ---------- Settings and read-aloud ----------
function applySettings() {
  const root = document.documentElement;
  root.lang = state.lang;
  root.style.setProperty('--scale', [0.95, 1, 1.15, 1.3][state.textSize]);
  root.classList.toggle('hc', state.contrast);
  root.classList.toggle('lowdata', state.lowData);
  $('#tagline').textContent = t('tagline');
  $('#banner').textContent = t('banner');
  document.querySelectorAll('[data-t]').forEach(n => { n.textContent = t(n.dataset.t); });
  save();
}

let speaking = false;
function toggleReading() {
  if (!('speechSynthesis' in window)) { alert('Read-aloud is not supported in this browser.'); return; }
  if (speaking) return stopReading();
  const u = new SpeechSynthesisUtterance($('#main').innerText);
  u.lang = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN' }[state.lang];
  u.rate = 0.95;
  u.onend = stopReading;
  speechSynthesis.speak(u); speaking = true;
  document.querySelectorAll('[data-read]').forEach(b => b.textContent = b.classList.contains('icon-btn') ? '■' : '■ ' + t('stopReading'));
}
function stopReading() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  speaking = false;
  document.querySelectorAll('[data-read]').forEach(b => b.textContent = b.classList.contains('icon-btn') ? '🔊' : '🔊 ' + t('readAloud'));
}

// ---------- Start ----------
$('#set-lang').value = state.lang;
$('#set-size').value = state.textSize;
$('#set-contrast').checked = state.contrast;
$('#set-lowdata').checked = state.lowData;
applySettings();
route();
