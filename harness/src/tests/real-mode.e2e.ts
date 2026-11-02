/**
 * Opt-in, Linux and Windows: pnpm run ai:test:real-mode.
 *
 * Starts the selected Vortex outside test mode (no VORTEX_E2E), so store detection, discovery
 * and the Games page's Add game run as they do for users, and adds every detected game with real
 * mouse input. JavaScript clicks never run inside Blink's user-input tasks, so they cannot catch
 * failures that only happen there. Fails on a renderer crash, a game that is not added, or an
 * error notification. Needs at least one supported game installed (for example through Steam).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { loadConfig } from "../config";
import { resolveDevElectron } from "../electronRuntime";
import { linuxDisplayArgs } from "../instance";
import { runRealModeProcess } from "../realModeProcess";
import {
  assertRealModeSupported,
  assertRealModeTarget,
  errorNotifications,
  protectProtocolRegistration,
  realModeArgs,
  realModeEnv,
  rendererCrashes,
} from "../realMode";

assertRealModeSupported();
const config = loadConfig();
assertRealModeTarget(config.target.kind);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const work = path.join(config.cacheDir, "real-mode", stamp);
fs.mkdirSync(work, { recursive: true });
let restoreProtocol: (() => void) | undefined;
const { target } = config;
if (target.kind === "dev" && !fs.existsSync(target.executable))
  target.executable = resolveDevElectron(target.args[0]!);
const nodeEnv =
  target.kind === "dev" ? (config.production ? "production" : "development") : undefined;
const stdioPath = path.join(work, "stdio.log");
const launch = () => {
  restoreProtocol = protectProtocolRegistration(work);
  const stdio = fs.openSync(stdioPath, "a");
  try {
    return spawn(
      target.executable,
      [
        ...target.args,
        ...realModeArgs(path.join(work, "config")),
        ...linuxDisplayArgs(),
        `--remote-debugging-port=${String(config.cdpPort)}`,
      ],
      {
        env: realModeEnv(process.env, path.join(work, "config"), nodeEnv),
        cwd: path.dirname(target.executable),
        stdio: ["ignore", stdio, stdio],
      },
    );
  } finally {
    fs.closeSync(stdio);
  }
};

function vortexLog(): string {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "vortex.log") found.push(full);
    }
  };
  const directory = path.join(work, "config");
  if (!fs.existsSync(directory)) return "";
  walk(directory);
  const [only] = found;
  return found.length === 1 && only !== undefined ? fs.readFileSync(only, "utf8") : "";
}

async function rendererPage(): Promise<Page> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${String(config.cdpPort)}`);
      const page = browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().endsWith("index.html"));
      if (page !== undefined) return page;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`No Vortex renderer on CDP; see ${stdioPath}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

const report: Record<string, unknown> = {
  platform: process.platform,
  workDirectory: work,
  target: target.executable,
};
let page: Page | undefined;
let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
const outcome = await runRealModeProcess(
  config,
  launch,
  async () => {
    page = await rendererPage();
    // Refuse to act unless Vortex is really using the private profile.
    await expect.poll(() => vortexLog().length, { timeout: 30_000 }).toBeGreaterThan(0);
    let crashed = false;
    page.on("crash", () => (crashed = true));
    await page
      .getByRole("button", { name: "Games", exact: true })
      .first()
      .click({ timeout: 120_000 });
    const add = page.getByRole("button", { name: "Add game" });
    // The empty-section text also shows while the startup scan is still running.
    await expect
      .poll(() => add.count(), { timeout: 120_000 })
      .toBeGreaterThan(0)
      .catch(() => undefined);
    const detected = await add.count();
    report.detected = await add.evaluateAll((buttons) =>
      buttons.map((button) => {
        let node: Element | null = button;
        for (let depth = 0; depth < 6 && node !== null; depth += 1, node = node.parentElement) {
          const image = node.querySelector("img[alt]");
          if (image !== null) return image.getAttribute("alt");
        }
        return null;
      }),
    );
    if (detected === 0)
      throw new Error(
        "Blocked: no detected games. Install a supported game (for example through Steam).",
      );
    for (let remaining = detected; remaining > 0; remaining -= 1) {
      // Real CDP mouse input: hover, press and release inside Blink's input handling.
      await add.first().hover();
      await add.first().click();
      await expect.poll(() => add.count(), { timeout: 60_000 }).toBe(remaining - 1);
      if (crashed) throw new Error("The renderer crashed after Add game");
    }
    await page.waitForTimeout(5000);
    report.added = detected;
  },
  async () => {
    // Close as a user would (the title bar's Close), so Vortex shuts down normally.
    await page
      ?.getByRole("button", { name: "Close", exact: true })
      .first()
      .click({ timeout: 10_000 })
      .catch(() => undefined);
  },
  { onStopped: () => restoreProtocol?.() },
);
try {
  const log = vortexLog();
  report.rendererCrashes = rendererCrashes(log);
  report.errorNotifications = errorNotifications(log);
} catch (error) {
  outcome.failure ??= (error as Error).message;
} finally {
  try {
    if (!outcome.stopped)
      outcome.failure ??= `Vortex is still running; preserve ${work} and its protocol backup`;
  } catch (error) {
    outcome.failure ??= (error as Error).message;
  }
  await browser?.close().catch(() => undefined);
  Object.assign(report, outcome);
  fs.mkdirSync(config.artifactDir, { recursive: true });
  const evidence = path.join(config.artifactDir, `real-mode-${stamp}.json`);
  fs.writeFileSync(evidence, JSON.stringify(report, null, 2));
  console.log(`Evidence: ${evidence}`);
}
const problems = [
  outcome.failure,
  ((report.rendererCrashes as unknown[]) ?? []).length > 0
    ? "renderer crashes in Vortex's log"
    : undefined,
  ((report.errorNotifications as string[]) ?? []).length > 0
    ? `error notifications: ${(report.errorNotifications as string[]).join("; ")}`
    : undefined,
  report.exitedCleanly ? undefined : `Vortex did not exit normally; see ${stdioPath}`,
].filter((problem): problem is string => problem !== undefined);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Added ${String(report.added)} detected game(s) with real input; no crash or error.`);
}
