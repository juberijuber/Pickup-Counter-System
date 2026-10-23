import type { DbClient } from "./db.js";
import type { OrderItemRow, OrderPublic, OrderRow } from "./types.js";

export function remainingHoldSeconds(holdExpiresAt: Date, now: Date): number {
  const ms = holdExpiresAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 1000));
}

export function serializeOrder(order: OrderRow, items: OrderItemRow[], now = new Date()): OrderPublic {
  const pending = order.status === "pending_payment";
  return {
    id: order.id,
    status: order.status,
    totalPaise: order.total_paise,
    holdExpiresAt: order.hold_expires_at.toISOString(),
    expiresInSeconds: pending ? remainingHoldSeconds(order.hold_expires_at, now) : 0,
    reviewReason: order.review_reason,
    items: items.map((item) => ({
      productId: item.product_id,
      name: item.product_name,
      unitPricePaise: item.unit_price_paise,
      quantity: item.quantity,
      lineTotalPaise: item.unit_price_paise * item.quantity,
    })),
  };
}

export async function loadOrderItems(db: DbClient, orderId: string): Promise<OrderItemRow[]> {
  const result = await db.query<OrderItemRow>(
    `SELECT id, order_id, product_id, product_name, unit_price_paise, quantity
     FROM order_items WHERE order_id = $1 ORDER BY product_name`,
    [orderId],
  );
  return result.rows;
}

export function holdHasElapsed(order: OrderRow, now = new Date()): boolean {
  return order.status === "pending_payment" && order.hold_expires_at.getTime() <= now.getTime();
}

export async function expireOrderIfNeeded(db: DbClient, order: OrderRow): Promise<OrderRow> {
  if (!holdHasElapsed(order)) {
    return order;
  }
  const updated = await db.query<OrderRow>(
    `UPDATE orders
     SET status = 'expired', expired_at = COALESCE(expired_at, now())
     WHERE id = $1 AND status = 'pending_payment'
     RETURNING *`,
    [order.id],
  );
  return updated.rows[0] ?? { ...order, status: "expired" };
}
