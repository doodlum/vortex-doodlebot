/**
 * `doodlebot check [--json]`: the one status table `/doodlebot:setup --check` prints (design 4.1).
 * It only reads: the workspace, `doctor`, the EGM plugin settings, `.vortex-src`, the inventory,
 * content.json (copy folder, pending restores), the kit gaps, local lessons that duplicate shared
 * ones (4.10), and disk use (4.13). Every row is ready, missing with the exact next command,
 * blocked with the reason, or advisory/info.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readContent } from "./content";
import type { Check } from "./doctor";
import { folderBytes } from "./fsWalk";
import { GAPS_FILE, openGaps } from "./gapCommand";
import { readInventory, type Inventory } from "./inventory";
import { duplicateLessons } from "./knowledgeCommand";
import {
  CONTENT_FILE,
  DEFAULT_ARTIFACT_DIR,
  DEFAULT_CACHE_DIR,
  RELEASES_DIR,
  REPO_ROOT,
} from "./paths";
import { gitBranch } from "./runningVortex";
import { hasVortexSource, missingBuildOutputs, vortexSourceDir } from "./source";
import { versionInfo, type VersionInfo } from "./versionCommand";

export type RowStatus = "ready" | "missing" | "blocked" | "advisory" | "info";

export interface CheckRow {
  area: string;
  item: string;
  status: RowStatus;
  detail: string;
  /** The exact command (or step) that makes it ready. */
  next?: string;
}

/** Free space below this warns, naming `doodlebot clean` (4.13). */
export const LOW_DISK_BYTES = 10 * 1024 ** 3;

export interface SourceState {
  dir: string;
  remotes: Record<string, string>;
  branch?: string;
  built: boolean;
}

export interface CheckDeps {
  version?: () => VersionInfo;
  /** doctor's checks for the installed target and the sandbox. */
  doctor?: () => Promise<Check[]>;
  inventory?: () => Inventory;
  contentFile?: string;
  gapsFile?: string;
  knowledge?: { local?: string; shared?: string };
  /** Claude Code settings files that may enable EGM: the workspace's, then the user's. */
  settingsFiles?: string[];
  /** Claude Code's installed-plugins list. */
  installedPluginsFile?: string;
  source?: () => SourceState | undefined;
  artifactDir?: string;
  cacheDir?: string;
  releasesDir?: string;
  /** Bytes in a folder (undefined when it does not exist). */
  sizeOf?: (dir: string) => number | undefined;
  /** Free bytes on the drive holding a path. */
  freeBytes?: (dir: string) => number | undefined;
}

const git = (dir: string, args: string[]): string | undefined => {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }
};

function managedSourceState(): SourceState | undefined {
  const dir = vortexSourceDir();
  if (!hasVortexSource(dir)) return undefined;
  const remotes: Record<string, string> = {};
  for (const line of (git(dir, ["remote", "-v"]) ?? "").split(/\r?\n/)) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
    if (match) remotes[match[1]!] = match[2]!;
  }
  const branch = gitBranch(dir);
  return {
    dir,
    remotes,
    ...(branch === undefined ? {} : { branch }),
    built: missingBuildOutputs(dir).length === 0,
  };
}

function driveFreeBytes(dir: string): number | undefined {
  let existing = path.resolve(dir);
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing)
    existing = path.dirname(existing);
  try {
    const stats = fs.statfsSync(existing);
    return stats.bavail * stats.bsize;
  } catch {
    return undefined;
  }
}

export const formatBytes = (bytes: number): string =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : bytes >= 1024 ** 2
      ? `${(bytes / 1024 ** 2).toFixed(1)} MB`
      : `${String(Math.round(bytes / 1024))} KB`;

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
};

function egmRow(deps: CheckDeps): CheckRow {
  const settingsFiles = deps.settingsFiles ?? [
    path.join(REPO_ROOT, ".claude", "settings.json"),
    path.join(os.homedir(), ".claude", "settings.json"),
  ];
  const enabledIn = settingsFiles.filter((file) => {
    const settings = readJson(file) as { enabledPlugins?: Record<string, unknown> } | undefined;
    return settings?.enabledPlugins?.["egm@egm"] === true;
  });
  const installed = readJson(
    deps.installedPluginsFile ??
      path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json"),
  ) as { plugins?: Record<string, unknown> } | undefined;
  const isInstalled = Object.keys(installed?.plugins ?? {}).some((key) => key.startsWith("egm@"));
  if (enabledIn.length === 0 && !isInstalled)
    return {
      area: "plugins",
      item: "EGM (Elephant-Goldfish Model)",
      status: "missing",
      detail: "not enabled in any Claude Code settings file and not installed; features need it",
      next: "/plugin install egm@egm (the marketplace is registered in <workspace>/.claude/settings.json)",
    };
  return {
    area: "plugins",
    item: "EGM (Elephant-Goldfish Model)",
    status: "ready",
    detail: [
      ...(enabledIn.length > 0 ? [`enabled in ${enabledIn.join(", ")}`] : []),
      isInstalled
        ? "installed"
        : "not in installed_plugins.json (Claude Code installs it on trust)",
    ].join("; "),
  };
}

function sourceRow(state: SourceState | undefined): CheckRow {
  if (state === undefined)
    return {
      area: "vortex source",
      item: ".vortex-src",
      status: "missing",
      detail: "not cloned; needed to fix, investigate or QA Vortex code",
      next: "doodlebot source",
    };
  const remotes = Object.entries(state.remotes)
    .map(([name, url]) => `${name} ${url}`)
    .join(", ");
  const pushes = state.remotes.origin !== undefined;
  return {
    area: "vortex source",
    item: ".vortex-src",
    status: state.built ? "ready" : "missing",
    detail:
      `${state.dir}; remotes: ${remotes || "none"}` +
      `${pushes ? "" : " (no fork as origin: pushing needs gh repo fork Nexus-Mods/Vortex --remote)"}` +
      `; branch ${state.branch ?? "detached"}; ${state.built ? "built" : "not built"}`,
    ...(state.built ? {} : { next: `doodlebot build --checkout ${state.dir}` }),
  };
}

function doctorRows(checks: Check[]): CheckRow[] {
  return checks
    .filter((check) => check.name !== "Nexus login captured")
    .map((check) => ({
      area: "doctor",
      item: check.name,
      status: check.ok ? "ready" : check.advisory === true ? "advisory" : "missing",
      detail: check.detail,
      ...(!check.ok && check.fix !== undefined ? { next: check.fix } : {}),
    }));
}

function inventoryRows(inventory: Inventory): CheckRow[] {
  const login = inventory.items.find((item) => item.kind === "login");
  const counts = `${String(inventory.items.filter((item) => item.ready).length)} ready, ${String(
    inventory.items.filter((item) => !item.ready).length,
  )} not ready`;
  return [
    { area: "inventory", item: "doodlebot inventory", status: "info", detail: counts },
    ...inventory.items
      .filter((item) => item.kind !== "login")
      .map((item): CheckRow => ({
        area: "inventory",
        item: item.id,
        status: item.ready ? "ready" : item.next === undefined ? "info" : "missing",
        detail: item.label,
        ...(item.next === undefined ? {} : { next: item.next }),
      })),
    {
      area: "login",
      item: "Nexus login",
      status: login?.ready === true ? "ready" : "missing",
      detail:
        login?.ready === true
          ? "present in ~/.doodlebot/login (presence only; auth-status asks the running Vortex)"
          : "missing or signed out; only collections and Nexus checks need it",
      ...(login?.ready === true ? {} : { next: "/doodlebot:setup --login" }),
    },
  ];
}

function contentRows(deps: CheckDeps): CheckRow[] {
  const content = readContent(deps.contentFile ?? CONTENT_FILE);
  const rows: CheckRow[] = [
    content.copyFolder === undefined
      ? {
          area: "game copies",
          item: "copy folder",
          status: "missing",
          detail: "not set; `game copy` copies a Steam install into it",
          next: "doodlebot game folder <dir>",
        }
      : {
          area: "game copies",
          item: "copy folder",
          status: "ready",
          detail: content.copyFolder,
        },
  ];
  if (content.pendingRestores.length === 0)
    rows.push({
      area: "game copies",
      item: "pending restores",
      status: "ready",
      detail: "none",
    });
  for (const pending of content.pendingRestores)
    rows.push({
      area: "game copies",
      item: `pending restore: ${pending.gameId}`,
      status: "blocked",
      detail: `user folders backed up at ${pending.startedAt} were never restored (${pending.backupDir}); every launch refuses until then`,
      next: `doodlebot game restore ${pending.gameId}`,
    });
  return rows;
}

function learningRows(deps: CheckDeps): CheckRow[] {
  const gaps = openGaps(deps.gapsFile ?? GAPS_FILE);
  const duplicates = duplicateLessons(deps.knowledge ?? {});
  return [
    {
      area: "learning",
      item: "open kit gaps",
      status: "info",
      detail:
        gaps.length === 0
          ? "none"
          : `${String(gaps.length)}: ${gaps.map((gap) => gap.title).join("; ")}`,
      ...(gaps.length === 0 ? {} : { next: "doodlebot gap list" }),
    },
    ...duplicates.map((lesson): CheckRow => ({
      area: "learning",
      item: `local lesson ${lesson.id}`,
      status: "advisory",
      detail: `"${lesson.title}" is now in KNOWLEDGE.md; remove the local copy if the person agrees`,
      next: `doodlebot knowledge remove ${lesson.id}`,
    })),
  ];
}

function diskRows(deps: CheckDeps): CheckRow[] {
  const sizeOf = deps.sizeOf ?? folderBytes;
  const content = readContent(deps.contentFile ?? CONTENT_FILE);
  const folders: [string, string][] = [
    ["harness/.artifacts", deps.artifactDir ?? DEFAULT_ARTIFACT_DIR],
    ["harness/.cache", deps.cacheDir ?? DEFAULT_CACHE_DIR],
    ["~/.doodlebot/releases", deps.releasesDir ?? RELEASES_DIR],
  ];
  const rows: CheckRow[] = folders.map(([item, dir]) => {
    const bytes = sizeOf(dir);
    return {
      area: "disk",
      item,
      status: "info",
      detail: bytes === undefined ? `${dir}: absent` : `${formatBytes(bytes)} (${dir})`,
    };
  });
  for (const copy of content.games)
    rows.push({
      area: "disk",
      item: `game copy ${copy.gameId}`,
      status: "info",
      detail: `${formatBytes(copy.sizeBytes)} recorded (${copy.path})`,
    });
  const free = (deps.freeBytes ?? driveFreeBytes)(deps.artifactDir ?? DEFAULT_ARTIFACT_DIR);
  rows.push(
    free === undefined
      ? { area: "disk", item: "free space", status: "info", detail: "unknown" }
      : free < LOW_DISK_BYTES
        ? {
            area: "disk",
            item: "free space",
            status: "advisory",
            detail: `${formatBytes(free)} free on the workspace's drive, below 10 GB`,
            next: "doodlebot clean --dry-run, then doodlebot clean --yes after the person agrees",
          }
        : {
            area: "disk",
            item: "free space",
            status: "ready",
            detail: `${formatBytes(free)} free on the workspace's drive`,
          },
  );
  return rows;
}

/** Every row of the status table. */
export async function checkRows(deps: CheckDeps = {}): Promise<CheckRow[]> {
  const info = (deps.version ?? (() => versionInfo()))();
  const workspace: CheckRow = {
    area: "workspace",
    item: "doodlebot",
    status: info.dirty ? "advisory" : "ready",
    detail:
      `${info.version} (${info.commit.slice(0, 10)}${info.dirty ? ", modified" : ""}) at ${info.workspace}` +
      (info.dirty ? "; local changes make `doodlebot update` refuse" : ""),
  };
  return [
    workspace,
    ...doctorRows(deps.doctor === undefined ? [] : await deps.doctor()),
    egmRow(deps),
    sourceRow((deps.source ?? managedSourceState)()),
    ...inventoryRows((deps.inventory ?? (() => readInventory()))()),
    ...contentRows(deps),
    ...learningRows(deps),
    ...diskRows(deps),
  ];
}

const MARK: Record<RowStatus, string> = {
  ready: "ready   ",
  missing: "MISSING ",
  blocked: "BLOCKED ",
  advisory: "advisory",
  info: "info    ",
};

export function formatCheck(rows: CheckRow[]): string {
  const lines = ["doodlebot check", ""];
  let area = "";
  for (const row of rows) {
    if (row.area !== area) {
      area = row.area;
      lines.push(`${area}:`);
    }
    lines.push(`  [${MARK[row.status]}] ${row.item}: ${row.detail}`);
    if (row.next !== undefined) lines.push(`             next: ${row.next}`);
  }
  const missing = rows.filter((row) => row.status === "missing" || row.status === "blocked");
  lines.push("");
  lines.push(
    missing.length === 0
      ? "Nothing missing."
      : `${String(missing.length)} item(s) missing or blocked; each names its next step.`,
  );
  return lines.join("\n");
}

/** `doodlebot check [--json]`. Always exits 0: it is a report, not a gate. */
export async function checkCommand(
  flags: Record<string, string | boolean>,
  deps: CheckDeps = {},
): Promise<string> {
  const rows = await checkRows(deps);
  return flags.json === true ? JSON.stringify({ rows }, null, 2) : formatCheck(rows);
}
