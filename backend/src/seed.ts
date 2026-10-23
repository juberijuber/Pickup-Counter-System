import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";
import { createPool } from "./db.js";

export const SEED_PRODUCTS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Samosa", pricePaise: 2500, stockUnits: 20 },
  { id: "22222222-2222-4222-8222-222222222222", name: "Vada Pav", pricePaise: 3000, stockUnits: 15 },
  { id: "33333333-3333-4333-8333-333333333333", name: "Masala Chai", pricePaise: 1500, stockUnits: 30 },
  { id: "44444444-4444-4444-8444-444444444444", name: "Veg Sandwich", pricePaise: 5000, stockUnits: 12 },
  { id: "55555555-5555-4555-8555-555555555555", name: "Pakora Mix", pricePaise: 4000, stockUnits: 10 },
] as const;

export async function seed(connectionString = config.databaseUrl): Promise<void> {
  const pool = createPool(connectionString);
  try {
    for (const product of SEED_PRODUCTS) {
      await pool.query(
        `INSERT INTO products (id, name, price_paise, stock_units)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [product.id, product.name, product.pricePaise, product.stockUnits],
      );
    }
    console.log("Seeded snack products.");
  } finally {
    await pool.end();
  }
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirect) {
  seed().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
