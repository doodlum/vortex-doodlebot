/**
 * The `doodlebot` command line, parsed. Kept apart from cli.ts so the rules that agents keep
 * tripping over (which flags `script` keeps after its file, what `--` means, which paths are the
 * caller's) have unit tests.
 */
import path from "node:path";

import { ConfigError } from "./config";
import { callerCwd } from "./processRunner";

export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
  /** Every value of each string flag, for flags that may repeat (`--test a --test b`). */
  lists: Record<string, string[]>;
  /** The command for `evidence run`, or a script's own arguments. */
  passthrough: string[];
}

export const BOOLEAN_FLAGS = new Set([
  "help",
  "installed",
  "sandbox",
  "bethesda-sandbox",
  "isolate-user-folders",
  "headless",
  "production",
  "oauth",
  "no-wait",
  "no-launch",
  "fresh",
  "no-game",
  "rebuild-snapshot",
  "rebuild-extension",
  "json",
  "screenshots",
  "strict",
  "build",
  "update",
  "no-build",
  "where",
  "purge",
  "keep",
  "full-page",
  "allow-incomplete",
  "skip-revert",
  "force",
  "with-api-key",
  "ready",
  "list",
  "all",
]);

/**
 * Flags whose value is a path the caller typed, so it is resolved against the caller's directory
 * (`callerCwd()`), not the workspace the shim runs the CLI in. Every value of a repeated flag is.
 * pr-preflight's `--project-dir`, `--test`, `--revert` and `--revert-hunk` (relative to the
 * checkout) and vortex-e2e's `--spec` (relative to packages/e2e) are deliberately absent.
 */
export const PATH_FLAGS = new Set([
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
]);

/** The positional arguments that are files the caller named, by command. */
function positionalPaths(command: string, positional: string[]): number[] {
  switch (command) {
    case "script":
    case "eval":
    case "install":
      return [0];
    case "evidence":
      return positional[0] === "runtime" ? positional.map((_, i) => i).slice(1) : [];
    case "game":
      return positional[0] === "register" ? [2] : [];
    default:
      return [];
  }
}

/**
 * Flags `script` takes for itself wherever they appear, even after the script's path: the flags
 * that pick the instance, so the script drives the same Vortex this command was given.
 * Everything else after the path is the script's; after a bare `--`, all of it is.
 */
export const SCRIPT_KIT_FLAGS = new Set(["dev-dir", "cache-dir", "port", "cdp-port"]);

/**
 * Parse a command line. Relative paths in `PATH_FLAGS` and in the commands' file arguments are
 * resolved against `cwd`, the caller's directory. Everything after `test <suite>` passes through
 * verbatim: the suite resolves its own arguments against the workspace root.
 */
export function parseArgs(argv: string[], cwd: string = callerCwd()): ParsedArgs {
  // A package-script wrapper may forward the `--` separator itself, so the first
  // argument we see is "--" rather than the command. Dropping a leading bare
  // separator makes that invocation work instead of printing help.
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const [command = "help", ...rest] = args;
  const runsCommand = command === "evidence";
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const lists: Record<string, string[]> = {};
  const setValue = (name: string, raw: string): void => {
    // A bare command name (no separator) for --ffmpeg is found on the PATH, not in the cwd.
    const bareCommand = name === "ffmpeg" && !/[\\/]/.test(raw);
    const value = PATH_FLAGS.has(name) && raw !== "" && !bareCommand ? path.resolve(cwd, raw) : raw;
    flags[name] = value;
    (lists[name] ??= []).push(value);
  };

  const passthrough: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === undefined) continue;
    const next = rest[i + 1];
    // `test <suite> [args...]`: everything after the suite is the suite's, verbatim.
    if (command === "test" && positional.length === 1) {
      passthrough.push(...rest.slice(i));
      break;
    }
    // `script <file> [args...]`: after the file, only the kit's own flags are taken.
    if (command === "script" && positional.length === 1) {
      if (arg === "--") {
        passthrough.push(...rest.slice(i + 1));
        break;
      }
      const kitFlag = /^--([\w-]+)(?:=(.*))?$/.exec(arg);
      if (kitFlag?.[1] !== undefined && SCRIPT_KIT_FLAGS.has(kitFlag[1])) {
        if (kitFlag[2] !== undefined) {
          setValue(kitFlag[1], kitFlag[2]);
        } else if (next !== undefined && !next.startsWith("--")) {
          setValue(kitFlag[1], next);
          i++;
        } else {
          throw new ConfigError(`--${kitFlag[1]} needs a value.`);
        }
        continue;
      }
      passthrough.push(arg);
      continue;
    }
    if (arg === "--") {
      // Ordinary pnpm script separators are ignored; command wrappers preserve their tail.
      if (!runsCommand || positional[0] !== "run") continue;
      passthrough.push(...rest.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      // A wrapped command starts at its first word even without
      // `--`, which Windows PowerShell 5.1 strips from native command lines.
      if (runsCommand && positional.length === 1 && positional[0] === "run") {
        passthrough.push(...rest.slice(i));
        break;
      }
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    if (command === "watch" && body.split("=")[0] === "build")
      throw new ConfigError("watch always builds extension source; remove obsolete --build.");
    const eq = body.indexOf("=");
    if (eq !== -1) {
      setValue(body.slice(0, eq), body.slice(eq + 1));
    } else if (BOOLEAN_FLAGS.has(body)) {
      flags[body] = true;
    } else if (next !== undefined && !next.startsWith("--")) {
      setValue(body, next);
      i++;
    } else {
      throw new ConfigError(`--${body} needs a value. Run help for supported flags.`);
    }
  }
  for (const index of positionalPaths(command, positional)) {
    const value = positional[index];
    if (value !== undefined && value !== "") positional[index] = path.resolve(cwd, value);
  }
  return { command, positional, flags, lists, passthrough };
}
