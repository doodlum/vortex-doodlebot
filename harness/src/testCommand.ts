/**
 * `doodlebot test <suite> [args…]` and `doodlebot test --list`: the kit's Playwright suites and
 * opt-in check scripts, by name. Each runs from the workspace root with this Node, so relative
 * arguments after the suite resolve there, and with this process's environment, so
 * PLAYWRIGHT_JSON_OUTPUT_FILE and the VORTEX_AI_* settings pass through.
 */
import { createRequire } from "node:module";

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
    name: "zoom",
    summary: "zoom controls, shortcuts and layout (source build)",
    argv: script("zoom"),
  },
  {
    name: "panels",
    summary: "right-hand split view (source build, Bethesda sandbox)",
    argv: script("panels"),
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
    summary: "opt-in live service: a real Nexus collection (needs a login)",
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
 * Run `doodlebot test`. Returns the exit code: the suite's own, 0 for `--list`, and 2 for a
 * missing or unknown suite (after listing the suites).
 */
export async function testCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
  passthrough: string[],
  options: {
    write?: (text: string) => void;
    run?: typeof runInteractive;
  } = {},
): Promise<number> {
  const write = options.write ?? ((text: string) => process.stdout.write(`${text}\n`));
  if (flags.list === true) {
    write(formatSuites());
    return 0;
  }
  const suite = positional[0];
  if (suite === undefined || !SUITES.some((candidate) => candidate.name === suite)) {
    write(suite === undefined ? "test needs a suite.\n" : `Unknown suite "${suite}".\n`);
    write(formatSuites());
    return 2;
  }
  const command = suiteCommand(suite, passthrough);
  return (options.run ?? runInteractive)(command.executable, command.args, {
    cwd: command.cwd,
    env: process.env,
  });
}
