// ReturnEase ENGINE: every business rule lives here as a pure, testable function.
// No screen code. All money is integer PAISE (₹1 = 100) so splits are exact.
(function (g) {
  const DAY = 86400000;
  const iso = d => new Date(d).toISOString();
  const addDays = (t, n) => new Date(new Date(t).getTime() + n * DAY).toISOString();
  const daysBetween = (a, b) => (new Date(b) - new Date(a)) / DAY;
  const fmtD = d => new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' });
  const fmtDT = d => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const fmtINR = p => '₹' + (p / 100).toLocaleString('en-IN', { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 });

  // Split `total` paise across weights so parts are whole paise and add up EXACTLY (largest remainder).
  function splitByWeights(total, weights) {
    const sum = weights.reduce((s, w) => s + w, 0);
    if (sum === 0) return weights.map(() => 0);
    const raw = weights.map(w => (total * w) / sum);
    const parts = raw.map(Math.floor);
    let left = total - parts.reduce((s, p) => s + p, 0);
    raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
      .forEach(([, i]) => { if (left > 0) { parts[i]++; left--; } });
    return parts;
  }

  // ---------------------------------------------------------------- 1. STATE MACHINES
  // Logistics/inspection and money are SEPARATE machines. "Approved" never means "paid".
  const ITEM_MACHINE = {
    REQUESTED: ['PICKUP_SCHEDULED', 'DROPOFF_SELECTED'],
    PICKUP_SCHEDULED: ['COLLECTED', 'PICKUP_FAILED'],
    PICKUP_FAILED: ['PICKUP_DISPUTED', 'PICKUP_SCHEDULED', 'DROPOFF_SELECTED'],
    PICKUP_DISPUTED: ['PICKUP_SCHEDULED', 'DROPOFF_SELECTED'],
    DROPOFF_SELECTED: ['COLLECTED'],
    COLLECTED: ['IN_TRANSIT'],
    IN_TRANSIT: ['RECEIVED'],
    RECEIVED: ['INSPECTION_PASSED', 'INSPECTION_HOLD'],
    INSPECTION_HOLD: ['INSPECTION_DISPUTED', 'INSPECTION_PASSED', 'INSPECTION_PARTIAL', 'INSPECTION_REJECTED'],
    INSPECTION_DISPUTED: ['INSPECTION_PASSED', 'INSPECTION_PARTIAL', 'INSPECTION_REJECTED'],
    INSPECTION_PASSED: ['CLOSED'],
    INSPECTION_PARTIAL: ['CLOSED'],
    INSPECTION_REJECTED: ['SENT_BACK'],
    SENT_BACK: ['CLOSED'],
    CLOSED: [],
  };
  const REFUND_MACHINE = {
    NOT_STARTED: ['APPROVED'],
    APPROVED: ['INITIATED'],
    INITIATED: ['PROVIDER_PROCESSED', 'FAILED'],
    FAILED: ['INITIATED'],
    PROVIDER_PROCESSED: ['CREDITED_CONFIRMED'],
    CREDITED_CONFIRMED: [],
  };
  const MACHINES = { item: ITEM_MACHINE, refund: REFUND_MACHINE };

  function canTransition(machine, from, to) { return (MACHINES[machine][from] || []).includes(to); }
  // Returns a NEW history array, or throws with a readable reason. The UI never edits state directly.
  function transition(machine, history, to, at, meta) {
    const from = history[history.length - 1].state;
    if (!MACHINES[machine][to]) throw new Error(`Unknown state "${to}"`);
    if (!canTransition(machine, from, to)) throw new Error(`Illegal move ${from} → ${to}`);
    if (new Date(at) < new Date(history[history.length - 1].at)) throw new Error(`Out-of-order update: ${to} at ${at} is older than ${from}`);
    return history.concat([{ state: to, at, ...(meta || {}) }]);
  }
  const current = h => h[h.length - 1];

  // ---------------------------------------------------------------- 2. ELIGIBILITY (before the request)
  // Three-valued: ELIGIBLE, CONDITIONAL, NOT_ELIGIBLE, each with reasons and the policy source.
  function eligibility(order, item, now, policies) {
    const reasons = [];
    const cat = policies.categories[item.category];
    const sellerRule = (policies.sellerExceptions[item.sellerId] || []).find(r => r.applies(item));
    if (item.giftOf) return { status: 'NOT_ELIGIBLE', reasons: [{ text: `Free gift with the ${(order.items.find(i => i.id === item.giftOf) || {}).name || item.giftOf}. It goes back only together with that item.`, source: 'Bundle rule B-2' }] };
    const lastDay = addDays(order.deliveredAt, cat.windowDays);
    const left = Math.ceil(daysBetween(now, lastDay));
    if (left < 0) return { status: 'NOT_ELIGIBLE', lastDay, reasons: [{ text: `${cat.label} window of ${cat.windowDays} days ended.`, source: `Category policy ${cat.id}` }] };
    if (sellerRule && sellerRule.block) return { status: 'NOT_ELIGIBLE', lastDay, reasons: [{ text: sellerRule.text, source: `Seller exception ${sellerRule.id}` }] };
    let status = 'ELIGIBLE';
    if (cat.condition) { status = 'CONDITIONAL'; reasons.push({ text: cat.condition, source: `Category policy ${cat.id}` }); }
    if (sellerRule) { status = 'CONDITIONAL'; reasons.push({ text: sellerRule.text, source: `Seller exception ${sellerRule.id}` }); }
    const gift = order.items.find(i => i.giftOf === item.id);
    if (gift) { status = 'CONDITIONAL'; reasons.push({ text: `Return the free ${gift.name} too, or ${fmtINR(gift.listValue)} (its value) is deducted.`, source: 'Bundle rule B-1' }); }
    reasons.unshift({ text: `${left} day(s) left (until ${fmtD(lastDay)}).`, source: `Category policy ${cat.id}` });
    return { status, lastDay, daysLeft: left, reasons };
  }

  // ---------------------------------------------------------------- 3. REFUND WATERFALL
  // config.order: 'proportional' | 'cash-first' | 'voucher-first'
  // priorRefunds: { instrumentId: paiseAlreadyRefunded } so an instrument can never be over-refunded.
  const WATERFALL_ORDERS = {
    'cash-first': ['card', 'upi', 'wallet', 'voucher'],
    'voucher-first': ['voucher', 'wallet', 'card', 'upi'],
  };
  function allocate(order, req, config, priorRefunds) {
    priorRefunds = priorRefunds || {};
    const paidItems = order.items.filter(i => !i.giftOf);
    const gross = paidItems.reduce((s, i) => s + i.price, 0);
    const lines = [];
    let refundable = 0;
    const couponShares = order.coupon ? splitByWeights(order.coupon.amount, paidItems.map(i => i.price)) : paidItems.map(() => 0);
    for (const r of req.items) {
      const item = order.items.find(i => i.id === r.itemId);
      const idx = paidItems.indexOf(item);
      const share = couponShares[idx];
      let amt = item.price - share;
      const steps = [{ label: `${item.name}: price`, amount: item.price },
        ...(share ? [{ label: `Less ${order.coupon.code} share (${fmtINR(order.coupon.amount)} × ${fmtINR(item.price)} ÷ ${fmtINR(gross)})`, amount: -share }] : [])];
      const gift = order.items.find(i => i.giftOf === item.id);
      if (gift && !req.items.some(x => x.itemId === gift.id) && !r.giftReturned) {
        steps.push({ label: `Free ${gift.name} kept: its value is deducted (rule B-1)`, amount: -gift.listValue }); amt -= gift.listValue;
      }
      if (r.deductionPct) {
        const d = Math.round(amt * r.deductionPct / 100);
        steps.push({ label: `Inspection deduction ${r.deductionPct}%: ${r.deductionReason}`, amount: -d }); amt -= d;
      }
      amt = Math.max(0, amt);
      lines.push({ itemId: item.id, steps, refundable: amt });
      refundable += amt;
    }
    // Remaining capacity per instrument = paid - already refunded.
    const caps = order.payments.map(p => Math.max(0, p.amount - (priorRefunds[p.id] || 0)));
    let parts;
    if (config.order === 'proportional') {
      parts = splitByWeights(Math.min(refundable, caps.reduce((s, c) => s + c, 0)), caps);
    } else {
      const seq = WATERFALL_ORDERS[config.order];
      parts = order.payments.map(() => 0);
      let left = refundable;
      order.payments.map((p, i) => [seq.indexOf(p.type), i]).sort((a, b) => a[0] - b[0]).forEach(([, i]) => {
        const take = Math.min(left, caps[i]); parts[i] = take; left -= take;
      });
    }
    const legs = order.payments.map((p, i) => ({
      instrumentId: p.id, type: p.type, label: p.label, amount: parts[i],
      refundAs: p.type === 'voucher' ? 'voucher' : p.type,
      voucherExpiry: p.type === 'voucher' ? voucherExpiry(p.expiresAt, config.now, config.minVoucherDays || 30) : null,
    })).filter(l => l.amount > 0);
    const total = legs.reduce((s, l) => s + l.amount, 0);
    return { lines, refundable, legs, total, balanced: total === refundable };
  }
  // A refunded voucher never comes back already expired: at least `minDays` of life from the refund date.
  function voucherExpiry(original, now, minDays) {
    const floor = addDays(now, minDays);
    return new Date(original) > new Date(floor) ? { at: original, extended: false } : { at: floor, extended: true, originalAt: original };
  }

  // ---------------------------------------------------------------- 4. IDEMPOTENT REFUND LEDGER
  // A refund leg has ONE key: returnId:itemId:instrumentId. Retries with the same key return the original.
  function createLedger() { return { byKey: {}, attempts: [] }; }
  function issueRefund(ledger, key, amount, at) {
    ledger.attempts.push({ key, amount, at });
    if (ledger.byKey[key]) {
      const orig = ledger.byKey[key];
      return { duplicate: true, refund: orig, mismatch: orig.amount !== amount };
    }
    const refund = { key, amount, at, ref: 'RF-' + sha256(key).slice(0, 10).toUpperCase() };
    ledger.byKey[key] = refund;
    return { duplicate: false, refund };
  }

  // ---------------------------------------------------------------- 5. THREE-SOURCE RECONCILIATION
  // Each source reports its own view with its own lag. We map them onto one expected timeline.
  const EXPECTED = {
    card: { creditMin: 5, creditMax: 7, label: 'Card' },
    upi: { creditMin: 1, creditMax: 3, label: 'UPI' },
    wallet: { creditMin: 0, creditMax: 1, label: 'Wallet' },
    voucher: { creditMin: 0, creditMax: 0, label: 'Voucher' },
    sellerLagMaxHours: 72,
    staleAfterHours: 24,
  };
  // sources: { platform:{status,at,seenAt}, provider:{status,at,seenAt}, seller:{status,at,seenAt} }
  function reconcile(leg, sources, now) {
    const notes = [];
    const fresh = {};
    for (const k of ['platform', 'provider', 'seller']) {
      const s = sources[k];
      if (!s) { fresh[k] = 'missing'; notes.push(`${k} has no record yet`); continue; }
      const ageH = daysBetween(s.seenAt, now) * 24;
      fresh[k] = s.timeout ? 'timeout' : ageH > EXPECTED.staleAfterHours ? 'stale' : 'fresh';
    }
    const exp = EXPECTED[leg.type];
    const p = sources.provider, pl = sources.platform, se = sources.seller;
    const result = (verdict, confidence, why, actions) => ({ verdict, confidence, why, actions, freshness: fresh, notes });
    if (fresh.provider === 'timeout') return result('UNKNOWN', 'low', 'Payment provider did not answer. Showing last known status; nothing is assumed.', { platform: 'Retry provider with backoff (same idempotency key)', customer: 'No action needed. We will update you.', seller: '—', provider: 'Respond to status query' });
    if (fresh.provider === 'stale') return result('UNKNOWN', 'low', `Provider data is ${Math.round(daysBetween(p.seenAt, now) * 24)} h old. Too old to classify safely.`, { platform: 'Refresh provider status before telling the customer anything', customer: 'No action needed yet', seller: '—', provider: 'Send a fresh status' });
    if (p && p.status === 'CREDITED') return result('DONE', 'high', 'Provider confirms the money reached the customer account.', { customer: 'Check your statement', platform: 'Close leg', seller: 'Settle', provider: '—' });
    if (p && (p.status === 'REVERSED' || p.status === 'PROCESSED')) {
      const due = addDays(p.at, exp.creditMax);
      const late = daysBetween(due, now);
      const sellerLagging = se && se.status === 'PENDING' && daysBetween(p.at, now) * 24 <= EXPECTED.sellerLagMaxHours;
      const sellerStuck = se && se.status === 'PENDING' && daysBetween(p.at, now) * 24 > EXPECTED.sellerLagMaxHours;
      if (sellerLagging) notes.push('Seller ledger still says PENDING. That is normal lag (up to 72 h) and does not block the customer.');
      if (sellerStuck) notes.push('Seller ledger has not caught up after 72 h: seller settlement is stuck (internal; customer money unaffected).');
      if (late <= 0) return result('WAITING', 'high', `Provider ${p.status.toLowerCase()} the ${exp.label.toLowerCase()} refund on ${fmtD(p.at)}. Banks usually show it within ${exp.creditMin}–${exp.creditMax} days, by ${fmtD(due)}.`, {
        customer: `Nothing to do until ${fmtD(due)}. Reference: ${leg.ref || 'shown below'}`,
        platform: sellerStuck ? 'Chase seller settlement (internal)' : 'Watch; no action',
        seller: se && se.status === 'PENDING' ? 'Post the debit note to update ledger' : '—',
        provider: '—' });
      return result('STUCK', 'high', `Past the ${exp.creditMax}-day window by ${Math.ceil(late)} day(s). The bank has the money but it is not showing.`, {
        customer: 'Give your bank the reference number (ARN) to trace it',
        platform: 'Open a trace with the provider, attach ARN; escalate in 48 h',
        seller: '—', provider: 'Trace with card network / issuing bank' });
    }
    if (pl && pl.status === 'INITIATED' && (!p || p.status === 'PENDING')) {
      const waitedH = daysBetween(pl.at, now) * 24;
      if (waitedH <= 48) return result('WAITING', 'medium', 'Refund sent to provider; provider has not confirmed yet (normal up to 48 h).', { customer: 'Nothing to do', platform: 'Watch', seller: '—', provider: 'Process' });
      return result('STUCK', 'high', `Provider has not acknowledged for ${Math.round(waitedH)} h (limit 48 h).`, { customer: 'Nothing to do; we are chasing', platform: 'Re-query provider with SAME key (no duplicate)', seller: '—', provider: 'Acknowledge or reject' });
    }
    return result('WAITING', 'medium', 'Refund not started yet.', { customer: '—', platform: '—', seller: '—', provider: '—' });
  }

  // ---------------------------------------------------------------- 6. PICKUP DISPUTE (courier vs customer)
  // Weighs attempt evidence. Never blames the customer on the courier's word alone.
  function judgeAttempt(a) {
    const signals = [];
    let courierFault = 0;
    if (a.gpsMetersFromAddress > 300) { courierFault += 2; signals.push(`Courier GPS was ${(a.gpsMetersFromAddress / 1000).toFixed(1)} km away`); }
    else signals.push(`Courier GPS within ${a.gpsMetersFromAddress} m of address`);
    if (a.callsLogged === 0) { courierFault += 1; signals.push('No call attempt logged by courier app'); }
    else if (a.callsConnectedSeconds === 0 && a.customerCallLogShowsMissed === false) { courierFault += 1; signals.push(`${a.callsLogged} call(s) logged by courier but none reached the customer phone`); }
    else signals.push(`${a.callsLogged} call(s) placed`);
    if (a.customerPresenceEvidence) signals.push(`Customer evidence: ${a.customerPresenceEvidence}`);
    const finding = courierFault >= 2 ? 'COURIER_FAULT' : courierFault === 1 ? 'INCONCLUSIVE' : 'CUSTOMER_UNAVAILABLE';
    return { finding, signals, countsAgainstCustomer: finding === 'CUSTOMER_UNAVAILABLE' };
  }

  // ---------------------------------------------------------------- 7. INSPECTION DISPUTE
  // Compares handover evidence (timestamped at pickup) with the warehouse finding. SLA-bound.
  function judgeInspection(claim, evidence, openedAt, slaHours, now) {
    const due = addDays(openedAt, slaHours / 24);
    const overdue = new Date(now) > new Date(due);
    if (!evidence.handoverPhotos || evidence.handoverPhotos.length === 0)
      return { outcome: 'REJECTED', refundPct: 0, reason: 'No handover evidence and warehouse photos show the defect.', due, overdue };
    const contradicts = evidence.handoverPhotos.some(p => p.showsCondition === 'clean' && p.area === claim.area);
    if (contradicts && evidence.photoBeforeWarehouse) return { outcome: 'PASSED', refundPct: 100, reason: `Handover photo (${fmtDT(evidence.handoverPhotos[0].at)}) shows the ${claim.area} clean before the courier took it. Damage cannot be attributed to the customer.`, due, overdue };
    if (claim.severity === 'minor') return { outcome: 'PARTIAL', refundPct: 85, reason: `Minor ${claim.area} wear visible in both sets of photos. 15% deduction per policy P-INS-3.`, due, overdue };
    return { outcome: 'REJECTED', refundPct: 0, reason: 'Defect visible in handover photos as well.', due, overdue };
  }

  // ---------------------------------------------------------------- 8. FRAUD FRICTION LADDER (with fairness check)
  const LADDER = [
    { level: 0, name: 'No friction', effect: 'Normal return; instant wallet refund allowed.' },
    { level: 1, name: 'Nudge', effect: 'Size helper shown; reason confirmed. No delay.' },
    { level: 2, name: 'Verify', effect: 'Refund only after inspection; no instant refund.' },
    { level: 3, name: 'Review', effect: 'Human review before pickup; refund held.' },
  ];
  function fraudAssess(p) {
    const signals = [];
    let naive = 0;
    if (p.returns90 >= 10) { naive = 2; signals.push({ s: `${p.returns90} returns in 90 days (high volume)`, w: '+2' }); }
    else if (p.returns90 >= 5) { naive = 1; signals.push({ s: `${p.returns90} returns in 90 days`, w: '+1' }); }
    let risk = naive;
    if (p.confirmedAbuse > 0) { risk += 2; signals.push({ s: `${p.confirmedAbuse} return(s) confirmed used/swapped`, w: '+2' }); }
    if (p.wardrobingHits >= 2) { risk += 1; signals.push({ s: `${p.wardrobingHits} event-wear returns right after use`, w: '+1' }); }
    if (p.sharedAccounts > 1) { risk += 1; signals.push({ s: `Address shared by ${p.sharedAccounts} accounts with high returns`, w: '+1' }); }
    // Fairness check: explainable high volume must not be punished.
    const fairness = [];
    if (p.sizingShare >= 0.8 && p.inspectionPassRate >= 0.9 && p.confirmedAbuse === 0) {
      risk = Math.max(0, risk - 2);
      fairness.push(`${Math.round(p.sizingShare * 100)}% are size/fit returns and ${Math.round(p.inspectionPassRate * 100)}% passed inspection: explainable, not abuse (−2)`);
    }
    if (p.keepRate >= 0.5) fairness.push(`Keeps ${Math.round(p.keepRate * 100)}% of what she buys: a valuable customer`);
    const level = Math.min(3, Math.max(0, risk));
    return { naiveLevel: Math.min(3, naive), level, rung: LADDER[level], signals, fairness };
  }

  // ---------------------------------------------------------------- 9. REFUND vs EXCHANGE vs REPLACEMENT
  // Shown in a fixed order with no option pre-selected. Recommendation is reasoned, never a default nudge.
  function compareOptions(item, reason, refundEstimate, stock) {
    const opts = [
      { id: 'refund', title: 'Refund', money: `${fmtINR(refundEstimate.total)} back across ${refundEstimate.legs.length} method(s)`, time: 'After inspection; card 5–7 days', solves: true },
      { id: 'exchange', title: 'Exchange (other size)', money: stock.otherSize.priceDiff === 0 ? 'No price difference' : `${stock.otherSize.priceDiff > 0 ? 'Pay' : 'Get back'} ${fmtINR(Math.abs(stock.otherSize.priceDiff))}`, time: stock.otherSize.qty > 0 ? `New pair in ${stock.otherSize.days} days, same visit as pickup` : 'Out of stock', solves: reason === 'SIZE' && stock.otherSize.qty > 0, stockNote: `${stock.otherSize.qty} left in ${stock.otherSize.size}` },
      { id: 'replacement', title: 'Replacement (same item)', money: 'No money moves', time: stock.same.qty > 0 ? `${stock.same.days} days` : 'Out of stock', solves: reason === 'DEFECT', stockNote: `${stock.same.qty} left` },
    ];
    let rec, why;
    if (reason === 'SIZE' && stock.otherSize.qty > 0) { rec = 'exchange'; why = 'Your reason is size, and the other size is in stock: an exchange fixes it fastest with no money in limbo. A replacement would bring the same wrong size.'; }
    else if (reason === 'DEFECT' && stock.same.qty > 0) { rec = 'replacement'; why = 'The item is faulty and the same one is in stock.'; }
    else { rec = 'refund'; why = 'No option that fixes the problem is in stock.'; }
    return { options: opts, recommended: rec, why, note: 'All three are equally available. Choose what suits you.' };
  }

  // ---------------------------------------------------------------- 10. NOTIFICATION WORDING LIBRARY
  // Every message comes from here and is tested against its state. Never "arrived" before CREDITED_CONFIRMED.
  const WORDING = {
    'item.REQUESTED': 'Return request received for {item}. Nothing has been collected yet.',
    'item.PICKUP_SCHEDULED': 'Pickup for {item} booked for {when}.',
    'item.PICKUP_FAILED': 'Courier marked pickup of {item} as not done ({why}). If you were home, tell us: it will not count against you.',
    'item.PICKUP_DISPUTED': 'We are checking the courier’s record for {item}. You will not be charged or penalised meanwhile.',
    'item.DROPOFF_SELECTED': 'Drop-off chosen for {item}. Show code {code} at the partner store.',
    'item.COLLECTED': '{item} handed over. Handover proof saved with photos at {when}.',
    'item.IN_TRANSIT': '{item} is on its way to the seller warehouse.',
    'item.RECEIVED': 'Warehouse received {item}. Inspection next.',
    'item.INSPECTION_HOLD': '{item} is on inspection hold: {why}. No decision yet. You can respond with your handover photos.',
    'item.INSPECTION_DISPUTED': 'Your evidence for {item} is under independent review. Decision due by {when}.',
    'item.INSPECTION_PASSED': '{item} passed inspection. Refund will now be started.',
    'item.INSPECTION_PARTIAL': '{item} accepted with a deduction: {why}.',
    'item.INSPECTION_REJECTED': '{item} not accepted: {why}. It will be sent back to you free.',
    'refund.APPROVED': 'Refund of {amount} approved for {item}. It has not been sent yet.',
    'refund.INITIATED': 'Refund of {amount} sent to the payment provider. It is not in your account yet.',
    'refund.PROVIDER_PROCESSED': 'Payment provider has processed {amount}. Banks usually show it by {when}.',
    'refund.CREDITED_CONFIRMED': '{amount} has reached your account (confirmed by provider).',
    'refund.FAILED': 'Refund attempt for {amount} did not go through. We will retry; you will not be paid twice.',
  };
  function message(machine, state, vars) {
    const tpl = WORDING[machine + '.' + state];
    if (!tpl) throw new Error('No approved wording for ' + machine + '.' + state);
    return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? vars[k] : '—'));
  }

  // ---------------------------------------------------------------- 11. TAMPER-EVIDENT AUDIT LOG
  function createAudit() { return []; }
  function auditAppend(log, actor, action, data, at) {
    const prev = log.length ? log[log.length - 1].hash : 'GENESIS';
    const body = { seq: log.length + 1, at, actor, action, data: JSON.stringify(data || {}), prev };
    const hash = sha256(JSON.stringify(body));
    log.push({ ...body, hash });
    return log[log.length - 1];
  }
  function auditVerify(log) {
    let prev = 'GENESIS';
    for (const e of log) {
      const { hash, ...body } = e;
      if (body.prev !== prev || sha256(JSON.stringify(body)) !== hash) return { ok: false, brokenAt: e.seq };
      prev = hash;
    }
    return { ok: true, length: log.length, head: prev };
  }

  // ---------------------------------------------------------------- 12. INPUT VALIDATION (malformed input)
  function validateEvent(ev) {
    const errs = [];
    if (!ev || typeof ev !== 'object') return ['Not an object'];
    if (!['item', 'refund'].includes(ev.machine)) errs.push('machine must be item or refund');
    if (typeof ev.to !== 'string' || !/^[A-Z_]+$/.test(ev.to)) errs.push('state must be UPPER_CASE text');
    if (isNaN(new Date(ev.at))) errs.push('time is not a valid date');
    if (ev.amount != null && (!Number.isInteger(ev.amount) || ev.amount < 0)) errs.push('amount must be whole paise ≥ 0');
    return errs;
  }

  g.Engine = { DAY, iso, addDays, daysBetween, fmtINR, splitByWeights, ITEM_MACHINE, REFUND_MACHINE, canTransition, transition, current,
    eligibility, allocate, voucherExpiry, createLedger, issueRefund, EXPECTED, reconcile, judgeAttempt, judgeInspection,
    LADDER, fraudAssess, compareOptions, WORDING, message, createAudit, auditAppend, auditVerify, validateEvent };
})(typeof window !== 'undefined' ? window : globalThis);
