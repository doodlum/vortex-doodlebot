import os from "node:os";
import path from "node:path";

import { defineConfig } from "vitest/config";

// Unit workers have isolated owners and lease storage. The collecting parent still tracks
// this process; its operation context must not be impersonated by independent test fixtures.
delete process.env.VORTEX_AI_OPERATION_CONTEXT;

export default defineConfig({
  resolve: {
    alias: {
      // See src/test/vortex-api.stub.ts — real resolution is intercepted by
      // Vortex at runtime; tests always override this via vi.mock(...).
      "@nexusmods/vortex-api": path.resolve(import.meta.dirname, "src/test/vortex-api.stub.ts"),
    },
  },
  test: {
    environment: "node",
    // harness/**/*.spec.ts are Playwright e2e and deliberately not matched.
    include: ["src/**/*.test.ts", "harness/src/**/*.test.ts"],
    // Unit tests must never take or read the machine-wide instance lease (lease.ts).
    env: {
      VORTEX_AI_LEASE_DIR: path.join(os.tmpdir(), "vortex-ai-unit-test-leases"),
      // Operator setup must not change pure command-selection tests.
      VORTEX_AI_PNPM: "",
      VORTEX_AI_OWNER: "unit-tests",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
