export type OrderStatus = "pending_payment" | "paid" | "expired" | "needs_review" | "picked_up";

export type OrderRow = {
  id: string;
  status: OrderStatus;
  total_paise: number;
  hold_expires_at: Date;
  created_at: Date;
  paid_at: Date | null;
  expired_at: Date | null;
  needs_review_at: Date | null;
  picked_up_at: Date | null;
  review_reason: string | null;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  product_id: string;
  product_name: string;
  unit_price_paise: number;
  quantity: number;
};

export type ProductPublic = {
  id: string;
  name: string;
  pricePaise: number;
  stockUnits: number;
  availableUnits: number;
};

export type OrderPublic = {
  id: string;
  status: OrderStatus;
  totalPaise: number;
  holdExpiresAt: string;
  expiresInSeconds: number;
  reviewReason: string | null;
  items: Array<{
    productId: string;
    name: string;
    unitPricePaise: number;
    quantity: number;
    lineTotalPaise: number;
  }>;
};
