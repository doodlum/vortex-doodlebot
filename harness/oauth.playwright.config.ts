import { defineConfig } from "@playwright/test";
import core from "./playwright.config";

export default defineConfig({
  ...core,
  // The core config's projects would override this match and run its own specs instead.
  projects: undefined,
  testMatch: "**/oauth-restore.spec.ts",
  testIgnore: [],
  globalSetup: "./src/tests/singleInstanceGlobalSetup.ts",
});
