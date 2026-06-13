import { defineConfig } from "vitest/config";

const INTEGRATION_TEST_TIMEOUT_MS = 30000;

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    hookTimeout: INTEGRATION_TEST_TIMEOUT_MS,
    testTimeout: INTEGRATION_TEST_TIMEOUT_MS,
    coverage: { enabled: false },
  },
});
