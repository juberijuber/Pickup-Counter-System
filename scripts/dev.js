import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

console.log(`
===================================================================
  🚀 Pickup Counter System is Starting!
  -----------------------------------------------------------------
  🌐 Customer Frontend : http://localhost:5173
  🔌 Backend API       : http://localhost:3000
  ❤️  Health Check      : http://localhost:3000/health
  📦 PostgreSQL DB     : localhost:5434 (DB: pickup_counter)
===================================================================
`);

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

const backend = spawn(npmCmd, ["run", "dev"], {
  cwd: path.join(rootDir, "backend"),
  stdio: "inherit",
  shell: true,
});

const frontend = spawn(npmCmd, ["run", "dev"], {
  cwd: path.join(rootDir, "frontend"),
  stdio: "inherit",
  shell: true,
});

function cleanup() {
  backend.kill();
  frontend.kill();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
