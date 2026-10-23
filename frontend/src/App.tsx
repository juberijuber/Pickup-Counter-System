import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  claimPickup,
  createOrder,
  fetchOrder,
  fetchProducts,
  formatRupees,
  simulatePayment,
  type Order,
  type Product,
} from "./api";

type Cart = Record<string, number>;

const PRODUCT_META: Record<string, { emoji: string; tag: string; description: string }> = {
  "Masala Chai": {
    emoji: "☕",
    tag: "Freshly Brewed",
    description: "Slow-simmered strong tea with fresh crushed ginger, green cardamom & aromatic spices.",
  },
  "Pakora Mix": {
    emoji: "🍟",
    tag: "Crispy Hot",
    description: "Crunchy golden fritters of sliced onion, potato, and spinach served with tangy chutney.",
  },
  "Samosa": {
    emoji: "🥟",
    tag: "Best Seller",
    description: "Golden flaky triangle pastry stuffed with spiced potato, cumin, and sweet green peas.",
  },
  "Vada Pav": {
    emoji: "🍔",
    tag: "Mumbai Classic",
    description: "Spiced mashed potato batata vada in a warm pav with dry garlic coconut chutney.",
  },
  "Veg Sandwich": {
    emoji: "🥪",
    tag: "Chef Special",
    description: "Grilled multi-layer sandwich with crisp cucumbers, tomatoes, bell peppers & mint spread.",
  },
};

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<Cart>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [displaySeconds, setDisplaySeconds] = useState(0);

  const holdRef = useRef<{ receivedAt: number; expiresInSeconds: number } | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((current) => (current === msg ? null : current));
    }, 3500);
  };

  const loadProducts = useCallback(async () => {
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

  // Server-derived monotonic countdown
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
      if (!hold) return;
      const elapsed = (performance.now() - hold.receivedAt) / 1000;
      setDisplaySeconds(Math.max(0, Math.ceil(hold.expiresInSeconds - elapsed)));
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [order?.id, order?.status]);

  // Polling order status until terminal state
  useEffect(() => {
    if (!order || order.status !== "pending_payment") {
      return;
    }
    const terminal = new Set(["paid", "expired", "needs_review", "picked_up"]);
    let cancelled = false;

    const poll = window.setInterval(() => {
      void (async () => {
        try {
          const data = await fetchOrder(order.id);
          if (cancelled) return;
          setOrder(data.order);
          if (terminal.has(data.order.status)) {
            window.clearInterval(poll);
            void loadProducts();
            if (data.order.status === "paid") {
              showToast("🎉 Payment confirmed! Your snacks are ready at the locker.");
            }
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Could not refresh order status.");
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

  const totalItemCount = useMemo(() => {
    return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  }, [cart]);

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
      setError("Please add at least one item to your tray.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const data = await createOrder(items);
      setOrder(data.order);
      setCart({});
      await loadProducts();
      showToast("🔒 Inventory reserved for 120 seconds. Please complete payment.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reserve order.");
      await loadProducts();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClaimPickup() {
    if (!order) return;
    setClaiming(true);
    setError(null);
    try {
      const data = await claimPickup(order.id);
      setOrder(data.order);
      await loadProducts();
      showToast("🔓 Locker unlocked! Enjoy your freshly prepared snacks.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pickup claim failed.");
    } finally {
      setClaiming(false);
    }
  }

  async function handleSimulatePayment(amountOverride?: number) {
    if (!order) return;
    setSimulating(true);
    setError(null);
    try {
      const result = await simulatePayment(order.id, amountOverride);
      setOrder(result.order);
      await loadProducts();
      showToast(
        amountOverride && amountOverride !== order.totalPaise
          ? "⚠️ Amount mismatch webhook sent -> Order flagged for review."
          : "✅ Signed webhook processed -> Order marked PAID!"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment simulation failed.");
    } finally {
      setSimulating(false);
    }
  }

  function startOver() {
    setOrder(null);
    setCart({});
    setError(null);
    void loadProducts();
  }

  function copyText(text: string, label: string) {
    void navigator.clipboard.writeText(text);
    showToast(`Copied ${label} to clipboard!`);
  }

  // Active Order Screen
  if (order) {
    return (
      <main className="app-container order-view-wrapper">
        <nav className="top-nav">
          <div className="brand-wrapper">
            <div className="brand-icon">📦</div>
            <div className="brand-title">
              <h1>Pickup Counter</h1>
              <p>Automated locker fulfillment & hold management</p>
            </div>
          </div>
          <button type="button" className="btn-sim secondary" onClick={startOver}>
            ← Back to Menu
          </button>
        </nav>

        {toast ? <div className="toast-bar"><span>{toast}</span><button type="button" className="copy-btn" onClick={() => setToast(null)}>✕</button></div> : null}
        {error ? <div className="error-banner">{error}</div> : null}

        <section className="order-card">
          <div className="order-meta-header">
            <div>
              <span className="order-id-badge">
                ID: {order.id}
                <button
                  type="button"
                  className="copy-btn"
                  onClick={() => copyText(order.id, "Order ID")}
                >
                  Copy
                </button>
              </span>
            </div>
            <div className="live-pill">
              <span className="pulse-dot" />
              <span>Status: <strong>{order.status.replace("_", " ").toUpperCase()}</strong></span>
            </div>
          </div>

          {/* Countdown timer for pending hold */}
          {order.status === "pending_payment" ? (
            <div className="timer-container">
              <div className="timer-digits">{displaySeconds}s</div>
              <p className="timer-subtext">Remaining on 120-second stock hold</p>
              <div className="timer-progress-bg">
                <div
                  className="timer-progress-fill"
                  style={{ width: `${Math.max(0, Math.min(100, (displaySeconds / 120) * 100))}%` }}
                />
              </div>
            </div>
          ) : null}

          {/* State Specific Panel */}
          {order.status === "pending_payment" ? (
            <div className="state-panel pending">
              <h2 className="state-title">⏳ Waiting for Payment</h2>
              <p className="state-desc">
                Your snacks are locked and reserved in PostgreSQL. Payment must be captured before the hold timer reaches 0s, or items will be released back to other customers.
              </p>

              <div className="sim-box">
                <div className="sim-box-title">
                  <span>Terminal Webhook Sender</span>
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={() => copyText(`npm run send-webhook -- ${order.id}`, "Command")}
                  >
                    Copy Command
                  </button>
                </div>
                <div className="sim-command">
                  <code>npm run send-webhook -- {order.id}</code>
                </div>

                <div className="sim-actions">
                  <button
                    type="button"
                    className="btn-sim"
                    disabled={simulating}
                    onClick={() => void handleSimulatePayment()}
                  >
                    {simulating ? "Sending Webhook…" : "⚡ Quick Simulate Payment (Captured)"}
                  </button>
                  <button
                    type="button"
                    className="btn-sim secondary"
                    disabled={simulating}
                    onClick={() => void handleSimulatePayment(order.totalPaise + 100)}
                  >
                    ⚠️ Test Mismatch Policy (+₹1)
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {order.status === "paid" ? (
            <div className="state-panel paid">
              <h2 className="state-title">✅ Payment Verified via Signed Webhook</h2>
              <p className="state-desc">
                Your order is confirmed. Go to <strong>Locker #04</strong> and click below to open the locker door and collect your snacks.
              </p>
              <button
                type="button"
                className="btn-claim-pickup"
                disabled={claiming}
                onClick={() => void handleClaimPickup()}
              >
                {claiming ? "Opening Locker…" : "🔓 Open Locker & Pick Up Items"}
              </button>
            </div>
          ) : null}

          {order.status === "picked_up" ? (
            <div className="state-panel picked_up">
              <h2 className="state-title">🎉 Order Picked Up Successfully!</h2>
              <p className="state-desc">
                Locker #04 has closed. Physical stock has been permanently deducted from inventory. Enjoy your hot snacks!
              </p>
            </div>
          ) : null}

          {order.status === "expired" ? (
            <div className="state-panel expired">
              <h2 className="state-title">⏱️ Reservation Hold Expired</h2>
              <p className="state-desc">
                The 120-second hold elapsed before payment was received. All reserved snack quantities have been safely released back to available inventory.
              </p>
            </div>
          ) : null}

          {order.status === "needs_review" ? (
            <div className="state-panel review">
              <h2 className="state-title">⚠️ Payment Flagged for Manual Review</h2>
              <p className="state-desc">
                Reason: <strong>{order.reviewReason ?? "review_required"}</strong>. Per policy, this order will not automatically deduct stock or dispense items until an operator resolves or refunds it.
              </p>
            </div>
          ) : null}

          {/* Ordered items breakdown */}
          <div className="order-items-summary">
            <h3>Items in this Order</h3>
            <ul>
              {order.items.map((item) => (
                <li key={item.productId}>
                  <span>
                    <strong>{item.name}</strong> × {item.quantity}
                  </span>
                  <span>{formatRupees(item.lineTotalPaise)}</span>
                </li>
              ))}
            </ul>
            <div className="totals-row final" style={{ marginTop: 14 }}>
              <span>Order Total</span>
              <span>{formatRupees(order.totalPaise)}</span>
            </div>
          </div>

          <button type="button" className="btn-new-order" onClick={startOver}>
            + Place Another Order
          </button>
        </section>
      </main>
    );
  }

  // Catalog & Ordering Screen
  return (
    <main className="app-container">
      <nav className="top-nav">
        <div className="brand-wrapper">
          <div className="brand-icon">🥟</div>
          <div className="brand-title">
            <h1>Pickup Counter</h1>
            <p>Fresh snacks • 120s Concurrency-Safe Stock Hold • Locker Collection</p>
          </div>
        </div>
        <div className="live-pill">
          <span className="pulse-dot" />
          <span>Live Inventory Active</span>
        </div>
      </nav>

      {toast ? <div className="toast-bar"><span>{toast}</span><button type="button" className="copy-btn" onClick={() => setToast(null)}>✕</button></div> : null}
      {error ? <div className="error-banner">{error}</div> : null}

      <div className="main-grid">
        {/* Snack Catalog */}
        <section>
          <div className="section-heading">
            <span>Snack Menu</span>
            <span style={{ fontSize: "0.8125rem", color: "var(--text-muted)", fontWeight: 500 }}>
              {products.length} fresh items available
            </span>
          </div>

          {loading ? <p style={{ color: "var(--text-muted)", padding: "20px 0" }}>Loading fresh inventory…</p> : null}

          <div className="product-grid">
            {products.map((product) => {
              const qty = cart[product.id] ?? 0;
              const meta = PRODUCT_META[product.name] ?? {
                emoji: "🍱",
                tag: "Snack",
                description: "Freshly prepared ready-to-eat snack.",
              };
              const isSoldOut = product.availableUnits <= 0;
              const isLowStock = product.availableUnits > 0 && product.availableUnits <= 3;

              return (
                <article
                  key={product.id}
                  className={`product-card ${isSoldOut ? "sold-out" : ""}`}
                >
                  <div className="card-top">
                    <div className="product-emoji">{meta.emoji}</div>
                    {isSoldOut ? (
                      <span className="stock-tag out-stock">Sold Out</span>
                    ) : isLowStock ? (
                      <span className="stock-tag low-stock">Only {product.availableUnits} left</span>
                    ) : (
                      <span className="stock-tag in-stock">{product.availableUnits} available</span>
                    )}
                  </div>

                  <h3 className="product-name">{product.name}</h3>
                  <p className="product-desc">{meta.description}</p>

                  <div className="card-bottom">
                    <div className="price-box">
                      <span className="price-main">{formatRupees(product.pricePaise)}</span>
                      <span className="price-sub">{product.pricePaise} paise</span>
                    </div>

                    <div className="stepper">
                      <button
                        type="button"
                        className="stepper-btn"
                        disabled={qty <= 0}
                        onClick={() => setQty(product, qty - 1)}
                        title="Decrease"
                      >
                        −
                      </button>
                      <span className="stepper-qty">{qty}</span>
                      <button
                        type="button"
                        className="stepper-btn"
                        disabled={isSoldOut || qty >= product.availableUnits}
                        onClick={() => setQty(product, qty + 1)}
                        title="Increase"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Floating Cart Sidebar */}
        <aside className="cart-panel">
          <div className="cart-header">
            <h2>
              <span>🛒 Tray</span>
              {totalItemCount > 0 ? (
                <span className="cart-count">{totalItemCount}</span>
              ) : null}
            </h2>
            {totalItemCount > 0 ? (
              <button
                type="button"
                className="copy-btn"
                style={{ fontSize: "0.75rem" }}
                onClick={() => setCart({})}
              >
                Clear
              </button>
            ) : null}
          </div>

          {totalItemCount === 0 ? (
            <div className="empty-cart">
              <div className="empty-icon">🍽️</div>
              <p><strong>Your tray is empty</strong></p>
              <p style={{ fontSize: "0.8125rem", marginTop: 4 }}>Select snacks to reserve stock.</p>
            </div>
          ) : (
            <>
              <div className="cart-items-list">
                {products
                  .filter((p) => (cart[p.id] ?? 0) > 0)
                  .map((product) => {
                    const quantity = cart[product.id]!;
                    const lineTotal = product.pricePaise * quantity;
                    return (
                      <div key={product.id} className="cart-item-row">
                        <div className="cart-item-info">
                          <span className="cart-item-name">{product.name}</span>
                          <span className="cart-item-meta">
                            {quantity} × {formatRupees(product.pricePaise)}
                          </span>
                        </div>
                        <span className="cart-item-total">{formatRupees(lineTotal)}</span>
                      </div>
                    );
                  })}
              </div>

              <div className="cart-totals">
                <div className="totals-row">
                  <span>Subtotal</span>
                  <span>{formatRupees(totalPaise)}</span>
                </div>
                <div className="totals-row">
                  <span>Hold Duration</span>
                  <span>120 seconds</span>
                </div>
                <div className="totals-row final">
                  <span>Total</span>
                  <span>{formatRupees(totalPaise)}</span>
                </div>
              </div>

              <button
                type="button"
                className="btn-checkout"
                disabled={submitting}
                onClick={() => void checkout()}
              >
                {submitting ? "Reserving stock…" : "🔒 Place Order & Reserve Stock"}
              </button>

              <p className="cart-policy-note">
                Inventory is held for 120 seconds via row-level locks. If payment is not completed in time, units are automatically restored.
              </p>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
