/**
 * `doodlebot check [--json]`: the one status table `/doodlebot:setup --check` prints (design 4.1).
 * It only reads: the workspace, `doctor`, the EGM plugin settings, this session's Vortex checkout,
 * a Vortex clone an older doodlebot left in the workspace (never deleted), the inventory,
 * content.json (copy folder, pending restores), the kit gaps, local lessons that duplicate shared
 * ones (4.10), and disk use (4.13). Every row is ready, missing with the exact next command,
 * blocked with the reason, or advisory/info.
 */
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
  OLD_CLONE_DIR,
  RELEASES_DIR,
  USER_STATE_DIR,
} from "./paths";
import { WORKSPACE_RECORD } from "./linkCommand";
import { gitBranch } from "./runningVortex";
import { NEEDS_CHECKOUT, vortexCheckoutOf } from "./config";
import { gitText } from "./gitText";
import { missingBuildOutputs, remotesOf } from "./source";
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
  /** The user's Claude Code settings (default `~/.claude/settings.json`); only user scope counts. */
  userSettingsFile?: string;
  /** Claude Code's installed-plugins list. */
  installedPluginsFile?: string;
  /** `doodlebot link`'s record of the workspace (default `~/.doodlebot/workspace.json`). */
  workspaceRecordFile?: string;
  source?: () => SourceState | undefined | Promise<SourceState | undefined>;
  /** The Vortex clone older kits kept in the workspace (default OLD_CLONE_DIR). */
  oldClone?: string;
  artifactDir?: string;
  cacheDir?: string;
  releasesDir?: string;
  /** Bytes in a folder (undefined when it does not exist). */
  sizeOf?: (dir: string) => number | undefined;
  /** Free bytes on the drive holding a path. */
  freeBytes?: (dir: string) => number | undefined;
}

async function checkoutState(): Promise<SourceState | undefined> {
  const dir = vortexCheckoutOf();
  if (dir === undefined) return undefined;
  const remotes = await remotesOf(dir);
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

/** An `installed_plugins.json` entry: version 2 lists one install per scope. */
type PluginInstall = { scope?: unknown; projectPath?: unknown };

/** The scopes EGM is installed at; a version 1 entry (no list, no scope) counts as user scope. */
function egmInstallScopes(file: string): string[] {
  const installed = readJson(file) as { plugins?: Record<string, unknown> } | undefined;
  return Object.entries(installed?.plugins ?? {})
    .filter(([key]) => key.startsWith("egm@"))
    .flatMap(([, value]) =>
      Array.isArray(value)
        ? (value as PluginInstall[]).map((entry) =>
            typeof entry.scope === "string" ? entry.scope : "user",
          )
        : ["user"],
    );
}

/**
 * EGM must be there in every Vortex checkout and worktree the person opens Claude in, so only
 * user scope counts: the user's settings enabling it, or a user-scope install. A project-scope
 * install (the doodlebot workspace's `.claude/settings.json` enables EGM for that folder only)
 * is reported as missing, with the step that installs it for the user.
 */
function egmRow(deps: CheckDeps): CheckRow {
  const item = "EGM (Elephant-Goldfish Model)";
  const userSettings = deps.userSettingsFile ?? path.join(os.homedir(), ".claude", "settings.json");
  const settings = readJson(userSettings) as
    | { enabledPlugins?: Record<string, unknown> }
    | undefined;
  const enabled = settings?.enabledPlugins?.["egm@egm"] === true;
  const scopes = egmInstallScopes(
    deps.installedPluginsFile ??
      path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json"),
  );
  if (enabled || scopes.includes("user"))
    return {
      area: "plugins",
      item,
      status: "ready",
      detail: [
        ...(enabled ? [`enabled in ${userSettings}`] : []),
        scopes.includes("user")
          ? "installed at user scope"
          : "not in installed_plugins.json (Claude Code installs it on trust)",
      ].join("; "),
    };
  return {
    area: "plugins",
    item,
    status: "missing",
    detail:
      scopes.length > 0
        ? `installed only at ${[...new Set(scopes)].join(", ")} scope, so a session in a Vortex checkout doesn't have it`
        : "not installed at user scope; designing features needs it",
    next: "install EGM at user scope: /plugin marketplace add google/elephant-goldfish-model, then /plugin install egm@egm (user scope)",
  };
}
const samePath = (a: string, b: string): boolean => {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32"
    ? norm(a).toLowerCase() === norm(b).toLowerCase()
    : norm(a) === norm(b);
};

/**
 * The plugin's SessionStart hook finds the workspace through `doodlebot link`'s record; without
 * it, a Vortex session gets only "run /doodlebot:setup" (designs/vortex-session-context.md).
 */
function sessionNoteRow(deps: CheckDeps, workspace: string): CheckRow {
  const item = "Vortex session note";
  const file = deps.workspaceRecordFile ?? path.join(USER_STATE_DIR, WORKSPACE_RECORD);
  const record = readJson(file) as { workspace?: unknown } | undefined;
  const named = typeof record?.workspace === "string" ? record.workspace : undefined;
  const hosts =
    "Claude Code loads it at start, so restart after installing or updating the plugin; " +
    "Codex runs it only after you trust it in /hooks (again after each update)";
  if (named !== undefined && samePath(named, workspace))
    return {
      area: "plugins",
      item,
      status: "ready",
      detail: `the SessionStart hook finds this workspace through ${file}. ${hosts}`,
    };
  return {
    area: "plugins",
    item,
    status: "missing",
    detail:
      named === undefined
        ? `no workspace record at ${file}, so a Vortex session is only told to run /doodlebot:setup`
        : `${file} names ${named}, not this workspace`,
    next: "doodlebot link",
  };
}

function sourceRow(state: SourceState | undefined): CheckRow {
  if (state === undefined)
    return {
      area: "vortex source",
      item: "this checkout",
      status: "advisory",
      detail:
        "this session is not in a Vortex checkout; needed to fix, investigate or QA Vortex code",
      next: NEEDS_CHECKOUT,
    };
  const remotes = Object.entries(state.remotes)
    .map(([name, url]) => `${name} ${url}`)
    .join(", ");
  const pushes = state.remotes.origin !== undefined;
  return {
    area: "vortex source",
    item: "this checkout",
    status: state.built ? "ready" : "missing",
    detail:
      `${state.dir}; remotes: ${remotes || "none"}` +
      `${pushes ? "" : " (no fork as origin: pushing needs gh repo fork Nexus-Mods/Vortex --remote)"}` +
      `; branch ${state.branch ?? "detached"}; ${state.built ? "built" : "not built"}`,
    ...(state.built ? {} : { next: `doodlebot build --checkout ${state.dir}` }),
  };
}

/**
 * The Vortex clone older kits kept in the workspace (OLD_CLONE_DIR). It can hold worktrees and
 * unpushed work, so doodlebot never deletes it: the row says where to open Claude instead.
 */
function oldCloneRows(deps: CheckDeps): CheckRow[] {
  const dir = deps.oldClone ?? OLD_CLONE_DIR;
  if (!fs.existsSync(dir)) return [];
  const listing = gitText(dir, ["worktree", "list", "--porcelain"]);
  const worktrees =
    listing === undefined
      ? undefined
      : listing.split(/\r?\n/).filter((line) => line.startsWith("worktree ")).length - 1;
  return [
    {
      area: "vortex source",
      item: "old Vortex clone",
      status: "advisory",
      detail:
        `Your Vortex clone from an older doodlebot (${dir}` +
        `${worktrees === undefined ? "" : `, ${String(worktrees)} worktree${worktrees === 1 ? "" : "s"}`}` +
        "): open Claude in it or one of its worktrees",
    },
  ];
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
    sessionNoteRow(deps, info.workspace),
    sourceRow(await (deps.source ?? checkoutState)()),
    ...oldCloneRows(deps),
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
