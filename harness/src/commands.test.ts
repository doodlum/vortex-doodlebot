import { createRequire } from "node:module";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { commands, findCommand } from "./commands";
import { REPO_ROOT } from "./paths";

/** scripts/cli-commands.cjs, typed here so the harness needs no .d.cts and no allowJs. */
interface CliCommandsModule {
  dispatchedCommands(sourceFile: ts.SourceFile): string[];
  dispatchedCommandsInFile(file: string): string[];
}
const { dispatchedCommands, dispatchedCommandsInFile } = createRequire(import.meta.url)(
  path.join(REPO_ROOT, "scripts", "cli-commands.cjs"),
) as CliCommandsModule;

const source = (text: string, file = "fixture.ts") =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

describe("the command list", () => {
  it("is exactly what cli.ts dispatches, besides help and the shim's own", () => {
    const dispatched = dispatchedCommandsInFile(path.join(REPO_ROOT, "harness", "src", "cli.ts"));
    expect(dispatched).toContain("help");
    expect(dispatched.filter((name) => name !== "help")).toEqual(
      commands
        .filter((command) => command.handledBy === undefined)
        .map((command) => command.name)
        .sort(),
    );
  });

  it("names as handledBy bin exactly what bin/doodlebot.cjs handles itself", () => {
    expect(dispatchedCommandsInFile(path.join(REPO_ROOT, "bin", "doodlebot.cjs"))).toEqual(
      commands
        .filter((command) => command.handledBy === "bin")
        .map((command) => command.name)
        .sort(),
    );
    expect(findCommand("update")?.handledBy).toBe("bin");
  });

  it("lists each command once, with the designed sub-commands", () => {
    const names = commands.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of ["version", "test", "link", "fixture", "log", "perf-summary", "update"])
      expect(names).toContain(name);
    expect(findCommand("evidence")?.subcommands).toEqual(["identity", "run", "runtime"]);
    for (const removed of ["design", "readiness"]) expect(findCommand(removed)).toBeUndefined();
    expect(findCommand("fixture")?.subcommands).toEqual(["mod"]);
    expect(findCommand("knowledge")?.subcommands).toEqual([
      "add",
      "search",
      "list",
      "remove",
      "path",
    ]);
    expect(commands.filter((command) => command.subcommands !== undefined)).toHaveLength(3);
    expect(findCommand("help")).toBeUndefined();
  });
});

describe("dispatchedCommands", () => {
  it("reads command === comparisons and case labels of switch (command) only", () => {
    expect(
      dispatchedCommands(
        source(`
          if (command === "alpha") {}
          if (other === "not-this") {}
          if (command == "loose") {}
          switch (command) {
            case "beta": {
              switch (event.type) {
                case "watching": break;
              }
              break;
            }
            case "gamma":
              break;
          }
          switch (mode) { case "delta": break; }
        `),
      ),
    ).toEqual(["alpha", "beta", "gamma"]);
  });

  it("reads JavaScript too", () => {
    expect(
      dispatchedCommands(
        source(`const command = args[0]; if (command === "update") { run(); }`, "x.cjs"),
      ),
    ).toEqual(["update"]);
  });
});
