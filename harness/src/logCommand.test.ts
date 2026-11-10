import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { filterLog, levelRank, logBlocks, logCommand, logOptionsFrom } from "./logCommand";

const LOG = [
  "2026-11-10T09:00:00.000Z [debug] [main] starting",
  "2026-11-10T09:00:01.000Z [info] [main] loaded 3 extensions",
  '2026-11-10T09:00:02.000Z [warn] [renderer] slow write {"ms":120}',
  "2026-11-10T09:00:03.000Z [error] [renderer] install failed",
  "Error: ENOENT: no such file",
  "    at open (node:fs:1:1)",
  "",
  "2026-11-10T09:00:04.000Z [silly] [main] chatter",
  "2026-11-10T09:00:05.000Z [WARN] [main] shouting",
  "2026-11-10T09:00:06.000Z [notice] [main] odd level",
  "2026-11-10T09:00:07.000Z [Error] [renderer] second failure",
].join("\r\n");

// Lines as Vortex really writes them: four-letter level codes (copied in form from a live
// harness profile's vortex.log, messages shortened).
const REAL_LOG = [
  '2026-11-10T12:37:46.015Z [DEBG] [MAIN] [elevation-trace] main entry {"pid":7932}',
  "2026-11-10T12:37:47.000Z [INFO] [RENDERER] loaded extensions",
  '2026-11-10T12:37:48.286Z [WARN] [RENDERER] migration sequence failed {"err":"Invalid Version: "}',
  "2026-11-10T12:37:49.000Z [ERRO] [RENDERER] failed to deploy",
  "Error: EPERM: operation not permitted",
  "    at deploy (renderer.js:1:1)",
].join("\n");

describe("doodlebot log", () => {
  it("ranks Vortex's four-letter codes: DEBG < INFO < WARN < ERRO", () => {
    expect(["DEBG", "INFO", "WARN", "ERRO"].map(levelRank)).toEqual([0, 1, 2, 3]);
    expect(levelRank("ERRO")).toBe(levelRank("error"));
  });

  it("keeps ERRO lines, with their stack, at the default warn level and at error", () => {
    expect(filterLog(REAL_LOG).map((b) => [b.entry.level, b.entry.message])).toEqual([
      ["WARN", "migration sequence failed"],
      ["ERRO", "failed to deploy"],
    ]);
    const errors = filterLog(REAL_LOG, { level: "error" });
    expect(errors).toHaveLength(1);
    expect(errors[0]!.lines).toHaveLength(3);
  });

  it("ranks levels case-insensitively, an unknown one as info", () => {
    expect(["debug", "silly", "verbose"].map(levelRank)).toEqual([0, 0, 0]);
    expect(["info", "INFO", "notice", "weird"].map(levelRank)).toEqual([1, 1, 1, 1]);
    expect(levelRank("Warn")).toBeLessThan(levelRank("error"));
  });

  it("keeps warnings and errors by default", () => {
    expect(filterLog(LOG).map((b) => b.entry.message)).toEqual([
      "slow write",
      "install failed",
      "shouting",
      "second failure",
    ]);
  });

  it("treats --level as a threshold", () => {
    expect(filterLog(LOG, { level: "error" }).map((b) => b.entry.message)).toEqual([
      "install failed",
      "second failure",
    ]);
    expect(filterLog(LOG, { level: "info" }).map((b) => b.entry.message)).toEqual([
      "loaded 3 extensions",
      "slow write",
      "install failed",
      "shouting",
      "odd level",
      "second failure",
    ]);
  });

  it("keeps entries at or after --since", () => {
    expect(
      filterLog(LOG, { level: "info", since: "2026-11-10T09:00:05.000Z" }).map(
        (b) => b.entry.message,
      ),
    ).toEqual(["shouting", "odd level", "second failure"]);
  });

  it("keeps the last --tail matches", () => {
    expect(filterLog(LOG, { tail: 2 }).map((b) => b.entry.message)).toEqual([
      "shouting",
      "second failure",
    ]);
    expect(filterLog(LOG, { tail: 0 })).toEqual([]);
    const many = Array.from(
      { length: 60 },
      (_, i) => `2026-11-10T09:00:00.000Z [warn] [main] w${String(i)}`,
    ).join("\n");
    expect(filterLog(many)).toHaveLength(50);
    expect(filterLog(many)[0]!.entry.message).toBe("w10");
  });

  it("keeps continuation lines under the entry they follow", () => {
    const blocks = logBlocks(LOG);
    const failed = blocks.find((b) => b.entry.message === "install failed")!;
    expect(failed.lines).toEqual([
      "2026-11-10T09:00:03.000Z [error] [renderer] install failed",
      "Error: ENOENT: no such file",
      "    at open (node:fs:1:1)",
    ]);
  });

  describe("output", () => {
    let temp: string;
    let file: string;
    beforeEach(() => {
      temp = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-log-"));
      file = path.join(temp, "vortex.log");
      fs.writeFileSync(file, LOG);
    });
    afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

    it("prints each entry's raw lines", () => {
      expect(logCommand(file, { level: "error" })).toBe(
        [
          "2026-11-10T09:00:03.000Z [error] [renderer] install failed",
          "Error: ENOENT: no such file",
          "    at open (node:fs:1:1)",
          "2026-11-10T09:00:07.000Z [Error] [renderer] second failure",
        ].join("\n"),
      );
    });

    it("prints LogEntry[] with --json, continuation lines in the message", () => {
      expect(JSON.parse(logCommand(file, { level: "warn", tail: "3", json: true }))).toEqual([
        {
          time: "2026-11-10T09:00:03.000Z",
          level: "error",
          process: "renderer",
          message: "install failed\nError: ENOENT: no such file\n    at open (node:fs:1:1)",
        },
        { time: "2026-11-10T09:00:05.000Z", level: "WARN", process: "main", message: "shouting" },
        {
          time: "2026-11-10T09:00:07.000Z",
          level: "Error",
          process: "renderer",
          message: "second failure",
        },
      ]);
    });

    it("refuses bad options and a missing log", () => {
      expect(() => logOptionsFrom({ level: "debug" })).toThrow(/--level/);
      expect(() => logOptionsFrom({ tail: "-1" })).toThrow(/--tail/);
      expect(() => logOptionsFrom({ since: "yesterday" })).toThrow(/--since/);
      expect(() => logCommand(path.join(temp, "missing.log"), {})).toThrow(/No Vortex log/);
    });
  });
});
