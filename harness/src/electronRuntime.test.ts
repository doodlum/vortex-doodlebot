import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const exec = promisify(execFile);
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture(failOnce = false): { root: string; run: () => Promise<string> } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "electron runtime "));
  roots.push(root);
  const pkg = path.join(root, "node_modules", "electron");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  fs.writeFileSync(path.join(pkg, "package.json"), '{"main":"index.cjs"}');
  fs.writeFileSync(
    path.join(pkg, "index.cjs"),
    `
const fs = require('fs');
const path = require('path');
const binary = path.join(__dirname, 'electron.exe');
if (!fs.existsSync(binary)) {
  fs.appendFileSync(path.join(__dirname, 'installs'), 'install\\n');
  const marker = path.join(__dirname, 'attempted');
  if (${String(failOnce)} && !fs.existsSync(marker)) {
    fs.writeFileSync(marker, 'yes');
    throw new Error('download interrupted');
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  fs.writeFileSync(binary, 'fixture executable');
}
module.exports = binary;
`,
  );
  const script = path.join(root, "resolve.mts");
  fs.writeFileSync(
    script,
    `
import { resolveDevElectron } from ${JSON.stringify(pathToFileURL(path.resolve("harness/src/electronRuntime.ts")).href)};
console.log(resolveDevElectron(${JSON.stringify(root)}));
`,
  );
  return {
    root,
    run: async () =>
      (
        await exec(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), script])
      ).stdout.trim(),
  };
}

it("installs a missing Electron once and then reuses it", async () => {
  const { root, run } = fixture();
  const first = await run();
  expect(fs.readFileSync(first, "utf8")).toBe("fixture executable");
  expect(await run()).toBe(first);
  expect(fs.readFileSync(path.join(root, "node_modules/electron/installs"), "utf8")).toBe(
    "install\n",
  );
  expect(fs.existsSync(path.join(root, "node_modules/electron/.doodlebot-install"))).toBe(false);
});

it("a later process retries an interrupted installation", async () => {
  const { run } = fixture(true);
  await expect(run()).rejects.toThrow("download interrupted");
  expect(fs.existsSync(await run())).toBe(true);
});
