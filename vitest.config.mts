import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@app": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    testTimeout: 10_000,
  },
});
