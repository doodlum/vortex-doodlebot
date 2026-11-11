import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { JSDOM } from "jsdom";

import { fixtureCommand, writeFomodFixture, writeModFixture } from "./fixtureCommand";

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

  it("writes a FOMOD archive whose ModuleConfig.xml has one step and one option, and its files", () => {
    const out = path.join(temp, "fomod.zip");
    expect(fixtureCommand(["fomod"], { out, name: "probe" })).toBe(
      `fixture: ${out} (FOMOD installer: one step, option "probe option")`,
    );
    const files = contents(out);
    expect(Object.keys(files).toSorted()).toEqual([
      "core/textures/probe.txt",
      "fomod/ModuleConfig.xml",
      "fomod/info.xml",
      "option/textures/probe-option.txt",
    ]);

    const xml = new JSDOM("").window.DOMParser;
    const config = new xml().parseFromString(
      files["fomod/ModuleConfig.xml"] ?? "",
      "application/xml",
    );
    expect(config.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(config.documentElement.tagName).toBe("config");
    expect(config.querySelector("moduleName")?.textContent).toBe("probe");
    expect(config.querySelectorAll("installSteps > installStep")).toHaveLength(1);
    const options = config.querySelectorAll("installStep group plugins > plugin");
    expect(options).toHaveLength(1);
    expect(options[0]?.getAttribute("name")).toBe("probe option");

    // Every source the script names is in the archive.
    const sources = [...config.querySelectorAll("file")].map((f) => f.getAttribute("source"));
    expect(sources).toEqual(["core/textures/probe.txt", "option/textures/probe-option.txt"]);
    for (const source of sources) expect(files).toHaveProperty([source ?? ""]);

    const info = new xml().parseFromString(files["fomod/info.xml"] ?? "", "application/xml");
    expect(info.getElementsByTagName("parsererror")).toHaveLength(0);
  });

  it("refuses a name that is not a plain file name, a missing --out and other kinds", () => {
    for (const name of ["../escape", "a/b", "", "x y"])
      expect(() => writeModFixture(path.join(temp, "x.zip"), name)).toThrow(/--name/);
    expect(() => fixtureCommand(["mod"], {})).toThrow("fixture mod needs --out <zip>.");
    expect(() => fixtureCommand(["collection"], { out: "x" })).toThrow(/fixture mod\|fomod --out/);
    expect(() => fixtureCommand([], { out: "x" })).toThrow(/fixture mod\|fomod --out/);
    expect(() => fixtureCommand(["fomod"], {})).toThrow("fixture fomod needs --out <zip>.");
    expect(() => writeFomodFixture(path.join(temp, "x.zip"), "../escape")).toThrow(/--name/);
  });
});
