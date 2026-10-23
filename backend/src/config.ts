import dotenv from "dotenv";

dotenv.config({ path: new URL("../../.env", import.meta.url) });
dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL", "postgres://pickup:pickup@localhost:5434/pickup_counter"),
  webhookSecret: required("WEBHOOK_SECRET", "dev-webhook-secret-change-me"),
  holdSeconds: Number(process.env.HOLD_SECONDS ?? 120),
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5173",
};

export function testDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgres://pickup:pickup@localhost:5434/pickup_counter_test"
  );
}
