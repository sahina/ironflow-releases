// node, not jsdom: this package is a worker process. The gateway opens a real
// SQLite file through node:sqlite, which no browser environment provides.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Pinned for the same reason as apps/web: runners are UTC and developers
    // generally are not, so an unpinned zone hides a failure on the machine
    // that wrote the test.
    env: { TZ: "UTC" },
    include: ["src/**/*.test.ts"],
  },
});
