import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ANONYMOUS, markerFile, snapshotDir } from "./bootstrap";
import { loadConfig, type HarnessConfig } from "./config";
import { checkoutCheck, formatDoctorReport, missingVortexCheck, runDoctor } from "./doctor";

let temp: string;
let home: string;
let config: HarnessConfig;

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

beforeEach(async () => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-doctor-"));
  home = path.join(temp, "home");
  fs.mkdirSync(home);
  config = loadConfig({
    cacheDir: path.join(temp, "cache"),
    // Any existing executable passes the installed-Vortex check.
    target: { kind: "installed", executable: process.execPath, args: [], appName: "Vortex" },
    apiKey: undefined,
    mcpPort: await freePort(),
    cdpPort: await freePort(),
  });
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

const check = (report: Awaited<ReturnType<typeof runDoctor>>, name: string) =>
  report.checks.find((c) => c.name === name);

describe("doctor's advisory checks", () => {
  it("reports a missing sandbox baseline without failing", async () => {
    const report = await runDoctor(config, { skipGame: true, homeDir: home });
    expect(check(report, "Sandbox baseline")).toMatchObject({
      ok: false,
      advisory: true,
      detail: "missing",
    });
    expect(report.ok).toBe(true);
  });

  it("reports a present baseline with its marker file", async () => {
    const snapshot = snapshotDir(config, ANONYMOUS, true);
    fs.mkdirSync(snapshot, { recursive: true });
    fs.writeFileSync(markerFile(snapshot), JSON.stringify({ createdAt: "2026-11-10T00:00:00Z" }));
    const report = await runDoctor(config, { skipGame: true, homeDir: home });
    expect(check(report, "Sandbox baseline")).toMatchObject({
      ok: true,
      detail: `present: ${markerFile(snapshot)}`,
    });
    expect(formatDoctorReport(report)).toContain(
      `  [ok  ] Sandbox baseline\n         present: ${markerFile(snapshot)}`,
    );
  });

  it("checks the --no-game baseline only with --no-game, and the game's otherwise", async () => {
    const game = snapshotDir(config, ANONYMOUS);
    fs.mkdirSync(game, { recursive: true });
    fs.writeFileSync(markerFile(game), JSON.stringify({ createdAt: "2026-11-10T00:00:00Z" }));
    // A game baseline does not stand in for the separate --no-game one.
    expect(
      check(await runDoctor(config, { skipGame: true, homeDir: home }), "Sandbox baseline"),
    ).toMatchObject({ ok: false, detail: "missing" });
    expect(check(await runDoctor(config, { homeDir: home }), "Sandbox baseline")).toMatchObject({
      ok: true,
      detail: `present: ${markerFile(game)}`,
    });
  });

  it("names the legacy lease store only when it exists, and never fails on it", async () => {
    expect(
      check(await runDoctor(config, { skipGame: true, homeDir: home }), "Legacy lease store"),
    ).toBeUndefined();
    const store = path.join(home, ".vortex-ai", "leases");
    fs.mkdirSync(store, { recursive: true });
    const report = await runDoctor(config, { skipGame: true, homeDir: home });
    expect(check(report, "Legacy lease store")).toEqual({
      name: "Legacy lease store",
      ok: false,
      advisory: true,
      detail: store,
      fix: `delete ${store}; nothing reads it any more`,
    });
    expect(report.ok).toBe(true);
    expect(formatDoctorReport(report)).toContain(`  [--  ] Legacy lease store\n         ${store}`);
  });
});

describe("doctor with an unresolvable target", () => {
  it("reports the target error as the failing Vortex check", async () => {
    const message = "--dev-dir C:/not-built is not a built Vortex checkout: no electron";
    const report = await runDoctor(config, {
      skipGame: true,
      homeDir: home,
      targetError: message,
    });
    expect(report.targetError).toBe(message);
    expect(check(report, "Vortex")).toMatchObject({ ok: false, detail: message });
    expect(check(report, "Vortex (installed)")).toBeUndefined();
    expect(report.ok).toBe(false);
    const text = formatDoctorReport(report);
    expect(text).toContain(`  [FAIL] Vortex\n         ${message}`);
    expect(text).toContain("Not ready");
  });

  it("checks the configured target otherwise", async () => {
    const report = await runDoctor(config, { skipGame: true, homeDir: home });
    expect(report.targetError).toBeUndefined();
    expect(check(report, "Vortex (installed)")?.ok).toBe(true);
  });
});

describe("doctor's This checkout row", () => {
  it("names the session's checkout, or the step that makes one, without failing", async () => {
    expect(checkoutCheck("C:/dev/Vortex")).toEqual({
      name: "This checkout",
      ok: true,
      advisory: true,
      detail: "C:/dev/Vortex",
    });
    const report = await runDoctor(config, { skipGame: true, homeDir: home, checkout: undefined });
    expect(check(report, "This checkout")).toMatchObject({
      ok: false,
      advisory: true,
      fix: "Open Claude in a Vortex checkout or worktree (or clone one with `doodlebot source --clone <dir>`).",
    });
    expect(check(report, "Vortex source")).toBeUndefined();
    expect(report.ok).toBe(true);
  });
});

describe("the Vortex check without an installed Vortex", () => {
  it("accepts a registered official release and names it", () => {
    const check = missingVortexCheck(["2.8.0"]);
    expect(check.ok).toBe(true);
    expect(check.detail).toContain("--release 2.8.0");
  });

  it("is missing with nothing registered, and offers release get first", () => {
    const check = missingVortexCheck([]);
    expect(check.ok).toBe(false);
    expect(check.fix).toMatch(/^doodlebot release get <version>/);
  });
});
