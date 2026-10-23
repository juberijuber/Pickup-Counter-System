import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { createPool } from "../src/db.js";
import { signRawBody } from "../src/hmac.js";
import { migrate } from "../src/migrate.js";

export const pool = createPool(config.databaseUrl);
export const app = createApp(pool);

let migrated = false;

export async function ensureMigrated() {
  if (migrated) {
    return;
  }
  await migrate(config.databaseUrl);
  migrated = true;
}

export async function resetDb() {
  await pool.query(
    "TRUNCATE processed_webhook_events, order_items, orders, products RESTART IDENTITY CASCADE",
  );
}

export async function insertProduct(opts: { name?: string; pricePaise?: number; stockUnits: number }) {
  const result = await pool.query<{
    id: string;
    name: string;
    price_paise: number;
    stock_units: number;
  }>(
    `INSERT INTO products (name, price_paise, stock_units)
     VALUES ($1, $2, $3)
     RETURNING id, name, price_paise, stock_units`,
    [opts.name ?? `Snack ${randomUUID()}`, opts.pricePaise ?? 1000, opts.stockUnits],
  );
  return result.rows[0];
}

export function signedWebhook(payload: unknown) {
  const raw = Buffer.from(JSON.stringify(payload));
  return {
    raw,
    signature: signRawBody(raw, config.webhookSecret),
  };
}

export async function postWebhook(payload: unknown, signature?: string) {
  const { raw, signature: computed } = signedWebhook(payload);
  return request(app)
    .post("/payments/webhook")
    .set("Content-Type", "application/json")
    .set("X-Signature", signature ?? computed)
    .send(raw.toString("utf8"));
}

export async function createPaidOrder(productId: string, quantity = 1) {
  const created = await request(app)
    .post("/orders")
    .send({ items: [{ productId, quantity }] });
  const order = created.body.order as { id: string; totalPaise: number };
  const eventId = `evt_${randomUUID()}`;
  await postWebhook({
    eventId,
    orderId: order.id,
    amountPaise: order.totalPaise,
    status: "captured",
  });
  return order;
}

export async function availableUnits(productId: string): Promise<number> {
  const result = await request(app).get("/products");
  const product = result.body.products.find((p: { id: string }) => p.id === productId);
  return product.availableUnits;
}

export async function physicalStock(productId: string): Promise<number> {
  const result = await pool.query<{ stock_units: number }>(`SELECT stock_units FROM products WHERE id = $1`, [
    productId,
  ]);
  return result.rows[0].stock_units;
}
