/**
 * Finding the operator's Vortex fork on GitHub, and keeping a clone of it here.
 *
 * The suite has to work for someone who just cloned this repo, so it cannot
 * assume a Vortex checkout exists anywhere on the machine, and it must not go
 * hunting around the filesystem for one. Instead it asks GitHub who the operator
 * is, looks for their fork, and clones it **inside this repo** at
 * `.vortex-src/` (gitignored).
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

import { REPO_ROOT } from "./paths";
import { withCheckoutOperation } from "./checkoutOperation";
import { type OperationContext } from "./operations";
import { abortOnSignals, runEvidenceProcess } from "./processRunner";

const execFileAsync = promisify(execFile);

export const UPSTREAM = "Nexus-Mods/Vortex";
const UPSTREAM_URL = `https://github.com/${UPSTREAM}.git`;

/** Where the Vortex clone lives — inside this repo, never outside it. */
export function vortexSourceDir(): string {
  return process.env.VORTEX_AI_SOURCE_DIR ?? path.join(REPO_ROOT, ".vortex-src");
}

export function hasVortexSource(dir = vortexSourceDir()): boolean {
  return fs.existsSync(path.join(dir, "src", "main", "package.json"));
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
 * The environment for a command someone runs through the kit (`lease run`), by where it runs.
 * Inside this repo, outside its Vortex checkouts, it's the kit's own command: unchanged. Anywhere
 * else, such as `pnpm run verify` in a worktree, it's a Vortex command, and gets what `childEnv`
 * gives a nested run: no npm_/PNPM_ variables from the kit's pnpm 9, and a PATH whose first pnpm
 * is the checkout's. `CI` is left as the caller had it.
 */
export function commandEnv(
  cwd: string,
  base: NodeJS.ProcessEnv = process.env,
  repoRoot: string = REPO_ROOT,
): NodeJS.ProcessEnv {
  const inside = (dir: string, root: string): boolean => {
    const relative = path.relative(root, dir);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };
  const dir = path.resolve(cwd);
  const vortex =
    inside(dir, path.join(repoRoot, ".vortex-src")) ||
    inside(dir, path.join(repoRoot, ".vortex-worktrees"));
  if (inside(dir, repoRoot) && !vortex) return { ...base };
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
  options: { cwd?: string; label: string; context?: OperationContext },
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
      context: options.context,
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

/**
 * Resolve which repository to clone.
 *
 * A fork rather than upstream on purpose: the point of this suite is to build,
 * change and push Vortex, and you cannot push to Nexus-Mods/Vortex. Failing with
 * "go and fork it" is more useful than silently cloning a repo the operator
 * cannot commit to.
 */
export async function resolveVortexRepo(): Promise<ForkInfo> {
  const override = process.env.VORTEX_AI_VORTEX_REPO;
  if (override !== undefined && override !== "") {
    const asUrl = override.includes("://") || override.endsWith(".git");
    return {
      fullName: asUrl ? override : override,
      cloneUrl: asUrl ? override : `https://github.com/${override}.git`,
      defaultBranch: "master",
      isFork: true,
      parent: undefined,
    };
  }

  const user = await detectGitHubUser();
  if (user === undefined) {
    throw new ForkError(
      "Could not work out your GitHub username, so I cannot find your Vortex fork.\n\n" +
        "  Set it explicitly:   VORTEX_AI_GITHUB_USER=<your-login>\n" +
        "  Or point at a repo:  VORTEX_AI_VORTEX_REPO=<owner>/<repo>\n" +
        "  Or log in:           gh auth login",
    );
  }

  const fork = await findFork(user);
  if (fork === undefined) {
    throw new ForkError(
      `No Vortex fork found at https://github.com/${user}/Vortex.\n\n` +
        `  This suite builds and tests YOUR fork, so you need one:\n\n` +
        `    gh repo fork ${UPSTREAM} --clone=false\n` +
        `  or fork it in the browser: https://github.com/${UPSTREAM}/fork\n\n` +
        `  Then re-run. If your fork is named something else, set\n` +
        `  VORTEX_AI_VORTEX_REPO=${user}/<name>. If "${user}" is the wrong login,\n` +
        `  set VORTEX_AI_GITHUB_USER.`,
    );
  }

  if (!fork.isFork) {
    // Not fatal — someone may keep a non-fork mirror — but worth saying, because
    // the usual cause is a typo'd username that happens to own a repo named Vortex.
    process.stderr.write(
      `[doodlebot] note: ${fork.fullName} is not a fork of ${UPSTREAM}; using it anyway.\n`,
    );
  }

  return fork;
}

export interface EnsureSourceOptions {
  owner?: string;
  context?: OperationContext;
  /** Re-fetch and fast-forward an existing clone. */
  update?: boolean;
  /** buildVortexSource: the checkout to build, when not .vortex-src (a worktree). */
  dir?: string;
  /** buildVortexSource: install dependencies only. */
  installOnly?: boolean;
  /** Progress reporting. */
  onProgress?: (message: string) => void;
}

export interface VortexSource {
  dir: string;
  repo: string;
  defaultBranch: string;
  cloned: boolean;
}

/**
 * Ensure a Vortex clone exists at `.vortex-src`, cloning it if not.
 *
 * `upstream` is wired up alongside `origin` so the usual "sync my fork" flow
 * works without further setup — the fork is where changes are pushed, upstream
 * is where they are rebased from.
 */
export async function ensureVortexSource(options: EnsureSourceOptions = {}): Promise<VortexSource> {
  return withCheckoutOperation(
    vortexSourceDir(),
    options.owner,
    "prepare source",
    { context: options.context, rewriting: true },
    (context) => ensureSourceInside({ ...options, context }),
  );
}

async function ensureSourceInside(options: EnsureSourceOptions): Promise<VortexSource> {
  const report = options.onProgress ?? ((): void => undefined);
  const dir = vortexSourceDir();

  if (hasVortexSource(dir)) {
    const remote = (await tryExec("git", ["-C", dir, "remote", "get-url", "origin"])) ?? "unknown";
    const branch =
      (await tryExec("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"])) ?? "master";
    if (options.update === true) {
      report("fetching origin and upstream");
      await runStreaming("git", ["-C", dir, "fetch", "--all", "--prune"], {
        label: "Fetching Vortex source",
        context: options.context,
      });
    }
    return { dir, repo: remote, defaultBranch: branch, cloned: false };
  }

  const fork = await resolveVortexRepo();
  report(`cloning ${fork.fullName} into ${dir} (this is a large repo — several minutes)`);

  fs.mkdirSync(path.dirname(dir), { recursive: true });
  // A full Vortex clone over a slow link genuinely takes a while; a short
  // timeout here would abort a working clone and leave a half-written dir.
  await runStreaming("git", ["clone", "--progress", fork.cloneUrl, dir], {
    label: `Cloning ${fork.fullName}`,
    context: options.context,
  });

  await runStreaming("git", ["-C", dir, "remote", "add", "upstream", UPSTREAM_URL], {
    label: "Configuring Vortex upstream",
    context: options.context,
  });
  report(`cloned; origin=${fork.fullName}, upstream=${UPSTREAM}`);

  return { dir, repo: fork.fullName, defaultBranch: fork.defaultBranch, cloned: true };
}

/**
 * Install dependencies and build the clone.
 *
 * Kept separate from cloning because it is by far the slower half and the one
 * most likely to need re-running on its own after a pull.
 */
export async function buildVortexSource(options: EnsureSourceOptions = {}): Promise<void> {
  return withCheckoutOperation(
    options.dir ?? vortexSourceDir(),
    options.owner,
    "install/build source",
    { context: options.context, rewriting: true },
    (context) => buildSourceInside({ ...options, context }),
  );
}

async function buildSourceInside(options: EnsureSourceOptions): Promise<void> {
  const report = options.onProgress ?? ((): void => undefined);
  const dir = options.dir ?? vortexSourceDir();
  if (!hasVortexSource(dir)) {
    throw new ForkError(`No Vortex clone at ${dir}. Run \`doodlebot source\` first.`);
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
  await runStreaming(pnpm.cmd, [...pnpm.args, "install"], {
    cwd: dir,
    label: "Installing Vortex's dependencies",
    context: options.context,
  });
  if (options.installOnly === true) {
    report("dependencies installed");
    return;
  }

  report("building renderer and main");
  try {
    await runStreaming(pnpm.cmd, [...pnpm.args, "nx", "run", "@vortex/main:build"], {
      cwd: dir,
      label: "Building Vortex",
      context: options.context,
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
      context: options.context,
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
      context: options.context,
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
export function missingBuildOutputs(dir = vortexSourceDir()): string[] {
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
export function buildArtifactsPresent(dir = vortexSourceDir()): boolean {
  return missingBuildOutputs(dir).length === 0;
}
