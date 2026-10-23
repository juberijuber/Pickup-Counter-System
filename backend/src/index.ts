import { config } from "./config.js";
import { createApp } from "./app.js";
import { createPool } from "./db.js";

const pool = createPool(config.databaseUrl);
const app = createApp(pool);

const server = app.listen(config.port, () => {
  console.log(`
===================================================================
  🚀 Pickup Counter System is Running!
  -----------------------------------------------------------------
  🌐 Customer Frontend : ${config.frontendUrl}
  🔌 Backend API       : http://localhost:${config.port}
  ❤️  Health Check      : http://localhost:${config.port}/health
===================================================================
`);
});

async function shutdown() {
  server.close();
  await pool.end();
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
