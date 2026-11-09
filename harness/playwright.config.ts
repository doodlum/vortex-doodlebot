import path from "node:path";

import { defineConfig } from "@playwright/test";

/**
 * A separate Playwright project from packages/e2e, because the two answer
 * different questions.
 *
 * packages/e2e is the deterministic CI suite: isolated temp profiles, a fake
 * game, no network. These tests instead exercise the AI automation stack itself
 * — the vortex-mcp extension's UI tools, the snapshot/act loop, window resizing
 * and hot reload — against a real Vortex build. They are slower, they need the
 * extension built, and they are run deliberately rather than on every push.
 */
export default defineConfig({
  testDir: "./src/tests",
  // Only the account-free integration contract belongs in the default gate.
  testMatch: "**/*.spec.ts",
  testIgnore: "**/oauth-restore.spec.ts",
  // Refuses while a harness Vortex is running: only one instance runs at a time.
  globalSetup: "./src/tests/singleInstanceGlobalSetup.ts",
  // One at a time: the tools under test resize the real window and the MCP
  // server binds a fixed port, neither of which survives parallel workers.
  workers: 1,
  retries: 0,
  fullyParallel: false,
  // A cold bootstrap plus an Electron launch is minutes, not seconds.
  timeout: 60_000,
  expect: { timeout: 30_000 },
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: path.resolve(import.meta.dirname, "playwright-report") },
    ],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "off",
    video: "off",
  },
  // One Vortex at a time: the lifecycle spec launches its own Vortex, so it runs as its own
  // project before the worker-scoped fixture Vortex of the other specs exists.
  projects: [
    { name: "lifecycle", testMatch: "**/bootstrap-lifecycle.spec.ts" },
    {
      name: "contract",
      testIgnore: ["**/oauth-restore.spec.ts", "**/bootstrap-lifecycle.spec.ts"],
      dependencies: ["lifecycle"],
    },
  ],
});
