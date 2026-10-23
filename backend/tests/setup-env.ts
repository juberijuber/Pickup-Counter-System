process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "test-webhook-secret";
process.env.HOLD_SECONDS = process.env.HOLD_SECONDS || "120";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://pickup:pickup@127.0.0.1:5434/pickup_counter_test";
