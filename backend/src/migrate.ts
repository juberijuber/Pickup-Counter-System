import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config } from "./config.js";
import { createPool } from "./db.js";

const sqlDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sql");

export async function ensureDatabase(connectionString: string): Promise<void> {
  const url = new URL(connectionString);
  const dbName = url.pathname.replace(/^\//, "");
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`Refusing to create invalid database name: ${dbName}`);
  }
  if (dbName === "pickup_counter") {
    return;
  }
  const admin = new URL(connectionString);
  admin.pathname = "/pickup_counter";
  const pool = createPool(admin.toString());
  try {
    const exists = await pool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
    if ((exists.rowCount ?? 0) === 0) {
      await pool.query(`CREATE DATABASE ${dbName}`);
    }
  } finally {
    await pool.end();
  }
}

export async function migrate(connectionString = config.databaseUrl): Promise<void> {
  await ensureDatabase(connectionString);
  const pool = createPool(connectionString);
  try {
    const sql = await readFile(path.join(sqlDir, "001_init.sql"), "utf8");
    await pool.query(sql);
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirect) {
  migrate().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
