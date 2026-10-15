import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": r("./src"),
      // The real package throws outside React Server Components; unit tests import server modules directly.
      "server-only": r("./tests/unit/stubs/server-only.ts"),
    },
  },
  test: { include: ["tests/unit/**/*.test.{ts,tsx}"] },
});
