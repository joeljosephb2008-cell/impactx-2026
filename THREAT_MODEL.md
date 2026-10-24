# Threat model

The most serious abuse and privacy risks, with the mitigation that is actually implemented and the test that proves it.

| # | Risk | Mitigation built in | Tested by |
|---|---|---|---|
| 1 | Double refund (gateway retry, double tap, replayed request) | Idempotency key per return:item:instrument; duplicates return the original refund and are logged. | T-IDEM-1/2 |
| 2 | Return fraud: used / swapped items, wardrobing | Friction ladder from explainable signals; inspection evidence at handover; human appeal. | T-FRAUD-* |
| 3 | Unfair penalty on genuine heavy returners | Fairness check (size/fit share, pass rate, keep rate) lowers friction; false-positive rate measured. | Metric M3 |
| 4 | Courier falsely marks “customer unreachable” | GPS distance + call-connect evidence; failed attempts never counted against customer without proof. | T-PICK-1/2 |
| 5 | Refund scams (fake agents asking OTP/PIN) and PII leaks | No OTP/PIN anywhere; masked phone and address; notifications from approved wording only, no amounts-on-lock-screen option. | T-WORD-* |
| 6 | Rewriting history to deny a claim | Append-only SHA-256 hash-chained audit log; any edit breaks verification. | T-AUDIT-1/2 |
