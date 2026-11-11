/**
 * `--production`: run a source build of Vortex the way a release runs, and prove it did.
 *
 * Vortex's bundler inlines `process.env.NODE_ENV` at build time (rolldown `define` for main,
 * webpack for the renderer). A plain `pnpm run build` has no NODE_ENV, so it produces a
 * development bundle: main.cjs's "set NODE_ENV=production unless development" becomes
 * `if (false)`, and renderer.tsx's "set process.env.NODE_ENV to production" branch is dead
 * code too. Removing NODE_ENV from the launch environment then leaves the renderer with none
 * at all, and React, which is required at run time rather than bundled, loads
 * `react.development.js`. Nothing errors; rendering is just several times slower. A bundle
 * built with NODE_ENV=production sets it itself, which is why the same kit gave production
 * React on one build of a checkout and development React on the next.
 *
 * So the harness sets NODE_ENV=production itself, then asks the renderer which React build
 * it loaded (`automation_status.react`) and refuses the run unless it is production.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ConfigError } from "./config";
import { hashBytes, worktreeChanges } from "./evidence";

export interface ProductionStatus {
  nodeEnv?: string | null;
  react?: { build?: string; files?: string[] };
}

/** A ConfigError, so the CLI prints the message rather than a stack. */
export class ProductionModeError extends ConfigError {}

/** Why a renderer is not in production mode, or undefined when it is. */
export function productionProblem(status: ProductionStatus): string | undefined {
  const problems: string[] = [];
  if (status.nodeEnv !== "production") {
    problems.push(`the renderer's NODE_ENV is ${JSON.stringify(status.nodeEnv ?? null)}`);
  }
  const build = status.react?.build;
  if (build === undefined) {
    problems.push(
      "automation_status does not report which React build loaded (the extension predates it)",
    );
  } else if (build !== "production") {
    const files = status.react?.files ?? [];
    problems.push(
      `React's ${build} build is loaded` + (files.length > 0 ? ` (${files.join(", ")})` : ""),
    );
  }
  return problems.length === 0 ? undefined : problems.join("; ");
}

export function productionErrorMessage(problem: string): string {
  return (
    `--production was requested, but ${problem}. Timings from this instance would be ` +
    `development React's, so it was stopped.\n\n` +
    `  The harness launches with NODE_ENV=production; something overrode it (NODE_OPTIONS, a ` +
    `preload, or a checkout whose main process forces development).\n` +
    `  Check: doodlebot call automation_status   (nodeEnv, react.build)`
  );
}

export type BundleMode = "development" | "production" | "unknown";

/**
 * Whether a Vortex checkout's renderer bundle was built for development.
 *
 * webpack in development mode leaves inlined comparisons such as
 * `"development" === "development"` in the output; a production build folds and minifies
 * them away. With no marker the mode is reported as production only when the bundle
 * exists; otherwise unknown.
 */
export function bundleModeOf(sourceDir: string): BundleMode {
  const file = path.join(sourceDir, "src", "main", "build", "renderer.js");
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return "unknown";
  }
  return bundleModeFromText(text);
}

export function bundleModeFromText(text: string): BundleMode {
  if (/"development"\s*[!=]==?\s*"development"/.test(text)) return "development";
  return text.length > 0 ? "production" : "unknown";
}

// ---------------------------------------------------------------------------
// The build record: a stale build never runs silently (design 4.6)
// ---------------------------------------------------------------------------

/** The record's file name, in the worktree's own git folder (`git rev-parse --git-dir`). */
export const BUILD_RECORD_NAME = "doodlebot-build.json";

/**
 * What `doodlebot build` built: the checkout's identity at build time. `changes` maps each file
 * whose content differed from `head` (tracked or untracked, not ignored) to its hash, so the
 * built tree is `head` plus `changes`. `bundleSha256` is the renderer bundle it produced, so a
 * later build made some other way is not mistaken for this one.
 */
export interface BuildRecord {
  schemaVersion: 1;
  builtAt: string;
  head: string;
  changesSha256: string;
  changes: Record<string, string>;
  mode: "production" | "development";
  bundleSha256?: string;
}

function gitText(dir: string, args: string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch {
    return undefined;
  }
}

/** Where a checkout's build record lives, or undefined when it is not a git checkout. */
export function buildRecordFile(checkout: string): string | undefined {
  const gitDir = gitText(checkout, ["rev-parse", "--absolute-git-dir"]);
  return gitDir === undefined || gitDir === "" ? undefined : path.join(gitDir, BUILD_RECORD_NAME);
}

function bundleHash(checkout: string): string | undefined {
  try {
    return hashBytes(fs.readFileSync(path.join(checkout, "src", "main", "build", "renderer.js")));
  } catch {
    return undefined;
  }
}

/** The checkout's identity now, or undefined when it is not a git checkout. */
export function checkoutBuildIdentity(
  checkout: string,
): Pick<BuildRecord, "head" | "changes" | "changesSha256"> | undefined {
  const root = gitText(checkout, ["rev-parse", "--show-toplevel"]);
  const head = gitText(checkout, ["rev-parse", "HEAD"]);
  if (root === undefined || head === undefined) return undefined;
  const changes = worktreeChanges(path.resolve(root), head);
  return { head, changes, changesSha256: hashBytes(JSON.stringify(changes)) };
}

/** Write the record for an identity taken before the build; returns its file. */
export function writeBuildRecord(
  checkout: string,
  identity: Pick<BuildRecord, "head" | "changes" | "changesSha256">,
  mode: BuildRecord["mode"],
): string | undefined {
  const file = buildRecordFile(checkout);
  if (file === undefined) return undefined;
  const bundle = bundleHash(checkout);
  const record: BuildRecord = {
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    ...identity,
    mode,
    ...(bundle === undefined ? {} : { bundleSha256: bundle }),
  };
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

/** Remove the record: before a build starts, and after one fails. */
export function clearBuildRecord(checkout: string): void {
  const file = buildRecordFile(checkout);
  if (file !== undefined) fs.rmSync(file, { force: true });
}

export function readBuildRecord(checkout: string): BuildRecord | undefined {
  const file = buildRecordFile(checkout);
  if (file === undefined) return undefined;
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<BuildRecord>;
    return record.schemaVersion === 1 &&
      typeof record.head === "string" &&
      typeof record.changes === "object" &&
      record.changes !== null
      ? (record as BuildRecord)
      : undefined;
  } catch {
    return undefined;
  }
}

export type BuildRecordCheck =
  | { status: "match"; record: BuildRecord }
  | { status: "none"; message: string }
  | { status: "stale"; files: string[]; message: string };

/**
 * Compare the checkout with its build record. The built tree is the record's HEAD plus its
 * changes; the checkout now is its working tree. Files that differ between the two, compared by
 * content, make the build stale, whatever HEAD says: a `git switch` that changes files is stale,
 * committing the very changes that were built is not.
 */
export function checkBuildRecord(checkout: string): BuildRecordCheck {
  const build = `\`doodlebot build --checkout ${checkout}\``;
  const record = readBuildRecord(checkout);
  if (record === undefined)
    return {
      status: "none",
      message:
        `${checkout} has no doodlebot build record (it was not built with doodlebot build), so ` +
        `whether its build matches the checkout is unknown. ${build} records one.`,
    };
  const bundle = bundleHash(checkout);
  if (record.bundleSha256 !== undefined && bundle !== record.bundleSha256)
    return {
      status: "none",
      message:
        `${checkout}'s renderer bundle was rebuilt outside doodlebot build since its build ` +
        `record, so whether it matches the checkout is unknown. ${build} records one.`,
    };
  const short = record.head.slice(0, 10);
  const stale = (files: string[], why: string): BuildRecordCheck => ({
    status: "stale",
    files,
    message:
      `The build is from ${short} and the checkout has changed since (${why}). Run ${build}, ` +
      "or pass --stale-ok to launch it anyway.",
  });
  if (gitText(checkout, ["cat-file", "-e", `${record.head}^{commit}`]) === undefined)
    return stale([], `the commit ${short} is no longer in it`);
  const root = gitText(checkout, ["rev-parse", "--show-toplevel"]);
  if (root === undefined) return stale([], "it is no longer a git checkout");
  const now = worktreeChanges(path.resolve(root), record.head);
  const files = [...new Set([...Object.keys(now), ...Object.keys(record.changes)])]
    .filter((file) => (record.changes[file] ?? "head") !== (now[file] ?? "head"))
    .sort();
  if (files.length === 0) return { status: "match", record };
  return stale(
    files,
    `${String(files.length)} file${files.length === 1 ? "" : "s"}, for example ${files[0]!}`,
  );
}

export function devBundleWarning(sourceDir: string): string {
  return (
    `${sourceDir} was built without NODE_ENV=production (a development bundle). React runs ` +
    `its production build, but Vortex's own development-only branches, inlined at build ` +
    `time, still run (main-process file logging, renderer source-map support and process ` +
    `warning traces, missing-icon checks). For release parity rebuild it with ` +
    `\`doodlebot build --checkout ${sourceDir} --production\`, which sets ` +
    `NODE_ENV=production for the build only (nx caches the two modes separately).`
  );
}
