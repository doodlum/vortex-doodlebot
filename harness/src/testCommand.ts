/**
 * `doodlebot test <suite> [args…]` and `doodlebot test --list`: the kit's Playwright suites and
 * opt-in check scripts, by name. Each runs from the workspace root with this Node, so relative
 * arguments after the suite resolve there, and with this process's environment, so
 * PLAYWRIGHT_JSON_OUTPUT_FILE and the VORTEX_AI_* settings pass through.
 */
import fs from "node:fs";
import { createRequire } from "node:module";

import { findRelease, type RegisteredRelease } from "./content";
import { ConfigError } from "./errors";
import { REPO_ROOT } from "./paths";
import { runInteractive, tsxCli } from "./processRunner";

interface Suite {
  name: string;
  summary: string;
  /** The arguments after the Node executable. */
  argv: (args: string[]) => string[];
}

const playwright = (config: string) => (args: string[]) => [
  createRequire(import.meta.url).resolve("@playwright/test/cli"),
  "test",
  "--config",
  config,
  ...args,
];
const script = (file: string) => (args: string[]) => [
  tsxCli(),
  `harness/src/tests/${file}.e2e.ts`,
  ...args,
];

/** Every suite runs on a released Vortex as well as a source build: none needs a source build. */
export const SUITES: Suite[] = [
  {
    name: "core",
    summary: "the core Playwright contract against a real Vortex, account-free",
    argv: playwright("harness/playwright.config.ts"),
  },
  {
    name: "oauth",
    summary: "opt-in: cached sandbox OAuth survives a fresh restore",
    argv: playwright("harness/oauth.playwright.config.ts"),
  },
  {
    name: "large-library",
    summary: "3,000 seeded mods: filter, installs, deploy",
    argv: script("large-library"),
  },
  {
    name: "bethesda",
    summary: "Missing Masters and the game-version prompt (Bethesda sandbox)",
    argv: script("bethesda"),
  },
  {
    name: "collection-download-retry",
    summary: "a resumed collection installs members whose downloads failed",
    argv: script("collection-download-retry"),
  },
  {
    name: "collection-scale",
    summary: "a large offline collection install and update",
    argv: script("collection-scale"),
  },
  {
    name: "plugins-mod-link",
    summary: "the Plugins page Mod link scrolls to the mod",
    argv: script("plugins-mod-link"),
  },
  {
    name: "plugins-page",
    summary: "Plugins page scroll, filter and toggle timings",
    argv: script("plugins-page"),
  },
  {
    name: "download-churn",
    summary: "what concurrent downloads cost Vortex",
    argv: script("download-churn"),
  },
  {
    name: "mods-scroll",
    summary: "Mods table wheel scrolling and scroll-through",
    argv: script("mods-scroll"),
  },
  {
    name: "nexus",
    summary:
      "opt-in live service: --collection <game>/<slug> (or content.json's newest) from Nexus (needs a login)",
    argv: script("nexus-collection"),
  },
];

/** The command for a suite: this Node and its arguments, run from the workspace root. */
export function suiteCommand(
  suite: string,
  args: string[],
): { executable: string; args: string[]; cwd: string } {
  const found = SUITES.find((candidate) => candidate.name === suite);
  if (found === undefined) throw new UnknownSuiteError(suite);
  return { executable: process.execPath, args: found.argv(args), cwd: REPO_ROOT };
}

export class UnknownSuiteError extends ConfigError {
  constructor(suite: string) {
    super(`Unknown suite "${suite}".\n\n${formatSuites()}`);
  }
}

export function formatSuites(): string {
  const width = Math.max(...SUITES.map((suite) => suite.name.length));
  return [
    "Suites (doodlebot test <suite> [args...]):",
    ...SUITES.map((suite) => `  ${suite.name.padEnd(width)}  ${suite.summary}`),
  ].join("\n");
}

/**
 * `--release <version>` among a suite's arguments: the kit's, not the suite's. It is taken out
 * and becomes `VORTEX_AI_EXE` (the registered release's Vortex.exe) and `VORTEX_AI_INSTALLED=1`
 * in the suite's environment, which every suite's config reads.
 */
export function releaseEnvironment(
  args: string[],
  find: (version: string) => RegisteredRelease | undefined = findRelease,
  exists: (file: string) => boolean = fs.existsSync,
): { args: string[]; env: Record<string, string> } {
  const rest: string[] = [];
  let version: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--release") {
      version = args[i + 1];
      if (version === undefined || version.startsWith("--"))
        throw new ConfigError("--release needs a version: --release <version>.");
      i++;
    } else if (arg.startsWith("--release=")) version = arg.slice("--release=".length);
    else rest.push(arg);
  }
  if (version === undefined) return { args: rest, env: {} };
  const release = find(version);
  if (release === undefined || !exists(release.exe))
    throw new ConfigError(
      `Release ${version} is not registered${release === undefined ? "" : ` (its ${release.exe} is gone)`}; run \`doodlebot release get ${version}\` first.`,
    );
  return { args: rest, env: { VORTEX_AI_EXE: release.exe, VORTEX_AI_INSTALLED: "1" } };
}

/**
 * Run `doodlebot test`. Returns the exit code: the suite's own, 0 for `--list`, `--help` or
 * `-h` (which list the suites), and 2 for a missing or unknown suite (after listing them).
 */
export async function testCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
  passthrough: string[],
  options: {
    write?: (text: string) => void;
    run?: typeof runInteractive;
    findRelease?: (version: string) => RegisteredRelease | undefined;
    exists?: (file: string) => boolean;
  } = {},
): Promise<number> {
  const write = options.write ?? ((text: string) => process.stdout.write(`${text}\n`));
  if (flags.list === true || flags.help === true || positional[0] === "-h") {
    write(formatSuites());
    return 0;
  }
  const suite = positional[0];
  if (suite === undefined || !SUITES.some((candidate) => candidate.name === suite)) {
    write(suite === undefined ? "test needs a suite.\n" : `Unknown suite "${suite}".\n`);
    write(formatSuites());
    return 2;
  }
  const release = releaseEnvironment(passthrough, options.findRelease, options.exists);
  const command = suiteCommand(suite, release.args);
  // `test --dev-dir <checkout> <suite>`: the suite's config finds that checkout as the session's
  // (its caller folder, INIT_CWD), as it would run from inside it.
  const devDir = typeof flags["dev-dir"] === "string" ? { INIT_CWD: flags["dev-dir"] } : {};
  return (options.run ?? runInteractive)(command.executable, command.args, {
    cwd: command.cwd,
    env: { ...process.env, ...release.env, ...devDir },
  });
}
