// Business rules for returns and refunds. No screen code lives here,
// so each rule can be explained (and tested) on its own.

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(s) { return new Date(s + 'T10:00:00'); }
function daysBetween(a, b) { return Math.round((toDate(b) - toDate(a)) / DAY_MS); }
function todayStr() { return DEMO_TODAY.toISOString().slice(0, 10); }
function addDays(s, n) {
  const d = toDate(s); d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function fmtDate(s) {
  return toDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function rupees(n) { return '₹' + Math.round(n).toLocaleString('en-IN'); }

// RULE 1: Can this item still be returned?
// Returns { ok, daysLeft, lastDay, why }
function eligibility(order, item, existingReturns) {
  const alreadyReturned = existingReturns.some(r => r.orderId === order.id && r.items.some(i => i.itemId === item.id));
  if (alreadyReturned) return { ok: false, why: 'inReturn' };
  if (!item.returnable) return { ok: false, why: item.blockReason || 'notReturnable' };
  const lastDay = addDays(order.delivered, item.windowDays);
  const daysLeft = daysBetween(todayStr(), lastDay);
  if (daysLeft < 0) return { ok: false, why: 'windowClosed', lastDay };
  return { ok: true, daysLeft, lastDay };
}

// RULE 2: How much comes back for each item?
// A coupon on the whole order is shared across items in proportion to their price.
// So returning one item only takes back that item's share of the discount.
function itemRefund(order, item) {
  const total = order.items.reduce((s, i) => s + i.price, 0);
  const couponShare = order.coupon ? Math.round(order.coupon.amount * item.price / total) : 0;
  return { price: item.price, couponShare, refund: item.price - couponShare };
}

// RULE 3: Where does the money go?
// Money goes back to the same places it came from, in the same proportion.
// Cash on delivery has no "original place", so it goes to a bank/UPI account the user gives.
// Option: the user can choose instant store-wallet credit instead.
function splitRefund(order, amount, preference) {
  if (preference === 'wallet') return [{ type: 'wallet', label: 'Store wallet (instant)', amount }];
  const paid = order.payments.reduce((s, p) => s + p.amount, 0);
  const parts = order.payments.map(p => ({
    type: p.type === 'cod' ? 'bank' : p.type,
    label: p.type === 'cod' ? 'Your bank / UPI account' : p.label,
    amount: Math.round(amount * p.amount / paid),
  }));
  // Fix rounding so the parts always add up to the exact refund.
  const diff = amount - parts.reduce((s, p) => s + p.amount, 0);
  parts[0].amount += diff;
  return parts.filter(p => p.amount > 0);
}

// RULE 4: When should the money arrive?
function eta(type, fromDate) {
  const m = PAYMENT_METHODS[type];
  return { from: addDays(fromDate, m.minDays), to: addDays(fromDate, m.maxDays) };
}

// RULE 5: What state is this item in, and is it late?
const STEP_ORDER = ['requested', 'pickup', 'picked', 'qc', 'initiated', 'credited'];

function itemStatus(ri) {
  const last = ri.steps[ri.steps.length - 1];
  if (last.key === 'qcfail') return { kind: 'action', last };
  if (last.key === 'credited') return { kind: 'done', last };
  if (ri.expectedBy && daysBetween(ri.expectedBy, todayStr()) > 0) {
    return { kind: 'delayed', last, lateBy: daysBetween(ri.expectedBy, todayStr()) };
  }
  return { kind: 'onTrack', last };
}

// The whole return is only as good as its worst item.
function returnStatus(ret) {
  const kinds = ret.items.map(itemStatus).map(s => s.kind);
  if (kinds.includes('delayed')) return 'delayed';
  if (kinds.includes('action')) return 'action';
  if (kinds.every(k => k === 'done')) return 'done';
  return 'onTrack';
}

// RULE 6: Escalation ladder for a late refund.
// Steps 2-4 describe real Indian consumer-protection routes. This prototype does NOT file anything.
function escalationLadder(ticketDate) {
  return [
    { who: 'Store support', what: 'We raise a ticket with your ARN and dates attached.', by: addDays(ticketDate, 2) },
    { who: 'Store grievance officer', what: 'E-commerce sites in India must acknowledge a complaint within 48 hours and resolve it within one month (Consumer Protection (E-Commerce) Rules, 2020).', by: addDays(ticketDate, 30) },
    { who: 'National Consumer Helpline', what: 'Call 1915 or file on the government INGRAM portal. We prepare the complaint text for you.', by: null },
    { who: 'Consumer Commission', what: 'Last resort: file online on e-Daakhil.', by: null },
  ];
}

// Moves a demo item to its next step (used by the "Demo: next step" button).
function advanceItem(order, ri) {
  const last = ri.steps[ri.steps.length - 1].key;
  const next = STEP_ORDER[STEP_ORDER.indexOf(last) + 1];
  if (!next || last === 'qcfail') return;
  const step = { key: next, date: todayStr() };
  if (next === 'initiated') {
    step.ref = 'ARN ' + String(Math.floor(1e13 + Math.random() * 9e13));
    const slowest = Math.max(...ri.destination.map(d => PAYMENT_METHODS[d.type].maxDays));
    ri.expectedBy = addDays(todayStr(), slowest);
  }
  ri.steps.push(step);
}
