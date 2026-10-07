import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HarnessConfig } from "./config";
import { withLiveOperation } from "./liveOperation";
import type { VortexMcpClient } from "./mcpClient";
import { assertAutomationProfile, expectedUserDataDir, requireRunning } from "./runningProfile";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot profile identity "));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

it.each([undefined, null, {}, { userDataDir: null }, { userDataDir: "relative" }])(
  "refuses absent or invalid profile identity %j",
  (status) => {
    expect(() => assertAutomationProfile(status, path.join(dir, "live", "userData"))).toThrow(
      /expected isolated profile/,
    );
  },
);

it("accepts only the exact canonical profile, including Windows case aliases", () => {
  const expected = path.join(dir, "live", "userData");
  fs.mkdirSync(expected, { recursive: true });
  const actual = process.platform === "win32" ? expected.toUpperCase() : expected;
  expect(() => assertAutomationProfile({ userDataDir: actual }, expected)).not.toThrow();
  expect(() => assertAutomationProfile({ userDataDir: dir }, expected)).toThrow();
  expect(() =>
    assertAutomationProfile({ userDataDir: path.join(expected, "nested") }, expected),
  ).toThrow();
});

it("the shared CLI attachment refuses a foreign endpoint before invoking a live action", async () => {
  const config = {
    owner: "operator",
    cacheDir: path.join(dir, "owned"),
    target: { kind: "installed" },
    mcpPort: 1,
    mcpToken: "synthetic",
  } as HarnessConfig;
  const mcp = {
    url: "synthetic",
    call: vi.fn(async () => ({
      runtimeId: "foreign",
      userDataDir: path.join(dir, "foreign", "live", "userData"),
    })),
  } as unknown as VortexMcpClient;
  const action = () =>
    withLiveOperation(
      config,
      "click",
      async () => {
        const client = await requireRunning(config, mcp);
        await client.call("ui_click", { ref: "synthetic-ref" });
      },
      { leaseEnv: { dir: path.join(dir, "leases") } },
    );
  await expect(action()).rejects.toThrow(/expected isolated profile/);
  expect(vi.mocked(mcp.call).mock.calls.map(([tool]) => tool)).toEqual(["automation_status"]);
  vi.mocked(mcp.call).mockResolvedValue({
    runtimeId: "owned",
    userDataDir: expectedUserDataDir(config),
  });
  await action();
  expect(vi.mocked(mcp.call).mock.calls.map(([tool]) => tool)).toEqual([
    "automation_status",
    "automation_status",
    "ui_click",
  ]);
});
