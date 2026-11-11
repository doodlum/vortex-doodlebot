/**
 * Preparing the session's Vortex checkout, and cloning a new one where the person says.
 *
 * The person opens Claude in a Vortex checkout or one of its worktrees, and that is the checkout
 * the kit works in (config.ts `sessionCheckout`); the kit never goes hunting around the
 * filesystem for one. `source --clone <dir>` makes one: it asks GitHub who the operator is,
 * looks for their fork, and clones it into the folder the person named, outside the workspace.
 * Without a fork it clones Nexus-Mods/Vortex itself, as the remote `upstream`: enough to read,
 * build and test, though pushing needs a fork (prPush.ts).
 *
 * Everything here works unauthenticated. `gh` is used when it happens to be
 * logged in, but the fallback — GitHub's public REST API plus the identity git
 * already knows — needs no token, which matters because requiring `gh auth
 * login` before you can build anything would be a poor first five minutes.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { ConfigError } from "./errors";
import { REPO_ROOT } from "./paths";
import { abortOnSignals, runEvidenceProcess } from "./processRunner";
import { assertNoVortexRunningFrom } from "./runningVortex";

const execFileAsync = promisify(execFile);

export const UPSTREAM = "Nexus-Mods/Vortex";
const UPSTREAM_URL = `https://github.com/${UPSTREAM}.git`;

export function hasVortexSource(dir: string): boolean {
  return fs.existsSync(path.join(dir, "src", "main", "package.json"));
}

/** `dir` is `root` or inside it. */
function isInside(dir: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(dir));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export class ForkError extends Error {}

/** Only an ordinary nonzero command exit permits the Nx build fallback. */
export class CommandExitError extends ForkError {}

export interface PackageManagerCommand {
  cmd: string;
  args: string[];
  version: string;
  exact: boolean;
}

/** Parse the package manager declared by a source checkout, ignoring Corepack's hash suffix. */
export function parsePnpmVersion(packageManager: string | undefined): string {
  const match = /^pnpm@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+.*)?$/.exec(packageManager ?? "");
  if (match?.[1] === undefined) {
    throw new ForkError(
      `Vortex must declare an exact pnpm version in package.json; found ${packageManager ?? "nothing"}.`,
    );
  }
  return match[1];
}

/**
 * Use the installed pnpm only when it exactly matches; otherwise bootstrap the pinned version.
 * `VORTEX_AI_PNPM` names a pnpm of the pinned version to use instead of `pnpm dlx`, for a
 * machine where dlx can't run (KNOWLEDGE.md, "No `pnpm`, or only Node 20").
 */
export function selectPnpmCommand(
  wantedVersion: string,
  installedVersion: string | undefined,
  override: string | undefined = process.env.VORTEX_AI_PNPM,
): PackageManagerCommand {
  if (override !== undefined && override.trim() !== "" && installedVersion !== wantedVersion) {
    return { cmd: override.trim(), args: [], version: wantedVersion, exact: true };
  }
  if (installedVersion === wantedVersion) {
    return { cmd: "pnpm", args: [], version: wantedVersion, exact: true };
  }
  return {
    cmd: "pnpm",
    args: ["dlx", `pnpm@${wantedVersion}`],
    version: wantedVersion,
    exact: false,
  };
}

/**
 * Environment for a nested package-manager run.
 *
 * Strips the `npm_*` / `PNPM_*` variables the surrounding `pnpm exec` exports.
 * They pin a child to the *parent* project's package manager regardless of its
 * own `packageManager` field and working directory — so running Vortex's install
 * from here used pnpm 9 instead of the 11 it requires, and failed with a
 * "broken lockfile" and an unresolvable `node@runtime:` spec. Neither error
 * mentions the version mismatch that actually caused them.
 *
 * `CI=1` additionally keeps anything downstream from stopping on a prompt there
 * is no terminal to answer.
 */
export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { CI: "1" };
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(npm_|PNPM_|COREPACK_)/i.test(key)) continue;
    if (value === undefined) continue;
    env[key] = key.toUpperCase() === "PATH" ? nestedPath(value) : value;
  }
  return env;
}

/**
 * The environment for a command someone runs through the kit (`evidence run`, `script`), by where
 * it runs. Inside this repo it's the kit's own command: unchanged. Anywhere else, such as
 * `pnpm run verify` in a Vortex checkout, it's a Vortex command, and gets what `childEnv`
 * gives a nested run: no npm_/PNPM_ variables from the kit's pnpm 9, and a PATH whose first pnpm
 * is the checkout's. `CI` is left as the caller had it.
 */
export function commandEnv(
  cwd: string,
  base: NodeJS.ProcessEnv = process.env,
  repoRoot: string = REPO_ROOT,
): NodeJS.ProcessEnv {
  if (isInside(path.resolve(cwd), repoRoot)) return { ...base };
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (/^(npm_|PNPM_|COREPACK_)/i.test(key)) continue;
    if (value === undefined) continue;
    env[key] =
      key.toUpperCase() === "PATH" ? nestedPath(value, base.VORTEX_AI_PNPM, repoRoot) : value;
  }
  return env;
}

/**
 * PATH for a command run inside a Vortex checkout. The kit runs under its own pnpm 9, and
 * `pnpm run` / `npx pnpm@9` put that pnpm and this repo's `node_modules/.bin` first on PATH.
 * A Vortex script that calls `pnpm` itself (the build's `assets` step does) then gets pnpm 9,
 * which can't read pnpm 11's lockfile (ERR_PNPM_BROKEN_LOCKFILE). Drop those entries, and put
 * `VORTEX_AI_PNPM`'s directory first when it names the checkout's pnpm.
 */
export function nestedPath(
  value: string,
  override: string | undefined = process.env.VORTEX_AI_PNPM,
  repoRoot: string = REPO_ROOT,
): string {
  const kitBin = path.join(repoRoot, "node_modules", ".bin").toLowerCase();
  const kept = value
    .split(path.delimiter)
    .filter((entry) => entry !== "")
    .filter((entry) => !/[\\/]_npx[\\/]/i.test(entry))
    .filter((entry) => path.resolve(entry).toLowerCase() !== kitBin);
  const first =
    override !== undefined && override.trim() !== "" ? [path.dirname(override.trim())] : [];
  return [...first, ...kept.filter((entry) => !first.includes(entry))].join(path.delimiter);
}

/**
 * Run a long command with its output visible.
 *
 * Capturing stdout for these was a mistake worth recording: `pnpm install` in a
 * Vortex checkout downloads an Electron binary and rebuilds six native modules,
 * which takes many minutes and prints steadily the whole time. With the output
 * swallowed it is indistinguishable from a hang — so it got killed as hung when
 * it was working fine. Streaming costs nothing and makes the difference obvious.
 *
 * `CI=1` keeps anything downstream from stopping on an interactive prompt there
 * is no terminal to answer.
 */
/** Windows runs pnpm and any `.cmd` shim only through a shell. */
export function needsShell(cmd: string): boolean {
  return process.platform === "win32" && (cmd === "pnpm" || /.(cmd|bat)$/i.test(cmd));
}

export async function runStreaming(
  cmd: string,
  args: string[],
  options: { cwd?: string; label: string },
): Promise<void> {
  const cancellation = abortOnSignals();
  try {
    const shell = needsShell(cmd);
    const line = [cmd, ...args]
      .map((part) => (/^[\w@%+=:,./\\-]+$/.test(part) ? part : `"${part.replace(/"/g, '\\"')}"`))
      .join(" ");
    const result = await runEvidenceProcess({
      executable: shell ? line : cmd,
      args: shell ? [] : args,
      cwd: options.cwd ?? process.cwd(),
      shell,
      stdin: "inherit",
      env: childEnv(),
      signal: cancellation.signal,
      onOutput: (chunk) => process.stdout.write(chunk),
    });
    if (result.aborted)
      throw new ForkError(`${options.label} was interrupted; child exit confirmed.`);
    if (result.signal !== null)
      throw new ForkError(
        `${options.label} was terminated by ${result.signal}; child exit confirmed.`,
      );
    if (result.code === null)
      throw new ForkError(`${options.label} ended without an exit code; child exit confirmed.`);
    if (result.code !== 0)
      throw new CommandExitError(
        `${options.label} failed (${cmd} ${args.join(" ")}) with ` +
          `${result.signal === null ? `exit code ${String(result.code)}` : `signal ${result.signal}`}. ` +
          `Its output is above.`,
      );
  } finally {
    cancellation.dispose();
  }
}

async function tryExec(
  cmd: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      shell: cmd === "pnpm" && process.platform === "win32",
      timeout: 20_000,
      cwd: options.cwd,
      env: options.env,
    });
    const out = stdout.trim();
    return out === "" ? undefined : out;
  } catch {
    return undefined;
  }
}

async function sourcePnpmCommand(dir: string): Promise<PackageManagerCommand> {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as {
    packageManager?: string;
  };
  const wanted = parsePnpmVersion(manifest.packageManager);
  const installed = await tryExec("pnpm", ["--version"], { cwd: dir, env: childEnv() });
  return selectPnpmCommand(wanted, installed);
}

/**
 * Work out the operator's GitHub login, cheapest signal first.
 *
 * The noreply-email parse is the quiet hero: GitHub hands out
 * `<id>+<login>@users.noreply.github.com`, and most people have it configured
 * already, so identity is usually known without `gh` being installed at all.
 */
export async function detectGitHubUser(): Promise<string | undefined> {
  const explicit = process.env.VORTEX_AI_GITHUB_USER;
  if (explicit !== undefined && explicit !== "") return explicit;

  const gh = await tryExec("gh", ["api", "user", "--jq", ".login"]);
  if (gh !== undefined) return gh;

  const configured = await tryExec("git", ["config", "--get", "github.user"]);
  if (configured !== undefined) return configured;

  const email = await tryExec("git", ["config", "--get", "user.email"]);
  const noreply = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i.exec(email ?? "");
  if (noreply?.[1] !== undefined) return noreply[1];

  return tryExec("git", ["config", "--get", "user.name"]);
}

export interface ForkInfo {
  fullName: string;
  cloneUrl: string;
  defaultBranch: string;
  isFork: boolean;
  parent: string | undefined;
}

/** Look up `<user>/Vortex` on GitHub. Undefined when it does not exist. */
export async function findFork(user: string): Promise<ForkInfo | undefined> {
  const response = await fetch(`https://api.github.com/repos/${user}/Vortex`, {
    headers: { accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return undefined;
  if (response.status === 403) {
    throw new ForkError(
      "GitHub rate-limited the unauthenticated lookup of your fork. Either wait a few minutes, " +
        "run `gh auth login`, or set VORTEX_AI_GITHUB_USER and VORTEX_AI_VORTEX_REPO to skip " +
        "discovery entirely.",
    );
  }
  if (!response.ok) {
    throw new ForkError(`GitHub returned ${String(response.status)} looking up ${user}/Vortex.`);
  }

  const repo = (await response.json()) as {
    full_name: string;
    clone_url: string;
    default_branch: string;
    fork: boolean;
    parent?: { full_name: string };
  };
  return {
    fullName: repo.full_name,
    cloneUrl: repo.clone_url,
    defaultBranch: repo.default_branch,
    isFork: repo.fork,
    parent: repo.parent?.full_name,
  };
}

/** What `source` says when it clones upstream: reading and building need no fork; pushing does. */
export const NO_FORK_NOTE =
  `No fork of ${UPSTREAM} was found, so the checkout is a clone of ${UPSTREAM} (remote ` +
  `\`upstream\`, no \`origin\`). Building, trying and QA need nothing more. Pushing a fix or ` +
  `opening a pull request needs your own fork: \`gh repo fork ${UPSTREAM} --remote\` adds it as ` +
  "`origin`. If your fork has another name, set VORTEX_AI_VORTEX_REPO=<owner>/<repo>; if your " +
  "login was guessed wrong, set VORTEX_AI_GITHUB_USER.";

/**
 * Resolve the person's fork: `VORTEX_AI_VORTEX_REPO`, else `<login>/Vortex`. Undefined when the
 * login is unknown or has no fork: `source` then clones upstream, which is enough to read and
 * build Vortex. Pushing needs the fork (prPush.ts).
 */
export async function resolveVortexRepo(): Promise<ForkInfo | undefined> {
  const override = process.env.VORTEX_AI_VORTEX_REPO;
  if (override !== undefined && override !== "") {
    const asUrl = override.includes("://") || override.endsWith(".git");
    return {
      fullName: override,
      cloneUrl: asUrl ? override : `https://github.com/${override}.git`,
      defaultBranch: "master",
      isFork: true,
      parent: undefined,
    };
  }

  const user = await detectGitHubUser();
  if (user === undefined) return undefined;
  const fork = await findFork(user);
  if (fork === undefined) return undefined;

  if (!fork.isFork) {
    // Not fatal — someone may keep a non-fork mirror — but worth saying, because
    // the usual cause is a typo'd username that happens to own a repo named Vortex.
    process.stderr.write(
      `[doodlebot] note: ${fork.fullName} is not a fork of ${UPSTREAM}; using it anyway.\n`,
    );
  }

  return fork;
}

export interface CloneOptions {
  /** Progress reporting. */
  onProgress?: (message: string) => void;
  /** Finds the person's fork (default resolveVortexRepo); undefined clones upstream alone. */
  resolveRepo?: () => Promise<ForkInfo | undefined>;
  /** The Nexus repository's clone URL (tests use a local one). */
  upstreamUrl?: string;
  /** The doodlebot workspace, which a clone never goes inside (default this repository). */
  workspace?: string;
}

export interface BuildSourceOptions {
  /** The checkout to install or build. */
  dir: string;
  /** Install dependencies only. */
  installOnly?: boolean;
  /** Progress reporting. */
  onProgress?: (message: string) => void;
}

export interface VortexSource {
  dir: string;
  /** The fork (`origin`) when there is one, else the upstream URL. */
  repo: string;
  /** Upstream's default branch, which work branches start from. */
  defaultBranch: string;
  /** Whether `origin`, the person's fork, exists. Pushing needs it. */
  hasFork: boolean;
}

/** A remote's URL, or undefined when the checkout has no such remote. */
export async function remoteUrl(dir: string, name: string): Promise<string | undefined> {
  return tryExec("git", ["-C", dir, "remote", "get-url", name]);
}

/** `upstream`'s default branch, from `refs/remotes/upstream/HEAD` (default `master`). */
export async function upstreamDefaultBranch(dir: string): Promise<string> {
  const head = await tryExec("git", [
    "-C",
    dir,
    "symbolic-ref",
    "--short",
    "refs/remotes/upstream/HEAD",
  ]);
  return head?.replace(/^upstream\//, "") ?? "master";
}

/**
 * `source --clone <dir>`: clone Vortex into the folder the person named, never into the doodlebot
 * workspace and never over an existing folder with something in it.
 *
 * The Nexus repository is always the remote `upstream`. With a fork, the fork is `origin` (where
 * changes are pushed) and upstream is added and fetched beside it. Without one, upstream is cloned
 * with `git clone -o upstream`, so there is no `origin` until `gh repo fork --remote` adds it;
 * reading and building need nothing more.
 */
export async function cloneVortex(
  target: string,
  options: CloneOptions = {},
): Promise<VortexSource> {
  const report = options.onProgress ?? ((): void => undefined);
  const dir = path.resolve(target);
  const upstreamUrl = options.upstreamUrl ?? UPSTREAM_URL;
  const workspace = options.workspace ?? REPO_ROOT;
  if (isInside(dir, workspace) || isInside(workspace, dir))
    throw new ConfigError(
      `${dir} is in the doodlebot workspace (${workspace}). Clone Vortex into a folder of its own, ` +
        "outside it.",
    );
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0)
    throw new ConfigError(
      `${dir} already exists and is not empty. Name a new folder, or open Claude in that ` +
        "checkout and run `/doodlebot:source`.",
    );

  const fork = await (options.resolveRepo ?? resolveVortexRepo)();
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  // A full Vortex clone over a slow link genuinely takes a while; a short
  // timeout here would abort a working clone and leave a half-written dir.
  if (fork === undefined) {
    report(`cloning ${UPSTREAM} into ${dir} as upstream (a large repo: several minutes)`);
    await runStreaming("git", ["clone", "--progress", "-o", "upstream", upstreamUrl, dir], {
      label: `Cloning ${UPSTREAM}`,
    });
    report(`cloned; upstream=${UPSTREAM}, no origin`);
    return {
      dir,
      repo: upstreamUrl,
      defaultBranch: await upstreamDefaultBranch(dir),
      hasFork: false,
    };
  }

  report(`cloning ${fork.fullName} into ${dir} (a large repo: several minutes)`);
  await runStreaming("git", ["clone", "--progress", "-o", "origin", fork.cloneUrl, dir], {
    label: `Cloning ${fork.fullName}`,
  });
  await runStreaming("git", ["-C", dir, "remote", "add", "upstream", upstreamUrl], {
    label: "Configuring Vortex upstream",
  });
  await runStreaming("git", ["-C", dir, "fetch", "upstream"], { label: "Fetching upstream" });
  await tryExec("git", ["-C", dir, "remote", "set-head", "upstream", "--auto"]);
  report(`cloned; origin=${fork.fullName}, upstream=${UPSTREAM}`);

  return {
    dir,
    repo: fork.fullName,
    defaultBranch: await upstreamDefaultBranch(dir),
    hasFork: true,
  };
}

/** `source --update`: fetch every remote of the checkout, and upstream's default branch. */
export async function fetchRemotes(
  dir: string,
  onProgress: (message: string) => void = () => undefined,
): Promise<void> {
  onProgress("fetching every remote");
  await runStreaming("git", ["-C", dir, "fetch", "--all", "--prune"], {
    label: "Fetching Vortex source",
  });
  await tryExec("git", ["-C", dir, "remote", "set-head", "upstream", "--auto"]);
}

/** The checkout's remotes, by name (fetch URLs). */
export async function remotesOf(dir: string): Promise<Record<string, string>> {
  const remotes: Record<string, string> = {};
  for (const line of ((await tryExec("git", ["-C", dir, "remote", "-v"])) ?? "").split(/\r?\n/)) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
    if (match) remotes[match[1]!] = match[2]!;
  }
  return remotes;
}

/** A URL that names Nexus-Mods/Vortex on GitHub (https or ssh, with or without `.git`). */
export function isNexusUpstream(url: string, expected: string = UPSTREAM_URL): boolean {
  return (
    url === expected ||
    /^(?:https?:\/\/|ssh:\/\/git@|git@)github\.com[/:]Nexus-Mods\/Vortex(?:\.git)?\/?$/i.test(url)
  );
}

/** The folder doodlebot keeps per worktree, kept out of every commit by the exclude. */
export const DOODLEBOT_FOLDER = ".doodlebot/";

/**
 * The exclude file every worktree of the checkout shares:
 * `$(git rev-parse --git-common-dir)/info/exclude`.
 */
export async function sharedExcludeFile(dir: string): Promise<string> {
  const common = await tryExec("git", ["-C", dir, "rev-parse", "--git-common-dir"]);
  if (common === undefined) throw new ConfigError(`${dir} is not a git checkout.`);
  return path.join(path.resolve(dir, common), "info", "exclude");
}

/** Whether the shared exclude already keeps `.doodlebot/` out. */
export function excludes(file: string): boolean {
  try {
    return fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .some((line) =>
        ["/.doodlebot/", ".doodlebot/", ".doodlebot", "/.doodlebot"].includes(line.trim()),
      );
  } catch {
    return false;
  }
}

/** What `source` did to the session's checkout, and what it found. */
export interface PreparedCheckout {
  checkout: string;
  branch: string | undefined;
  remotes: Record<string, string>;
  /** `upstream`: present, added now (`--add-upstream`), or missing. */
  upstream: "present" | "added" | "missing";
  /** `origin`: the person's fork, Nexus-Mods/Vortex itself, or absent. */
  origin: "fork" | "upstream" | "absent";
  /** `.doodlebot/` in the shared exclude: already, added now (`--exclude`), or not. */
  exclude: "present" | "added" | "missing";
  /** `--branch`: the branch cut, and what from. */
  cut?: { branch: string; from: string };
  /** Whether install and build ran, were skipped (`--no-build`), or failed. */
  build: "built" | "skipped" | "failed";
  /** Notes for the person, one per line. */
  notes: string[];
}

export interface PrepareOptions {
  checkout: string;
  /** `--add-upstream`: add Nexus-Mods/Vortex as `upstream` when it is missing. */
  addUpstream?: boolean;
  /** `--exclude`: add `.doodlebot/` to the exclude every worktree shares. */
  exclude?: boolean;
  /** `--update`: fetch every remote first. */
  update?: boolean;
  /** `--branch <name>`: cut a work branch from upstream. */
  branch?: string;
  /** Install and build (default true; `--no-build` turns it off). */
  build?: boolean;
  /** Installs the checkout's dependencies (default: its pinned pnpm, `--frozen-lockfile`). */
  install?: (dir: string) => Promise<void>;
  /** Builds the checkout (`doodlebot build --checkout <dir>`); resolves to its exit code. */
  runBuild?: (dir: string) => Promise<{ exitCode: number }>;
  /** The Nexus repository's clone URL (tests use a local one). */
  upstreamUrl?: string;
  onProgress?: (message: string) => void;
}

/**
 * `doodlebot source` in the session's checkout (design 4.2). It changes only what is missing and
 * was asked for, and reports the rest:
 *
 * 1. `upstream` must be Nexus-Mods/Vortex. Pointing anywhere else, it refuses before changing
 *    anything. Missing, it is added only with `--add-upstream` (the skill asks the person first).
 * 2. `.doodlebot/` goes into the exclude every worktree shares only with `--exclude` (asked too).
 * 3. `--update` fetches every remote, `--branch` cuts a branch from upstream.
 * 4. Install with the checkout's pinned pnpm, then `doodlebot build --checkout <dir>`.
 */
export async function prepareCheckout(options: PrepareOptions): Promise<PreparedCheckout> {
  const report = options.onProgress ?? ((): void => undefined);
  const dir = options.checkout;
  const upstreamUrl = options.upstreamUrl ?? UPSTREAM_URL;
  const notes: string[] = [];

  const current = await remoteUrl(dir, "upstream");
  if (current !== undefined && !isNexusUpstream(current, upstreamUrl))
    throw new ConfigError(
      `The remote upstream of ${dir} is ${current}, not ${UPSTREAM}. Doodlebot changed nothing. ` +
        `Branches start from upstream, so point it at ${UPSTREAM_URL} yourself ` +
        "(`git remote set-url upstream <url>`) or rename that remote, then run `doodlebot source` again.",
    );
  const excludeFile = await sharedExcludeFile(dir);

  let upstream: PreparedCheckout["upstream"] = current === undefined ? "missing" : "present";
  if (upstream === "missing" && options.addUpstream === true) {
    assertNoVortexRunningFrom(dir, "changing its remotes");
    report(`adding ${UPSTREAM} as upstream`);
    await runStreaming("git", ["-C", dir, "remote", "add", "upstream", upstreamUrl], {
      label: "Configuring Vortex upstream",
    });
    await runStreaming("git", ["-C", dir, "fetch", "upstream"], { label: "Fetching upstream" });
    await tryExec("git", ["-C", dir, "remote", "set-head", "upstream", "--auto"]);
    upstream = "added";
  } else if (upstream === "missing")
    notes.push(
      `There is no upstream remote. With the person's yes, \`doodlebot source --add-upstream\` adds ${UPSTREAM}; branches start from it.`,
    );

  let exclude: PreparedCheckout["exclude"] = excludes(excludeFile) ? "present" : "missing";
  if (exclude === "missing" && options.exclude === true) {
    fs.mkdirSync(path.dirname(excludeFile), { recursive: true });
    const before = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : "";
    const separator = before === "" || before.endsWith("\n") ? "" : "\n";
    fs.appendFileSync(excludeFile, `${separator}${DOODLEBOT_FOLDER}\n`);
    report(`added ${DOODLEBOT_FOLDER} to ${excludeFile} (every worktree of this checkout)`);
    exclude = "added";
  } else if (exclude === "missing")
    notes.push(
      `${DOODLEBOT_FOLDER} is not excluded. With the person's yes, \`doodlebot source --exclude\` adds it to ${excludeFile}, which every worktree shares.`,
    );

  if (options.update === true) await fetchRemotes(dir, report);
  const remotes = await remotesOf(dir);
  const origin: PreparedCheckout["origin"] =
    remotes.origin === undefined
      ? "absent"
      : isNexusUpstream(remotes.origin, upstreamUrl)
        ? "upstream"
        : "fork";
  if (origin !== "fork") notes.push(NO_FORK_NOTE);

  let cut: PreparedCheckout["cut"];
  if (options.branch !== undefined)
    cut = await cutWorkBranch(dir, options.branch, { onProgress: report });

  let build: PreparedCheckout["build"] = "skipped";
  if (options.build !== false) {
    if (options.runBuild === undefined) throw new ForkError("prepareCheckout needs runBuild.");
    await (
      options.install ??
      ((at) => buildVortexSource({ dir: at, installOnly: true, onProgress: report }))
    )(dir);
    build = (await options.runBuild(dir)).exitCode === 0 ? "built" : "failed";
  }
  return {
    checkout: dir,
    branch: await tryExec("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]),
    remotes,
    upstream,
    origin,
    exclude,
    ...(cut === undefined ? {} : { cut }),
    build,
    notes,
  };
}

/** The report `source` prints: checkout, branch, remotes, built or not, and the next step. */
export function formatPrepared(prepared: PreparedCheckout): string {
  const remotes = Object.entries(prepared.remotes)
    .map(([name, url]) => `${name} ${url}`)
    .join(", ");
  const origin = {
    fork: "origin is your fork",
    upstream: `origin is ${UPSTREAM} itself`,
    absent: "no origin",
  }[prepared.origin];
  return [
    `Checkout: ${prepared.checkout}`,
    `Branch:   ${prepared.branch ?? "unknown"}${prepared.cut === undefined ? "" : ` (cut from ${prepared.cut.from})`}`,
    `Remotes:  ${remotes === "" ? "none" : remotes} (upstream ${prepared.upstream}; ${origin})`,
    `Exclude:  ${DOODLEBOT_FOLDER} ${prepared.exclude === "missing" ? "not excluded" : `excluded (${prepared.exclude})`}`,
    `Build:    ${
      prepared.build === "built"
        ? "built"
        : prepared.build === "failed"
          ? "FAILED (its output is above)"
          : "not built (--no-build)"
    }`,
    ...prepared.notes.map((note) => `Note:     ${note}`),
    "",
    prepared.build === "failed"
      ? `Next: fix the build, then \`doodlebot build --checkout ${prepared.checkout}\`.`
      : prepared.build === "built"
        ? "Next: `doodlebot up` from this checkout drives this build."
        : `Next: \`doodlebot build --checkout ${prepared.checkout}\` before \`doodlebot up\`.`,
  ].join("\n");
}

/**
 * Cut a work branch from `upstream/<default branch>`, never from the fork's default branch, which
 * can carry the fork's own work. Fetches upstream first, refuses an existing branch and refuses
 * while a harness Vortex runs from the checkout.
 */
export async function cutWorkBranch(
  dir: string,
  name: string,
  options: { onProgress?: (message: string) => void; fetch?: boolean } = {},
): Promise<{ branch: string; from: string }> {
  const report = options.onProgress ?? ((): void => undefined);
  if ((await tryExec("git", ["check-ref-format", "--branch", name])) === undefined)
    throw new ForkError(`${name} is not a valid branch name.`);
  if ((await remoteUrl(dir, "upstream")) === undefined)
    throw new ForkError(
      `${dir} has no upstream remote. Run \`doodlebot source --add-upstream\` to add ${UPSTREAM}.`,
    );
  if (
    (await tryExec("git", [
      "-C",
      dir,
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${name}`,
    ])) !== undefined
  )
    throw new ForkError(`The branch ${name} already exists in ${dir}; switch to it with git.`);
  assertNoVortexRunningFrom(dir, "switching it to a new branch");
  if (options.fetch !== false) {
    report("fetching upstream");
    await runStreaming("git", ["-C", dir, "fetch", "upstream"], { label: "Fetching upstream" });
  }
  const from = `upstream/${await upstreamDefaultBranch(dir)}`;
  report(`creating ${name} from ${from}`);
  await runStreaming("git", ["-C", dir, "switch", "--no-track", "-c", name, from], {
    label: `Creating ${name}`,
  });
  return { branch: name, from };
}

/**
 * Install dependencies and build the clone.
 *
 * Kept separate from cloning because it is by far the slower half and the one
 * most likely to need re-running on its own after a pull.
 */
export async function buildVortexSource(options: BuildSourceOptions): Promise<void> {
  const report = options.onProgress ?? ((): void => undefined);
  const dir = options.dir;
  // A running Vortex holds the checkout's native modules open; reinstalling or rebuilding them
  // underneath it fails or corrupts the build.
  assertNoVortexRunningFrom(dir, options.installOnly === true ? "installing it" : "building it");
  if (!hasVortexSource(dir)) {
    throw new ForkError(`${dir} is not a Vortex checkout (no src/main/package.json).`);
  }

  report("installing dependencies (slow: native modules are rebuilt)");
  const pnpm = await sourcePnpmCommand(dir);
  report(
    pnpm.exact
      ? `using Vortex's pinned pnpm ${pnpm.version}`
      : `installed pnpm does not match; bootstrapping Vortex's pinned pnpm ${pnpm.version} with pnpm dlx`,
  );
  // Minutes, not seconds: an Electron binary download plus six native module
  // rebuilds. The output is streamed so that is visible rather than looking hung.
  await runStreaming(pnpm.cmd, [...pnpm.args, "install", "--frozen-lockfile"], {
    cwd: dir,
    label: "Installing Vortex's dependencies",
  });
  if (options.installOnly === true) {
    report("dependencies installed");
    return;
  }

  assertNoVortexRunningFrom(dir, "building it");
  report("building renderer and main");
  try {
    await runStreaming(pnpm.cmd, [...pnpm.args, "nx", "run", "@vortex/main:build"], {
      cwd: dir,
      label: "Building Vortex",
    });
  } catch (err) {
    if (!(err instanceof CommandExitError)) throw err;
    // Vortex's full build can exit non-zero on a bundled extension whose native
    // dependency did not build, while still having produced the renderer and
    // most other outputs. Fall back to building main's own bundle so one
    // unrelated extension cannot block the whole suite — but only accept that
    // if the artifacts the harness actually needs exist afterwards.
    report("full build failed; building main's own bundle directly");
    await runStreaming("node", ["./build.mjs"], {
      cwd: path.join(dir, "src", "main"),
      label: "Building main",
    });
    if (!buildArtifactsPresent(dir)) throw err;
    report("main built — the earlier failure was in a bundled extension");
  }

  // An nx cache hit restores only the outputs a target declares, and @vortex/main's list has
  // lagged its build script: hash-worker.cjs was missing from it, so a cached build ran until the
  // first install and then failed to find it (KNOWLEDGE.md). Rebuild main directly when so.
  const missing = missingBuildOutputs(dir);
  if (missing.length > 0) {
    report(`the build left out ${missing.join(", ")}; building main's own bundle directly`);
    await runStreaming("node", ["./build.mjs"], {
      cwd: path.join(dir, "src", "main"),
      label: "Building main",
    });
    const still = missingBuildOutputs(dir);
    if (still.length > 0)
      throw new ForkError(`The build did not produce ${still.join(", ")} in src/main/build.`);
  }

  report("build complete");
}

/**
 * What a source build must have produced for the harness to launch it and use it, that
 * src/main/build lacks: main.cjs, renderer.js, and every worker main's build script bundles
 * (`bundleWorker(…, "<name>")` in src/main/build.mjs).
 */
export function missingBuildOutputs(dir: string): string[] {
  const build = path.join(dir, "src", "main", "build");
  let script = "";
  try {
    script = fs.readFileSync(path.join(dir, "src", "main", "build.mjs"), "utf8");
  } catch {
    // An older layout without the script: check the two bundles alone.
  }
  const workers = [...script.matchAll(/bundleWorker\([^,]+,\s*["']([^"']+)["']/g)].map(
    (m) => m[1]!,
  );
  return ["main.cjs", "renderer.js", ...workers].filter(
    (name) => !fs.existsSync(path.join(build, name)),
  );
}

/** The outputs the harness needs in order to launch a source build. */
export function buildArtifactsPresent(dir: string): boolean {
  return missingBuildOutputs(dir).length === 0;
}
