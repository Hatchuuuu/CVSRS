import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next";
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

export default defineConfig([
  globalIgnores(["public/ocr/**"]),
  ...next,
  ...coreWebVitals,
  ...typescript,
  globalIgnores([".next/**", ".next-e2e/**", "playwright-report/**", "test-results/**", ".worktrees/**", ".local/**", "node_modules/**", ".agents/**", ".claude/**", ".codex/**", "next-env.d.ts"]),
  {
    rules: {
      // Never silence the type system for convenience.
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
]);
