/**
 * Disk use (design 4.13): `doodlebot clean`, and the rule that evidence folders hold reports, not
 * binaries.
 *
 * `clean` lists, and deletes only with `--yes`:
 * - in run, QA and benchmark folders under `harness/.artifacts` older than `--older-than` days
 *   (default 30), every file of 1 MB or more except `report.md`;
 * - under `harness/.cache`, baseline snapshots and nested caches not used for that long;
 * - releases in `~/.doodlebot/releases` that `content.json` no longer names.
 *
 * It never touches a registered game copy, any `oauth-*.json` or `login-*` folder, a pending
 * restore's backup, or the cache of the running harness Vortex.
 */
import fs from "node:fs";
import path from "node:path";

import { readMarker } from "./bootstrap";
import { readContent } from "./content";
import { ConfigError } from "./errors";
import {
  CONTENT_FILE,
  DEFAULT_ARTIFACT_DIR,
  DEFAULT_CACHE_DIR,
  RELEASES_DIR,
  normalizedPath,
} from "./paths";
import { runningVortex, type InstanceRecord } from "./runningVortex";

export const MB = 1024 * 1024;
/** Files from this size up are binaries for `clean`; smaller ones are kept with the report. */
export const KEEP_BELOW_BYTES = MB;
/** A file this large never goes into an evidence folder; a `.link.txt` names it instead. */
export const EVIDENCE_LIMIT_BYTES = 100 * MB;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The evidence rule
// ---------------------------------------------------------------------------

/**
 * Put `file` into the evidence folder `evidenceDir`: copied when it is under 100 MB, otherwise
 * left where it is and named by `<name>.link.txt` (its absolute path and size). Run-report
 * writers use this for anything that is not text they wrote themselves (game copies, VM disks,
 * packages and downloads belong in the cache or the copy folder).
 */
export function placeEvidenceFile(
  file: string,
  evidenceDir: string,
  options: { limitBytes?: number } = {},
): { path: string; linked: boolean } {
  const limit = options.limitBytes ?? EVIDENCE_LIMIT_BYTES;
  const size = fs.statSync(file).size;
  fs.mkdirSync(evidenceDir, { recursive: true });
  const name = path.basename(file);
  if (size > limit) {
    const link = path.join(evidenceDir, `${name}.link.txt`);
    fs.writeFileSync(
      link,
      `${path.resolve(file)}\n${String(size)} bytes, over the ${String(Math.round(limit / MB))} MB ` +
        `an evidence folder holds; the file stays where it is.\n`,
    );
    return { path: link, linked: true };
  }
  const target = path.join(evidenceDir, name);
  if (normalizedPath(target) !== normalizedPath(file)) fs.copyFileSync(file, target);
  return { path: target, linked: false };
}

// ---------------------------------------------------------------------------
// clean
// ---------------------------------------------------------------------------

export interface CleanItem {
  /** What is deleted: a folder or a file. */
  path: string;
  kind: "evidence" | "cache" | "release";
  bytes: number;
  reason: string;
  /** For evidence: the files deleted inside a kept folder (reports and small files stay). */
  files?: string[];
}

export interface CleanDeps {
  artifactDir?: string;
  cacheDir?: string;
  releasesDir?: string;
  contentFile?: string;
  now?: () => Date;
  running?: () => InstanceRecord | undefined;
}

interface FileInfo {
  path: string;
  size: number;
  mtimeMs: number;
}

function walk(dir: string): FileInfo[] {
  const files: FileInfo[] = [];
  const visit = (current: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const stat = fs.statSync(full);
        files.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    }
  };
  visit(dir);
  return files;
}

const subdirectories = (dir: string): string[] => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
};

/** The newest modification time of the folder or anything in it. */
function lastUsed(dir: string): number {
  return Math.max(fs.statSync(dir).mtimeMs, ...walk(dir).map((file) => file.mtimeMs));
}

/** Run, QA and benchmark folders: `runs/<run>`, `benchmarks/<run>`, `qa/<version>/<id>/<time>`. */
function evidenceFolders(artifactDir: string): string[] {
  return [
    ...subdirectories(path.join(artifactDir, "runs")),
    ...subdirectories(path.join(artifactDir, "benchmarks")),
    ...subdirectories(path.join(artifactDir, "qa")).flatMap((version) =>
      subdirectories(version).flatMap(subdirectories),
    ),
  ];
}

/** Paths `clean` never deletes, nor anything inside them, nor any folder holding one. */
function protectedPaths(deps: CleanDeps): { paths: string[]; why: string }[] {
  const content = readContent(deps.contentFile ?? CONTENT_FILE);
  const running = (deps.running ?? runningVortex)();
  return [
    ...content.games.map((copy) => ({ paths: [copy.path], why: "a registered game copy" })),
    ...content.pendingRestores.map((pending) => ({
      paths: [pending.backupDir],
      why: "a pending restore",
    })),
    ...(running === undefined
      ? []
      : [{ paths: [running.cacheDir, running.userDataDir], why: "the running instance's cache" }]),
  ];
}

const isLogin = (file: string): boolean =>
  /^(?:oauth-.*\.json|login-.*)$/i.test(path.basename(file));

/** `a` is `b` or inside it. */
const within = (a: string, b: string): boolean => {
  const x = normalizedPath(a);
  const y = normalizedPath(b);
  return x === y || x.startsWith(`${y}/`);
};
const overlaps = (a: string, b: string): boolean => within(a, b) || within(b, a);

/**
 * Why `target` may not be deleted, or undefined. A target deleted whole may not hold a protected
 * path either (`overlap`); a folder whose files are judged one by one only may not lie inside one
 * (`inside`).
 */
function protection(
  target: string,
  guards: { paths: string[]; why: string }[],
  mode: "overlap" | "inside" = "overlap",
): string | undefined {
  const test = mode === "overlap" ? overlaps : within;
  for (const guard of guards) if (guard.paths.some((p) => test(target, p))) return guard.why;
  return undefined;
}

function evidenceItems(
  deps: CleanDeps,
  cutoff: number,
  guards: { paths: string[]; why: string }[],
): CleanItem[] {
  const items: CleanItem[] = [];
  for (const dir of evidenceFolders(deps.artifactDir ?? DEFAULT_ARTIFACT_DIR)) {
    if (protection(dir, guards, "inside") !== undefined || lastUsed(dir) >= cutoff) continue;
    const doomed = walk(dir).filter(
      (file) =>
        path.basename(file.path).toLowerCase() !== "report.md" &&
        file.size >= KEEP_BELOW_BYTES &&
        !isLogin(file.path) &&
        protection(file.path, guards) === undefined,
    );
    if (doomed.length === 0) continue;
    items.push({
      path: dir,
      kind: "evidence",
      bytes: doomed.reduce((sum, file) => sum + file.size, 0),
      reason: `${String(doomed.length)} file(s) of 1 MB or more; report.md and small files stay`,
      files: doomed.map((file) => file.path),
    });
  }
  return items;
}

/** A folder that is a cache of its own: it holds a profile, baselines or a build record. */
const isNestedCache = (dir: string): boolean =>
  fs.existsSync(path.join(dir, "live")) ||
  fs.existsSync(path.join(dir, "last-build.json")) ||
  subdirectories(dir).some((sub) => path.basename(sub).startsWith("snapshot-"));

function cacheItems(
  deps: CleanDeps,
  cutoff: number,
  guards: { paths: string[]; why: string }[],
): CleanItem[] {
  const cacheDir = deps.cacheDir ?? DEFAULT_CACHE_DIR;
  if (!fs.existsSync(cacheDir) || protection(cacheDir, guards, "inside") !== undefined) return [];
  const items: CleanItem[] = [];
  const size = (dir: string) => walk(dir).reduce((sum, file) => sum + file.size, 0);
  // The working profile's baseline is in use whenever the profile is: as of the last launch.
  const liveKey = readMarker(path.join(cacheDir, "live"))?.snapshotKey;
  const lastLaunch = (() => {
    try {
      return fs.statSync(path.join(cacheDir, "last-build.json")).mtimeMs;
    } catch {
      return 0;
    }
  })();
  for (const dir of subdirectories(cacheDir)) {
    const name = path.basename(dir);
    if (isLogin(dir) || protection(dir, guards) !== undefined) continue;
    if (name.startsWith("snapshot-")) {
      const used = Math.max(lastUsed(dir), name === liveKey ? lastLaunch : 0);
      if (used >= cutoff) continue;
      items.push({
        path: dir,
        kind: "cache",
        bytes: size(dir),
        reason: `baseline not used since ${new Date(used).toISOString().slice(0, 10)}`,
      });
    } else if (isNestedCache(dir)) {
      const used = lastUsed(dir);
      if (used >= cutoff) continue;
      // Its login stays: everything else in it goes.
      const doomed = fs
        .readdirSync(dir)
        .map((entry) => path.join(dir, entry))
        .filter((entry) => !isLogin(entry) && protection(entry, guards) === undefined);
      if (doomed.length === 0) continue;
      items.push({
        path: dir,
        kind: "cache",
        bytes: doomed.reduce(
          (sum, entry) =>
            sum + (fs.statSync(entry).isDirectory() ? size(entry) : fs.statSync(entry).size),
          0,
        ),
        reason: `cache not used since ${new Date(used).toISOString().slice(0, 10)}; its login stays`,
        files: doomed,
      });
    }
  }
  return items;
}

function releaseItems(deps: CleanDeps, guards: { paths: string[]; why: string }[]): CleanItem[] {
  const releasesDir = deps.releasesDir ?? RELEASES_DIR;
  const named = readContent(deps.contentFile ?? CONTENT_FILE).releases.map((release) => [
    release.path,
    release.exe,
  ]);
  return subdirectories(releasesDir)
    .filter((dir) => !named.some((paths) => paths.some((p) => overlaps(p, dir))))
    .filter((dir) => protection(dir, guards) === undefined)
    .map((dir) => ({
      path: dir,
      kind: "release" as const,
      bytes: walk(dir).reduce((sum, file) => sum + file.size, 0),
      reason: "not named in content.json",
    }));
}

/** What `clean` would delete. */
export function planClean(olderThanDays: number, deps: CleanDeps = {}): CleanItem[] {
  if (!Number.isFinite(olderThanDays) || olderThanDays < 0)
    throw new ConfigError("--older-than needs a number of days (0 or more).");
  const cutoff = (deps.now ?? (() => new Date()))().getTime() - olderThanDays * DAY_MS;
  const guards = protectedPaths(deps);
  return [
    ...evidenceItems(deps, cutoff, guards),
    ...cacheItems(deps, cutoff, guards),
    ...releaseItems(deps, guards),
  ];
}

/** Delete what the plan lists. Each path is checked against the protections again first. */
export function applyClean(items: CleanItem[], deps: CleanDeps = {}): void {
  const guards = protectedPaths(deps);
  for (const item of items) {
    for (const target of item.files ?? [item.path]) {
      const why = protection(target, guards);
      if (why !== undefined || isLogin(target))
        throw new ConfigError(`Refusing to delete ${target}: ${why ?? "a login"}.`);
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
}

const gb = (bytes: number): string =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / MB).toFixed(bytes >= MB ? 0 : 1)} MB`;

export function formatClean(items: CleanItem[], olderThanDays: number): string {
  if (items.length === 0) return `Nothing to clean (older than ${String(olderThanDays)} days).`;
  const total = items.reduce((sum, item) => sum + item.bytes, 0);
  return [
    `To delete (${gb(total)} in all; older than ${String(olderThanDays)} days):`,
    ...items.map(
      (item) =>
        `  ${item.kind.padEnd(8)} ${gb(item.bytes).padStart(8)}  ${item.path}  (${item.reason})`,
    ),
  ].join("\n");
}

/**
 * `doodlebot clean [--older-than <days>] [--dry-run] [--yes]`: lists, and deletes only with
 * `--yes` (the skill asks the person first). `--dry-run` lists even with `--yes`.
 */
export function cleanCommand(
  flags: Record<string, string | boolean>,
  deps: CleanDeps = {},
): { text: string; code: number } {
  const days = typeof flags["older-than"] === "string" ? Number(flags["older-than"]) : 30;
  const items = planClean(days, deps);
  const listing = formatClean(items, days);
  if (items.length === 0 || flags["dry-run"] === true || flags.yes !== true)
    return {
      text:
        items.length === 0 || flags["dry-run"] === true
          ? listing
          : `${listing}\nNothing was deleted. Run again with --yes to delete these.`,
      code: 0,
    };
  applyClean(items, deps);
  return {
    text: `${listing}\nDeleted ${String(items.length)} item(s).`,
    code: 0,
  };
}
