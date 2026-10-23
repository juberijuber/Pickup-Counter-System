# AI Coding Prompt — Pickup Counter Assignment

## Your Role

Act as a senior full-stack engineer and pragmatic technical lead. Build a complete, runnable solution for the **Pickup Counter** assignment described below. Prioritize correctness under concurrency, database-backed tests, security, and clear documentation over visual polish.

Do not stop after generating a plan or scaffolding. Inspect the project, implement the solution, run it, run the tests, fix failures, and update the documentation. If you cannot execute a command in the current environment, state that clearly and provide the exact command I should run.

## 1. Required Technology

Use TypeScript throughout the application.

- **Backend:** Node.js with NestJS or Express. Choose one framework and use it consistently.
- **Database:** PostgreSQL.
- **Frontend:** React with Vite.
- **Local startup:** The application and database must start with one command, preferably `docker compose up --build`.
- **Tests:** Automated integration tests must run against a real PostgreSQL database. Do not mock the database for the three required concurrency/idempotency tests.
- **Code quality:** Use clear modules, strict TypeScript where practical, validation, centralized error handling, environment-based configuration, and readable naming.
- **Money:** Store and calculate all prices and totals as integer paise. Never use floating-point rupees for money calculations.

Before coding, briefly inspect the repository and identify existing conventions. If it is empty, create a sensible structure. Avoid unnecessary complexity and extra services.

## 2. Expected Deliverables

Deliver a complete project containing at least:

- Backend source code and database schema/migrations.
- React customer interface.
- Product seed data for approximately five snack products.
- Dockerfile(s) and `docker-compose.yml`.
- `.env.example` with documented configuration variables and safe development defaults.
- Automated tests using a real PostgreSQL test database.
- A correctly signed webhook sender script runnable as `npm run send-webhook -- <orderId> [amountPaise] [status]`.
- `README.md` with setup, test commands, assumptions, design decisions, late-payment policy, and known limitations.
- `AI_NOTES.md` with the AI usage disclosure requested below.
- No real payment provider integration is needed; the webhook sender simulates the provider.
- Do not commit actual secrets, `.env` files containing secrets, build output, or `node_modules`.

Keep the repository public or otherwise provide a submission method that does not require reviewers to access a private repository.

## 3. Domain Model and State Transitions

Design a PostgreSQL schema for products, orders, order items, and processed webhook events. You may add tables or columns when justified.

Suggested order states:

- `pending_payment`
- `paid`
- `expired`
- `needs_review`
- `picked_up`
- Optionally, a clearly documented state for late payments requiring manual refund/review.

Define and enforce valid state transitions. An order must not be picked up before payment, after expiry, or more than once. Store timestamps in PostgreSQL using an appropriate timezone-aware type and use the server/database as the source of truth.

An order should preserve a snapshot of each item's name and unit price at purchase time, so later catalog changes do not alter the order total or receipt.

## 4. Catalog and Inventory

Seed about five products. Each product has an ID, name, unit price in paise, and physical stock quantity.

Implement:

### `GET /products`

Return each product with:

- `id`
- `name`
- `pricePaise`
- `stockUnits` (physical stock, if useful)
- `availableUnits`

`availableUnits` must equal physical stock minus units reserved by active unpaid orders. An active reservation is one whose order is still `pending_payment` and whose hold has not expired. Expired orders must not continue to reduce available stock, even if no background cleanup has run yet.

Use integer types for all money fields and validate quantities as positive integers.

## 5. Creating Orders and Reserving Stock

Implement:

### `POST /orders`

Request body:

```json
{
  "items": [
    { "productId": "product-id", "quantity": 2 }
  ]
}
```

Requirements:

1. Validate the request and reject empty carts, invalid quantities, unknown products, and duplicate product lines (either reject duplicates clearly or normalize them safely).
2. Calculate the order total in integer paise using the current product prices.
3. Reserve stock for **120 seconds** from order creation.
4. Prevent overselling under concurrent requests. Use PostgreSQL transactions and appropriate row locks or an equally robust atomic reservation strategy. Do not rely on a frontend check or a read-then-write sequence without locking.
5. If any requested item is unavailable, roll back the entire transaction. Do not partially reserve stock.
6. Create the order and its items atomically.
7. Return the order, total in paise, status, and `expiresInSeconds`, calculated on the server as close as possible to response time. It must represent the remaining time on the hold, not always return a hard-coded 120.
8. Ensure simultaneous requests cannot reserve the same physical units.

Also implement an order-status endpoint such as `GET /orders/:id` that returns the current state and the server-derived expiry information needed by the UI. When checking status, transition a pending order to `expired` if its hold has elapsed, or use another robust approach that guarantees expired holds no longer count against available stock.

## 6. Payment Webhook Security and Idempotency

Implement:

### `POST /payments/webhook`

Example JSON:

```json
{
  "eventId": "evt_123",
  "orderId": "order-id",
  "amountPaise": 4500,
  "status": "captured"
}
```

The request must include `X-Signature`, containing the hexadecimal HMAC-SHA256 signature of the **exact raw HTTP request body bytes**, using a shared secret from an environment variable.

Requirements:

1. Verify the signature using a timing-safe comparison. Reject missing or invalid signatures.
2. Preserve access to the exact raw request body. Do not parse and re-serialize JSON before calculating the signature.
3. Validate the payload and supported event status.
4. Make processing idempotent using a PostgreSQL uniqueness constraint on `eventId` (or a suitably scoped provider event ID) and a transaction. Replaying the same event must not change order state, inventory, or other side effects.
5. Handle concurrent duplicate deliveries safely. Application-level “check then insert” logic alone is insufficient.
6. If `amountPaise` does not equal the stored order total, mark the order `needs_review`; do not mark it paid.
7. A valid captured payment for an unexpired `pending_payment` order should mark it `paid` atomically.
8. Do not let a repeated or out-of-order event revert a terminal order state.
9. Return appropriate HTTP status codes and safe, useful error messages without exposing secrets.
10. Document how non-captured statuses are handled.

### Late-payment policy — choose and document one

Choose a clear, defensible policy for a valid capture received after the reservation expired and the stock may have been sold to someone else. A recommended policy is:

- Never silently take stock away from another customer or allow stock to go negative.
- Do not automatically mark the order as fulfillable if its reservation expired.
- Record the event and move the order to a documented state such as `needs_review` / `late_payment_review`.
- Explain that an operator must arrange a refund or manual resolution.

If you choose a different policy, implement it transactionally and explain why in `README.md`. Ensure duplicate webhooks cannot trigger repeated refunds or other repeated side effects.

## 7. Webhook Sender Script

Create a developer script, for example:

```bash
npm run send-webhook -- <orderId> [amountPaise] [status]
```

The script should:

- Build the JSON payload.
- Sign the exact bytes sent using the same configured development secret.
- Send the request to the local webhook endpoint.
- Print the HTTP status and response body.
- Use the order total if `amountPaise` is omitted, if this can be done safely through the API; otherwise require the amount and document it.
- Make it easy to resend the same `eventId` to test idempotency, or support an explicit event ID argument.
- Never print the shared secret.

Document an example command in `README.md`.

## 8. Pickup Claim and Inventory Finalization

Implement:

### `POST /orders/:id/pickup-claim`

Two lockers may call this endpoint for the same order simultaneously. **Exactly one request must succeed**; all competing or subsequent claims must receive `409 Conflict`.

Requirements:

1. Only a paid order may be claimed.
2. Pending, expired, `needs_review`, already-picked-up, and unknown orders must be handled correctly.
3. Use a PostgreSQL transaction and row lock, conditional update, or another atomic database-level mechanism to guarantee one winner.
4. On successful pickup, reduce physical product stock permanently by the ordered quantities and transition the order to `picked_up` atomically.
5. Ensure stock is deducted exactly once. A retry after a successful claim must not deduct it again.
6. Define how stock reservations interact with physical stock so the same units are not deducted twice or counted as available incorrectly.
7. Ensure a failed pickup transaction changes nothing.

**Important inventory design requirement:** Explain clearly whether physical stock represents on-hand stock before or after pickup, and how reservations and pickup deductions are calculated. Avoid double-counting reservations or temporarily allowing stock to become negative. Use a consistent model throughout catalog reads, order creation, webhook handling, and pickup.

## 9. Customer Screen (React + Vite)

Build a simple, functional customer interface.

It should:

- Fetch and display products and available units.
- Allow the customer to add/remove items and change quantities.
- Prevent obvious invalid cart selections in the UI while still relying on the backend as the authority.
- Show item prices and the total clearly, displaying rupees for people but keeping API/database amounts in integer paise. Convert for display only.
- Submit the cart to `POST /orders`.
- Show an order/payment screen after order creation.
- Display a countdown based on **server time/expiry**, not the customer's local clock.
- Poll the order-status endpoint until the order becomes `paid`, `expired`, or `needs_review`, then show the correct message.
- Avoid client-clock drift. Prefer returning a server-derived `expiresInSeconds` or absolute expiry timestamp and calculating a monotonic client countdown from the server response; do not repeatedly compare the expiry timestamp directly to the local wall clock.
- Stop polling and clean up timers when the component unmounts or the order reaches a terminal state.
- Handle loading states, API errors, stock changes, and expired orders gracefully.
- Provide a clear way to start a new order.

Keep styling simple and responsive. No payment gateway UI or real UPI integration is required; the simulated webhook changes the payment status.

## 10. Real PostgreSQL Integration Tests

Write automated integration tests that run against a real PostgreSQL database, not mocks. Make them repeatable and isolated from development data. Use a dedicated test database and clean/reset test data safely.

The following three tests are mandatory:

### Test A: Ten concurrent customers, last two units

- Create a product with exactly two units available.
- Launch ten order requests concurrently, each requesting one unit.
- Assert exactly two orders succeed and eight fail cleanly for insufficient stock.
- Assert total active reserved quantity never exceeds two.
- Assert available stock never becomes negative.
- Ensure a failed multi-item order does not leave partial reservations.

Use actual concurrent requests or concurrent service calls backed by independent database transactions/connections.

### Test B: Duplicate webhook event

- Create an order and deliver a correctly signed capture webhook.
- Send the exact same event again, including the same `eventId`.
- Assert the event is processed only once and the order remains in the correct state.
- Assert inventory and other side effects are not duplicated.

### Test C: Two simultaneous pickup claims

- Create an order, make it paid through the normal webhook flow, then submit two pickup claims concurrently.
- Assert exactly one request succeeds and the other returns `409 Conflict`.
- Assert stock is deducted exactly once and the final order state is `picked_up`.

Also add useful tests for invalid signatures, amount mismatch, expired holds, late payment, unknown products, invalid quantities, and rollback on insufficient multi-item stock where practical.

Do not weaken or skip a required test simply to make the suite pass. If a test fails, diagnose and fix the underlying implementation.

## 11. Docker and One-Command Startup

Provide a `docker-compose.yml` that starts the database, backend, and frontend with one documented command, ideally:

```bash
docker compose up --build
```

Requirements:

- Use health checks and wait for PostgreSQL readiness before migrations/seeding or backend startup.
- Apply schema migrations and seed products predictably.
- Keep secrets configurable via environment variables and provide `.env.example`.
- Do not bake real secrets into images.
- Configure the frontend API URL correctly for browser access.
- Include persistent database storage for normal development.
- Document ports and URLs.
- Include a separate test command that uses a dedicated test database or a clearly isolated test service.
- Ensure a fresh clone can be started by following only the README instructions.

## 12. Suggested API Contract

You may refine the contract, but document the final version.

- `GET /health`
- `GET /products`
- `POST /orders`
- `GET /orders/:id`
- `POST /payments/webhook`
- `POST /orders/:id/pickup-claim`

Use appropriate status codes, including `400` for malformed input, `401` or `403` for an invalid webhook signature as appropriate, `404` for unknown resources, `409` for stock conflicts or an invalid pickup claim, and `5xx` for unexpected server errors.

Use a consistent JSON error shape, for example:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Not enough units available for one or more products."
  }
}
```

Do not leak stack traces, database credentials, or secrets in API responses.

## 13. README.md Requirements

Write a concise but complete README containing:

1. Project overview and architecture.
2. Prerequisites.
3. Environment setup and `.env.example` explanation.
4. One-command startup and URLs.
5. Database migration and seed behavior.
6. API endpoints with request/response examples.
7. How to send a signed test webhook.
8. How to run integration tests against real PostgreSQL.
9. The concurrency and idempotency guarantees, including the database mechanisms used.
10. The chosen late-payment policy and rationale.
11. Assumptions and trade-offs.
12. What remains unfinished, if anything.
13. What you would improve with more time.
14. A brief explanation of how you verified the hard requirements.

Never claim tests passed unless you actually ran them and observed a successful result.

## 14. AI_NOTES.md Requirements

Create `AI_NOTES.md` of roughly half a page. Keep it honest and specific. Include:

- AI tools used (for example, ChatGPT, Claude Code, Cursor, or Copilot) and what each helped with.
- One actual prompt that worked well.
- At least one specific incorrect suggestion, bug, or weak implementation generated by AI.
- How you detected it (test, code review, documentation, manual reproduction, or another check).
- How you corrected it.

Do not invent tool usage or claim an AI error occurred if it did not. Leave clear placeholders for me to fill in any details that cannot be known from the repository or actual work session. I must review this note and make it truthful before submission.

## 15. Implementation Workflow

Work in this order:

1. Inspect the repository and summarize the planned architecture and important assumptions.
2. Implement the PostgreSQL schema/migrations and inventory model first.
3. Implement transactional order creation and hold expiry.
4. Implement raw-body webhook signature verification, idempotency, amount validation, and late-payment handling.
5. Implement atomic pickup claims and one-time stock deduction.
6. Write and run the three mandatory real-PostgreSQL concurrency/idempotency tests.
7. Add additional backend edge-case tests.
8. Implement the React customer screen and server-based countdown.
9. Add Docker Compose, health checks, seeding, and webhook sender script.
10. Write `README.md` and a truthful `AI_NOTES.md`.
11. Run formatting, linting, type checking, tests, and a production build where supported.
12. Fix issues and provide a final status report.

After each major stage, report files changed and checks run. Do not stop to ask me about minor choices: make a sensible assumption, document it, and continue. Ask only if a genuine blocker prevents progress.

## 16. Final Acceptance Checklist

Before declaring the project complete, verify each item:

- [ ] Entire application uses TypeScript.
- [ ] Prices and totals are integer paise.
- [ ] Product availability excludes only active, unexpired reservations.
- [ ] Concurrent order creation cannot oversell stock.
- [ ] Failed multi-item orders roll back completely.
- [ ] Hold duration is 120 seconds and remaining seconds are server-derived.
- [ ] Expired orders release reservations even without a cleanup job.
- [ ] Webhook verifies HMAC-SHA256 against exact raw body bytes.
- [ ] Signature comparison is timing-safe.
- [ ] Duplicate webhook events are idempotent under concurrent delivery.
- [ ] Amount mismatch never marks an order paid.
- [ ] Late-payment behavior is implemented and documented.
- [ ] Pickup claims are atomic; exactly one simultaneous claim succeeds.
- [ ] Stock is deducted once and only once at successful pickup.
- [ ] UI countdown is not dependent on the customer's wall clock.
- [ ] UI polls and stops at the required terminal states.
- [ ] Three mandatory tests use real PostgreSQL and pass.
- [ ] Invalid signature, amount mismatch, expiry, and rollback cases are tested where practical.
- [ ] One-command startup works from a fresh clone.
- [ ] Webhook sender script sends a correctly signed request.
- [ ] README and AI_NOTES.md are complete and truthful.
- [ ] No secrets or private repository links are included in the submission.

## Final Response Format

When implementation is finished, provide:

1. A brief summary of what was built.
2. The main architecture and key concurrency decisions.
3. Exact startup and test commands.
4. The test results, distinguishing tests actually run from tests not run.
5. Any unfinished requirements or assumptions.
6. A short list of files I should review carefully before submitting.

Do not say “complete” merely because code was generated. Completion means the implementation was checked against the acceptance checklist and the verification status is reported honestly.
