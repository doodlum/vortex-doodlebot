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

import { ANONYMOUS, loginDir, markerFile, readMarker, snapshotDir, liveDir } from "./bootstrap";
import { extensionRoot, findInstalledVortex, type HarnessConfig } from "./config";
import { KNOWN_GAMES, findGamePath, steamLibraryRoots } from "./gameSetup";
import { VortexMcpClient } from "./mcpClient";
import { hasVortexSource, vortexSourceDir } from "./source";
import { authCacheFile } from "./instance";

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
}

export async function runDoctor(
  config: HarnessConfig,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const checks: Check[] = [];

  checks.push(checkApiKey(config));
  checks.push(await checkSource());
  checks.push(
    options.targetError === undefined ? checkVortex(config) : targetFailure(options.targetError),
  );
  checks.push(checkExtension());
  if (!options.skipGame) checks.push(checkGame(config));
  checks.push(checkCache(config));
  checks.push(checkSandboxBaseline(config));
  checks.push(checkCapturedLogin(config));
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
 * the next `up` builds it. The same test `checkCache` and `status` use.
 */
function checkSandboxBaseline(config: HarnessConfig): Check {
  const snapshot = snapshotDir(config, config.apiKey?.trim() || ANONYMOUS);
  const present = readMarker(snapshot) !== undefined;
  return {
    name: "Sandbox baseline",
    ok: present,
    advisory: true,
    detail: present ? `present: ${markerFile(snapshot)}` : "missing",
    fix: "doodlebot up --sandbox (the first start builds it), then doodlebot down",
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

function checkCapturedLogin(config: HarnessConfig): Check {
  const key = config.apiKey?.trim();
  const captured =
    readMarker(snapshotDir(config, key === undefined || key === "" ? "anonymous" : key))
      ?.loginCaptured === true ||
    readMarker(loginDir(config))?.loginCaptured === true ||
    fs.existsSync(authCacheFile(config));
  return {
    name: "Nexus login captured",
    ok: captured,
    // Advisory for the same reason as the API key: only collections need it,
    // and everything else works without it.
    advisory: true,
    detail: captured
      ? "cache recorded — auth-status checks live credentials; this marker does not prove server validity"
      : "not captured — collections will fail; an API key alone does not cover them",
    fix: "doodlebot setup --oauth (complete browser login once; caches automatically)",
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
 * The Vortex clone this repo manages.
 *
 * Advisory, not required: you can drive an installed Vortex without ever
 * cloning. But when the task is working ON Vortex, this is the first thing that
 * has to exist, so it is reported before the target.
 */
async function checkSource(): Promise<Check> {
  const dir = vortexSourceDir();
  if (hasVortexSource(dir)) {
    return { name: "Vortex source", ok: true, advisory: true, detail: dir };
  }
  return {
    name: "Vortex source",
    ok: false,
    advisory: true,
    detail: "not cloned; optional unless developing Vortex itself",
    fix: "doodlebot source",
  };
}

function checkVortex(config: HarnessConfig): Check {
  const { target } = config;
  if (target.executable === "" || !fs.existsSync(target.executable)) {
    return {
      name: "Vortex",
      ok: false,
      detail: "no installed Vortex found",
      fix:
        "Install it from https://www.nexusmods.com/about/vortex/ — the released build is " +
        "all this needs. Or set VORTEX_AI_EXE / VORTEX_AI_DEV_DIR.",
    };
  }

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

function checkCache(config: HarnessConfig): Check {
  const snapshot = snapshotDir(config, config.apiKey?.trim() || ANONYMOUS);
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
