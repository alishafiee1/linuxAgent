import { defineConfig } from "vitest/config";

// Separate from the unit tests: these start Chromium and need a built web app (pnpm build).
export default defineConfig({
  test: {
    include: ["e2e/**/*.e2e.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
