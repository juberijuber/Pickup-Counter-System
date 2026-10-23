import type pg from "pg";
import { z } from "zod";
import { AppError } from "./errors.js";
import { expireOrderIfNeeded, loadOrderItems, serializeOrder } from "./orders.js";
import type { OrderPublic, OrderRow } from "./types.js";

const webhookSchema = z.object({
  eventId: z.string().min(1),
  orderId: z.string().uuid(),
  amountPaise: z.number().int().nonnegative(),
  status: z.string().min(1),
});

export type WebhookResult = {
  duplicate: boolean;
  order: OrderPublic;
};

export async function processWebhook(pool: pg.Pool, payload: unknown): Promise<WebhookResult> {
  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError(400, "INVALID_WEBHOOK", "Webhook payload is invalid.");
  }
  const event = parsed.data;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext('webhook'))`, [event.eventId]);

    const existing = await client.query(`SELECT event_id, order_id FROM processed_webhook_events WHERE event_id = $1`, [
      event.eventId,
    ]);
    if ((existing.rowCount ?? 0) > 0) {
      const orderId = existing.rows[0].order_id as string;
      const orderRow = await client.query<OrderRow>(`SELECT * FROM orders WHERE id = $1`, [orderId]);
      const items = await loadOrderItems(client, orderId);
      await client.query("COMMIT");
      return { duplicate: true, order: serializeOrder(orderRow.rows[0], items) };
    }

    const found = await client.query<OrderRow>(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [event.orderId]);
    if (found.rowCount === 0) {
      throw new AppError(404, "ORDER_NOT_FOUND", "Order not found.");
    }

    try {
      await client.query(
        `INSERT INTO processed_webhook_events (event_id, order_id, amount_paise, event_status, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [event.eventId, event.orderId, event.amountPaise, event.status, JSON.stringify(event)],
      );
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "23505") {
        const orderRow = await client.query<OrderRow>(`SELECT * FROM orders WHERE id = $1`, [event.orderId]);
        const items = await loadOrderItems(client, event.orderId);
        await client.query("COMMIT");
        return { duplicate: true, order: serializeOrder(orderRow.rows[0], items) };
      }
      throw error;
    }

    let order = await expireOrderIfNeeded(client, found.rows[0]);

    if (event.status !== "captured") {
      const items = await loadOrderItems(client, order.id);
      await client.query("COMMIT");
      return { duplicate: false, order: serializeOrder(order, items) };
    }

    const terminal = order.status === "paid" || order.status === "picked_up" || order.status === "needs_review";
    if (terminal) {
      const items = await loadOrderItems(client, order.id);
      await client.query("COMMIT");
      return { duplicate: false, order: serializeOrder(order, items) };
    }

    if (event.amountPaise !== order.total_paise) {
      const updated = await client.query<OrderRow>(
        `UPDATE orders
         SET status = 'needs_review',
             needs_review_at = now(),
             review_reason = 'amount_mismatch'
         WHERE id = $1 AND status IN ('pending_payment', 'expired')
         RETURNING *`,
        [order.id],
      );
      order = updated.rows[0] ?? order;
    } else if (order.status === "pending_payment") {
      const updated = await client.query<OrderRow>(
        `UPDATE orders
         SET status = 'paid', paid_at = now()
         WHERE id = $1 AND status = 'pending_payment'
         RETURNING *`,
        [order.id],
      );
      order = updated.rows[0] ?? order;
    } else if (order.status === "expired") {
      const updated = await client.query<OrderRow>(
        `UPDATE orders
         SET status = 'needs_review',
             needs_review_at = now(),
             review_reason = 'late_payment'
         WHERE id = $1 AND status = 'expired'
         RETURNING *`,
        [order.id],
      );
      order = updated.rows[0] ?? order;
    }

    const items = await loadOrderItems(client, order.id);
    await client.query("COMMIT");
    return { duplicate: false, order: serializeOrder(order, items) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
