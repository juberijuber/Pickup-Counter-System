import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import request from "supertest";
import {
  app,
  availableUnits,
  ensureMigrated,
  insertProduct,
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

test("rejects unknown products, invalid quantities, empty carts, and duplicate lines", async () => {
  const product = await insertProduct({ stockUnits: 5 });
  const empty = await request(app).post("/orders").send({ items: [] });
  expect(empty.status).toBe(400);

  const qty = await request(app)
    .post("/orders")
    .send({ items: [{ productId: product.id, quantity: 0 }] });
  expect(qty.status).toBe(400);

  const unknown = await request(app)
    .post("/orders")
    .send({ items: [{ productId: "99999999-9999-4999-8999-999999999999", quantity: 1 }] });
  expect(unknown.status).toBe(400);
  expect(unknown.body.error.code).toBe("UNKNOWN_PRODUCT");

  const dup = await request(app)
    .post("/orders")
    .send({
      items: [
        { productId: product.id, quantity: 1 },
        { productId: product.id, quantity: 1 },
      ],
    });
  expect(dup.status).toBe(400);
  expect(dup.body.error.code).toBe("DUPLICATE_PRODUCT_LINE");
});

test("invalid webhook signatures are rejected", async () => {
  const product = await insertProduct({ stockUnits: 2 });
  const created = await request(app)
    .post("/orders")
    .send({ items: [{ productId: product.id, quantity: 1 }] });
  const payload = {
    eventId: "evt_bad_sig",
    orderId: created.body.order.id,
    amountPaise: created.body.order.totalPaise,
    status: "captured",
  };
  const missing = await request(app).post("/payments/webhook").send(payload);
  expect(missing.status).toBe(401);

  const bad = await postWebhook(payload, "00".repeat(32));
  expect(bad.status).toBe(401);

  const status = await request(app).get(`/orders/${created.body.order.id}`);
  expect(status.body.order.status).toBe("pending_payment");
});

test("amount mismatch marks the order needs_review and never paid", async () => {
  const product = await insertProduct({ stockUnits: 2 });
  const created = await request(app)
    .post("/orders")
    .send({ items: [{ productId: product.id, quantity: 1 }] });
  const order = created.body.order;
  const response = await postWebhook({
    eventId: "evt_mismatch",
    orderId: order.id,
    amountPaise: order.totalPaise + 1,
    status: "captured",
  });
  expect(response.status).toBe(200);
  expect(response.body.order.status).toBe("needs_review");
  expect(response.body.order.reviewReason).toBe("amount_mismatch");
  expect(await availableUnits(product.id)).toBe(2);
});

test("expired holds release reservations even without a cleanup job", async () => {
  const product = await insertProduct({ stockUnits: 1 });
  const created = await request(app)
    .post("/orders")
    .send({ items: [{ productId: product.id, quantity: 1 }] });
  expect(await availableUnits(product.id)).toBe(0);

  await pool.query(`UPDATE orders SET hold_expires_at = now() - interval '1 second' WHERE id = $1`, [
    created.body.order.id,
  ]);

  expect(await availableUnits(product.id)).toBe(1);

  const status = await request(app).get(`/orders/${created.body.order.id}`);
  expect(status.body.order.status).toBe("expired");
  expect(status.body.order.expiresInSeconds).toBe(0);
});

test("late captured payment after expiry goes to needs_review without taking stock", async () => {
  const product = await insertProduct({ stockUnits: 1 });
  const first = await request(app)
    .post("/orders")
    .send({ items: [{ productId: product.id, quantity: 1 }] });
  await pool.query(`UPDATE orders SET hold_expires_at = now() - interval '1 second' WHERE id = $1`, [
    first.body.order.id,
  ]);
  expect(await availableUnits(product.id)).toBe(1);

  const second = await request(app)
    .post("/orders")
    .send({ items: [{ productId: product.id, quantity: 1 }] });
  expect(second.status).toBe(201);

  const late = await postWebhook({
    eventId: "evt_late",
    orderId: first.body.order.id,
    amountPaise: first.body.order.totalPaise,
    status: "captured",
  });
  expect(late.body.order.status).toBe("needs_review");
  expect(late.body.order.reviewReason).toBe("late_payment");
  expect(await availableUnits(product.id)).toBe(0);

  const claim = await request(app).post(`/orders/${first.body.order.id}/pickup-claim`);
  expect(claim.status).toBe(409);
});

test("non-captured webhook statuses are stored without paying the order", async () => {
  const product = await insertProduct({ stockUnits: 1 });
  const created = await request(app)
    .post("/orders")
    .send({ items: [{ productId: product.id, quantity: 1 }] });
  const response = await postWebhook({
    eventId: "evt_failed",
    orderId: created.body.order.id,
    amountPaise: created.body.order.totalPaise,
    status: "failed",
  });
  expect(response.status).toBe(200);
  expect(response.body.order.status).toBe("pending_payment");
});

test("server-derived remaining hold seconds is not a hard-coded 120 after time passes", async () => {
  const product = await insertProduct({ stockUnits: 1 });
  const created = await request(app)
    .post("/orders")
    .send({ items: [{ productId: product.id, quantity: 1 }] });
  expect(created.body.order.expiresInSeconds).toBeGreaterThan(0);
  expect(created.body.order.expiresInSeconds).toBeLessThanOrEqual(120);

  await pool.query(`UPDATE orders SET hold_expires_at = now() + interval '40 seconds' WHERE id = $1`, [
    created.body.order.id,
  ]);
  const status = await request(app).get(`/orders/${created.body.order.id}`);
  expect(status.body.order.expiresInSeconds).toBeGreaterThan(0);
  expect(status.body.order.expiresInSeconds).toBeLessThanOrEqual(40);
});
