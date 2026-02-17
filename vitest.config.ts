import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: { "@app": path.resolve(__dirname, "src") },
  },
  test: {
    testTimeout: 10_000,
    exclude: ["src/tools/web.test.ts", "node_modules"],
  },
});
