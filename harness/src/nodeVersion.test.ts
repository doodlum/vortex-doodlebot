import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { REPO_ROOT } from "./paths";

const { DEFAULT_MINIMUM, minimumNode, nodeVersionProblem } = createRequire(import.meta.url)(
  path.join(REPO_ROOT, "bin", "nodeVersion.cjs"),
) as {
  DEFAULT_MINIMUM: string;
  minimumNode: (root: string) => string;
  nodeVersionProblem: (version: string, minimum: string) => string | undefined;
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("the doodlebot command's Node check", () => {
  it("names the minimum and this Node's version when Node is too old", () => {
    expect(nodeVersionProblem("v18.20.4", "20.19")).toBe(
      "doodlebot needs Node 20.19 or newer; this is v18.20.4",
    );
    expect(nodeVersionProblem("v20.18.9", "20.19")).toMatch(/needs Node 20\.19 or newer/);
    for (const ok of ["v20.19.0", "v20.19.5", "v22.0.0", "v24.20.0"])
      expect(nodeVersionProblem(ok, "20.19"), ok).toBeUndefined();
  });

  it("reads the minimum from package.json's engines, else 20.19", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      engines?: { node?: string };
    };
    expect(pkg.engines?.node).toBe(`>=${minimumNode(REPO_ROOT)}`);
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "node-version-"));
    dirs.push(bare);
    fs.writeFileSync(path.join(bare, "package.json"), "{}");
    expect(minimumNode(bare)).toBe(DEFAULT_MINIMUM);
    expect(DEFAULT_MINIMUM).toBe("20.19");
  });

  it("runs before anything else in bin/doodlebot.cjs", () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, "bin", "doodlebot.cjs"), "utf8");
    expect(text.indexOf("nodeVersionProblem(")).toBeGreaterThan(-1);
    expect(text.indexOf("nodeVersionProblem(")).toBeLessThan(text.indexOf('command === "update"'));
    expect(text.indexOf("nodeVersionProblem(")).toBeLessThan(text.indexOf("spawn("));
  });
});
