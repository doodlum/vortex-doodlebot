import { describe, expect, it } from "vitest";

import { BOOLEAN_FLAGS, SCRIPT_KIT_FLAGS, parseArgs } from "./cliArgs";

describe("parseArgs", () => {
  it.each(["--build", "--build=true", "--build=false"])("rejects obsolete watch %s", (flag) => {
    expect(() => parseArgs(["watch", flag])).toThrow(/remove obsolete --build/);
    expect(parseArgs(["source", "--build"]).flags.build).toBe(true);
  });

  it("drops the separator pnpm forwards before the command", () => {
    expect(parseArgs(["--", "snapshot", "x"])).toMatchObject({
      command: "snapshot",
      positional: ["x"],
    });
  });

  it("keeps setup's --no-wait as a switch", () => {
    expect(parseArgs(["setup", "--oauth", "--no-wait"]).flags).toEqual({
      oauth: true,
      "no-wait": true,
    });
  });

  it("knows none of the removed multi-instance switches", () => {
    expect(BOOLEAN_FLAGS.has("checkout-only")).toBe(false);
    expect([...SCRIPT_KIT_FLAGS].sort()).toEqual(["cache-dir", "cdp-port", "dev-dir", "port"]);
  });

  it("takes script's --cache-dir before or after the file, and passes the rest on", () => {
    const before = parseArgs([
      "script",
      "--cache-dir",
      "C:/c",
      "probe.mts",
      "label",
      "--mode",
      "x",
    ]);
    const after = parseArgs(["script", "probe.mts", "label", "--cache-dir", "C:/c", "--mode", "x"]);
    for (const parsed of [before, after]) {
      expect(parsed.positional).toEqual(["probe.mts"]);
      expect(parsed.flags["cache-dir"]).toBe("C:/c");
      expect(parsed.passthrough).toEqual(["label", "--mode", "x"]);
    }
    const inline = parseArgs(["script", "probe.mts", "--port=3800", "--cache-dir=C:/c", "a"]);
    expect(inline.flags).toMatchObject({ port: "3800", "cache-dir": "C:/c" });
    expect(inline.passthrough).toEqual(["a"]);
  });

  it("takes the flags that pick the instance after the file too", () => {
    const parsed = parseArgs(["script", "probe.mts", "--dev-dir", "C:/vx", "--port", "3800", "x"]);
    expect(parsed.flags).toMatchObject({ "dev-dir": "C:/vx", port: "3800" });
    expect(parsed.passthrough).toEqual(["x"]);
  });

  it("gives the script everything after a bare --, its own --cache-dir included", () => {
    const parsed = parseArgs([
      "script",
      "probe.mts",
      "--cache-dir",
      "C:/c",
      "--",
      "--cache-dir",
      "theirs",
    ]);
    expect(parsed.flags["cache-dir"]).toBe("C:/c");
    expect(parsed.passthrough).toEqual(["--cache-dir", "theirs"]);
  });

  it("refuses a kit flag with no value after a script's path", () => {
    expect(() => parseArgs(["script", "probe.mts", "--cache-dir"])).toThrow(
      /--cache-dir needs a value/,
    );
  });

  it("repeats list flags", () => {
    expect(parseArgs(["pr-preflight", "--test", "a", "--test", "b"]).lists.test).toEqual([
      "a",
      "b",
    ]);
  });

  it("reads design subcommands and their flags", () => {
    expect(
      parseArgs(["design", "scope", "designs/x.md", "--checkout", ".", "--base", "abc", "--json"]),
    ).toMatchObject({
      command: "design",
      positional: ["scope", "designs/x.md"],
      flags: { checkout: ".", base: "abc", json: true },
    });
    expect(parseArgs(["design", "check", "designs/x.md", "--ready"]).flags).toEqual({
      ready: true,
    });
    // --ready is a switch: it neither swallows the next flag nor needs a value.
    expect(parseArgs(["design", "check", "x.md", "--ready", "--json"])).toMatchObject({
      positional: ["check", "x.md"],
      flags: { ready: true, json: true },
    });
  });

  it.each([true, false])("preserves evidence command flags with separator=%s", (separator) => {
    const parsed = parseArgs([
      "evidence",
      "run",
      "--checkout",
      "C:/repo",
      "--out",
      "C:/evidence.json",
      ...(separator ? ["--"] : []),
      "node",
      "check.cjs",
      "--label",
      "child-value",
      "--json",
      "--reporter=json",
    ]);
    expect(parsed.flags).toEqual({
      checkout: "C:/repo",
      out: "C:/evidence.json",
    });
    expect(parsed.positional).toEqual(["run"]);
    expect(parsed.passthrough).toEqual([
      "node",
      "check.cjs",
      "--label",
      "child-value",
      "--json",
      "--reporter=json",
    ]);
  });
});
