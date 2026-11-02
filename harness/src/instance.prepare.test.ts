import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { prepareUserDataDir } from "./instance";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("prepareUserDataDir", () => {
  it("marks the plugins folder CommonJS, so a downloaded extension loads under harness/", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-profile-"));
    dirs.push(dir);
    prepareUserDataDir(dir, "@vortex/main");
    const marker = path.join(dir, "userData", "plugins", "package.json");
    expect(JSON.parse(fs.readFileSync(marker, "utf8"))).toEqual({ type: "commonjs" });
    // A second preparation keeps what is there.
    fs.writeFileSync(marker, '{ "type": "commonjs", "kept": true }');
    prepareUserDataDir(dir, "@vortex/main");
    expect(JSON.parse(fs.readFileSync(marker, "utf8")).kept).toBe(true);
  });
});
