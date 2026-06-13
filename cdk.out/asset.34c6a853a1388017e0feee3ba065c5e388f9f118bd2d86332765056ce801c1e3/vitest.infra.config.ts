import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["infra/test/**/*.test.ts"],
    coverage: { enabled: false }
  }
});
