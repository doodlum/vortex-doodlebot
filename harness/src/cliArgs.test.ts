import path from "node:path";

import { describe, expect, it } from "vitest";

import { BOOLEAN_FLAGS, PATH_FLAGS, SCRIPT_KIT_FLAGS, parseArgs } from "./cliArgs";

/** The caller's directory in these cases: never the workspace the CLI runs in. */
const CALLER = path.resolve("/caller/dir");
const at = (value: string): string => path.resolve(CALLER, value);
const parse = (argv: string[]) => parseArgs(argv, CALLER);

describe("parseArgs", () => {
  it.each(["--build", "--build=true", "--build=false"])("rejects obsolete watch %s", (flag) => {
    expect(() => parse(["watch", flag])).toThrow(/remove obsolete --build/);
    expect(parse(["source", "--build"]).flags.build).toBe(true);
  });

  it("drops a separator forwarded before the command", () => {
    expect(parse(["--", "snapshot", "x"])).toMatchObject({
      command: "snapshot",
      positional: ["x"],
    });
  });

  it("keeps setup's --no-wait as a switch", () => {
    expect(parse(["setup", "--oauth", "--no-wait"]).flags).toEqual({
      oauth: true,
      "no-wait": true,
    });
  });

  it("knows none of the removed multi-instance switches", () => {
    expect(BOOLEAN_FLAGS.has("checkout-only")).toBe(false);
    expect([...SCRIPT_KIT_FLAGS].sort()).toEqual(["cache-dir", "cdp-port", "dev-dir", "port"]);
  });

  it("takes script's --cache-dir before or after the file, and passes the rest on", () => {
    const before = parse(["script", "--cache-dir", "C:/c", "probe.mts", "label", "--mode", "x"]);
    const after = parse(["script", "probe.mts", "label", "--cache-dir", "C:/c", "--mode", "x"]);
    for (const parsed of [before, after]) {
      expect(parsed.positional).toEqual([at("probe.mts")]);
      expect(parsed.flags["cache-dir"]).toBe(at("C:/c"));
      expect(parsed.passthrough).toEqual(["label", "--mode", "x"]);
    }
    const inline = parse(["script", "probe.mts", "--port=3800", "--cache-dir=C:/c", "a"]);
    expect(inline.flags).toMatchObject({ port: "3800", "cache-dir": at("C:/c") });
    expect(inline.passthrough).toEqual(["a"]);
  });

  it("takes the flags that pick the instance after the file too", () => {
    const parsed = parse(["script", "probe.mts", "--dev-dir", "C:/vx", "--port", "3800", "x"]);
    expect(parsed.flags).toMatchObject({ "dev-dir": at("C:/vx"), port: "3800" });
    expect(parsed.passthrough).toEqual(["x"]);
  });

  it("gives the script everything after a bare --, its own --cache-dir included", () => {
    const parsed = parse([
      "script",
      "probe.mts",
      "--cache-dir",
      "C:/c",
      "--",
      "--cache-dir",
      "theirs",
    ]);
    expect(parsed.flags["cache-dir"]).toBe(at("C:/c"));
    expect(parsed.passthrough).toEqual(["--cache-dir", "theirs"]);
  });

  it("refuses a kit flag with no value after a script's path", () => {
    expect(() => parse(["script", "probe.mts", "--cache-dir"])).toThrow(
      /--cache-dir needs a value/,
    );
  });

  it("repeats list flags", () => {
    expect(parse(["pr-preflight", "--test", "a", "--test", "b"]).lists.test).toEqual(["a", "b"]);
  });

  it("reads game and release subcommands and their flags", () => {
    expect(
      parse(["game", "restore", "fallout4", "--file", "a.ini", "--file", "b.ini"]),
    ).toMatchObject({
      command: "game",
      positional: ["restore", "fallout4"],
      lists: { file: [at("a.ini"), at("b.ini")] },
    });
    // --all is a switch: it neither swallows the next flag nor needs a value.
    expect(parse(["game", "restore", "fallout4", "--all", "--json"]).flags).toEqual({
      all: true,
      json: true,
    });
    expect(parse(["game", "copy", "fallout4", "--to", "copies"]).flags).toEqual({
      to: at("copies"),
    });
    expect(parse(["up", "--release", "2.8.0"]).flags).toEqual({ release: "2.8.0" });
  });

  it.each([true, false])("preserves evidence command flags with separator=%s", (separator) => {
    const parsed = parse([
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
      checkout: at("C:/repo"),
      out: at("C:/evidence.json"),
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

describe("path rules", () => {
  it.each([...PATH_FLAGS])("resolves --%s against the caller's directory", (flag) => {
    expect(parse(["doctor", `--${flag}`, "rel/x"]).flags[flag]).toBe(at("rel/x"));
    expect(parse(["doctor", `--${flag}=rel/y`]).flags[flag]).toBe(at("rel/y"));
  });

  it("lists exactly the designed path flags", () => {
    expect([...PATH_FLAGS].sort()).toEqual(
      [
        "dev-dir",
        "checkout",
        "out",
        "cache-dir",
        "artifact-dir",
        "game-path",
        "test-report",
        "runtime",
        "manifest",
        "exe",
        "bin-dir",
        "args-file",
        "from",
        "cwd",
        "compare",
        "ffmpeg",
        "a",
        "b",
        "to",
        "file",
      ].sort(),
    );
  });

  it("keeps a bare --ffmpeg command name for the PATH lookup", () => {
    expect(parse(["record", "--ffmpeg", "ffmpeg"]).flags.ffmpeg).toBe("ffmpeg");
    expect(parse(["record", "--ffmpeg", "tools/ffmpeg.exe"]).flags.ffmpeg).toBe(
      at("tools/ffmpeg.exe"),
    );
  });

  it("keeps an absolute path as it is", () => {
    const absolute = path.resolve("/elsewhere/checkout");
    expect(parse(["build", "--checkout", absolute]).flags.checkout).toBe(absolute);
  });

  it("resolves every value of the repeated --a and --b, read from the lists", () => {
    const parsed = parse([
      "perf-summary",
      "--check",
      "mods-scroll",
      "--a",
      "a1.json",
      "--a=a2.json",
      "--b",
      "b1.json",
      "--b",
      "b2.json",
    ]);
    expect(parsed.lists.a).toEqual([at("a1.json"), at("a2.json")]);
    expect(parsed.lists.b).toEqual([at("b1.json"), at("b2.json")]);
    expect(parsed.flags.check).toBe("mods-scroll");
  });

  it.each([
    [["game", "register", "fallout4", "copies/fallout4"], [2]],
    [["game", "copy", "fallout4"], []],
    [["script", "probe.mts"], [0]],
    [["eval", "probe.js"], [0]],
    [["install", "mod.zip"], [0]],
    [
      ["evidence", "runtime", "Vortex.exe", "app.asar"],
      [1, 2],
    ],
  ])("resolves the file arguments of %j", (argv, indexes) => {
    const parsed = parse(argv);
    parsed.positional.forEach((value, index) => {
      const original = argv.filter((arg) => !arg.startsWith("--"))[index + 1]!;
      expect(value).toBe(indexes.includes(index) ? at(original) : original);
    });
  });

  it("leaves pr-preflight's checkout-relative tests and vortex-e2e's specs alone", () => {
    const preflight = parse([
      "pr-preflight",
      "--test",
      "src/a.test.ts",
      "--revert",
      "src/a.ts",
      "--revert-hunk",
      "src/b.ts:12",
      "--project-dir",
      "src/renderer",
      "src/c.test.ts",
    ]);
    expect(preflight.lists.test).toEqual(["src/a.test.ts"]);
    expect(preflight.flags).toMatchObject({
      revert: "src/a.ts",
      "revert-hunk": "src/b.ts:12",
      "project-dir": "src/renderer",
    });
    expect(preflight.positional).toEqual(["src/c.test.ts"]);
    expect(parse(["vortex-e2e", "--spec", "tests/x.spec.ts"]).flags.spec).toBe("tests/x.spec.ts");
    expect(parse(["design", "other", "d.md"]).positional).toEqual(["other", "d.md"]);
  });

  it("passes everything after test <suite> through verbatim, unresolved", () => {
    const parsed = parse([
      "test",
      "core",
      "--reporter=json",
      "--grep",
      "x",
      "--out",
      "rel",
      "--",
      "--list",
    ]);
    expect(parsed.positional).toEqual(["core"]);
    expect(parsed.flags).toEqual({});
    expect(parsed.passthrough).toEqual([
      "--reporter=json",
      "--grep",
      "x",
      "--out",
      "rel",
      "--",
      "--list",
    ]);
  });

  it("reads test --list as a switch", () => {
    expect(parse(["test", "--list"])).toMatchObject({
      positional: [],
      flags: { list: true },
      passthrough: [],
    });
    expect(BOOLEAN_FLAGS.has("json")).toBe(true);
  });

  it("defaults to the caller's directory from INIT_CWD", () => {
    const previous = process.env.INIT_CWD;
    process.env.INIT_CWD = CALLER;
    try {
      expect(parseArgs(["build", "--checkout", "vx"]).flags.checkout).toBe(at("vx"));
    } finally {
      if (previous === undefined) delete process.env.INIT_CWD;
      else process.env.INIT_CWD = previous;
    }
  });
});
