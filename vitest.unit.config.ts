import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/types/**/*.d.ts",
        "src/services/**/*.ts",
      ],
      thresholds: {
        statements: 98,
        branches: 88,
        functions: 100,
        lines: 99,
      },
    },
  },
});
