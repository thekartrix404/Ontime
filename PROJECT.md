# OnTime: invoicing agent that prevents late payments

Stack: Next.js (App Router, TypeScript), SQLite (better-sqlite3), zod, PayPal Sandbox Invoicing API, one LLM API.

Core flow (build ONLY this):
1. User pastes a client email -> LLM extracts invoice JSON (validated with zod).
2. Rules-based risk engine scores the client 0-100 with human-readable reasons.
3. Terms strategist (rules in code) proposes terms: low = Net-14, medium = Net-7 + 2% early-pay discount, high = 40% deposit / 60% on delivery.
4. Approval screen: original vs proposed terms, Approve / Edit / Send as-is.
5. Approve -> create + send a real PayPal sandbox invoice.
6. Time-travel buttons (+5/+15/+30 days) run an agent loop that picks follow-ups by tone.
7. Mandate config guards every agent action. Firm tones need human approval.
8. Plain-English audit log of every action.

Hard rules:
- The LLM NEVER does arithmetic. All money math is in code. PayPal amounts are strings like "1200.00".
- Secrets only from process.env. Never hard-code or log them. Never commit .env.local.
- PayPal calls go behind a PaymentProvider interface (SandboxPayPal + MockPayPal fallback).
- Verify PayPal endpoints and fields against the official docs before using them.
- No auth, no webhooks, no dashboards, no extra features.
- Keep the app runnable after every task.