import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup-env.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
    env: {
      HOLD_SECONDS: "120",
    },
  },
});
