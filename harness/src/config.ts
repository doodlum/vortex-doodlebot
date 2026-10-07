/**
 * Configuration, paths, and locating Vortex itself.
 *
 * Everything an operator has to supply lives here, in one place, so `doctor` can
 * check it and AGENTS.md can document it without either drifting from the code.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ConfigError } from "./errors";
import { resolveDevElectron } from "./electronRuntime";
import { resolveOwner } from "./lease";
import { HARNESS_ROOT, REPO_ROOT } from "./paths";
import { assignSlot, parseSlot, type SlotRequest, slotPaths } from "./slots";

export { ConfigError, REPO_ROOT };

// Loaded from harness/.env when present, so an operator can keep the API key out
// of their shell profile. Gitignored.
const envFile = path.join(HARNESS_ROOT, ".env");
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/**
 * How the harness starts Vortex.
 *
 * `installed` is the default and the one that matters: it drives a stock,
 * officially released Vortex, with no patched build and no source checkout. The
 * extension is written to that constraint deliberately.
 *
 * `dev` points Electron at a Vortex source checkout instead. The only thing it
 * buys is hot-reloading changes to *Vortex's own* renderer code; everything else
 * behaves identically.
 */
export type VortexTargetKind = "installed" | "dev";

export interface VortexTarget {
  kind: VortexTargetKind;
  /** Executable to run. */
  executable: string;
  /** Extra argv before the debugging flags (the app directory, for `dev`). */
  args: string[];
  /**
   * Subdirectory of appData that Vortex expects to find startup.json in.
   *
   * It is Electron's app name, which differs between builds: a released Vortex
   * is `Vortex`, while a source checkout takes it from src/main/package.json and
   * so is `@vortex/main`. Creating the wrong one makes Vortex quit during
   * startup with an unrecoverable ENOENT on startup.json — which reads like a
   * corrupt profile rather than a naming mismatch.
   */
  appName: string;
  /** Vortex source checkout root, when kind === "dev" — needed for rebuilds. */
  sourceDir?: string;
}

export interface HarnessConfig {
  /**
   * Optional Nexus personal API key for legacy API access. Collections require
   * OAuth; local UI/install/deployment tests need neither credential.
   */
  apiKey: string | undefined;
  /** Bearer token unlocking the extension's write tools. Generated if unset. */
  mcpToken: string;
  /** Port the extension's MCP server listens on inside the launched Vortex. */
  mcpPort: number;
  /** CDP port opened on the launched Vortex, for screenshots and Playwright. */
  cdpPort: number;
  /** Game to manage during bootstrap. */
  gameId: string;
  /** Explicit install path for that game, instead of locating it via Steam. */
  gamePath: string | undefined;
  /** Where the built extension is staged and seeded profiles cached. */
  cacheDir: string;
  /** Where screenshots and sweep reports are written. */
  artifactDir: string;
  /** How to start Vortex. */
  target: VortexTarget;
  /** Hide the window. Off by default — layout measurement needs a real window. */
  headless: boolean;
  /**
   * Run a source build as a release runs: without NODE_ENV=development, so Vortex switches
   * itself to production and React loads its production build. Development React is several
   * times slower at rendering, so any timing meant to stand for users' experience needs this.
   * Released builds always run like this.
   */
  production: boolean;
  /**
   * Private stand-ins for the per-user folders a Bethesda game writes to: plugins.txt
   * under LocalAppData, INI files under Documents. Set by the Bethesda sandbox; when set,
   * Vortex must start with both redirected or not at all.
   */
  profileRedirect?: { localAppData: string; documents: string };
  /**
   * Who is using the kit, for the machine-wide instance lease (lease.ts). From `--owner`
   * or VORTEX_AI_OWNER; unset means "anonymous".
   */
  owner?: string;
  /**
   * The instance slot (slots.ts) this configuration's defaults came from: 0 unless `--slot`
   * or VORTEX_AI_SLOT asked for another. An explicit cache or port overrides its part.
   */
  slot: number;
  /**
   * True when an API key is configured but deliberately not used: sandbox runs are
   * local-only, and a seeded key makes every local install wait on Nexus lookups.
   */
  apiKeyWithheld?: boolean;
}

/** An environment variable, with an empty one counted as unset. */
function envValue(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

function envFlag(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v?.toLowerCase() === "true";
}

/**
 * A stable per-machine token when none is configured.
 *
 * Random-per-run would look more secure but would mean a different
 * `claude mcp add` every time, defeating a documented one-line client setup. The
 * server is loopback-bound and host/origin-validated regardless; the token gates
 * writes, and a stable one in .env is the same trust level as the Vortex UI the
 * operator already has.
 */
function defaultToken(): string {
  return `vortex-ai-${os.hostname().replace(/[^a-zA-Z0-9]/g, "")}`;
}

/** Where a released Vortex puts itself, most likely first. */
function installedVortexCandidates(): string[] {
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const localAppData = process.env.LOCALAPPDATA ?? "";
  return [
    path.join(programFiles, "Vortex", "Vortex.exe"),
    path.join(programFiles, "Black Tree Gaming Ltd", "Vortex", "Vortex.exe"),
    localAppData === "" ? "" : path.join(localAppData, "Programs", "Vortex", "Vortex.exe"),
  ].filter((p) => p !== "");
}

/**
 * The Vortex clone this repo manages, at `.vortex-src`, or undefined.
 *
 * Deliberately the only place a source checkout is looked for. The suite never
 * goes hunting around the filesystem for a Vortex repo: "some checkout
 * somewhere" is not something it can reason about, build from, or push to.
 */
function managedSourceDir(): string | undefined {
  const dir = process.env.VORTEX_AI_SOURCE_DIR ?? path.join(REPO_ROOT, ".vortex-src");
  return fs.existsSync(path.join(dir, "src", "main", "package.json")) ? dir : undefined;
}

export function findInstalledVortex(): string | undefined {
  const explicit = process.env.VORTEX_AI_EXE;
  if (explicit !== undefined && explicit !== "" && fs.existsSync(explicit)) return explicit;
  return installedVortexCandidates().find((c) => fs.existsSync(c));
}

/**
 * Resolve how to start Vortex.
 *
 * The extension itself is written to work against a stock released build, and
 * that constraint still holds — but this suite's job is building and testing
 * Vortex, so a clone it manages takes precedence once one exists.
 */
export function resolveTarget(
  overrides: { devDir?: string; exe?: string; preferInstalled?: boolean } = {},
): VortexTarget {
  // Precedence: an explicit --dev-dir, then the clone this repo manages, then an
  // installed Vortex. The clone wins because if you have gone to the trouble of
  // cloning Vortex here, working on it is the whole point — but --installed
  // puts the released build back in front.
  const installed = overrides.preferInstalled === true || envFlag("VORTEX_AI_INSTALLED");
  const managed = installed || overrides.exe !== undefined ? undefined : managedSourceDir();
  const devDir =
    overrides.devDir ??
    (installed || overrides.exe !== undefined
      ? undefined
      : (process.env.VORTEX_AI_DEV_DIR ?? managed));
  if (devDir !== undefined && devDir !== "") {
    const mainDir = path.join(devDir, "src", "main");
    const resolved = fs.existsSync(mainDir) ? mainDir : devDir;
    return {
      kind: "dev",
      executable: resolveDevElectron(resolved),
      args: [resolved],
      appName: "@vortex/main",
      sourceDir: path.resolve(resolved, "..", ".."),
    };
  }

  const exe = overrides.exe ?? findInstalledVortex();
  if (exe === undefined) {
    throw new ConfigError(`No Vortex to drive.

  Work on Vortex itself:     pnpm run ai:source
     (finds your GitHub fork, clones it into .vortex-src here, and builds it)

  Or drive a released build:  install it from
     https://www.nexusmods.com/about/vortex/

  Or point at one directly:   VORTEX_AI_EXE / VORTEX_AI_DEV_DIR`);
  }
  return { kind: "installed", executable: exe, args: [], appName: "Vortex" };
}

/**
 * Config loading must not throw just because Vortex is missing — `doctor` exists
 * precisely to report that, and it can report nothing if building the config
 * blew up first.
 */
export function resolveTargetSafely(
  overrides: Parameters<typeof resolveTarget>[0] = {},
): VortexTarget {
  try {
    return resolveTarget(overrides);
  } catch {
    return { kind: "installed", executable: "", args: [], appName: "Vortex" };
  }
}

export type ConfigOverrides = Partial<Omit<HarnessConfig, "slot">> & { slot?: SlotRequest };

export function loadConfig(overrides: ConfigOverrides = {}): HarnessConfig {
  const { slot: slotOverride, ...rest } = overrides;
  const owner = rest.owner ?? process.env.VORTEX_AI_OWNER;
  const request = slotOverride ?? parseSlot(process.env.VORTEX_AI_SLOT);
  const slot = request === "auto" ? assignSlot(resolveOwner(owner)) : (request ?? 0);
  const defaults = slotPaths(slot);
  const config: HarnessConfig = {
    apiKey: process.env.VORTEX_AI_NEXUS_API_KEY ?? process.env.NEXUS_API_KEY,
    mcpToken: process.env.VORTEX_MCP_TOKEN ?? defaultToken(),
    mcpPort: Number(envValue("VORTEX_MCP_PORT") ?? defaults.mcpPort),
    cdpPort: Number(envValue("VORTEX_AI_CDP_PORT") ?? defaults.cdpPort),
    gameId: process.env.VORTEX_AI_GAME_ID ?? "fallout4",
    gamePath: process.env.VORTEX_AI_GAME_PATH,
    cacheDir: envValue("VORTEX_AI_CACHE_DIR") ?? defaults.cacheDir,
    artifactDir: envValue("VORTEX_AI_ARTIFACT_DIR") ?? defaults.artifactDir,
    target: resolveTargetSafely(),
    headless: envFlag("VORTEX_AI_HEADLESS"),
    production: envFlag("VORTEX_AI_PRODUCTION"),
    owner,
    ...rest,
    slot,
  };
  for (const port of [config.mcpPort, config.cdpPort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new ConfigError("MCP and CDP ports must be integers from 1 to 65535.");
  }
  if (config.mcpPort === config.cdpPort) throw new ConfigError("MCP and CDP need different ports.");
  config.cacheDir = path.resolve(config.cacheDir);
  config.artifactDir = path.resolve(config.artifactDir);
  if (config.gamePath) config.gamePath = path.resolve(config.gamePath);
  return config;
}

/** This repo — holds the built extension that gets copied into an instance. */
export function extensionRoot(): string {
  return REPO_ROOT;
}

export const MCP_EXTENSION_ID = "doodlebot";
/** Earlier ids of this extension; removed from a profile before installing, so two servers never load. */
export const LEGACY_EXTENSION_IDS = ["vortex-mcp"];

/**
 * Optional helper for integrations that specifically need the legacy API key.
 * Collections use requireOAuth instead. Credentials belong in local setup,
 * never in chat or committed files.
 */
export function requireApiKey(config: HarnessConfig): string {
  if (config.apiKey === undefined || config.apiKey.trim() === "") {
    throw new ConfigError(
      "This legacy integration requires a Nexus API key. Collections instead use setup --oauth.\n\n" +
        "  During initial setup, store the key locally rather than sending it in chat.\n\n" +
        "  1. Open https://next.nexusmods.com/settings/api-keys\n" +
        "  2. Copy the personal API key\n" +
        "  3. echo 'VORTEX_AI_NEXUS_API_KEY=<key>' >> harness/.env   # gitignored\n\n" +
        "  Stored once, it is reused by every later run, including cold ones.\n",
    );
  }
  return config.apiKey.trim();
}
