// ReturnEase UI. Draws screens from state; every decision comes from Engine (engine.js).
(function () {
  const E = Engine, S = Scenario, { STR, WORDING_T } = I18N;
  const $ = s => document.querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NOW = S.NOW, O = S.ORDER;
  const t = k => (STR[st.lang] && STR[st.lang][k]) || STR.en[k] || k;
  const when = iso => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const day = iso => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
  const inr = E.fmtINR;
  const itemOf = id => O.items.find(i => i.id === id);
  const payOf = id => O.payments.find(p => p.id === id);
  const PAY_COLOR = { card: '#14141F', wallet: '#0FA3A3', voucher: '#FFC83D', upi: '#7B5CFF' };

  // ------------------------------------------------------------------ state
  let st;
  function fresh(keepLang) {
    const items = JSON.parse(JSON.stringify(S.ITEMS_IN_RETURN));
    st = { lang: keepLang || 'en', view: 'return', big: false, hc: false, wfItem: 'B', wf: 'proportional',
      faults: { stale: false, timeout: false, offline: false }, queue: [], items, ledger: E.createLedger(), audit: E.createAudit(),
      faultLog: [], appeals: {}, tamperBackup: null, tests: null, chosen: null, corrections: [] };
    // B legs amounts come from the same allocation rule used on 21 Oct.
    const allocB = E.allocate(O, { items: [{ itemId: 'B' }] }, { order: 'proportional', now: '2026-10-21T04:30:00.000Z' });
    items.B.alloc = allocB;
    allocB.legs.forEach(l => { items.B.refundLegs[l.instrumentId].amount = l.amount; items.B.refundLegs[l.instrumentId].leg = l; });
    // Seed the audit log and the idempotency ledger from history, in time order.
    const evs = [];
    items.A.item.forEach(h => evs.push({ at: h.at, actor: actorFor(h.state), action: `${h.state}`, data: { items: h.state.startsWith('INSPECTION') ? 'A' : 'A+B', attempt: h.attempt, note: h.note || h.why } }));
    items.B.item.filter(h => h.state.startsWith('INSPECTION')).forEach(h => evs.push({ at: h.at, actor: 'warehouse', action: h.state, data: { items: 'B' } }));
    Object.entries(items.B.refundLegs).forEach(([pm, leg]) => leg.history.slice(1).forEach(h => evs.push({ at: h.at, actor: 'payments', action: 'REFUND_' + h.state, data: { items: 'B', instrument: pm, amount: leg.amount, arn: h.arn } })));
    evs.sort((a, b) => a.at.localeCompare(b.at)).forEach(e => E.auditAppend(st.audit, e.actor, e.action, e.data, e.at));
    Object.entries(items.B.refundLegs).forEach(([pm, leg]) => {
      const r = E.issueRefund(st.ledger, `${S.RETURN_ID}:B:${pm}`, leg.amount, leg.history[3].at); leg.ref = r.refund.ref;
    });
  }
  function actorFor(s) { return /PICKUP|COLLECTED|TRANSIT/.test(s) ? 'courier' : /INSPECTION|RECEIVED/.test(s) ? 'warehouse' : s === 'REQUESTED' ? 'customer' : 'system'; }
  function log(actor, action, data) { return E.auditAppend(st.audit, actor, action, data, new Date().toISOString()); }
  function toast(msg, tone) {
    const el = document.createElement('div'); el.className = 'toast ' + (tone || ''); el.textContent = msg;
    $('#toasts').appendChild(el); setTimeout(() => el.remove(), 4200);
    $('#live').textContent = msg;
  }

  // ------------------------------------------------------------------ derived helpers
  const STATIONS = ['st_requested', 'st_pickup', 'st_collected', 'st_transit', 'st_received', 'st_inspect', 'st_decision', 'st_refund'];
  function stationOf(state) {
    return ({ REQUESTED: 0, PICKUP_SCHEDULED: 1, PICKUP_FAILED: 1, PICKUP_DISPUTED: 1, DROPOFF_SELECTED: 1, COLLECTED: 2, IN_TRANSIT: 3, RECEIVED: 4,
      INSPECTION_HOLD: 5, INSPECTION_DISPUTED: 5, INSPECTION_PASSED: 6, INSPECTION_PARTIAL: 6, INSPECTION_REJECTED: 6, SENT_BACK: 6, CLOSED: 7 })[state];
  }
  function legsOf(id) { return Object.entries(st.items[id].refundLegs).map(([pm, l]) => ({ pm, ...l, state: E.current(l.history).state })); }
  function itemProgress(id) {
    const r = st.items[id]; const cur = E.current(r.item).state;
    let idx = stationOf(cur);
    const legs = legsOf(id);
    const refundState = !legs.length ? null : legs.every(l => l.state === 'CREDITED_CONFIRMED') ? 'done' : 'moving';
    if (legs.length) idx = 7;
    return { cur, idx, fails: r.item.filter(h => h.state === 'PICKUP_FAILED').length, hold: /HOLD|DISPUTED/.test(cur), refundState };
  }
  function sourcesFor(leg) {
    const src = JSON.parse(JSON.stringify(leg.sources));
    if (st.faults.stale && src.provider) src.provider.seenAt = '2026-10-23T02:30:00.000Z';
    if (st.faults.timeout && src.provider) src.provider.timeout = true;
    return src;
  }
  function msgFor(machine, state, vars) {
    const key = machine + '.' + state;
    const tr = WORDING_T[st.lang] && WORDING_T[st.lang][key];
    const base = E.message(machine, state, vars);
    return tr ? tr.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '—') : base;
  }

  // ------------------------------------------------------------------ shell
  function render() {
    document.documentElement.lang = st.lang;
    document.documentElement.classList.toggle('big', st.big);
    document.documentElement.classList.toggle('hc', st.hc);
    $('#sim').textContent = t('sim');
    $('#tag').textContent = t('tag');
    $('#offline').hidden = !st.faults.offline;
    $('#offline').textContent = t('offline') + (st.queue.length ? ` (${st.queue.length} queued)` : '');
    document.querySelectorAll('[data-nav]').forEach(b => { b.textContent = t('nav_' + b.dataset.nav); b.setAttribute('aria-selected', b.dataset.nav === st.view); });
    $('#set-lang').value = st.lang;
    const views = { return: vReturn, money: vMoney, before: vBefore, trust: vTrust, judge: vJudge };
    $('#main').innerHTML = views[st.view]();
  }

  // ------------------------------------------------------------------ visuals
  function metroSVG() {
    const ids = ['A', 'B'];
    const W = 960, laneH = 140, x0 = 56, gap = 120;
    let out = `<svg viewBox="0 0 ${W} ${ids.length * laneH + 10}" role="img" aria-label="Item tracks: ${ids.map(id => { const p = itemProgress(id); return itemOf(id).short + ' at ' + STR.en[STATIONS[p.idx]] + (p.fails ? ', ' + p.fails + ' failed pickups' : '') + (p.hold ? ', on hold' : ''); }).join('; ')}">`;
    ids.forEach((id, li) => {
      const it = itemOf(id), p = itemProgress(id), y = 72 + li * laneH;
      out += `<text x="${x0 - 40}" y="${y - 50}" class="m-name">${esc(it.short)} · ${esc(it.seller)}</text>`;
      for (let i = 0; i < STATIONS.length - 1; i++) {
        const done = i < p.idx;
        out += `<line x1="${x0 + i * gap}" y1="${y}" x2="${x0 + (i + 1) * gap}" y2="${y}" stroke="${done ? it.color : '#CFC8B8'}" stroke-width="${done ? 12 : 6}" stroke-linecap="round" ${done ? '' : 'stroke-dasharray="2 12"'}/>`;
      }
      STATIONS.forEach((k, i) => {
        const x = x0 + i * gap, isCur = i === p.idx, done = i < p.idx || (i === 7 && p.refundState === 'done');
        let fill = done ? '#14141F' : '#FFF8EC', r = 11;
        if (isCur) { fill = p.hold ? '#FFC83D' : it.color; r = 17; }
        out += `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="#14141F" stroke-width="4"/>`;
        if (isCur) out += `<circle cx="${x}" cy="${y}" r="${r + 8}" fill="none" stroke="${p.hold ? '#FFC83D' : it.color}" stroke-width="3" class="pulse"/>`;
        out += `<text x="${x}" y="${y + 42}" text-anchor="middle" class="m-lbl ${isCur ? 'cur' : ''}">${esc(t(k))}</text>`;
      });
      if (p.fails) {
        const x = x0 + gap;
        for (let f = 0; f < p.fails; f++) out += `<circle cx="${x - 12 + f * 24}" cy="${y - 30}" r="10" fill="#FFF8EC" stroke="#E5383B" stroke-width="4"/>`;
        out += `<text x="${x + 26 + (p.fails - 1) * 12}" y="${y - 25}" class="m-fail">${p.fails}× failed</text>`;
      }
      if (p.hold) out += `<text x="${x0 + 5 * gap}" y="${y - 30}" text-anchor="middle" class="m-hold">ON HOLD</text>`;
    });
    return out + '</svg>';
  }

  // Waterfall ribbons: item price → (coupon, deductions, refundable) → instruments
  function waterfallSVG(alloc, id) {
    const it = itemOf(id), line = alloc.lines[0];
    const W = 940, H = 330, top = 30, bh = 260, scale = bh / it.price;
    let y = top, out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Refund waterfall for ${esc(it.short)}: ${line.steps.map(s => s.label + ' ' + inr(s.amount)).join('; ')}; split ${alloc.legs.map(l => l.label + ' ' + inr(l.amount)).join(', ')}">`;
    out += `<defs><pattern id="hatch" width="10" height="10" patternTransform="rotate(45)" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#FFF8EC"/><line x1="0" y1="0" x2="0" y2="10" stroke="#14141F" stroke-width="4"/></pattern></defs>`;
    const segs = [];
    line.steps.slice(1).forEach(s => segs.push({ label: s.label.split(':')[0].split('(')[0].trim(), amt: -s.amount, kind: 'cut' }));
    const refundTop = top + segs.reduce((a, s) => a + s.amt * scale, 0);
    out += `<text x="40" y="20" class="w-h">${esc(it.short)} price ${inr(it.price)}</text>`;
    segs.forEach(s => { const h = s.amt * scale; out += `<rect x="40" y="${y}" width="150" height="${Math.max(h, 2)}" fill="url(#hatch)" stroke="#14141F" stroke-width="3"/><text x="200" y="${y + Math.max(h, 14) / 2 + 6}" class="w-t">−${inr(s.amt)} ${esc(s.label.replace('Less ', ''))}</text>`; y += h; });
    out += `<rect x="40" y="${refundTop}" width="150" height="${top + bh - refundTop}" fill="${it.color}" stroke="#14141F" stroke-width="3"/>`;
    out += `<text x="115" y="${refundTop + (top + bh - refundTop) / 2}" text-anchor="middle" class="w-big">${inr(line.refundable)}</text>`;
    // ribbons to instruments
    let ry = refundTop, iy = top + 20;
    const ibh = bh - 20, iscale = ibh / Math.max(alloc.total, 1);
    alloc.legs.forEach(l => {
      const h1 = l.amount * ((top + bh - refundTop) / Math.max(alloc.total, 1)), h2 = l.amount * iscale;
      const c = PAY_COLOR[l.type];
      out += `<path d="M190 ${ry} C 470 ${ry}, 470 ${iy}, 640 ${iy} L 640 ${iy + h2} C 470 ${iy + h2}, 470 ${ry + h1}, 190 ${ry + h1} Z" fill="${c}" opacity="0.28" stroke="${c}" stroke-width="1.5"/>`;
      out += `<rect x="640" y="${iy}" width="40" height="${Math.max(h2, 3)}" fill="${c}" stroke="#14141F" stroke-width="3"/>`;
      out += `<text x="692" y="${iy + Math.max(h2, 18) / 2 + 2}" class="w-t"><tspan font-weight="800">${inr(l.amount)}</tspan> → ${esc(l.label)}</text>`;
      if (l.refundAs === 'voucher') out += `<text x="692" y="${iy + Math.max(h2, 18) / 2 + 22}" class="w-s">comes back as a voucher, not to the bank</text>`;
      ry += h1; iy += h2 + 8;
    });
    return out + '</svg>';
  }

  function reconSVG(src, leg) {
    const start = new Date('2026-10-20T18:30:00Z').getTime(), end = new Date('2026-10-31T18:30:00Z').getTime();
    const W = 940, x0 = 150, x1 = 920, X = iso => x0 + (new Date(iso).getTime() - start) / (end - start) * (x1 - x0);
    const rows = [['platform', t('platform')], ['provider', t('provider')], ['seller', t('seller')]];
    let out = `<svg viewBox="0 0 ${W} 250" role="img" aria-label="Timeline of three records with the expected credit window">`;
    for (let d = 0; d <= 11; d++) { const x = x0 + d * (x1 - x0) / 11; out += `<line x1="${x}" y1="20" x2="${x}" y2="210" stroke="#E6DFCF"/><text x="${x}" y="232" text-anchor="middle" class="r-ax">${21 + d > 31 ? 21 + d - 31 + ' Nov' : 21 + d}</text>`; }
    const p = leg.sources.provider, exp = E.EXPECTED[leg.type];
    if (p && /REVERSED|PROCESSED/.test(p.status) && exp) {
      const a = X(E.addDays(p.at, exp.creditMin)), b = X(E.addDays(p.at, exp.creditMax));
      out += `<rect x="${a}" y="24" width="${Math.max(b - a, 6)}" height="180" fill="#2BB673" opacity="0.16"/><text x="${(a + b) / 2}" y="40" text-anchor="middle" class="r-band">expected credit window</text>`;
    }
    rows.forEach(([k, label], i) => {
      const y = 70 + i * 52, s = src[k];
      out += `<text x="10" y="${y + 5}" class="r-lbl">${esc(label)}</text><line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="#14141F" stroke-width="2"/>`;
      if (s) {
        const stale = (new Date(NOW) - new Date(s.seenAt)) / 36e5 > 24;
        out += `<circle cx="${X(s.at)}" cy="${y}" r="9" fill="${s.timeout ? '#E5383B' : stale ? '#FFC83D' : '#14141F'}"/><text x="${X(s.at) + 14}" y="${y - 10}" class="r-st">${esc(s.timeout ? 'TIMEOUT' : s.status)}${stale ? ' (stale)' : ''}</text>`;
      }
    });
    out += `<line x1="${X(NOW)}" y1="18" x2="${X(NOW)}" y2="212" stroke="#FF5A1F" stroke-width="4"/><text x="${X(NOW)}" y="14" text-anchor="middle" class="r-now">today</text>`;
    return out + '</svg>';
  }

  function ladderSVG(level, naive) {
    let out = `<svg viewBox="0 0 520 230" role="img" aria-label="Friction ladder: automatic volume rule says level ${naive}, after fairness check level ${level}">`;
    E.LADDER.forEach((r, i) => {
      const x = 20 + i * 122, h = 50 + i * 45, y = 200 - h;
      out += `<rect x="${x}" y="${y}" width="112" height="${h}" fill="${i === level ? '#2BB673' : i === naive ? '#FFE3D6' : '#FFF8EC'}" stroke="#14141F" stroke-width="3"/>`;
      out += `<text x="${x + 56}" y="${y + 26}" text-anchor="middle" class="l-t">L${i}</text><text x="${x + 56}" y="${y + 46}" text-anchor="middle" class="l-s">${esc(r.name)}</text>`;
    });
    const nx = 76 + naive * 122, fx = 76 + level * 122;
    if (naive !== level) out += `<path d="M${nx} ${200 - (50 + naive * 45) - 8} C ${nx} ${8}, ${fx} ${8}, ${fx} ${200 - (50 + level * 45) - 8}" fill="none" stroke="#FF5A1F" stroke-width="4" marker-end="url(#ar)"/><defs><marker id="ar" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#FF5A1F"/></marker></defs><text x="${(nx + fx) / 2}" y="22" text-anchor="middle" class="l-s">fairness check</text>`;
    return out + '</svg>';
  }

  function shoeSVG(clean, label) {
    return `<svg viewBox="0 0 220 130" role="img" aria-label="${esc(label)}"><rect width="220" height="130" fill="${clean ? '#EAF7F1' : '#FDEDE6'}"/>
      <path d="M30 80 C 30 50, 70 40, 110 50 C 150 58, 190 62, 196 84 C 198 98, 180 104, 150 104 L 46 104 C 34 104, 30 96, 30 80 Z" fill="#FFF8EC" stroke="#14141F" stroke-width="4"/>
      ${[0, 1, 2, 3, 4, 5].map(i => `<line x1="${56 + i * 22}" y1="96" x2="${62 + i * 22}" y2="84" stroke="#14141F" stroke-width="3"/>`).join('')}
      ${clean ? '' : '<ellipse cx="88" cy="94" rx="30" ry="8" fill="#8C8577" opacity=".75"/><ellipse cx="150" cy="96" rx="22" ry="6" fill="#8C8577" opacity=".7"/>'}
      <text x="10" y="22" class="ph-t">${esc(label)}</text></svg>`;
  }

  // ------------------------------------------------------------------ shared UI bits
  const chip = (txt, tone) => `<span class="chip ${tone || ''}">${esc(txt)}</span>`;
  const verdictChip = v => chip(t(v.toLowerCase()), { WAITING: 'c-wait', STUCK: 'c-stuck', UNKNOWN: 'c-unk', DONE: 'c-done' }[v]);
  function explain({ reason, confidence, source, freshness, target }) {
    return `<div class="xq"><div><b>Why:</b> ${esc(reason)}</div><div class="xq-row">${chip('Confidence: ' + confidence, confidence === 'high' ? 'c-done' : confidence === 'low' ? 'c-stuck' : 'c-wait')}${chip('Source: ' + source)}${chip('As of ' + freshness)}</div>
      <button class="btn ghost sm" data-act="correct" data-target="${esc(target)}">Something’s wrong? Correct or escalate</button></div>`;
  }

  // ------------------------------------------------------------------ VIEW: my return
  function nowCards() {
    const out = [];
    // Shoes
    const A = st.items.A, aCur = E.current(A.item);
    if (aCur.state === 'INSPECTION_DISPUTED') {
      const due = E.addDays(A.inspection.openedAt, A.inspection.slaHours / 24);
      out.push({ id: 'A', msg: msgFor('item', 'INSPECTION_DISPUTED', { item: itemOf('A').short, when: when(due) }), x: { reason: 'Warehouse flagged “used: sole wear”; you sent handover photos, so a separate team reviews within 72 h.', confidence: 'high', source: 'Warehouse + your photos', freshness: when(aCur.at), target: 'A-inspection' } });
    } else {
      const legs = legsOf('A');
      const msgs = legs.length ? legs.map(l => msgFor('refund', l.state, { item: itemOf('A').short, amount: inr(l.amount), when: day(E.addDays(l.history[l.history.length - 1].at, (E.EXPECTED[l.type] || {}).creditMax || 0)) })) : [msgFor('item', aCur.state, { item: itemOf('A').short, why: aCur.why || '' })];
      out.push({ id: 'A', msg: msgs.join(' '), x: { reason: st.items.A.decision ? st.items.A.decision.reason : 'Latest state of the item.', confidence: 'high', source: 'Inspection review + payments', freshness: when(aCur.at), target: 'A-refund' } });
    }
    // Kurta
    const legs = legsOf('B');
    const card = legs.find(l => l.type === 'card' || payOf(l.pm).type === 'card');
    const src = sourcesFor(card); const rec = E.reconcile({ type: 'card', ref: card.history[3].arn }, src, NOW);
    const parts = legs.map(l => {
      const ty = payOf(l.pm).type;
      if (ty === 'card') {
        if (rec.verdict === 'UNKNOWN') return `Card ${inr(l.amount)}: status unknown right now (${rec.why}) We are not assuming anything.`;
        return msgFor('refund', l.state, { amount: inr(l.amount), when: day(E.addDays(src.provider.at, 7)) });
      }
      return msgFor('refund', l.state, { amount: inr(l.amount) }) + (ty === 'voucher' ? ` (voucher, valid till ${day(st.items.B.alloc.legs.find(x => x.type === 'voucher').voucherExpiry.at)})` : '');
    });
    out.push({ id: 'B', msg: parts.join(' '), verdict: rec.verdict, x: { reason: rec.why, confidence: rec.confidence, source: 'Platform + payment provider + seller', freshness: st.faults.stale ? when('2026-10-23T02:30:00.000Z') + ' (stale)' : when(src.provider.seenAt), target: 'B-refund' } });
    return out;
  }

  function vReturn() {
    const cards = nowCards().map(c => {
      const it = itemOf(c.id), p = itemProgress(c.id);
      return `<article class="card now" style="--accent:${it.color}"><div class="row between"><h3>${esc(it.name)}</h3>${c.verdict ? verdictChip(c.verdict) : p.hold ? chip('On hold', 'c-wait') : chip(t(STATIONS[p.idx]))}</div>
        <p class="now-msg">${esc(c.msg)}</p>${explain(c.x)}</article>`;
    }).join('');
    const A = st.items.A;
    const attempts = S.ATTEMPTS.map(a => {
      const j = a.n < 3 ? E.judgeAttempt(a) : null;
      return `<div class="attempt ${a.n < 3 ? 'fail' : 'ok'}"><div class="row between"><b>Attempt ${a.n} · ${when(a.at)}</b>${j ? chip(j.finding.replace('_', ' '), j.finding === 'COURIER_FAULT' ? 'c-stuck' : 'c-wait') : chip('Collected', 'c-done')}</div>
        <div class="small">Courier said: “${esc(a.courierClaim)}”</div>
        ${j ? `<ul class="ev">${j.signals.map(s => `<li>${esc(s)}</li>`).join('')}</ul><div class="small">${j.countsAgainstCustomer ? 'Counts against customer' : '<b>Not counted against you.</b>'} Next: ${a.n === 1 ? 'rescheduled + courier QA ticket' : 'priority slot + drop-off fallback offered'}</div>` : `<div class="small">Proof of handover: receipt <b>HOV-5512</b>, GPS 12 m, 3 customer photos + 2 agent photos, timestamped.</div>`}</div>`;
    }).join('');
    const aCur = E.current(A.item).state;
    const insp = A.inspection, due = E.addDays(insp.openedAt, insp.slaHours / 24);
    const hrsLeft = Math.round((new Date(due) - new Date(NOW)) / 36e5 * 10) / 10;
    const decided = A.decision;
    return `<section class="hero"><div><p class="eyebrow">${t('hello')}, ${esc(S.CUSTOMER.name)} · ${S.RETURN_ID}</p>
      <h1>Order ${O.id}: <span class="hl">2 ${t('items_in_return')}</span>, 3 ${t('sellers')}, 3 ${t('paid_ways')}</h1>
      <p class="warn-strip">${esc(t('no_otp'))}</p></div></section>
      <h2>${t('now')}</h2><div class="grid2">${cards}</div>
      <h2>${t('track')}</h2><p class="muted">${t('track_hint')}</p><div class="metro card">${metroSVG()}</div>
      <div class="grid2">
        <section class="card"><h2 class="h-in">${t('pickup_title')}</h2><p class="muted small">${t('pickup_hint')}</p>${attempts}</section>
        <section class="card" id="A-inspection"><h2 class="h-in">${t('inspect_title')} · ${esc(itemOf('A').short)}</h2>
          <div class="photos"><figure>${shoeSVG(true, 'Your handover photo · 18 Oct 11:03')}<figcaption>Taken at pickup, before the courier left</figcaption></figure>
          <figure>${shoeSVG(false, 'Warehouse photo · 20 Oct 2:00 PM')}<figcaption>Flag: “used: sole wear”</figcaption></figure></div>
          ${decided ? `<div class="decision ${decided.outcome}"><b>${decided.outcome}: ${decided.refundPct}% refund.</b> ${esc(decided.reason)}<div class="small">Reviewed by Team B (not the warehouse that flagged it) · logged #${decided.seq}</div></div>`
            : `<p><b>${t('review_due')}:</b> ${when(due)} <span class="muted">(${hrsLeft} h left of 72 h)</span></p>
          <label class="field">Add a note for the reviewer (optional)<textarea id="note" rows="2" placeholder="e.g. The scuff is from the warehouse floor"></textarea></label>
          <button class="btn primary" data-act="review" ${aCur !== 'INSPECTION_DISPUTED' ? 'disabled' : ''}>${t('run_review')}</button>
          <p class="muted small">Possible outcomes: full refund, partial refund (with reason), or rejection with the item sent back free.</p>`}
        </section></div>`;
  }

  // ------------------------------------------------------------------ VIEW: money
  function allocFor(id) {
    if (id === 'B') return st.items.B.alloc;
    if (st.items.A.alloc) return st.items.A.alloc;
    const prior = {}; st.items.B.alloc.legs.forEach(l => { prior[l.instrumentId] = (prior[l.instrumentId] || 0) + l.amount; });
    const dec = st.items.A.decision;
    return E.allocate(O, { items: [{ itemId: 'A', ...(dec && dec.refundPct < 100 ? { deductionPct: 100 - dec.refundPct, deductionReason: dec.reason } : {}) }] }, { order: st.wf, now: NOW }, prior);
  }
  function vMoney() {
    const id = st.wfItem, alloc = allocFor(id), it = itemOf(id);
    const lockedNote = id === 'B' ? 'Kurta was refunded on 21 Oct under the proportional policy; this is the actual split.' : st.items.A.alloc ? 'Shoes refund has been issued; this is the actual split.' : 'Shoes refund not started yet: this is a PREVIEW. Try the policy switch to see how the split changes.';
    const steps = alloc.lines[0].steps.map(s => `<tr><td>${esc(s.label)}</td><td class="num">${s.amount < 0 ? '−' : ''}${inr(Math.abs(s.amount))}</td></tr>`).join('');
    const legRows = alloc.legs.map(l => `<tr><td><span class="sw" style="background:${PAY_COLOR[l.type]}"></span>${esc(l.label)}${l.refundAs === 'voucher' ? `<div class="small">Re-issued as voucher, valid till <b>${day(l.voucherExpiry.at)}</b>${l.voucherExpiry.extended ? ` (original expired ${day(l.voucherExpiry.originalAt)}; extended so you get at least 30 days)` : ''}</div>` : ''}</td><td class="num">${inr(l.amount)}</td></tr>`).join('');
    const legs = legsOf(id);
    const recon = legs.map(l => {
      const ty = payOf(l.pm).type, src = sourcesFor(l), r = E.reconcile({ type: ty, ref: l.ref }, src, NOW);
      return `<article class="card recon"><div class="row between"><h3>${esc(payOf(l.pm).label)} · ${inr(l.amount)}</h3>${verdictChip(r.verdict)}</div>
        <div class="tri">${['platform', 'provider', 'seller'].map(k => { const s = src[k]; return `<div class="src"><div class="small muted">${t(k)}</div><b>${s ? esc(s.timeout ? 'NO ANSWER' : s.status) : '—'}</b><div class="small">${s ? when(s.at) : ''}</div>${chip(r.freshness[k], r.freshness[k] === 'fresh' ? 'c-done' : 'c-stuck')}</div>`; }).join('')}</div>
        ${ty === 'card' ? reconSVG(src, { ...l, type: ty, sources: src }) : ''}
        ${explain({ reason: r.why + (r.notes.length ? ' ' + r.notes.join(' ') : ''), confidence: r.confidence, source: 'Reconciler v1 (3 sources)', freshness: when(NOW), target: id + '-' + l.pm })}
        <table class="tbl small"><tr><th>${t('next_step')}</th><th></th></tr>${['customer', 'platform', 'seller', 'provider'].map(k => `<tr><td>${k === 'customer' ? t('you') : t(k)}</td><td>${esc(r.actions[k])}</td></tr>`).join('')}</table>
        <div class="small muted">Ref ${esc(l.ref)} · idempotency key <code>${S.RETURN_ID}:${id}:${l.pm}</code>${l.history[3] && l.history[3].arn ? ' · ARN ' + l.history[3].arn : ''}</div></article>`;
    }).join('');
    return `<h1>${t('money_title')}</h1>
      <div class="row wrap gap"><div class="seg" role="tablist" aria-label="Item">${['B', 'A'].map(x => `<button role="tab" aria-selected="${x === id}" data-act="wfitem" data-v="${x}">${esc(itemOf(x).short)}</button>`).join('')}</div>
      ${id === 'A' && !st.items.A.alloc ? `<label class="field inline">Refund policy <select id="wf"><option value="proportional">Proportional (back where you paid)</option><option value="cash-first">Bank/card first</option><option value="voucher-first">Voucher first</option></select></label>` : ''}</div>
      <p class="muted">${lockedNote}</p>
      <div class="card">${waterfallSVG(alloc, id)}</div>
      <div class="grid2"><section class="card"><h3>Line by line</h3><table class="tbl">${steps}<tr class="tot"><td>Refundable</td><td class="num">${inr(alloc.refundable)}</td></tr></table></section>
      <section class="card"><h3>Split across what you paid with</h3><table class="tbl">${legRows}<tr class="tot"><td>Total ${alloc.balanced ? '✓ balanced to the paisa' : '✗ NOT balanced'}</td><td class="num">${inr(alloc.total)}</td></tr></table>
      <p class="small muted">Why the coupon is shared: ${O.coupon.code} gave ${inr(O.coupon.amount)} off the order. Each item carries a share in proportion to its price, so items you keep keep their discount.</p></section></div>
      ${legs.length ? `<h2>${t('recon_title')}</h2>${recon}` : '<p class="muted">Reconciliation appears once the refund is sent.</p>'}
      <section class="card"><h3>Duplicate-refund guard</h3><p class="small">Each refund leg has one idempotency key. A retry with the same key returns the original refund instead of paying again.</p>
        <table class="tbl small"><tr><th>Key</th><th>Ref</th><th class="num">Amount</th></tr>${Object.values(st.ledger.byKey).map(r => `<tr><td><code>${esc(r.key)}</code></td><td>${esc(r.ref)}</td><td class="num">${inr(r.amount)}</td></tr>`).join('')}</table>
        <p class="small">Attempts received: ${st.ledger.attempts.length} · refunds issued: ${Object.keys(st.ledger.byKey).length}</p></section>`;
  }

  // ------------------------------------------------------------------ VIEW: before you return
  function vBefore() {
    const rows = O.items.map(it => {
      const e = E.eligibility(O, it, NOW, S.POLICIES);
      const inRet = st.items[it.id];
      let preview = '';
      if (e.status !== 'NOT_ELIGIBLE' || it.id === 'C') {
        const a = E.allocate(O, { items: [{ itemId: it.id }] }, { order: 'proportional', now: NOW });
        preview = `<div class="small">Preview: refund about <b>${inr(a.refundable)}</b> → ${a.legs.map(l => `${inr(l.amount)} ${l.type}`).join(' + ')}</div>`;
      }
      return `<article class="card elig" style="--accent:${it.color}"><div class="row between"><h3>${esc(it.name)}</h3>${chip(e.status.replace('_', ' '), e.status === 'ELIGIBLE' ? 'c-done' : e.status === 'CONDITIONAL' ? 'c-wait' : 'c-stuck')}</div>
        <div class="small muted">${esc(it.seller)} · ${inr(it.price || 0)}${it.listValue ? ' (worth ' + inr(it.listValue) + ')' : ''}</div>
        <ul class="ev">${e.reasons.map(r => `<li>${esc(r.text)} <span class="src-tag">${esc(r.source)}</span></li>`).join('')}</ul>${preview}${inRet ? chip('Already in ' + S.RETURN_ID) : ''}</article>`;
    }).join('');
    const est = E.allocate(O, { items: [{ itemId: 'A' }] }, { order: 'proportional', now: NOW });
    const cmp = E.compareOptions(itemOf('A'), 'SIZE', est, S.STOCK.A);
    return `<h1>${t('nav_before')}</h1><p class="muted">Every item is checked on its own (category window, condition, seller exception, bundle) before you request anything.</p>
      <div class="grid2">${rows}</div>
      <h2>${t('exchange_q')} · ${esc(itemOf('A').short)}</h2><p class="muted small">${esc(cmp.note)}</p>
      <div class="grid3">${cmp.options.map(o => `<article class="card opt ${st.chosen === o.id ? 'picked' : ''}"><h3>${esc(o.title)}</h3><dl><dt>Money</dt><dd>${esc(o.money)}</dd><dt>Time</dt><dd>${esc(o.time)}</dd>${o.stockNote ? `<dt>Stock</dt><dd>${esc(o.stockNote)}</dd>` : ''}<dt>Fixes a size problem?</dt><dd>${o.solves ? 'Yes' : 'No'}</dd></dl>
        <button class="btn ${st.chosen === o.id ? 'primary' : 'ghost'}" data-act="choose" data-v="${o.id}">${st.chosen === o.id ? '✓ Chosen' : 'Choose'}</button></article>`).join('')}</div>
      <div class="card reco"><b>Our suggestion: ${esc(cmp.options.find(o => o.id === cmp.recommended).title)}.</b> ${esc(cmp.why)}</div>`;
  }

  // ------------------------------------------------------------------ VIEW: fairness
  function vTrust() {
    const f = E.fraudAssess(S.CUSTOMER.profile);
    const rows = S.RETURNERS.map(r => {
      const a = E.fraudAssess(r); const ap = st.appeals[r.id];
      const lvl = ap === 'overturned' ? 0 : a.level;
      return `<tr><td>${r.id}</td><td class="num">${r.returns90}</td><td class="num">${Math.round(r.sizingShare * 100)}%</td><td class="num">${Math.round(r.inspectionPassRate * 100)}%</td><td class="num">L${a.naiveLevel}</td><td class="num"><b>L${lvl}</b>${ap ? ` (${ap})` : ''}</td><td>${r.legit ? 'Genuine' : 'Abuse confirmed'}</td>
        <td>${a.level >= 2 && !ap ? `<button class="btn ghost sm" data-act="appeal" data-v="${r.id}">Appeal</button>` : ''}</td></tr>`;
    }).join('');
    return `<h1>${t('nav_trust')}</h1>
      <div class="grid2"><section class="card"><h3>${esc(S.CUSTOMER.name)}: 12 returns in 90 days</h3>${ladderSVG(f.level, f.naiveLevel)}
        <p><b>Result: L${f.level}, ${esc(f.rung.name)}.</b> ${esc(f.rung.effect)}</p>
        <h4>Signals</h4><ul class="ev">${f.signals.map(s => `<li>${esc(s.s)} <span class="src-tag">${s.w}</span></li>`).join('')}</ul>
        <h4>Fairness check</h4><ul class="ev">${f.fairness.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
        <p class="small muted">Volume alone never raises friction above a nudge. Any customer at L2+ can appeal to a human; every decision is logged.</p></section>
      <section class="card"><h3>Appeal path</h3><ol class="ev"><li>Customer taps Appeal (no form, one tap).</li><li>A human checks for confirmed abuse evidence, not volume.</li><li>No evidence → friction removed at once. Evidence → friction stays, reason shown.</li><li>Both outcomes go into the audit trail.</li></ol></section></div>
      <section class="card"><h3>Seeded heavy returners (synthetic)</h3><div class="scroll"><table class="tbl small"><tr><th>ID</th><th>Returns</th><th>Size/fit</th><th>Passed QC</th><th>Volume rule</th><th>Our ladder</th><th>Truth</th><th></th></tr>${rows}</table></div>
        <p class="small">Genuine customers flagged L2+: naive rule ${S.RETURNERS.filter(r => r.legit && E.fraudAssess(r).naiveLevel >= 2).length}/8 → ours ${S.RETURNERS.filter(r => r.legit && E.fraudAssess(r).level >= 2 && st.appeals[r.id] !== 'overturned').length}/8. Abusers still caught: ${S.RETURNERS.filter(r => !r.legit && E.fraudAssess(r).level >= 2).length}/4.</p></section>
      <h2>Threat model</h2><div class="scroll"><table class="tbl"><tr><th>#</th><th>Risk</th><th>Mitigation built in</th><th>Tested by</th></tr>${S.THREATS.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.risk)}</td><td>${esc(x.mitigation)}</td><td><code>${esc(x.test)}</code></td></tr>`).join('')}</table></div>`;
  }

  // ------------------------------------------------------------------ VIEW: judge console
  function vJudge() {
    const v = E.auditVerify(st.audit);
    const tr = st.tests;
    const faults = [
      ['stale', 'Stale provider data', 'Provider feed 26 h old'], ['timeout', 'Service timeout', 'Provider API does not answer'],
      ['offline', 'Connectivity loss', 'Phone goes offline'], ['conflict', 'Conflicting update', 'Warehouse says PASSED for an item still in transit'],
      ['ooo', 'Out-of-order event', 'Courier IN_TRANSIT older than COLLECTED'], ['malformed', 'Malformed input', 'Bad JSON event'],
      ['dup', 'Duplicate refund retry', 'Gateway retries kurta card refund'], ['tamper', 'Tamper with audit log', 'Edit entry #5 amount'],
    ];
    const ring = tr ? (() => { const r = 54, c = 2 * Math.PI * r, p = tr.rate; return `<svg viewBox="0 0 140 140" class="ring" role="img" aria-label="${tr.passed} of ${tr.total} tests passed"><circle cx="70" cy="70" r="${r}" fill="none" stroke="#E6DFCF" stroke-width="16"/><circle cx="70" cy="70" r="${r}" fill="none" stroke="#2BB673" stroke-width="16" stroke-dasharray="${c * p} ${c}" transform="rotate(-90 70 70)"/><text x="70" y="78" text-anchor="middle" class="ring-t">${Math.round(p * 100)}%</text></svg>`; })() : '';
    return `<h1>Judge console</h1><p class="muted">Inject faults, run the test suite, and verify the audit trail live. Everything here is simulated and labelled.</p>
      <section class="card"><h3>Fault injection</h3><div class="faults">${faults.map(([k, name, d]) => `<button class="fault ${st.faults[k] ? 'on' : ''}" data-act="fault" data-v="${k}" aria-pressed="${!!st.faults[k]}"><b>${name}</b><span>${d}</span></button>`).join('')}</div>
        ${st.faultMalformed ? `<label class="field">Event JSON (edit and submit)<textarea id="evjson" rows="3">{"machine":"item","to":"received","at":"yesterday","amount":-5}</textarea></label><button class="btn primary sm" data-act="submitEvent">Submit event</button>` : ''}
        <ol class="flog">${st.faultLog.slice().reverse().map(l => `<li class="${l.ok ? 'ok' : 'bad'}"><b>${esc(l.title)}</b> ${esc(l.text)}</li>`).join('') || '<li class="muted">No faults injected yet.</li>'}</ol></section>
      <div class="grid2"><section class="card"><div class="row between"><h3>Evaluation harness</h3><button class="btn primary sm" data-act="tests">Run ${tr ? 'again' : 'all tests'}</button></div>
        ${tr ? `<div class="row gap">${ring}<div><div class="big-n">${tr.passed}/${tr.total}</div><div class="muted small">scripted cases passed</div></div></div>
        ${Object.values(tr.metrics).map(m => `<div class="metric"><b>${esc(m.name)}</b><div>${esc(m.value)}</div>${m.abusersCaught ? `<div class="small muted">Abusers still caught: ${m.abusersCaught}</div>` : ''}</div>`).join('')}
        <details><summary>All ${tr.total} cases</summary><ul class="tests">${tr.cases.map(c => `<li class="${c.pass ? 'ok' : 'bad'}">${c.pass ? '✓' : '✗'} <code>${c.id}</code> ${esc(c.name)}${c.detail ? ` <span class="muted">[${esc(c.detail)}]</span>` : ''}</li>`).join('')}</ul></details>` : '<p class="muted">Press run: 56 cases covering allocation, state machines, reconciliation, idempotency, disputes, fraud fairness, wording and audit.</p>'}</section>
      <section class="card"><div class="row between"><h3>Audit trail</h3>${chip(v.ok ? `Chain intact · ${v.length} entries` : `BROKEN at #${v.brokenAt}`, v.ok ? 'c-done' : 'c-stuck')}</div>
        <p class="small muted">Append-only. Each entry stores the SHA-256 of the previous one, so editing history breaks the chain.</p>
        <div class="chain">${st.audit.slice(-10).map(e => `<div class="blk ${!v.ok && e.seq >= v.brokenAt ? 'broken' : ''}"><div class="small"><b>#${e.seq}</b> ${esc(e.actor)} · ${when(e.at)}</div><div>${esc(e.action)}</div><code>${e.hash.slice(0, 12)}…</code></div>`).join('')}</div>
        ${st.tamperBackup ? '<button class="btn ghost sm" data-act="restore">Restore original entry</button>' : ''}</section></div>
      <section class="card"><h3>Data card: ${S.DATA_CARD.length} planted conflicts</h3><div class="scroll"><table class="tbl small"><tr><th>ID</th><th>Planted problem</th><th>Expected detection</th></tr>${S.DATA_CARD.map(d => `<tr><td>${d[0]}</td><td>${esc(d[1])}</td><td>${esc(d[2])}</td></tr>`).join('')}</table></div></section>`;
  }

  // ------------------------------------------------------------------ actions
  function fault(title, text, ok) { st.faultLog.push({ title, text, ok }); log('judge', 'FAULT_' + title.toUpperCase().replace(/\W+/g, '_'), { text }); }
  function runReview() {
    const A = st.items.A, x = A.inspection;
    const note = ($('#note') && $('#note').value) || '';
    const d = E.judgeInspection(x.claim, { ...x.evidence, note }, x.openedAt, x.slaHours, NOW);
    const nextState = { PASSED: 'INSPECTION_PASSED', PARTIAL: 'INSPECTION_PARTIAL', REJECTED: 'INSPECTION_REJECTED' }[d.outcome];
    A.item = E.transition('item', A.item, nextState, NOW, { why: d.reason });
    const entry = log('reviewer-teamB', nextState, { item: 'A', refundPct: d.refundPct, reason: d.reason, customerNote: note.slice(0, 200) });
    A.decision = { ...d, seq: entry.seq };
    if (d.refundPct > 0) {
      const alloc = allocFor('A'); A.alloc = alloc;
      alloc.legs.forEach(l => {
        const key = `${S.RETURN_ID}:A:${l.instrumentId}`;
        const r = E.issueRefund(st.ledger, key, l.amount, NOW);
        const instant = l.type !== 'card';
        let h = [{ state: 'NOT_STARTED', at: NOW }];
        h = E.transition('refund', h, 'APPROVED', NOW); h = E.transition('refund', h, 'INITIATED', NOW);
        if (instant) { h = E.transition('refund', h, 'PROVIDER_PROCESSED', NOW); h = E.transition('refund', h, 'CREDITED_CONFIRMED', NOW); }
        A.refundLegs[l.instrumentId] = { amount: l.amount, leg: l, ref: r.refund.ref, history: h,
          sources: { platform: { status: 'INITIATED', at: NOW, seenAt: NOW }, provider: instant ? { status: 'CREDITED', at: NOW, seenAt: NOW } : { status: 'PENDING', at: NOW, seenAt: NOW }, seller: { status: 'PENDING', at: NOW, seenAt: NOW } } };
        log('payments', 'REFUND_INITIATED', { item: 'A', instrument: l.instrumentId, amount: l.amount, key });
      });
    }
    toast(`Review done: ${d.outcome} (${d.refundPct}% refund).`, 'good');
  }
  const ACTIONS = {
    review: () => runReview(),
    choose: v => { st.chosen = v; log('customer', 'OPTION_CHOSEN', { item: 'A', option: v }); toast(`Recorded: ${v}.`); },
    appeal: v => {
      const r = S.RETURNERS.find(x => x.id === v), lvl = E.fraudAssess(r).level;
      if (r.confirmedAbuse > 0) { st.appeals[v] = 'upheld'; log('reviewer', 'APPEAL_REJECTED', { customer: v, level: lvl, reason: r.confirmedAbuse + ' confirmed used/swapped returns' }); toast(`${v}: appeal reviewed, friction stays (${r.confirmedAbuse} confirmed abuse cases). Logged.`); }
      else { st.appeals[v] = 'overturned'; log('reviewer', 'FRICTION_OVERTURNED', { customer: v, from: lvl, to: 0, reason: 'No confirmed abuse; ' + Math.round(r.inspectionPassRate * 100) + '% inspection pass' }); toast(`${v}: appeal upheld, friction removed. Logged.`, 'good'); }
    },
    correct: v => { st.corrections.push(v); log('customer', 'CORRECTION_REQUESTED', { target: v }); toast('Thanks. A person will check this within 24 h. Logged in the audit trail.'); },
  };
  function act(name, v) {
    if (st.faults.offline && ACTIONS[name]) {
      const id = 'q' + Date.now(); st.queue.push({ id, name, v });
      toast('Offline: action queued. It will be sent once when you reconnect.'); return;
    }
    if (ACTIONS[name]) ACTIONS[name](v);
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act],[data-nav]'); if (!b) return;
    if (b.dataset.nav) { st.view = b.dataset.nav; render(); window.scrollTo(0, 0); $('#main').focus({ preventScroll: true }); return; }
    const a = b.dataset.act, v = b.dataset.v;
    try {
      if (a === 'wfitem') st.wfItem = v;
      else if (a === 'tests') { st.tests = TestHarness.runAll(E, S); log('judge', 'TESTS_RUN', { passed: st.tests.passed, total: st.tests.total }); }
      else if (a === 'restore') { const e2 = st.audit.find(x => x.seq === st.tamperBackup.seq); e2.data = st.tamperBackup.data; st.tamperBackup = null; toast('Entry restored; chain verifies again.', 'good'); }
      else if (a === 'submitEvent') {
        let ev, errs; try { ev = JSON.parse($('#evjson').value); errs = E.validateEvent(ev); } catch (err) { errs = ['Not valid JSON: ' + err.message]; }
        if (errs.length) fault('Malformed input', 'Rejected, state unchanged: ' + errs.join('; '), true);
        else fault('Event accepted', 'Valid shape; would still pass through the state machine guard.', true);
        st.faultMalformed = false;
      }
      else if (a === 'fault') injectFault(v);
      else act(a, v);
    } catch (err) { toast(err.message, 'bad'); }
    render();
  });

  function injectFault(k) {
    if (k === 'stale' || k === 'timeout') {
      st.faults[k] = !st.faults[k];
      fault(k === 'stale' ? 'Stale data' : 'Service timeout', st.faults[k] ? 'Kurta card refund now classified UNKNOWN; customer told “status unknown”, nothing assumed. See My return / Money.' : 'Cleared; classification back to normal.', true);
    } else if (k === 'offline') {
      st.faults.offline = !st.faults.offline;
      if (!st.faults.offline && st.queue.length) {
        const q = st.queue.splice(0); const seen = new Set();
        q.forEach(x => { if (seen.has(x.name + x.v)) return; seen.add(x.name + x.v); if (ACTIONS[x.name]) ACTIONS[x.name](x.v); });
        fault('Back online', `Replayed ${seen.size} queued action(s) once each (${q.length - seen.size} duplicate(s) dropped).`, true);
      } else fault('Connectivity loss', st.faults.offline ? 'Offline banner shown; actions now queue locally.' : 'Back online, nothing queued.', true);
    } else if (k === 'conflict') {
      try { E.transition('item', [{ state: 'IN_TRANSIT', at: '2026-10-18T12:30:00.000Z' }], 'INSPECTION_PASSED', NOW); }
      catch (err) { fault('Conflicting update', 'Rejected: ' + err.message + '. Record kept, flagged for ops.', true); log('system', 'REJECTED_EVENT', { reason: err.message }); }
    } else if (k === 'ooo') {
      try { E.transition('item', [{ state: 'COLLECTED', at: '2026-10-18T05:35:00.000Z' }], 'IN_TRANSIT', '2026-10-18T05:00:00.000Z'); }
      catch (err) { fault('Out-of-order event', 'Rejected: ' + err.message, true); log('system', 'REJECTED_EVENT', { reason: err.message }); }
    } else if (k === 'malformed') { st.faultMalformed = true; }
    else if (k === 'dup') {
      const leg = st.items.B.refundLegs['pm-card'];
      const r = E.issueRefund(st.ledger, `${S.RETURN_ID}:B:pm-card`, leg.amount, NOW);
      log('payments', r.duplicate ? 'DUPLICATE_BLOCKED' : 'REFUND_ISSUED', { key: r.refund.key, ref: r.refund.ref });
      fault('Duplicate refund retry', r.duplicate ? `Blocked. Same key returned original ${r.refund.ref}; refunds issued still ${Object.keys(st.ledger.byKey).length}, attempts ${st.ledger.attempts.length}.` : 'Issued (unexpected).', r.duplicate);
    } else if (k === 'tamper') {
      const target = st.audit[4]; if (!st.tamperBackup) { st.tamperBackup = { seq: target.seq, data: target.data }; target.data = JSON.stringify({ ...JSON.parse(target.data), amount: 1 }); }
      const v = E.auditVerify(st.audit);
      fault('Tamper attempt', v.ok ? 'Not detected (unexpected).' : `Detected: chain breaks at entry #${v.brokenAt}.`, !v.ok);
    }
  }

  document.addEventListener('change', e => {
    if (e.target.id === 'wf') { st.wf = e.target.value; render(); }
    if (e.target.id === 'set-lang') { st.lang = e.target.value; render(); }
    if (e.target.id === 'set-big') { st.big = e.target.checked; render(); }
    if (e.target.id === 'set-hc') { st.hc = e.target.checked; render(); }
  });
  $('#btn-read').addEventListener('click', () => {
    if (!('speechSynthesis' in window)) return toast('Read-aloud not supported here.');
    speechSynthesis.cancel();
    const txt = [...document.querySelectorAll('#main h1, #main h2, .now-msg')].map(n => n.innerText).join('. ');
    const u = new SpeechSynthesisUtterance(txt); u.lang = { en: 'en-IN', te: 'te-IN', hi: 'hi-IN' }[st.lang]; speechSynthesis.speak(u);
  });
  $('#btn-reset').addEventListener('click', () => { fresh(st.lang); render(); toast('Demo reset to 24 Oct, 10:00 AM.'); });
  window.addEventListener('offline', () => { st.faults.offline = true; render(); });
  window.addEventListener('online', () => { if (st.faults.offline) injectFault('offline'); render(); });

  fresh(); render();
  const wf = () => { const s = $('#wf'); if (s) s.value = st.wf; };
  new MutationObserver(wf).observe($('#main'), { childList: true });
  wf();
})();
