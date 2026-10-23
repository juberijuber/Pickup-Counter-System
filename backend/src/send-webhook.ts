import { config } from "./config.js";
import { signRawBody } from "./hmac.js";

function usage(): never {
  console.error(
    "Usage: npm run send-webhook -- <orderId> [amountPaise] [status] [eventId]\n" +
      "If amountPaise is omitted, the script fetches GET /orders/:id and uses totalPaise.\n" +
      "Reuse the same eventId to test idempotency. The webhook secret is never printed.",
  );
  process.exit(1);
}

async function main() {
  const [, , orderId, amountArg, statusArg, eventIdArg] = process.argv;
  if (!orderId) {
    usage();
  }

  const apiBase = process.env.API_URL ?? `http://localhost:${config.port}`;
  let amountPaise = amountArg ? Number(amountArg) : undefined;
  if (amountPaise === undefined) {
    const orderRes = await fetch(`${apiBase}/orders/${orderId}`);
    if (!orderRes.ok) {
      console.error(`Could not load order ${orderId}: HTTP ${orderRes.status}`);
      process.exit(1);
    }
    const body = (await orderRes.json()) as { order: { totalPaise: number } };
    amountPaise = body.order.totalPaise;
  }
  if (!Number.isInteger(amountPaise) || amountPaise < 0) {
    console.error("amountPaise must be a non-negative integer.");
    process.exit(1);
  }

  const payload = {
    eventId: eventIdArg ?? `evt_${crypto.randomUUID()}`,
    orderId,
    amountPaise,
    status: statusArg ?? "captured",
  };
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = signRawBody(raw, config.webhookSecret);

  const response = await fetch(`${apiBase}/payments/webhook`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature": signature,
    },
    body: raw,
  });
  const text = await response.text();
  console.log(`HTTP ${response.status}`);
  console.log(text);
  console.log(`eventId=${payload.eventId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
