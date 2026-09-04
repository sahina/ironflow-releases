import react from "@vitejs/plugin-react";
// From vitest/config, not vite: this package tests but does not bundle, so vite
// is vitest's dependency here and not a direct one.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Pinned for the same reason as apps/dashboard: runners are UTC and
    // developers generally are not, so an unpinned zone hides a failure on the
    // machine that wrote the test.
    env: { TZ: "UTC" },
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
      // The one source of truth, read in place. `contracts/` is never copied
      // into an application — see CONTEXT-MAP.md.
      "@contracts": path.resolve(import.meta.dirname, "../../contracts"),
    },
  },
});
