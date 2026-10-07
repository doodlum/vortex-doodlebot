import { describe, expect, it } from "vitest";

import { parseArgs } from "./cliArgs";

describe("parseArgs", () => {
  it("carries the original kit unlock acquisition separately from recovery force", () => {
    expect(
      parseArgs(["kit", "unlock", "--owner", "qa", "--acquisition", "original-id"]),
    ).toMatchObject({
      command: "kit",
      positional: ["unlock"],
      flags: { owner: "qa", acquisition: "original-id" },
    });
    expect(parseArgs(["kit", "unlock", "--owner", "qa", "--force"]).flags).toEqual({
      owner: "qa",
      force: true,
    });
  });
  it.each(["--build", "--build=true", "--build=false"])("rejects obsolete watch %s", (flag) => {
    expect(() => parseArgs(["watch", flag])).toThrow(/remove obsolete --build/);
    expect(parseArgs(["source", "--build"]).flags.build).toBe(true);
  });

  it("drops the separator pnpm forwards before the command", () => {
    expect(parseArgs(["--", "lease", "status"])).toMatchObject({
      command: "lease",
      positional: ["status"],
    });
  });

  it("takes script's --owner and --wait before or after the file, and passes the rest on", () => {
    const before = parseArgs(["script", "--owner", "qa", "probe.mts", "label", "--mode", "x"]);
    const after = parseArgs(["script", "probe.mts", "label", "--owner", "qa", "--mode", "x"]);
    for (const parsed of [before, after]) {
      expect(parsed.positional).toEqual(["probe.mts"]);
      expect(parsed.flags.owner).toBe("qa");
      expect(parsed.passthrough).toEqual(["label", "--mode", "x"]);
    }
    const inline = parseArgs(["script", "probe.mts", "--wait=5", "--owner=qa", "a"]);
    expect(inline.flags).toMatchObject({ wait: "5", owner: "qa" });
    expect(inline.passthrough).toEqual(["a"]);
  });

  it("takes the flags that pick the instance after the file too", () => {
    const parsed = parseArgs(["script", "probe.mts", "--slot", "auto", "--worktree", "fix-a", "x"]);
    expect(parsed.flags).toMatchObject({ slot: "auto", worktree: "fix-a" });
    expect(parsed.passthrough).toEqual(["x"]);
  });

  it("gives the script everything after a bare --, its own --owner included", () => {
    const parsed = parseArgs(["script", "probe.mts", "--owner", "qa", "--", "--owner", "theirs"]);
    expect(parsed.flags.owner).toBe("qa");
    expect(parsed.passthrough).toEqual(["--owner", "theirs"]);
  });

  it("refuses a kit flag with no value after a script's path", () => {
    expect(() => parseArgs(["script", "probe.mts", "--owner"])).toThrow(/--owner needs a value/);
  });

  it("starts lease run's command at its first word", () => {
    const parsed = parseArgs(["lease", "run", "--owner", "qa", "pnpm", "run", "verify", "--x"]);
    expect(parsed.flags.owner).toBe("qa");
    expect(parsed.passthrough).toEqual(["pnpm", "run", "verify", "--x"]);
  });

  it("reads --checkout-only as a switch and repeats list flags", () => {
    const parsed = parseArgs([
      "lease",
      "acquire",
      "--checkout",
      "C:/dev/vx",
      "--checkout-only",
      "--owner",
      "qa",
    ]);
    expect(parsed.flags).toMatchObject({ checkout: "C:/dev/vx", "checkout-only": true });
    expect(parseArgs(["pr-preflight", "--test", "a", "--test", "b"]).lists.test).toEqual([
      "a",
      "b",
    ]);
  });

  it.each([true, false])("preserves evidence command flags with separator=%s", (separator) => {
    const parsed = parseArgs([
      "evidence",
      "run",
      "--owner",
      "collector",
      "--checkout",
      "C:/repo",
      "--out",
      "C:/evidence.json",
      ...(separator ? ["--"] : []),
      "node",
      "check.cjs",
      "--owner",
      "child-value",
      "--json",
      "--reporter=json",
    ]);
    expect(parsed.flags).toEqual({
      owner: "collector",
      checkout: "C:/repo",
      out: "C:/evidence.json",
    });
    expect(parsed.positional).toEqual(["run"]);
    expect(parsed.passthrough).toEqual([
      "node",
      "check.cjs",
      "--owner",
      "child-value",
      "--json",
      "--reporter=json",
    ]);
  });
});
