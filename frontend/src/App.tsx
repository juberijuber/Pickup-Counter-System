import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createOrder, fetchOrder, fetchProducts, formatRupees, type Order, type Product } from "./api";

type Cart = Record<string, number>;

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Cart>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const holdRef = useRef<{ receivedAt: number; expiresInSeconds: number } | null>(null);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchProducts();
      setProducts(data.products);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load products.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (!order) {
      holdRef.current = null;
      return;
    }
    holdRef.current = {
      receivedAt: performance.now(),
      expiresInSeconds: order.expiresInSeconds,
    };
    setDisplaySeconds(order.expiresInSeconds);
  }, [order?.id, order?.expiresInSeconds, order?.status]);

  useEffect(() => {
    if (!order || order.status !== "pending_payment") {
      return;
    }
    const tick = () => {
      const hold = holdRef.current;
      if (!hold) {
        return;
      }
      const elapsed = (performance.now() - hold.receivedAt) / 1000;
      setDisplaySeconds(Math.max(0, Math.ceil(hold.expiresInSeconds - elapsed)));
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [order?.id, order?.status]);

  useEffect(() => {
    if (!order || order.status !== "pending_payment") {
      return;
    }
    const terminal = new Set(["paid", "expired", "needs_review"]);
    let cancelled = false;
    const poll = window.setInterval(() => {
      void (async () => {
        try {
          const data = await fetchOrder(order.id);
          if (cancelled) {
            return;
          }
          setOrder(data.order);
          if (terminal.has(data.order.status)) {
            window.clearInterval(poll);
            void loadProducts();
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Could not refresh order.");
          }
        }
      })();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [order?.id, order?.status, loadProducts]);

  const totalPaise = useMemo(() => {
    return products.reduce((sum, product) => sum + (cart[product.id] ?? 0) * product.pricePaise, 0);
  }, [cart, products]);

  function setQty(product: Product, quantity: number) {
    const next = Math.max(0, Math.min(product.availableUnits, quantity));
    setCart((current) => {
      const copy = { ...current };
      if (next === 0) {
        delete copy[product.id];
      } else {
        copy[product.id] = next;
      }
      return copy;
    });
  }

  async function checkout() {
    const items = Object.entries(cart)
      .filter(([, quantity]) => quantity > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));
    if (items.length === 0) {
      setError("Add at least one snack before placing an order.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = await createOrder(items);
      setOrder(data.order);
      setCart({});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create order.");
      await loadProducts();
    } finally {
      setSubmitting(false);
    }
  }

  function startOver() {
    setOrder(null);
    setCart({});
    setError(null);
    void loadProducts();
  }

  if (order) {
    return (
      <main className="page">
        <header>
          <h1>Pickup Counter</h1>
          <p>Pay within the hold window. Status is confirmed by the server, not your device clock.</p>
        </header>
        <section className="card">
          <h2>Order {order.id.slice(0, 8)}</h2>
          <ul>
            {order.items.map((item) => (
              <li key={item.productId}>
                {item.name} × {item.quantity} — {formatRupees(item.lineTotalPaise)}
              </li>
            ))}
          </ul>
          <p className="total">Total {formatRupees(order.totalPaise)}</p>
          <StatusPanel order={order} seconds={displaySeconds} />
          {error ? <p className="error">{error}</p> : null}
          <button type="button" onClick={startOver}>
            Start a new order
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header>
        <h1>Pickup Counter</h1>
        <p>Reserve snacks, pay within 120 seconds, then collect at the locker.</p>
      </header>
      {loading ? <p>Loading the snack counter…</p> : null}
      {error ? <p className="error">{error}</p> : null}
      <div className="layout">
        <section className="catalog">
          {products.map((product) => {
            const qty = cart[product.id] ?? 0;
            return (
              <article key={product.id} className="card product">
                <h2>{product.name}</h2>
                <p>{formatRupees(product.pricePaise)}</p>
                <p className="muted">{product.availableUnits} available</p>
                <div className="qty">
                  <button type="button" disabled={qty <= 0} onClick={() => setQty(product, qty - 1)}>
                    −
                  </button>
                  <span>{qty}</span>
                  <button
                    type="button"
                    disabled={qty >= product.availableUnits}
                    onClick={() => setQty(product, qty + 1)}
                  >
                    +
                  </button>
                </div>
              </article>
            );
          })}
        </section>
        <aside className="card cart">
          <h2>Cart</h2>
          {Object.keys(cart).length === 0 ? <p className="muted">Your tray is empty.</p> : null}
          {products
            .filter((product) => (cart[product.id] ?? 0) > 0)
            .map((product) => (
              <p key={product.id}>
                {product.name} × {cart[product.id]} — {formatRupees(product.pricePaise * cart[product.id])}
              </p>
            ))}
          <p className="total">Total {formatRupees(totalPaise)}</p>
          <button type="button" disabled={submitting || Object.keys(cart).length === 0} onClick={() => void checkout()}>
            {submitting ? "Reserving…" : "Place order"}
          </button>
        </aside>
      </div>
    </main>
  );
}

function StatusPanel({ order, seconds }: { order: Order; seconds: number }) {
  if (order.status === "pending_payment") {
    return (
      <div className="status pending">
        <p>Waiting for payment.</p>
        <p className="countdown">{seconds}s remaining</p>
        <p className="muted">
          Simulate capture with{" "}
          <code>
            npm run send-webhook -- {order.id}
          </code>
        </p>
      </div>
    );
  }
  if (order.status === "paid") {
    return (
      <div className="status paid">
        <p>Payment received. Show this screen at the locker.</p>
      </div>
    );
  }
  if (order.status === "expired") {
    return (
      <div className="status expired">
        <p>The hold expired and reserved snacks were released.</p>
      </div>
    );
  }
  if (order.status === "needs_review") {
    return (
      <div className="status review">
        <p>This payment needs manual review{order.reviewReason ? ` (${order.reviewReason})` : ""}.</p>
      </div>
    );
  }
  return (
    <div className="status paid">
      <p>Picked up. Enjoy the snacks.</p>
    </div>
  );
}
