import type pg from "pg";
import { z } from "zod";
import { AppError } from "./errors.js";
import { expireOrderIfNeeded, loadOrderItems, serializeOrder } from "./orders.js";
import type { OrderPublic, OrderRow } from "./types.js";

export async function claimPickup(pool: pg.Pool, orderId: string): Promise<OrderPublic> {
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
    if (order.status === "picked_up") {
      throw new AppError(409, "ALREADY_PICKED_UP", "This order has already been claimed.");
    }
    if (order.status !== "paid") {
      throw new AppError(409, "PICKUP_NOT_ALLOWED", "Only a paid order can be claimed for pickup.");
    }

    const items = await loadOrderItems(client, order.id);
    const productIds = [...new Set(items.map((item) => item.product_id))].sort();
    await client.query(`SELECT id FROM products WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [productIds]);
    for (const item of items) {
      const updated = await client.query(
        `UPDATE products
         SET stock_units = stock_units - $1
         WHERE id = $2 AND stock_units >= $1`,
        [item.quantity, item.product_id],
      );
      if ((updated.rowCount ?? 0) === 0) {
        throw new AppError(409, "STOCK_INTEGRITY", "Physical stock could not be deducted for this pickup.");
      }
    }

    const claimed = await client.query<OrderRow>(
      `UPDATE orders
       SET status = 'picked_up', picked_up_at = now()
       WHERE id = $1 AND status = 'paid'
       RETURNING *`,
      [order.id],
    );
    if (claimed.rowCount === 0) {
      throw new AppError(409, "ALREADY_PICKED_UP", "This order has already been claimed.");
    }

    await client.query("COMMIT");
    return serializeOrder(claimed.rows[0], items);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
