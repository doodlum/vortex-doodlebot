/**
 * Preflight checks.
 *
 * The harness has several independent prerequisites (a built Vortex, a built
 * extension, an API key, an installed game), and when one is missing the
 * downstream failure is usually nowhere near the cause — a missing renderer
 * bundle shows up as "MCP never became ready", which reads like a networking
 * problem. `doctor` exists so the first thing anyone runs tells them which
 * prerequisite is actually missing and the exact command that fixes it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ANONYMOUS, markerFile, readMarker, snapshotDir, liveDir } from "./bootstrap";
import {
  NEEDS_CHECKOUT,
  extensionRoot,
  findInstalledVortex,
  sessionCheckout,
  type HarnessConfig,
} from "./config";
import { KNOWN_GAMES, findGamePath, steamLibraryRoots } from "./gameSetup";
import { VortexMcpClient } from "./mcpClient";
import { callerCwd } from "./processRunner";
import { authCacheFile } from "./instance";
import { checkLoginAcl, loginState, usesSharedLogin } from "./login";
import { SEVEN_ZIP_HINT, find7Zip } from "./releaseFetch";
import { readContent } from "./content";

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** Exact command or step that fixes it. */
  fix?: string;
  /** A failure that does not block the harness (e.g. nothing running yet). */
  advisory?: boolean;
}

export interface DoctorReport {
  ok: boolean;
  checks: Check[];
  /** Why the requested Vortex target could not be resolved (an explicit --dev-dir). */
  targetError?: string;
}

export interface DoctorOptions {
  skipGame?: boolean;
  /** A target the CLI could not resolve; reported as the failing `Vortex` check. */
  targetError?: string;
  /** The home folder holding the legacy lease store (default: the user's). */
  homeDir?: string;
  /** This session's Vortex checkout (default: the one holding the caller's folder, if any). */
  checkout?: string | undefined;
}

export async function runDoctor(
  config: HarnessConfig,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const checks: Check[] = [];

  checks.push(checkApiKey(config));
  checks.push(
    checkoutCheck("checkout" in options ? options.checkout : sessionCheckout(callerCwd())),
  );
  checks.push(
    options.targetError === undefined ? checkVortex(config) : targetFailure(options.targetError),
  );
  checks.push(checkExtension());
  if (!options.skipGame) checks.push(checkGame(config));
  checks.push(checkCache(config, options.skipGame === true));
  checks.push(checkSandboxBaseline(config, options.skipGame === true));
  checks.push(checkCapturedLogin(config));
  checks.push(checkLoginFolder(path.join(options.homeDir ?? os.homedir(), ".doodlebot", "login")));
  checks.push(checkSevenZip());
  const lease = checkLegacyLeaseStore(options.homeDir ?? os.homedir());
  if (lease !== undefined) checks.push(lease);
  checks.push(await checkRunning(config));

  return {
    ok: checks.every((c) => c.ok || c.advisory === true),
    checks,
    ...(options.targetError === undefined ? {} : { targetError: options.targetError }),
  };
}

function targetFailure(message: string): Check {
  return {
    name: "Vortex",
    ok: false,
    detail: message,
    fix: "Pass a built Vortex checkout to --dev-dir (doodlebot build --checkout <dir>), or use --installed.",
  };
}

/**
 * The baseline a start reseeds from, for these flags (`--sandbox` gives the sandbox's). Advisory:
 * the next `up` builds it. The same test `checkCache` and `status` use; `--no-game` has its own
 * baseline, so `skipGame` selects it.
 */
function checkSandboxBaseline(config: HarnessConfig, skipGame: boolean): Check {
  const snapshot = snapshotDir(config, config.apiKey?.trim() || ANONYMOUS, skipGame);
  const present = readMarker(snapshot) !== undefined;
  return {
    name: "Sandbox baseline",
    ok: present,
    advisory: true,
    detail: present ? `present: ${markerFile(snapshot)}` : "missing",
    fix: `doodlebot up ${skipGame ? "--no-game" : "--sandbox"} (the first start builds it), then doodlebot down`,
  };
}

/** 7-Zip, which `release get` needs to extract a release without running its installer. */
export function checkSevenZip(find: () => string | undefined = find7Zip): Check {
  const found = find();
  return {
    name: "7-Zip",
    ok: found !== undefined,
    advisory: true,
    detail: found ?? "not found; only `doodlebot release get` needs it",
    fix: SEVEN_ZIP_HINT,
  };
}

/** The lease store of the removed multi-instance kit; reported only when it is still there. */
function checkLegacyLeaseStore(homeDir: string): Check | undefined {
  const store = path.join(homeDir, ".vortex-ai", "leases");
  if (!fs.existsSync(store)) return undefined;
  return {
    name: "Legacy lease store",
    ok: false,
    advisory: true,
    detail: store,
    fix: `delete ${store}; nothing reads it any more`,
  };
}

/**
 * The login of this cache: the shared `~/.doodlebot/login` file for the default cache (and a
 * cache that opts in), the cache's own file otherwise, which only a signed-out marker or a test
 * writes (login.ts).
 */
function checkCapturedLogin(config: HarnessConfig): Check {
  const file = authCacheFile(config);
  const state = loginState(file);
  const shared = usesSharedLogin(config);
  const captured = state === "login";
  return {
    name: "Nexus login captured",
    ok: captured,
    // Advisory for the same reason as the API key: only collections need it,
    // and everything else works without it.
    advisory: true,
    detail: captured
      ? `present in ${file}; auth-status checks live credentials, this file does not prove Nexus still accepts them`
      : shared
        ? `${state === "missing" ? "missing" : state} (${file}) — collections will fail; an API key alone does not cover them`
        : `this cache has no login (${state}); only the default cache uses the shared login in ~/.doodlebot/login`,
    fix: shared
      ? "doodlebot setup --oauth --installed (the account owner signs in once; a lost or expired login is fixed the same way)"
      : "run collections and Nexus tests in the default cache",
  };
}

/** The shared login's folder is private: only the user, SYSTEM and Administrators can read it. */
function checkLoginFolder(dir: string): Check {
  let report;
  try {
    report = checkLoginAcl(dir);
  } catch (error) {
    return {
      name: "Nexus login folder",
      ok: false,
      advisory: true,
      detail: `${dir}: could not read its ACL (${error instanceof Error ? error.message : String(error)})`,
      fix: `icacls "${dir}"`,
    };
  }
  return {
    name: "Nexus login folder",
    ok: report.ok,
    advisory: true,
    detail: `${dir}: ${report.detail}`,
    ...(report.fix === undefined ? {} : { fix: report.fix }),
  };
}

function checkApiKey(config: HarnessConfig): Check {
  const set = config.apiKey !== undefined && config.apiKey.trim() !== "";
  return {
    name: "Nexus API key",
    ok: set,
    // Advisory: everything except Nexus downloads works signed out, so a
    // missing key must not read as "the harness is broken".
    advisory: true,
    detail: set
      ? "set (legacy API access; collections require OAuth)"
      : "not set — optional; local automation needs no account and collections use OAuth",
    fix:
      "Get one at https://next.nexusmods.com/settings/api-keys, then:\n" +
      "      echo 'VORTEX_AI_NEXUS_API_KEY=<key>' >> harness/.env",
  };
}

/**
 * Which Vortex the harness will drive.
 *
 * Reported prominently because it is the single most consequential setting: the
 * whole system is built to work against a released install, and silently
 * falling back to something else would hide the thing worth knowing.
 */
/**
 * The Vortex checkout this session works in: the one holding the caller's folder.
 *
 * Advisory, not required: you can drive an installed Vortex or a release from anywhere. But when
 * the task is working ON Vortex, this is the first thing that has to exist, so it is reported
 * before the target.
 */
export function checkoutCheck(checkout: string | undefined): Check {
  if (checkout !== undefined) {
    return { name: "This checkout", ok: true, advisory: true, detail: checkout };
  }
  return {
    name: "This checkout",
    ok: false,
    advisory: true,
    detail: "not in a Vortex checkout; optional unless developing Vortex itself",
    fix: NEEDS_CHECKOUT,
  };
}

/**
 * No installed Vortex is fine when an official release is registered (`release get`): every
 * command takes `--release <version>`.
 */
export function missingVortexCheck(releases: string[]): Check {
  if (releases.length > 0)
    return {
      name: "Vortex",
      ok: true,
      detail: `no installed Vortex; registered releases: ${releases.join(", ")} (use --release ${releases[0]!})`,
    };
  return {
    name: "Vortex",
    ok: false,
    detail: "no installed Vortex found",
    fix:
      "doodlebot release get <version>   (an official release, never installed), or install " +
      "Vortex from https://www.nexusmods.com/about/vortex/, or name one with --exe <path> " +
      "(VORTEX_AI_EXE), or open Claude in a built Vortex checkout.",
  };
}

function checkVortex(config: HarnessConfig): Check {
  const { target } = config;
  if (target.executable === "" || !fs.existsSync(target.executable))
    return missingVortexCheck(readContent().releases.map((release) => release.version));

  if (target.kind === "dev") {
    const renderer = path.join(target.args[0] ?? "", "build", "renderer.js");
    const built = fs.existsSync(renderer);
    return {
      name: "Vortex (dev checkout)",
      ok: built,
      detail: built
        ? `source build at ${target.sourceDir ?? "?"}`
        : `source checkout at ${target.sourceDir ?? "?"} is not built`,
      fix: "doodlebot source   (installs and builds the clone)",
    };
  }

  return {
    name: "Vortex (installed)",
    ok: true,
    detail: `${target.executable}${findInstalledVortex() === undefined ? " (explicit)" : ""}`,
  };
}

function checkExtension(): Check {
  const source = extensionRoot();
  const built = fs.existsSync(path.join(source, "dist", "index.js"));
  return {
    name: "Extension build",
    ok: true,
    detail: built ? `built (${path.join(source, "dist")})` : "not built yet (builds on demand)",
  };
}

function checkGame(config: HarnessConfig): Check {
  const game = KNOWN_GAMES[config.gameId];
  if (config.gamePath !== undefined) {
    const ok =
      fs.existsSync(config.gamePath) &&
      (game === undefined || fs.existsSync(path.join(config.gamePath, game.executable)));
    return {
      name: `Game (${config.gameId})`,
      ok,
      detail: config.gamePath,
      fix: "Correct --game-path, use --sandbox for disposable tests, or --no-game for global UI.",
    };
  }
  if (game === undefined) {
    return {
      name: `Game (${config.gameId})`,
      ok: false,
      detail: "not a game the harness can locate itself — pass an explicit path when bootstrapping",
      fix: "Provide --game-path, use --sandbox, or choose --no-game.",
    };
  }
  const found = findGamePath(game);
  return {
    name: `Game (${game.name})`,
    ok: found !== undefined,
    detail: found ?? `not installed — searched Steam libraries: ${steamLibraryRoots().join(", ")}`,
    fix: `Install ${game.name}, or run with --game <id> for one you do have (${Object.keys(KNOWN_GAMES).join(", ")}).`,
  };
}

function checkCache(config: HarnessConfig, skipGame: boolean): Check {
  const snapshot = snapshotDir(config, config.apiKey?.trim() || ANONYMOUS, skipGame);
  const marker = readMarker(snapshot);
  const live = fs.existsSync(path.join(liveDir(config), "userData"));

  return {
    name: "Profile cache",
    ok: true,
    advisory: true,
    detail: live
      ? "live working directory present — next start is warm (fastest)"
      : marker === undefined
        ? "empty — the next start is a cold bootstrap (once, then cached)"
        : `snapshot from ${marker.createdAt} — next start reseeds from it`,
  };
}

async function checkRunning(config: HarnessConfig): Promise<Check> {
  const mcp = new VortexMcpClient({ port: config.mcpPort, token: config.mcpToken });
  const running = await mcp.ping();
  if (!running) {
    return {
      name: "Running instance",
      ok: false,
      advisory: true,
      detail: `nothing answering on ${mcp.url}`,
      fix: "doodlebot up",
    };
  }

  const tools = await mcp.listTools().catch(() => []);
  const hasWrite = tools.some((t) => t.name === "ui_click");
  return {
    name: "Running instance",
    ok: hasWrite,
    detail: hasWrite
      ? `answering on ${mcp.url} with ${String(tools.length)} tools (writes unlocked)`
      : `answering on ${mcp.url}, but UI write tools are missing — VORTEX_MCP_TOKEN was not set ` +
        `when Vortex was launched, so it is in read-only mode`,
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = ["doodlebot doctor", ""];
  for (const check of report.checks) {
    const mark = check.ok ? "ok  " : check.advisory === true ? "--  " : "FAIL";
    lines.push(`  [${mark}] ${check.name}`);
    lines.push(`         ${check.detail}`);
    if (!check.ok && check.fix !== undefined) {
      lines.push(`         fix: ${check.fix}`);
    }
  }
  lines.push("");
  lines.push(
    report.ok
      ? "Ready. Start an instance with: doodlebot up"
      : "Not ready — fix the FAIL items above.",
  );
  return lines.join("\n");
}
