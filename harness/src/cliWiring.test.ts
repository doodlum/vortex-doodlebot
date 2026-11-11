/**
 * The CLI's own wiring, through the real entry point: `checkoutFlag` for commands that need
 * source, and `configFrom`/`LAUNCHES` for a launch from an unbuilt session checkout. Nothing here
 * can start Vortex: every refusal comes before a launch, and no installed Vortex is findable
 * (VORTEX_AI_EXE, ProgramFiles and LOCALAPPDATA point into the temp folder).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NEEDS_CHECKOUT } from "./config";
import { REPO_ROOT } from "./paths";
import { runEvidenceProcess } from "./processRunner";

let root: string;
const cli = (cwd: string, ...args: string[]) =>
  runEvidenceProcess({
    executable: process.execPath,
    args: ["--import", "tsx", path.join(REPO_ROOT, "harness", "src", "cli.ts"), ...args],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      INIT_CWD: cwd,
      VORTEX_AI_EXE: path.join(root, "none", "Vortex.exe"),
      VORTEX_AI_INSTALLED: "",
      ProgramFiles: path.join(root, "pf"),
      LOCALAPPDATA: path.join(root, "lad"),
    },
  });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cli-wiring-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("the CLI's checkout wiring", { timeout: 120_000 }, () => {
  it("build refuses outside a checkout with the one step (checkoutFlag)", async () => {
    const plain = path.join(root, "plain");
    fs.mkdirSync(plain);
    const result = await cli(plain, "build");
    expect(result.code).toBe(1);
    expect(result.output).toContain(NEEDS_CHECKOUT);
  });

  it("up from an unbuilt session checkout refuses with the build command (configFrom, LAUNCHES)", async () => {
    const checkout = path.join(root, "vortex");
    fs.mkdirSync(path.join(checkout, "src", "main"), { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", checkout, ...args], { encoding: "utf8", windowsHide: true });
    git("init", "-q", "-b", "master");
    fs.writeFileSync(path.join(checkout, "package.json"), '{"name":"@vortex/monorepo"}');
    fs.writeFileSync(path.join(checkout, "src", "main", "package.json"), '{"name":"@vortex/main"}');
    const result = await cli(path.join(checkout, "src"), "up", "--sandbox");
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/This session's checkout .* is not built/);
    expect(result.output).toContain("doodlebot build --checkout");
  });
});
