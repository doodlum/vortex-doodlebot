/**
 * A relative Vortex checkout reaches the dev target instead of silently falling back to the
 * installed one. Only these cases live here, so a revert check of config.ts runs nothing else.
 * Fixtures are built inside the test bodies (no beforeAll or beforeEach), and only
 * `resolveTarget`, which the base also has, is used.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, it, vi } from "vitest";

import { REPO_ROOT, resolveTarget } from "./config";

/** A checkout with src/main/package.json and a resolvable fake electron module. */
function fakeCheckout(dir: string): string {
  fs.mkdirSync(path.join(dir, "src", "main"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "main", "package.json"), '{"name":"@vortex/main"}');
  const electron = path.join(dir, "node_modules", "electron");
  fs.mkdirSync(electron, { recursive: true });
  fs.writeFileSync(path.join(electron, "package.json"), '{"name":"electron","main":"index.js"}');
  fs.writeFileSync(path.join(electron, "index.js"), "module.exports = 'electron.exe';\n");
  return dir;
}

function clearTargetVariables(): void {
  vi.stubEnv("VORTEX_AI_INSTALLED", undefined);
  vi.stubEnv("VORTEX_AI_EXE", undefined);
  vi.stubEnv("VORTEX_AI_SOURCE_DIR", undefined);
  vi.stubEnv("VORTEX_AI_DEV_DIR", undefined);
}

const real = (dir: string) => fs.realpathSync.native(dir);

it("resolves a relative explicit devDir against the working directory", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "reldev-"));
  const fixture = fakeCheckout(path.join(parent, "vortex-checkout"));
  const previous = process.cwd();
  clearTargetVariables();
  try {
    process.chdir(parent);
    const target = resolveTarget({ devDir: "vortex-checkout" });
    expect(target.kind).toBe("dev");
    expect(real(target.sourceDir!)).toBe(real(fixture));
  } finally {
    process.chdir(previous);
    vi.unstubAllEnvs();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

it("resolves a relative VORTEX_AI_DEV_DIR against the workspace root", () => {
  const fixture = fakeCheckout(
    path.join(
      REPO_ROOT,
      "harness",
      ".cache",
      `tmp-reldev-${crypto.randomBytes(4).toString("hex")}`,
    ),
  );
  const previous = process.cwd();
  clearTargetVariables();
  try {
    // Somewhere else, so only the workspace root can make the relative variable resolve.
    process.chdir(os.tmpdir());
    vi.stubEnv("VORTEX_AI_DEV_DIR", path.relative(REPO_ROOT, fixture));
    const target = resolveTarget();
    expect(target.kind).toBe("dev");
    expect(real(target.sourceDir!)).toBe(real(fixture));
  } finally {
    process.chdir(previous);
    vi.unstubAllEnvs();
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
