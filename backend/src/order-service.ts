import type pg from "pg";
import { z } from "zod";
import { config } from "./config.js";
import { AppError } from "./errors.js";
import { occupiedQuantities } from "./inventory.js";
import { expireOrderIfNeeded, loadOrderItems, remainingHoldSeconds, serializeOrder } from "./orders.js";
import type { OrderPublic, OrderRow } from "./types.js";

const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1, "Cart must contain at least one item."),
});

export function parseCreateOrderBody(body: unknown) {
  const parsed = createOrderSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(400, "INVALID_REQUEST", "Cart items are missing or invalid.");
  }
  const productIds = parsed.data.items.map((item) => item.productId);
  if (new Set(productIds).size !== productIds.length) {
    throw new AppError(400, "DUPLICATE_PRODUCT_LINE", "Each product may appear only once in the cart.");
  }
  return parsed.data.items;
}

export async function createOrder(pool: pg.Pool, body: unknown): Promise<OrderPublic> {
  const items = parseCreateOrderBody(body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sorted = [...items].sort((a, b) => a.productId.localeCompare(b.productId));
    const productIds = sorted.map((item) => item.productId);

    const products = await client.query<{
      id: string;
      name: string;
      price_paise: number;
      stock_units: number;
    }>(`SELECT id, name, price_paise, stock_units FROM products WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [
      productIds,
    ]);

    if (products.rows.length !== productIds.length) {
      throw new AppError(400, "UNKNOWN_PRODUCT", "One or more products do not exist.");
    }

    const occupied = await occupiedQuantities(client, productIds);
    const byId = new Map(products.rows.map((row) => [row.id, row]));

    for (const item of sorted) {
      const product = byId.get(item.productId);
      if (!product) {
        throw new AppError(400, "UNKNOWN_PRODUCT", "One or more products do not exist.");
      }
      const available = product.stock_units - (occupied.get(product.id) ?? 0);
      if (item.quantity > available) {
        throw new AppError(409, "INSUFFICIENT_STOCK", "Not enough units available for one or more products.");
      }
    }

    const totalPaise = sorted.reduce((sum, item) => {
      const product = byId.get(item.productId)!;
      return sum + product.price_paise * item.quantity;
    }, 0);

    const inserted = await client.query<OrderRow>(
      `INSERT INTO orders (status, total_paise, hold_expires_at)
       VALUES ('pending_payment', $1, now() + ($2::int * interval '1 second'))
       RETURNING *`,
      [totalPaise, config.holdSeconds],
    );
    const order = inserted.rows[0];

    for (const item of sorted) {
      const product = byId.get(item.productId)!;
      await client.query(
        `INSERT INTO order_items (order_id, product_id, product_name, unit_price_paise, quantity)
         VALUES ($1, $2, $3, $4, $5)`,
        [order.id, product.id, product.name, product.price_paise, item.quantity],
      );
    }

    const orderItems = await loadOrderItems(client, order.id);
    await client.query("COMMIT");

    const nowResult = await pool.query<{ now: Date }>("SELECT now() AS now");
    const now = nowResult.rows[0].now;
    const publicOrder = serializeOrder(order, orderItems, now);
    publicOrder.expiresInSeconds = remainingHoldSeconds(order.hold_expires_at, now);
    return publicOrder;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getOrder(pool: pg.Pool, orderId: string): Promise<OrderPublic> {
  if (!z.string().uuid().safeParse(orderId).success) {
    throw new AppError(404, "ORDER_NOT_FOUND", "Order not found.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<OrderRow>(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId]);
    if (found.rowCount === 0) {
      throw new AppError(404, "ORDER_NOT_FOUND", "Order not found.");
    }
    const order = await expireOrderIfNeeded(client, found.rows[0]);
    const items = await loadOrderItems(client, order.id);
    await client.query("COMMIT");
    const nowResult = await pool.query<{ now: Date }>("SELECT now() AS now");
    return serializeOrder(order, items, nowResult.rows[0].now);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
