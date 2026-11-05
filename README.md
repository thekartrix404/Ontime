# OnTime

> Autonomous invoicing agent that prevents late payments before and after they happen.

OnTime pairs client risk intelligence with the **PayPal Invoicing API v2** and **Gemini AI** to proactively adapt contract terms, automate invoice generation, and execute follow-up cycles governed by hard mandate guardrails.

---

## The 7-Step Flow

1. **Unstructured Extraction**: The freelancer pastes an informal email, message, or project brief. Gemini extracts structured invoice details (client identity, currency, line items, and requested terms) validated strictly against Zod schemas.
2. **Rules-Based Risk Scoring**: The engine evaluates historical payment records in SQLite and scores the client from 0 to 100 with clear human-readable factors (late payment rate, average days late, total invoice volume).
3. **Terms Strategist**: Dynamic payment terms are recommended based on the calculated risk tier:
   - **Low Risk (0–29)**: Standard Net-14 terms.
   - **Medium Risk (30–69)**: Net-7 with an early-payment discount (e.g., 2% discount if paid within 5 days).
   - **High Risk (70–100)**: Milestone split requiring a 40% upfront deposit before work begins and 60% upon delivery.
4. **Interactive Approval Screen**: The user reviews the original terms side-by-side with the recommended terms, with full controls to Approve, Edit line items, or Send as-is.
5. **PayPal Invoicing Execution**: Approving terms immediately generates and sends PayPal Sandbox invoices. High-risk contracts automatically spawn linked invoices: an upfront 40% deposit invoice sent right away, and a 60% balance invoice retained in `DRAFT` status until delivery is marked.
6. **Due-Date-Relative Time-Travel**: Interactive controls allow simulated time jumps (-2 days before due, +5 days, +15 days, +30 days overdue) to test aging and prompt the follow-up agent loop.
7. **Autonomous Follow-Up Agent & Mandate Guard**: The agent determines the appropriate communication tone based on lateness. Before any tool runs, a hard mandate guard validates the action:
   - Friendly and nudge tones are auto-approved and delivered via PayPal's remind API.
   - Firm or formal escalations and fee proposals exceeding policy are **BLOCKED** and routed to the human approval queue.

---

## How PayPal Is Used

OnTime integrates directly with the **PayPal Invoicing API v2** in sandbox mode:

- **OAuth 2.0 Authentication**: Generates bearer tokens via `/v1/oauth2/token` using basic auth credentials with automated expiration tracking.
- **Invoice Creation & Dispatch**:
  - `POST /v2/invoicing/invoices` creates drafts with formatted line items, currencies, and due dates.
  - `POST /v2/invoicing/invoices/{id}/send` dispatches the invoice to the buyer and transitions status to `SENT`.
- **Payment Reminders**:
  - `POST /v2/invoicing/invoices/{id}/remind` triggers PayPal-delivered reminder emails with custom messages drafted by the agent.
- **Invoice Inspection & Reconciliation**:
  - `GET /v2/invoicing/invoices/{id}` fetches live invoice status and recipient details.
  - `POST /v2/invoicing/invoices/{id}/payments` records invoice payments to synchronize records.
- **High-Risk Invoice Linking**: Automatically creates and relates a deposit invoice (`SENT`) and a balance invoice (`DRAFT`) tied to a common project ID.

---

## How AI Is Used

OnTime uses Google Gemini via the official `@google/genai` SDK:

- **Model Configuration**: Defaults to `gemini-3.8-flash` (configurable via `GEMINI_MODEL` in `.env.local`).
- **Structured Extraction**: Converts natural language emails into verified invoice parameters with single-attempt retry and deterministic fallback.
- **Clear Explanations**: Generates plain-English summaries explaining why a specific risk score and payment term were assigned.
- **Follow-up Agent with Function Calling**: The follow-up agent runs an autonomous loop using official Gemini tool calling with thinking level `medium`.
  - Available tools: `get_open_invoices`, `send_reminder`, `draft_escalation`, and `propose_late_fee`.
  - The model selects tone based on days overdue (-2..0 friendly, 1..7 nudge, 8..20 firm, 21+ formal).
  - The model does not know mandate rules in advance—allowing firm actions to be attempted so the mandate guard's enforcement can be visualized.

---

## Trust & Safety Model

- **No AI Arithmetic**: The LLM is never permitted to perform arithmetic or invent numbers. All payment calculations, currency rounding, late fees, and score formulas are executed in deterministic TypeScript.
- **Code-Enforced Mandate Guard**: Runs in code before any agent tool executes. The agent cannot bypass rules defined in `src/lib/mandate.ts`.
- **Approval Queue for Risky Actions**: Firm or formal messages and late fees exceeding policy (max 5%) are blocked from auto-send and held for human review in `/dashboard`.
- **Plain-English Audit Log**: Every action, status change, guard block, and user override is recorded with human-readable summary text visible in `/audit`.
- **Demo Safety**: In sandbox mode, all outgoing PayPal invoices route recipient emails to a designated test buyer (`PAYPAL_TEST_CLIENT_EMAIL`) so real client addresses are never messaged.

---

## Real vs. Simulated Components

| Component | Behavior |
|---|---|
| **PayPal API** | **Real** sandbox calls when `PAYPAL_MODE=sandbox`; in-memory **mock** when `PAYPAL_MODE=mock`. |
| **Gemini AI** | **Real** Gemini API calls when `LLM_MODE=live`; canned responses when `LLM_MODE=mock`. |
| **Clock / Time** | **Simulated** clock stored in SQLite (`simulated_now`) enabling forward time-travel for aging invoices. |
| **Client Payment** | **Simulated** via the "Mark as paid" action or PayPal sandbox status sync. |
| **Automated Tests** | Run in complete offline **mock mode** (`LLM_MODE=mock`, `PAYPAL_MODE=mock`) with zero network dependencies. |
| **UI Header Badges** | Query `/api/status` dynamically to display current live/mock modes without exposing secrets. |

---

## Getting Started

### Prerequisites

- Node.js 18+ (tested on Node.js 20+)
- npm 9+

### Installation & Setup

1. **Clone the repository and install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment variables**:
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   Open `.env.local` and add your credentials:
   - `GEMINI_API_KEY`: Your Google Gemini API key.
   - `GEMINI_MODEL`: `gemini-3.8-flash` (or another Gemini model).
   - `PAYPAL_CLIENT_ID`: PayPal Sandbox App Client ID.
   - `PAYPAL_SECRET`: PayPal Sandbox App Secret.
   - `PAYPAL_TEST_CLIENT_EMAIL`: PayPal Sandbox Personal/Buyer account email.
   - `PAYPAL_MERCHANT_EMAIL`: PayPal Sandbox Business account email.
   - `PAYPAL_MODE`: `sandbox` (or `mock` for local development).
   - `LLM_MODE`: `live` (or `mock` to run without API tokens).

3. **Seed the SQLite database**:
   ```bash
   npm run seed
   ```

4. **Start the development server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

### Test Scripts

Verify the system components using the built-in test suites (all configured for deterministic mock execution):

```bash
npm run test:risk     # Risk scoring engine & rule verification
npm run test:llm      # Gemini extraction, caching, and fallback validation
npm run test:agent    # Agent tool-calling loop & mandate guard enforcement
npm run test:e2e      # Complete end-to-end flow & audit verification
```

### Production Build Note

When building on Windows, if Turbopack experiences path or linking issues, use webpack:
```bash
npx next build --webpack
```

---

## Limitations

- **Single User**: Designed for an individual freelancer or single-operator business; no multi-tenant authentication.
- **No Webhooks**: Uses synchronous API polling and direct user action reconciliation rather than public webhook listeners.
- **Currency**: Configured for USD (`USD`) transactions.
- **Rules-Based Risk**: Scoring is deterministic and rules-based by design to preserve auditability and prevent non-deterministic credit decisions.

---

## License

This project is licensed under the [MIT License](LICENSE).
