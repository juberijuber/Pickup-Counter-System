const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export type Product = {
  id: string;
  name: string;
  pricePaise: number;
  stockUnits: number;
  availableUnits: number;
};

export type Order = {
  id: string;
  status: "pending_payment" | "paid" | "expired" | "needs_review" | "picked_up";
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

export type ApiError = { error: { code: string; message: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json()) as T | ApiError;
  if (!response.ok) {
    const err = body as ApiError;
    throw new Error(err.error?.message ?? `Request failed (${response.status})`);
  }
  return body as T;
}

export function fetchProducts() {
  return request<{ products: Product[] }>("/products");
}

export function createOrder(items: Array<{ productId: string; quantity: number }>) {
  return request<{ order: Order }>("/orders", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export function fetchOrder(id: string) {
  return request<{ order: Order }>(`/orders/${id}`);
}

export function formatRupees(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}
