# returnease · Team Sleepy Coders · IMPACTX 2026 Challenge 15 (Hard Mode)

**Live:** https://impactx-2026-seven.vercel.app/  ·  **Judge login:** `judge@returnease.demo` / `Impactx@2026`  ·  **Simulated data only** (no real store, courier, bank or seller is connected).

An item-level return and refund journey: eligibility before the request, a configurable refund waterfall across card / wallet / voucher, three-source reconciliation (seller · platform · payment provider) with *waiting vs stuck* classification, idempotent refunds, pickup and inspection disputes, a fair fraud friction ladder with appeal, and a tamper-evident audit trail.

## Team
B Joel (lead) · Sameer SK · Tejasvi G · Nikitha V

## Architecture (plain HTML/CSS/JS, no build step)
| File | Role |
|---|---|
| `js/engine.js` | All rules as pure functions: state machines, eligibility, waterfall, reconciliation, idempotency ledger, dispute judges, fraud ladder, options compare, wording library, audit chain, input validation |
| `js/scenario.js` | Synthetic scenario from the brief + 18 planted conflicts + seeded heavy returners + threat model |
| `js/tests.js` | Evaluation harness: 56 scripted cases + 3 success metrics |
| `js/app.js` | Landing page, sign-in, customer app (home, tracking, returns, exchange, checkout, shipping, reviews), chat assistant, judge console |
| `js/api.js` | Tiny Supabase REST client (auth, saved state, reviews, chat log) with automatic on-device fallback |
| `js/i18n.js` | 8 languages: English, Hindi, Telugu, Tamil, Kannada, Malayalam, Marathi, Bengali |
| `js/sha256.js` | SHA-256 for the hash-chained audit log |

## Results (run `node tests/run.js` or Judge console → Run all tests)
- 56/56 scripted cases pass
- M1 Refund allocation correctness: 10/10 generated mixed-instrument orders + 8/8 hand-checked
- M2 Status mismatches classified (waiting / stuck / unknown / done): 10/10
- M3 Fraud false-positive rate on genuine heavy returners: 1/8 = 13% (naive volume rule: 7/8 = 88%); abusers still caught 4/4

## Key design rules
- Logistics and money are **separate state machines**; illegal and out-of-order transitions are rejected.
- Money is integer paise; splits use largest-remainder so totals are exact.
- Voucher portion refunds as a voucher, extended to at least 30 days of validity.
- Never says money "reached" you before the provider confirms (`CREDITED_CONFIRMED`); enforced by test T-WORD-2.
- One idempotency key per return:item:instrument; retries can never pay twice.
- No OTP/PIN is ever requested.

See `DATA_CARD.md` and `THREAT_MODEL.md`. Deliberately left out: real APIs, voice input, full translation of judge console.

## AI use
Built with help from Claude (AI assistant), as the rules allow. The team reviewed, tested and can explain every part.

## Backend
Supabase (Mumbai region): email/password accounts, per-user saved return state, reviews and chat log. Every table has Row Level Security so users only see their own rows. If the backend is unreachable the app falls back to an on-device account so the demo never stops.
