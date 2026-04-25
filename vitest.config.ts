import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    hmr: false
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true
  }
});
