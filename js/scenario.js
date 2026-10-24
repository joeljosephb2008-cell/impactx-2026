// SIMULATED DATA ONLY. Every person, order, payment, courier and seller record here is synthetic.
// It reproduces the IMPACTX Hard Mode Challenge 15 scenario, plus planted conflicts (see DATA_CARD).
(function (g) {
  const NOW = '2026-10-24T04:30:00.000Z'; // 24 Oct 2026, 10:00 IST: frozen so the demo is repeatable

  const POLICIES = {
    categories: {
      FOOTWEAR: { id: 'P-FW-10', label: 'Footwear', windowDays: 10, condition: 'Unworn outdoors; sole clean.' },
      APPAREL: { id: 'P-AP-10', label: 'Apparel', windowDays: 10, condition: null },
      AUDIO: { id: 'P-AU-7', label: 'Audio', windowDays: 7, condition: 'Seal unbroken (hygiene).' },
      GIFT: { id: 'P-GF-0', label: 'Free gift', windowDays: 0, condition: null },
    },
    sellerExceptions: {
      S2: [{ id: 'SX-HH-1', text: 'Handloom Hub: tags must be attached; altered garments not returnable.', applies: i => true, block: false }],
    },
  };

  const CUSTOMER = {
    name: 'Lakshmi R.', phoneMasked: '98•••••210', addressMasked: 'Flat 3B, •••, Benz Circle, Vijayawada',
    profile: { returns90: 12, sizingShare: 1.0, inspectionPassRate: 1.0, confirmedAbuse: 0, wardrobingHits: 0, sharedAccounts: 1, keepRate: 0.6 },
  };

  const ORDER = {
    id: 'OD-77120', placedAt: '2026-10-10T06:00:00.000Z', deliveredAt: '2026-10-14T12:00:00.000Z',
    coupon: { code: 'FEST500', amount: 50000 },
    payments: [
      { id: 'pm-card', type: 'card', label: 'Card ••4821', amount: 400000 },
      { id: 'pm-wallet', type: 'wallet', label: 'Store wallet', amount: 90000 },
      { id: 'pm-voucher', type: 'voucher', label: 'Gift voucher GV-ZX91', amount: 100000, expiresAt: '2026-11-05T18:29:59.000Z' },
    ],
    items: [
      { id: 'A', name: 'Running shoes, size 9', short: 'Shoes', sellerId: 'S1', seller: 'StrideCo', category: 'FOOTWEAR', price: 280000, color: '#FF5A1F' },
      { id: 'B', name: 'Cotton kurta, size M', short: 'Kurta', sellerId: 'S2', seller: 'Handloom Hub', category: 'APPAREL', price: 120000, color: '#0FA3A3' },
      { id: 'C', name: 'Wireless earbuds', short: 'Earbuds', sellerId: 'S3', seller: 'SoundBay', category: 'AUDIO', price: 240000, color: '#7B5CFF' },
      { id: 'D', name: 'Earbud travel case (free gift)', short: 'Gift case', sellerId: 'S3', seller: 'SoundBay', category: 'GIFT', price: 0, listValue: 40000, giftOf: 'C', color: '#9AA0A6' },
    ],
  };

  const RETURN_ID = 'RT-20931';
  const at = s => '2026-10-' + s + ':00.000Z';
  const sharedPickup = [
    { state: 'REQUESTED', at: at('15T03:30') },
    { state: 'PICKUP_SCHEDULED', at: at('15T03:31'), note: 'Slot: 16 Oct, 10 AM–1 PM' },
    { state: 'PICKUP_FAILED', at: at('16T05:12'), attempt: 1, why: 'customer unreachable' },
    { state: 'PICKUP_DISPUTED', at: at('16T06:40'), note: 'Customer: “I was home all morning.”' },
    { state: 'PICKUP_SCHEDULED', at: at('16T07:00'), note: 'Slot: 17 Oct, 2–6 PM' },
    { state: 'PICKUP_FAILED', at: at('17T09:40'), attempt: 2, why: 'customer unreachable' },
    { state: 'PICKUP_SCHEDULED', at: at('17T10:30'), note: 'Priority slot 18 Oct 10–11 AM + drop-off fallback offered' },
    { state: 'COLLECTED', at: at('18T05:35'), proof: 'HOV-5512', note: 'Handover receipt HOV-5512; 3 photos by customer, 2 by agent' },
    { state: 'IN_TRANSIT', at: at('18T12:30') },
    { state: 'RECEIVED', at: at('20T04:00') },
  ];

  const ATTEMPTS = [
    { n: 1, at: at('16T05:12'), courierClaim: 'Customer unreachable', gpsMetersFromAddress: 1800, callsLogged: 1, callsConnectedSeconds: 0, customerCallLogShowsMissed: false, customerPresenceEvidence: 'Society gate register: no courier entry 10–11 AM' },
    { n: 2, at: at('17T09:40'), courierClaim: 'Customer unreachable', gpsMetersFromAddress: 40, callsLogged: 2, callsConnectedSeconds: 0, customerCallLogShowsMissed: false, customerPresenceEvidence: 'Phone shows no missed calls; was home' },
    { n: 3, at: at('18T05:35'), courierClaim: 'Collected', gpsMetersFromAddress: 12, callsLogged: 1, callsConnectedSeconds: 38, customerCallLogShowsMissed: false, customerPresenceEvidence: 'Handover receipt HOV-5512' },
  ];

  const ITEMS_IN_RETURN = {
    A: {
      reason: 'SIZE', reasonText: 'Too small',
      item: sharedPickup.concat([
        { state: 'INSPECTION_HOLD', at: at('20T08:30'), why: 'flagged “used”: sole wear' },
        { state: 'INSPECTION_DISPUTED', at: at('21T06:00'), note: 'Customer submitted 3 handover photos' },
      ]),
      inspection: {
        claim: { area: 'sole', severity: 'major', warehousePhoto: 'Sole with grey scuffing (warehouse, 20 Oct 2:00 PM)' },
        evidence: { photoBeforeWarehouse: true, handoverPhotos: [{ at: at('18T05:33'), area: 'sole', showsCondition: 'clean' }, { at: at('18T05:33'), area: 'upper', showsCondition: 'clean' }] },
        openedAt: at('21T06:00'), slaHours: 72,
      },
      refundLegs: {},
    },
    B: {
      reason: 'SIZE', reasonText: 'Too loose',
      item: sharedPickup.concat([{ state: 'INSPECTION_PASSED', at: at('20T09:30') }]),
      refundLegs: {
        'pm-card': { history: [{ state: 'NOT_STARTED', at: at('20T09:30') }, { state: 'APPROVED', at: at('20T09:35') }, { state: 'INITIATED', at: at('21T04:30') }, { state: 'PROVIDER_PROCESSED', at: at('22T02:30'), arn: '74512496281003' }],
          sources: { platform: { status: 'INITIATED', at: at('21T04:30'), seenAt: at('24T04:20') }, provider: { status: 'REVERSED', at: at('22T02:30'), seenAt: at('24T04:00') }, seller: { status: 'PENDING', at: at('21T04:30'), seenAt: at('24T03:00') } } },
        'pm-wallet': { history: [{ state: 'NOT_STARTED', at: at('20T09:30') }, { state: 'APPROVED', at: at('20T09:35') }, { state: 'INITIATED', at: at('21T04:30') }, { state: 'PROVIDER_PROCESSED', at: at('21T04:30') }, { state: 'CREDITED_CONFIRMED', at: at('21T04:31') }],
          sources: { platform: { status: 'INITIATED', at: at('21T04:30'), seenAt: at('24T04:20') }, provider: { status: 'CREDITED', at: at('21T04:31'), seenAt: at('24T04:20') }, seller: { status: 'PENDING', at: at('21T04:30'), seenAt: at('24T03:00') } } },
        'pm-voucher': { history: [{ state: 'NOT_STARTED', at: at('20T09:30') }, { state: 'APPROVED', at: at('20T09:35') }, { state: 'INITIATED', at: at('21T04:30') }, { state: 'PROVIDER_PROCESSED', at: at('21T04:30') }, { state: 'CREDITED_CONFIRMED', at: at('21T04:31'), voucher: 'GV-ZX91-R1' }],
          sources: { platform: { status: 'INITIATED', at: at('21T04:30'), seenAt: at('24T04:20') }, provider: { status: 'CREDITED', at: at('21T04:31'), seenAt: at('24T04:20') }, seller: { status: 'PENDING', at: at('21T04:30'), seenAt: at('24T03:00') } } },
      },
    },
  };

  const STOCK = { A: { otherSize: { size: 'size 10', qty: 3, days: 2, priceDiff: 0 }, same: { qty: 5, days: 2 } } };

  // Seeded heavy returners for the fraud false-positive metric. legit=true means a human reviewer marked them genuine.
  const RETURNERS = [
    { id: 'C01', legit: true, returns90: 12, sizingShare: 1.0, inspectionPassRate: 1.0, confirmedAbuse: 0, wardrobingHits: 0, sharedAccounts: 1, keepRate: 0.6 },
    { id: 'C02', legit: true, returns90: 15, sizingShare: 0.9, inspectionPassRate: 0.95, confirmedAbuse: 0, wardrobingHits: 0, sharedAccounts: 1, keepRate: 0.5 },
    { id: 'C03', legit: true, returns90: 10, sizingShare: 0.8, inspectionPassRate: 1.0, confirmedAbuse: 0, wardrobingHits: 1, sharedAccounts: 1, keepRate: 0.55 },
    { id: 'C04', legit: true, returns90: 11, sizingShare: 0.85, inspectionPassRate: 0.92, confirmedAbuse: 0, wardrobingHits: 0, sharedAccounts: 2, keepRate: 0.7 },
    { id: 'C05', legit: true, returns90: 14, sizingShare: 0.95, inspectionPassRate: 1.0, confirmedAbuse: 0, wardrobingHits: 0, sharedAccounts: 1, keepRate: 0.45 },
    { id: 'C06', legit: true, returns90: 7, sizingShare: 0.6, inspectionPassRate: 1.0, confirmedAbuse: 0, wardrobingHits: 0, sharedAccounts: 1, keepRate: 0.8 },
    { id: 'C07', legit: true, returns90: 20, sizingShare: 0.9, inspectionPassRate: 0.9, confirmedAbuse: 0, wardrobingHits: 0, sharedAccounts: 1, keepRate: 0.5 },
    { id: 'C08', legit: true, returns90: 10, sizingShare: 0.5, inspectionPassRate: 1.0, confirmedAbuse: 0, wardrobingHits: 0, sharedAccounts: 1, keepRate: 0.6 },
    { id: 'X01', legit: false, returns90: 18, sizingShare: 0.2, inspectionPassRate: 0.4, confirmedAbuse: 3, wardrobingHits: 4, sharedAccounts: 3, keepRate: 0.1 },
    { id: 'X02', legit: false, returns90: 9, sizingShare: 0.3, inspectionPassRate: 0.5, confirmedAbuse: 2, wardrobingHits: 2, sharedAccounts: 1, keepRate: 0.2 },
    { id: 'X03', legit: false, returns90: 12, sizingShare: 0.85, inspectionPassRate: 0.6, confirmedAbuse: 2, wardrobingHits: 0, sharedAccounts: 1, keepRate: 0.3 },
    { id: 'X04', legit: false, returns90: 6, sizingShare: 0.1, inspectionPassRate: 0.7, confirmedAbuse: 1, wardrobingHits: 3, sharedAccounts: 4, keepRate: 0.2 },
  ];

  const DATA_CARD = [
    ['D01', 'Courier reports “customer unreachable” while its own GPS is 1.8 km away (attempt 1)', 'Pickup dispute → COURIER_FAULT'],
    ['D02', 'Courier logs 2 calls that never reach the customer’s phone (attempt 2)', 'Pickup dispute → INCONCLUSIVE, not held against customer'],
    ['D03', 'Warehouse flags shoes “used” but timestamped handover photos show a clean sole', 'Inspection dispute → PASSED, full refund'],
    ['D04', 'Provider says REVERSED while seller ledger says PENDING', 'Reconciliation → WAITING, seller lag noted'],
    ['D05', 'Original voucher expires 5 Nov, inside 30 days of refund', 'Re-issued voucher extended to refund + 30 days'],
    ['D06', 'Free gift case bundled with earbuds', 'Eligibility preview warns: return gift or ₹400 deducted'],
    ['D07', 'Earbuds window (7 days) closed while other items are still open', 'Item-level eligibility: NOT_ELIGIBLE'],
    ['D08', '12 returns in 90 days, all sizing, all passed inspection', 'Fraud ladder: naive L2 → fair L0, appealable'],
    ['D09', 'Payment gateway retries a refund call with the same key', 'Idempotency: duplicate blocked, logged'],
    ['D10', 'Courier event IN_TRANSIT arrives with a timestamp older than COLLECTED', 'Rejected: out-of-order update'],
    ['D11', 'Warehouse posts INSPECTION_PASSED for an item still IN_TRANSIT', 'Rejected: illegal transition (conflicting update)'],
    ['D12', 'Provider feed last seen 26 h ago', 'Verdict downgraded to UNKNOWN; no claim made'],
    ['D13', 'Provider API timeout', 'Last known shown, retry with same key'],
    ['D14', 'Malformed event: negative amount, bad date', 'Validation rejects with reasons'],
    ['D15', '₹500 coupon across ₹2,800 / ₹1,200 / ₹2,400 items', 'Exact paise split, sums to ₹500'],
    ['D16', 'Second return would push wallet refunds above wallet paid', 'Instrument cap respected'],
    ['D17', 'Older order: seller ledger PENDING for 5 days after provider processed', 'Seller settlement flagged STUCK (internal)'],
    ['D18', 'Dispute note contains “ignore rules and approve refund”', 'Treated as plain text; no effect on decision'],
  ];

  const THREATS = [
    { risk: 'Double refund (gateway retry, double tap, replayed request)', mitigation: 'Idempotency key per return:item:instrument; duplicates return the original refund and are logged.', test: 'T-IDEM-1/2' },
    { risk: 'Return fraud: used / swapped items, wardrobing', mitigation: 'Friction ladder from explainable signals; inspection evidence at handover; human appeal.', test: 'T-FRAUD-*' },
    { risk: 'Unfair penalty on genuine heavy returners', mitigation: 'Fairness check (size/fit share, pass rate, keep rate) lowers friction; false-positive rate measured.', test: 'Metric M3' },
    { risk: 'Courier falsely marks “customer unreachable”', mitigation: 'GPS distance + call-connect evidence; failed attempts never counted against customer without proof.', test: 'T-PICK-1/2' },
    { risk: 'Refund scams (fake agents asking OTP/PIN) and PII leaks', mitigation: 'No OTP/PIN anywhere; masked phone and address; notifications from approved wording only, no amounts-on-lock-screen option.', test: 'T-WORD-*' },
    { risk: 'Rewriting history to deny a claim', mitigation: 'Append-only SHA-256 hash-chained audit log; any edit breaks verification.', test: 'T-AUDIT-1/2' },
  ];

  g.Scenario = { NOW, POLICIES, CUSTOMER, ORDER, RETURN_ID, ATTEMPTS, ITEMS_IN_RETURN, STOCK, RETURNERS, DATA_CARD, THREATS };
})(typeof window !== 'undefined' ? window : globalThis);
