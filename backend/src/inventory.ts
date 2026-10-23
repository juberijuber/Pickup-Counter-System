import type { DbClient } from "./db.js";
import type { ProductPublic } from "./types.js";

/**
 * Inventory model
 *
 * `products.stock_units` is physical on-hand stock: units that have not been
 * picked up yet. Pickup is the only operation that decrements this column.
 *
 * Units are unavailable for new orders when they are:
 * - reserved by an unexpired `pending_payment` hold, or
 * - committed to a `paid` order waiting for pickup.
 *
 * Expired, needs_review, and picked_up orders do not occupy availability.
 * Late payments never steal stock from later customers.
 */
export const AVAILABILITY_SQL = `
  SELECT
    p.id,
    p.name,
    p.price_paise AS "pricePaise",
    p.stock_units AS "stockUnits",
    GREATEST(
      p.stock_units - COALESCE(occupied.qty, 0),
      0
    )::int AS "availableUnits"
  FROM products p
  LEFT JOIN (
    SELECT oi.product_id, SUM(oi.quantity)::int AS qty
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE
      (o.status = 'pending_payment' AND o.hold_expires_at > now())
      OR o.status = 'paid'
    GROUP BY oi.product_id
  ) occupied ON occupied.product_id = p.id
`;

export async function listProducts(db: DbClient): Promise<ProductPublic[]> {
  const result = await db.query<ProductPublic>(`${AVAILABILITY_SQL} ORDER BY p.name`);
  return result.rows;
}

export async function occupiedQuantities(
  db: DbClient,
  productIds: string[],
): Promise<Map<string, number>> {
  const result = await db.query<{ product_id: string; qty: number }>(
    `SELECT oi.product_id, SUM(oi.quantity)::int AS qty
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.product_id = ANY($1::uuid[])
       AND (
         (o.status = 'pending_payment' AND o.hold_expires_at > now())
         OR o.status = 'paid'
       )
     GROUP BY oi.product_id`,
    [productIds],
  );
  return new Map(result.rows.map((row) => [row.product_id, row.qty]));
}
