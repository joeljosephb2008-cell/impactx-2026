# ReturnEase · IMPACTX 2026 (Problem 15: The Return That Shouldn't Be a Hassle)

A mobile-first prototype that makes returns and refunds clear: what you can return, exactly how much comes back, where the money goes, when it arrives, and what to do when it's late.

**Live demo:** https://impactx-2026-seven.vercel.app/

> Prototype with **sample data only**. No real orders, couriers, payments or government systems are connected.

## What it does
| Feature | Problem it solves |
|---|---|
| Multi-item return in one pickup, with per-item eligibility (window, hygiene items) | "Which of my items can I still return?" |
| Per-item refund breakdown with pro-rata coupon share | "Why is my refund less than the price?" |
| Split-payment refund (UPI + wallet, COD → UPI) with ETA per source | "Why did I get two refunds / where's the rest?" |
| Per-item tracker; overall status = worst item | Mixed outcomes in one return |
| Delay detection with ARN, bank script, escalation ladder (store → grievance officer → NCH 1915 → e-Daakhil) | "My refund is late and nobody answers" |
| QC-failure challenge using pickup vs warehouse photos | Unfair rejections |
| All SMS / email / app updates in one feed | Conflicting messages |
| English / Hindi / Telugu, text size, high contrast, low-data mode, read aloud | Accessibility and inclusion |
| Anti-scam notice, consent for address sharing, no OTP/PIN ever | Trust and privacy |

## Code map (plain HTML/CSS/JS, no build step)
- `index.html` – page shell, header, bottom tabs, settings dialog
- `js/data.js` – sample orders, payments, one in-progress return
- `js/logic.js` – business rules: eligibility, refund maths, refund split, ETA, delay status, escalation
- `js/i18n.js` – interface text in EN / HI / TE
- `js/app.js` – screens (home, return wizard, tracker, help) and click handling
- `css/styles.css` – design, high-contrast and dark mode

## Run locally
Open `index.html` in a browser. That's it.

## AI use
Built with help from Claude (AI assistant), which the IMPACTX rules allow. The team reviewed, tested and can explain every part.
