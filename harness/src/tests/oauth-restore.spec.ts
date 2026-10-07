import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { requireOAuth } from "../auth";
import { bootstrap, captureLogin } from "../bootstrap";
import { loadConfig } from "../config";
import { authCacheFile } from "../instance";
import { sandboxConfig } from "../sandbox";

// Explicit opt-in: uses the operator's harness login and leaves its restored app running.
test("@oauth cached OAuth survives a clean shutdown and fresh restore", async () => {
  test.setTimeout(240_000);
  const config = sandboxConfig(loadConfig());
  expect(
    fs.existsSync(authCacheFile(config)),
    "Cache a sandbox login with save-login --sandbox first",
  ).toBe(true);
  const before = await bootstrap(config);
  await requireOAuth(before.instance.mcp);
  await captureLogin(config);
  const restored = await bootstrap(config, { fresh: true });
  expect(await requireOAuth(restored.instance.mcp)).toMatchObject({
    oauthPresent: true,
    oauthRefreshable: true,
  });
});
