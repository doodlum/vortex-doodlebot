import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fixtureCommand, writeModFixture } from "./fixtureCommand";

let temp: string;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-fixture-"));
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

const contents = (file: string) =>
  Object.fromEntries(
    Object.entries(unzipSync(fs.readFileSync(file))).map(([name, bytes]) => [
      name,
      strFromU8(bytes),
    ]),
  );

describe("doodlebot fixture mod", () => {
  it("writes one textures/automation-probe.txt by default", () => {
    const out = path.join(temp, "nested", "probe.zip");
    expect(fixtureCommand(["mod"], { out })).toBe(
      `fixture: ${out} (textures/automation-probe.txt)`,
    );
    expect(contents(out)).toEqual({ "textures/automation-probe.txt": "automation-probe" });
  });

  it("names the file and its content after --name", () => {
    const out = writeModFixture(path.join(temp, "x.zip"), "my-check_2");
    expect(contents(out)).toEqual({ "textures/my-check_2.txt": "my-check_2" });
  });

  it("refuses a name that is not a plain file name, a missing --out and other kinds", () => {
    for (const name of ["../escape", "a/b", "", "x y"])
      expect(() => writeModFixture(path.join(temp, "x.zip"), name)).toThrow(/--name/);
    expect(() => fixtureCommand(["mod"], {})).toThrow("fixture mod needs --out <zip>.");
    expect(() => fixtureCommand(["collection"], { out: "x" })).toThrow(/fixture mod --out/);
    expect(() => fixtureCommand([], { out: "x" })).toThrow(/fixture mod --out/);
  });
});
