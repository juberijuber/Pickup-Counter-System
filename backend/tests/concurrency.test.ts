import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import request from "supertest";
import {
  app,
  availableUnits,
  createPaidOrder,
  ensureMigrated,
  insertProduct,
  physicalStock,
  pool,
  postWebhook,
  resetDb,
} from "./helpers.js";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await pool.end();
});

test("Test A: ten concurrent customers compete for the last two units", async () => {
  const product = await insertProduct({ name: "Last Two Samosas", pricePaise: 2500, stockUnits: 2 });
  const second = await insertProduct({ name: "Companion Snack", pricePaise: 1000, stockUnits: 1 });

  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      request(app)
        .post("/orders")
        .send({ items: [{ productId: product.id, quantity: 1 }] }),
    ),
  );

  const successes = responses.filter((res) => res.status === 201);
  const failures = responses.filter((res) => res.status !== 201);

  expect(successes).toHaveLength(2);
  expect(failures).toHaveLength(8);
  for (const failure of failures) {
    expect(failure.status).toBe(409);
    expect(failure.body.error.code).toBe("INSUFFICIENT_STOCK");
  }

  const reserved = await pool.query<{ qty: string }>(
    `SELECT COALESCE(SUM(oi.quantity), 0) AS qty
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.product_id = $1
       AND o.status = 'pending_payment'
       AND o.hold_expires_at > now()`,
    [product.id],
  );
  expect(Number(reserved.rows[0].qty)).toBe(2);
  expect(await availableUnits(product.id)).toBe(0);
  expect(await availableUnits(product.id)).toBeGreaterThanOrEqual(0);

  const mixed = await request(app)
    .post("/orders")
    .send({
      items: [
        { productId: product.id, quantity: 1 },
        { productId: second.id, quantity: 1 },
      ],
    });
  expect(mixed.status).toBe(409);
  expect(await availableUnits(second.id)).toBe(1);
  const secondOrders = await pool.query(`SELECT count(*)::int AS n FROM order_items WHERE product_id = $1`, [
    second.id,
  ]);
  expect(secondOrders.rows[0].n).toBe(0);
});

test("Test B: duplicate webhook event is processed only once", async () => {
  const product = await insertProduct({ stockUnits: 3 });
  const created = await request(app)
    .post("/orders")
    .send({ items: [{ productId: product.id, quantity: 1 }] });
  expect(created.status).toBe(201);
  const order = created.body.order;
  const payload = {
    eventId: "evt_duplicate_same",
    orderId: order.id,
    amountPaise: order.totalPaise,
    status: "captured",
  };

  const first = await postWebhook(payload);
  expect(first.status).toBe(200);
  expect(first.body.duplicate).toBe(false);
  expect(first.body.order.status).toBe("paid");

  const concurrent = await Promise.all([postWebhook(payload), postWebhook(payload)]);
  for (const response of concurrent) {
    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe("paid");
  }
  expect(concurrent.some((response) => response.body.duplicate)).toBe(true);

  const events = await pool.query(`SELECT count(*)::int AS n FROM processed_webhook_events WHERE event_id = $1`, [
    payload.eventId,
  ]);
  expect(events.rows[0].n).toBe(1);
  expect(await physicalStock(product.id)).toBe(3);
  expect(await availableUnits(product.id)).toBe(2);
});

test("Test C: two simultaneous pickup claims yield one winner", async () => {
  const product = await insertProduct({ stockUnits: 4 });
  const order = await createPaidOrder(product.id, 2);

  const [a, b] = await Promise.all([
    request(app).post(`/orders/${order.id}/pickup-claim`),
    request(app).post(`/orders/${order.id}/pickup-claim`),
  ]);

  const statuses = [a.status, b.status].sort();
  expect(statuses).toEqual([200, 409]);
  const winner = a.status === 200 ? a : b;
  const loser = a.status === 409 ? a : b;
  expect(winner.body.order.status).toBe("picked_up");
  expect(loser.body.error.code).toMatch(/ALREADY_PICKED_UP|PICKUP_NOT_ALLOWED/);

  const stored = await pool.query(`SELECT status FROM orders WHERE id = $1`, [order.id]);
  expect(stored.rows[0].status).toBe("picked_up");
  expect(await physicalStock(product.id)).toBe(2);
  expect(await availableUnits(product.id)).toBe(2);

  const retry = await request(app).post(`/orders/${order.id}/pickup-claim`);
  expect(retry.status).toBe(409);
  expect(await physicalStock(product.id)).toBe(2);
});
