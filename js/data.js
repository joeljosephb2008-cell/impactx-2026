// SAMPLE DATA ONLY. Every order, person, payment and reference number below is made up.
// Nothing here connects to a real store, bank, courier or government system.

// We freeze "today" so the demo behaves the same every time judges open it.
const DEMO_TODAY = new Date('2026-10-24T10:00:00');

const USER = { name: 'Lakshmi', city: 'Vijayawada' };

// Typical refund timelines per payment method, counted from the day the store sends the refund.
// These are SAMPLE values for the prototype, not official numbers.
const PAYMENT_METHODS = {
  upi:    { label: 'UPI',          color: '#0A6E6E', minDays: 1, maxDays: 3 },
  card:   { label: 'Credit card',  color: '#5B3FA8', minDays: 5, maxDays: 7 },
  wallet: { label: 'Store wallet', color: '#C2410C', minDays: 0, maxDays: 0 },
  bank:   { label: 'Bank / UPI (for cash on delivery)', color: '#1F6F3F', minDays: 2, maxDays: 4 },
};

const RETURN_REASONS = [
  'wrongSize', 'damaged', 'notAsDescribed', 'wrongItem', 'noLongerNeeded',
];

const ORDERS = [
  {
    id: 'OD-58213',
    placed: '2026-10-12',
    delivered: '2026-10-16',
    payments: [
      { type: 'upi', label: 'UPI  lakshmi@okbank', amount: 3500 },
      { type: 'wallet', label: 'Store wallet', amount: 1696 },
    ],
    coupon: { code: 'FEST350', amount: 350 },
    items: [
      { id: 'i1', name: 'Running shoes, size 9', seller: 'StrideCo', price: 2499, returnable: true, windowDays: 10, tint: '#DCEBEA' },
      { id: 'i2', name: 'Wireless earbuds', seller: 'SoundBay', price: 1799, returnable: true, windowDays: 7, tint: '#E6E1F3' },
      { id: 'i3', name: 'Cotton kurta, size M', seller: 'Handloom Hub', price: 899, returnable: true, windowDays: 10, tint: '#F6E3D6' },
      { id: 'i4', name: 'Face cream, 50 g', seller: 'GlowLab', price: 349, returnable: false, blockReason: 'hygiene', tint: '#F3E6EC' },
    ],
  },
  {
    id: 'OD-58390',
    placed: '2026-10-19',
    delivered: '2026-10-22',
    payments: [{ type: 'cod', label: 'Cash on delivery', amount: 450 }],
    coupon: null,
    items: [
      { id: 'k1', name: 'Notebook set (pack of 6)', seller: 'PaperLane', price: 450, returnable: true, windowDays: 7, tint: '#E3ECF7' },
    ],
  },
  {
    id: 'OD-57940',
    placed: '2026-09-28',
    delivered: '2026-10-01',
    payments: [{ type: 'card', label: 'Credit card ending 4821', amount: 3740 }],
    coupon: null,
    items: [
      { id: 'j1', name: 'Mixer grinder, 750 W', seller: 'KitchenPro', price: 3290, returnable: true, windowDays: 10, tint: '#E7EEE0' },
      { id: 'j2', name: 'Steel water bottle, 1 L', seller: 'KitchenPro', price: 450, returnable: true, windowDays: 10, tint: '#E1E7EE' },
    ],
  },
];

// One return that is already in progress, so the tracker has something real-looking to show.
// It deliberately contains two problems: a late refund and a failed quality check.
const SEED_RETURNS = [
  {
    id: 'RT-10422',
    orderId: 'OD-57940',
    created: '2026-10-04',
    pickup: { date: '2026-10-06', slot: '10 AM – 1 PM' },
    items: [
      {
        itemId: 'j1', reason: 'damaged', refund: 3290,
        destination: [{ type: 'card', label: 'Credit card ending 4821', amount: 3290 }],
        steps: [
          { key: 'requested', date: '2026-10-04' },
          { key: 'pickup', date: '2026-10-05' },
          { key: 'picked', date: '2026-10-06' },
          { key: 'qc', date: '2026-10-08' },
          { key: 'initiated', date: '2026-10-09', ref: 'ARN 74512496281003' },
        ],
        expectedBy: '2026-10-16',
      },
      {
        itemId: 'j2', reason: 'noLongerNeeded', refund: 0,
        destination: [],
        steps: [
          { key: 'requested', date: '2026-10-04' },
          { key: 'pickup', date: '2026-10-05' },
          { key: 'picked', date: '2026-10-06' },
          { key: 'qcfail', date: '2026-10-08', note: 'Dent on the bottle base found at the warehouse. Item will be sent back to you.' },
        ],
      },
    ],
    updates: [
      { date: '2026-10-04', channel: 'App', text: 'Return RT-10422 created for 2 items. One pickup booked.' },
      { date: '2026-10-05', channel: 'SMS', text: 'Pickup confirmed for 6 Oct, 10 AM – 1 PM. Keep both items packed.' },
      { date: '2026-10-06', channel: 'SMS', text: 'Both items picked up by agent. Pickup photo saved.' },
      { date: '2026-10-08', channel: 'Email', text: 'Mixer grinder passed quality check. Steel bottle failed: dent on base.' },
      { date: '2026-10-09', channel: 'SMS', text: '₹3,290 refund sent to credit card ending 4821. Reference ARN 74512496281003.' },
    ],
  },
];
