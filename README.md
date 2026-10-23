# Pickup Counter

A snack pickup counter: customers reserve stock for 120 seconds, a simulated payment provider captures via a signed webhook, and a locker claims the paid order exactly once.

## Architecture

- **Frontend:** React + Vite customer screen (`frontend/`), served on port `5173`.
- **Backend:** Node.js, Express, TypeScript (`backend/`), API on port `3000`.
- **Database:** PostgreSQL 16. Money is stored and calculated as integer paise only.

```
Browser -> Vite/nginx (5173) -> API (3000) -> PostgreSQL
Developer script -> POST /payments/webhook (HMAC-SHA256)
```

<div align="center">

## 📸 Application Screenshots

<img src="Preview.png" width="32%" alt="Customer Interface" />
<img src="Preview2.png" width="32%" alt="Payment Flow" />
<img src="Preview3.png" width="32%" alt="Pickup and Order Status" />

</div>

## Prerequisites

- Docker and Docker Compose, **or**
- Node.js 20+ and a reachable PostgreSQL instance

## Environment

Copy `.env.example` to `.env` if you run services on the host. Docker Compose uses the same defaults.

| Variable | Purpose | Development default |
| --- | --- | --- |
| `DATABASE_URL` | API and migrations | `postgres://pickup:pickup@localhost:5434/pickup_counter` |
| `TEST_DATABASE_URL` | Integration tests | `postgres://pickup:pickup@localhost:5434/pickup_counter_test` |
| `WEBHOOK_SECRET` | HMAC-SHA256 shared secret | `dev-webhook-secret-change-me` |
| `HOLD_SECONDS` | Unpaid reservation length | `120` |
| `PORT` | API port | `3000` |
| `VITE_API_URL` | Browser-facing API origin | `http://localhost:3000` |

Do not put production secrets in the repository.

## One-command startup

Start all services with Docker:

```bash
docker compose up --build
```
*(or run `npm start`)*

Or run locally in development mode (with PostgreSQL running on port 5434):

```bash
npm run dev
```

Both Docker startup and `npm run dev` print the active URLs right in your terminal:

```
===================================================================
  🚀 Pickup Counter System is Running!
  -----------------------------------------------------------------
  🌐 Customer Frontend : http://localhost:5173
  🔌 Backend API       : http://localhost:3000
  ❤️  Health Check      : http://localhost:3000/health
===================================================================
```

| Service | URL |
| --- | --- |
| Customer UI | http://localhost:5173 |
| API | http://localhost:3000 |
| Health | http://localhost:3000/health |
| PostgreSQL | localhost:5434 (`pickup_counter`) — host port 5434 avoids clashing with a local Postgres on 5432 |
| Test database | localhost:5434 (`pickup_counter_test`) |

Development database data is stored in the `pgdata` volume.

## Migrations and seed

On API container start:

1. `node dist/migrate.js` applies `backend/sql/001_init.sql` (idempotent `CREATE IF NOT EXISTS`).
2. `node dist/seed.js` inserts five products with stable UUIDs (`ON CONFLICT (id) DO NOTHING` so later restarts do not reset stock).

Host equivalent after `docker compose up -d postgres`:

```bash
cd backend
npm install
set DATABASE_URL=postgres://pickup:pickup@localhost:5434/pickup_counter
npm run migrate
npm run seed
npm run dev
```

On PowerShell use `$env:DATABASE_URL="postgres://pickup:pickup@localhost:5434/pickup_counter"`.

## Inventory model

`products.stock_units` is **physical on-hand stock**: units that have not been picked up.

`availableUnits` = physical stock minus units on:

- `pending_payment` orders whose `hold_expires_at` is still in the future, and
- `paid` orders waiting for pickup

Expired, `needs_review`, and `picked_up` orders do not occupy availability. Availability is computed in SQL against `now()`, so expired holds stop reducing stock even if no background job has marked the row `expired`. GET `/orders/:id` persists that expiry when the order is read.

Pickup is the only path that decrements `stock_units`. Paid orders keep occupying availability until that decrement, so the same units cannot be sold twice. A retry after a successful claim cannot deduct again because the order is already `picked_up`.

## API

Errors use:

```json
{ "error": { "code": "INSUFFICIENT_STOCK", "message": "Not enough units available for one or more products." } }
```

### `GET /health`

```json
{ "status": "ok" }
```

### `GET /products`

```json
{
  "products": [
    {
      "id": "11111111-1111-4111-8111-111111111111",
      "name": "Samosa",
      "pricePaise": 2500,
      "stockUnits": 20,
      "availableUnits": 18
    }
  ]
}
```

### `POST /orders`

```json
{ "items": [{ "productId": "11111111-1111-4111-8111-111111111111", "quantity": 2 }] }
```

`201`:

```json
{
  "order": {
    "id": "…",
    "status": "pending_payment",
    "totalPaise": 5000,
    "holdExpiresAt": "2026-10-23T09:01:00.000Z",
    "expiresInSeconds": 119,
    "reviewReason": null,
    "items": [
      {
        "productId": "11111111-1111-4111-8111-111111111111",
        "name": "Samosa",
        "unitPricePaise": 2500,
        "quantity": 2,
        "lineTotalPaise": 5000
      }
    ]
  }
}
```

`expiresInSeconds` is computed from the database clock at response time. Duplicate product lines, empty carts, invalid quantities, and unknown products return `400`. Insufficient stock returns `409` and the transaction is fully rolled back.

### `GET /orders/:id`

Returns the same `order` object. Pending holds that have elapsed are transitioned to `expired`.

### `POST /payments/webhook`

Header `X-Signature`: hex HMAC-SHA256 of the **raw body bytes** using `WEBHOOK_SECRET`. Comparison is timing-safe. Missing/invalid signatures return `401`.

```json
{
  "eventId": "evt_123",
  "orderId": "…",
  "amountPaise": 5000,
  "status": "captured"
}
```

`eventId` is unique. Replays return `200` with `"duplicate": true` and do not change state again.

Non-`captured` statuses (for example `failed`) are recorded and leave the order unchanged.

### `POST /orders/:id/pickup-claim`

Succeeds only for `paid` orders. Concurrent or later claims return `409`. On success, physical stock is reduced once and the order becomes `picked_up`.

## Signed test webhook

From the repository root, with the API running:

```bash
npm install --prefix backend
npm run send-webhook -- <orderId>
```

Optional arguments: `[amountPaise] [status] [eventId]`. If `amountPaise` is omitted, the script calls `GET /orders/:id` and uses `totalPaise`. Pass the same `eventId` twice to exercise idempotency. The shared secret is never printed.

Example:

```bash
npm run send-webhook -- 11111111-1111-4111-8111-111111111111
npm run send-webhook -- 11111111-1111-4111-8111-111111111111 5000 captured evt_replay
```

## Integration tests (real PostgreSQL)

```bash
docker compose up -d postgres
cd backend
npm install
npm test
```

Or:

```bash
docker compose --profile test run --rm api-test
```

Tests talk to PostgreSQL; they do not mock the database. The suite includes the three required cases:

- **A** — ten concurrent orders for two units
- **B** — duplicate (including concurrent) webhook `eventId`
- **C** — two simultaneous pickup claims

plus signature, amount mismatch, expiry, late payment, unknown products, invalid quantities, and multi-item rollback.

## Concurrency and idempotency

- **Reservations:** `SELECT … FROM products … ORDER BY id FOR UPDATE`, then availability = physical stock minus active unpaid holds and paid-not-picked-up quantities, all inside one transaction.
- **Expiry:** SQL availability uses `hold_expires_at > now()`; order reads persist `expired`.
- **Webhooks:** transaction-scoped advisory lock on `eventId`, uniqueness on `processed_webhook_events.event_id`, raw-body HMAC.
- **Pickup:** `SELECT … FOR UPDATE` on the order (and product rows), conditional status update to `picked_up`, stock decrement in the same transaction.

## Late-payment policy

A valid `captured` webhook whose amount matches, but whose reservation has already expired (status `expired`, or `pending_payment` with `hold_expires_at <= now()`), is stored and the order moves to **`needs_review`** with `reviewReason: "late_payment"`.

Stock is not taken from later customers and cannot go negative through this path. The order is not fulfillable until an operator refunds or resolves it by hand. Duplicate deliveries of the same `eventId` cannot repeat that transition.

Amount mismatches on a still-open or expired order also go to `needs_review` (`amount_mismatch`) and never `paid`.

## Assumptions and trade-offs

- Duplicate product lines in `POST /orders` are rejected rather than merged.
- Paid orders occupy availability until pickup so payment cannot be followed by overselling. That is a conservative extension of “subtract active unpaid holds”.
- There is no background expiry worker; reads and availability queries are enough for correctness.
- The webhook sender is the payment provider. There is no UPI or card UI.
- Catalog prices at order time are snapshotted onto `order_items`.

## Unfinished

Nothing required by the assignment prompt is intentionally left unimplemented.

## With more time

- Operator UI for `needs_review` refunds
- Structured logging and metrics for lock wait time
- Product admin and stock adjustments
- OpenAPI document generated from the handlers

## How the hard requirements were verified

See the final status in the submission notes after tests were executed in this workspace. Do not assume green tests without that report.

## Customer UI notes

The countdown uses `expiresInSeconds` from the API plus `performance.now()` elapsed since that response. It does not compare `holdExpiresAt` to the browser wall clock. Polling of `GET /orders/:id` stops on `paid`, `expired`, or `needs_review`, and on unmount.
