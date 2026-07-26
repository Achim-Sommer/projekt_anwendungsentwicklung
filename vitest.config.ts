import path from "node:path";
import { defineConfig } from "vitest/config";

// Ein Test-Setup fuer das gesamte Monorepo.
export default defineConfig({
  resolve: {
    alias: {
      // Tests nutzen die Quellen von @projekt/shared direkt, damit vorher
      // kein Build noetig ist.
      "@projekt/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/backend/src/game/**/*.ts"],
    },
  },
});
