/**
 * Vortex worktrees: one checkout per session, so parallel agents never share a working tree.
 *
 * `.vortex-src` is the one clone this kit manages. When several agents each fix an issue at
 * once, each needs its own branch, build and running Vortex. A second clone would be several
 * minutes and gigabytes; a git worktree of `.vortex-src` shares its object store and takes
 * seconds. They live in `.vortex-worktrees/<name>` (gitignored), next to `.vortex-src`, so
 * the suite still never searches the filesystem for a checkout.
 *
 * Pair a worktree with a slot (slots.ts): `up --worktree <name> --slot auto`. The running
 * Vortex locks its worktree (`checkout:<dir>`), so a session's checkout can't be removed or
 * rebuilt by another one under it.
 */
import fs from "node:fs";
import path from "node:path";

import { ConfigError } from "./errors";
import { checkoutResource, readLease, requireNamedOwner, normalizedPath } from "./lease";
import { withCheckoutOperation } from "./checkoutOperation";
import { withOperations, inheritedOperation, type OperationContext } from "./operations";
import { REPO_ROOT } from "./paths";
import { buildVortexSource, hasVortexSource, vortexSourceDir } from "./source";
import { GENERATED_FILES, restoreChanged, saveFiles } from "./vortexBuild";
import { abortOnSignals, runEvidenceProcess } from "./processRunner";

export const WORKTREES_DIR = path.join(REPO_ROOT, ".vortex-worktrees");
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Where the worktree called `name` lives. Names are plain: no separators, no `..`. */
export function worktreeDir(name: string): string {
  if (!NAME.test(name) || name.includes(".."))
    throw new ConfigError(
      `A worktree name is letters, digits, ".", "_" and "-" (at most 64): "${name}" is not.`,
    );
  return path.join(WORKTREES_DIR, name);
}

async function git(args: string[], cwd?: string, context?: OperationContext): Promise<string> {
  const cancellation = abortOnSignals();
  try {
    const result = await runEvidenceProcess({
      executable: "git",
      args,
      cwd: cwd ?? process.cwd(),
      context,
      // Removal has an operation guard but no persistent checkout reservation.
      persistentResources: [],
      signal: cancellation.signal,
    });
    if (result.aborted) throw new Error("Git was interrupted; child exit confirmed.");
    if (result.code !== 0) throw new Error(result.output.trim() || `exit ${result.code}`);
    return result.stdout.trim();
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim();
    throw new ConfigError(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`, {
      cause: err,
    });
  } finally {
    cancellation.dispose();
  }
}

function requireSource(): string {
  const source = vortexSourceDir();
  if (!hasVortexSource(source))
    throw new ConfigError(
      `No Vortex clone at ${source}. Run \`pnpm run ai:source\` first: worktrees are made from it.`,
    );
  return source;
}

export interface Worktree {
  name: string;
  dir: string;
  branch: string | undefined;
  head: string;
}

/** `git worktree list --porcelain`, keeping the ones under WORKTREES_DIR. */
export function parseWorktreeList(porcelain: string, root = WORKTREES_DIR): Worktree[] {
  const inRoot = (dir: string): boolean => {
    const relative = path.relative(root, dir);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  };
  return porcelain
    .split(/\r?\n\r?\n/)
    .map((block) => {
      const fields = new Map<string, string>();
      for (const line of block.split(/\r?\n/)) {
        const space = line.indexOf(" ");
        if (space > 0) fields.set(line.slice(0, space), line.slice(space + 1));
        else if (line !== "") fields.set(line, "");
      }
      return fields;
    })
    .filter((fields) => fields.has("worktree"))
    .map((fields) => {
      const dir = path.resolve(fields.get("worktree")!);
      return {
        name: path.basename(dir),
        dir,
        branch: fields.get("branch")?.replace(/^refs\/heads\//, ""),
        head: fields.get("HEAD") ?? "",
      };
    })
    .filter((worktree) => inRoot(worktree.dir));
}

export async function listWorktrees(): Promise<Worktree[]> {
  const source = requireSource();
  return parseWorktreeList(await git(["-C", source, "worktree", "list", "--porcelain"]));
}

export interface AddWorktreeOptions {
  owner?: string;
  context?: OperationContext;
  name: string;
  /** What to branch from. Default upstream/master, fetched first. */
  base?: string;
  /** The branch to create, or to check out when it exists. Default: the name. */
  branch?: string;
  /**
   * Check out this ref (a branch, remote branch or sha) detached, with no branch of its own.
   * For reviewing someone's branch: a branch another worktree has checked out can't be checked
   * out again, and QA must not commit to the author's branch anyway. Overrides branch and base.
   */
  ref?: string;
  /** Install dependencies. Default true. */
  install?: boolean;
  /** Build it, so it can run. Default true; slow. */
  build?: boolean;
  onProgress?: (message: string) => void;
}

export async function addWorktree(options: AddWorktreeOptions): Promise<Worktree> {
  const owner = requireNamedOwner(options.owner);
  const dir = worktreeDir(options.name);
  return withOperations(
    [`worktree-store:${normalizedPath(requireSource())}`],
    owner,
    { context: options.context ?? inheritedOperation(owner) },
    (context) =>
      withCheckoutOperation(
        dir,
        owner,
        "provision worktree",
        { context, rewriting: true },
        (nested) => addWorktreeInside({ ...options, owner, context: nested }),
      ),
  );
}

async function addWorktreeInside(options: AddWorktreeOptions): Promise<Worktree> {
  const report = options.onProgress ?? ((): void => undefined);
  const source = requireSource();
  const dir = worktreeDir(options.name);
  if (fs.existsSync(dir))
    throw new ConfigError(`${dir} already exists. Use it with --worktree ${options.name}.`);
  const branch = options.branch ?? options.name;
  const base = options.ref ?? options.base ?? "upstream/master";

  if (base.startsWith("upstream/") || base.startsWith("origin/")) {
    const remote = base.split("/")[0]!;
    report(`fetching ${remote}`);
    await git(["-C", source, "fetch", remote], undefined, options.context);
  }
  if (options.ref !== undefined) {
    report(`checking out ${options.ref} detached in ${dir}`);
    fs.mkdirSync(WORKTREES_DIR, { recursive: true });
    await git(
      ["-C", source, "worktree", "add", "--detach", dir, options.ref],
      undefined,
      options.context,
    );
  } else {
    const branchExists = await git(["-C", source, "branch", "--list", branch]).then(
      (out) => out !== "",
    );
    report(
      branchExists
        ? `checking out the existing branch ${branch} in ${dir}`
        : `creating ${branch} from ${base} in ${dir}`,
    );
    fs.mkdirSync(WORKTREES_DIR, { recursive: true });
    await git(
      branchExists
        ? ["-C", source, "worktree", "add", dir, branch]
        : ["-C", source, "worktree", "add", "-b", branch, dir, base],
      undefined,
      options.context,
    );
  }

  if (options.install !== false) {
    // A build rewrites the API report and dependency report; a fresh worktree must not start
    // out with changes nobody made (and `remove` would then refuse it).
    const saved = saveFiles(dir, GENERATED_FILES);
    try {
      await buildVortexSource({
        dir,
        owner: options.owner,
        context: options.context,
        installOnly: options.build === false,
        onProgress: report,
      });
    } finally {
      const restored = restoreChanged(dir, saved);
      if (restored.length > 0) report(`restored ${restored.join(", ")} (the build rewrote them)`);
    }
  }
  const [worktree] = parseWorktreeList(
    await git(["-C", source, "worktree", "list", "--porcelain"]),
  ).filter((w) => w.dir === path.resolve(dir));
  return worktree ?? { name: options.name, dir, branch, head: "" };
}

/**
 * Remove a worktree; its branch stays. Refused while a Vortex runs from it or anyone holds
 * its checkout lock, and, without `force`, while it has uncommitted changes.
 */
export async function removeWorktree(
  name: string,
  force = false,
  ownerFlag?: string,
): Promise<string> {
  const owner = requireNamedOwner(ownerFlag);
  return withOperations(
    [`worktree-store:${normalizedPath(requireSource())}`, checkoutResource(worktreeDir(name))],
    owner,
    { context: inheritedOperation(owner) },
    (context) => removeWorktreeInside(name, force, context),
  );
}

async function removeWorktreeInside(
  name: string,
  force: boolean,
  context: OperationContext,
): Promise<string> {
  const source = requireSource();
  const dir = worktreeDir(name);
  if (!fs.existsSync(dir)) throw new ConfigError(`There is no worktree ${dir}.`);
  const lock = readLease(checkoutResource(dir));
  if (lock?.live === true)
    throw new ConfigError(
      `${dir} is locked by "${lock.lease.owner}" (${lock.reason}). Stop its Vortex with ` +
        "`down` or release the lease first.",
    );
  if (!force) {
    const changes = await git(["-C", dir, "status", "--porcelain"]);
    if (changes !== "")
      throw new ConfigError(
        `${dir} has uncommitted changes; commit them, or pass --force to discard them:\n${changes}`,
      );
  }
  await git(
    ["-C", source, "worktree", "remove", ...(force ? ["--force"] : []), dir],
    undefined,
    context,
  );
  return dir;
}
