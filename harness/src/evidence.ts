/** Concrete, local evidence. Hashes detect drift; they do not authenticate a reviewer. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { REPO_ROOT } from "./paths";
import { commandEnv } from "./source";
import { runEvidenceProcess, abortOnSignals } from "./processRunner";
import { assertNoVortexRunningFrom } from "./runningVortex";
export { runEvidenceProcess, abortOnSignals, type ProcessEvidenceOptions } from "./processRunner";

const text = z.string().trim().min(1);
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const artifactSchema = z.strictObject({ path: text, sha256: digestSchema });
export type Artifact = z.infer<typeof artifactSchema>;
export const checkoutIdentitySchema = z.strictObject({
  checkout: text,
  headSha: z.string().regex(/^[a-f0-9]{40}$/),
  baseSha: z.string().regex(/^[a-f0-9]{40}$/),
  changesSha256: digestSchema,
  changedFiles: z.array(text),
  dirty: z.boolean(),
});
export type CheckoutIdentity = z.infer<typeof checkoutIdentitySchema>;
export const runtimeIdentitySchema = z
  .strictObject({
    kind: z.enum(["installed", "source"]),
    label: text,
    mode: z.enum(["production", "development"]),
    files: z.array(artifactSchema).min(1),
    source: checkoutIdentitySchema.optional(),
  })
  .superRefine((runtime, ctx) => {
    if ((runtime.kind === "source") !== (runtime.source !== undefined))
      ctx.addIssue({ code: "custom", message: "source runtime needs its own source identity" });
  });
export type RuntimeIdentity = z.infer<typeof runtimeIdentitySchema>;

export const hashBytes = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

function git(checkout: string, args: string[]): string {
  return execFileSync("git", ["-C", checkout, ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** A working-tree file's content hash: a link's target, `"deleted"` when gone, `"directory"`. */
export function hashWorktreeFile(root: string, file: string): string {
  const abs = path.join(root, file);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return "deleted";
  }
  if (stat.isSymbolicLink()) return hashBytes(fs.readlinkSync(abs));
  if (stat.isDirectory()) return "directory";
  return hashBytes(fs.readFileSync(abs));
}

/** Untracked files `git add -A` would take (`ls-files --others --exclude-standard`), sorted. */
function untrackedFiles(root: string): string[] {
  return git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .sort();
}

/**
 * Every file whose working-tree content differs from `against` (tracked, staged or not, and
 * untracked files that are not ignored), each with `hashWorktreeFile`'s hash. The build record
 * (productionMode.ts) compares two of these; file times are never used.
 */
export function worktreeChanges(root: string, against = "HEAD"): Record<string, string> {
  const files = new Set([
    ...git(root, ["diff", "--no-ext-diff", "--name-only", "-z", against, "--"])
      .split("\0")
      .filter(Boolean),
    ...untrackedFiles(root),
  ]);
  return Object.fromEntries(
    [...files].sort().map((file) => [file, hashWorktreeFile(root, file)] as const),
  );
}

/** Includes staged, unstaged and nonignored untracked contents, without saving source bytes. */
export function captureCheckoutIdentity(checkout: string, base = "HEAD"): CheckoutIdentity {
  const root = fs.realpathSync.native(
    git(path.resolve(checkout), ["rev-parse", "--show-toplevel"]).trim(),
  );
  const headSha = git(root, ["rev-parse", "HEAD"]).trim();
  const baseSha = git(root, ["rev-parse", "--verify", `${base}^{commit}`]).trim();
  const args = ["--no-ext-diff", "--no-textconv", "--binary"];
  const unstaged = git(root, ["diff", ...args, "HEAD", "--"]);
  const staged = git(root, ["diff", ...args, "--cached", "--"]);
  const untracked = untrackedFiles(root).map((file) => ({
    file,
    hash: hashWorktreeFile(root, file),
  }));
  const changedFiles = [
    ...new Set([
      ...git(root, ["diff", "--no-ext-diff", "--name-only", "-z", baseSha, "--"])
        .split("\0")
        .filter(Boolean),
      ...untracked.map((entry) => entry.file),
    ]),
  ].sort();
  return {
    checkout: root,
    headSha,
    baseSha,
    changesSha256: hashBytes(JSON.stringify({ unstaged, staged, untracked })),
    changedFiles,
    dirty: unstaged !== "" || staged !== "" || untracked.length > 0,
  };
}

export function sameIdentity(a: CheckoutIdentity, b: CheckoutIdentity): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
/** Source equivalence permits a separate checkout of the same reviewed code. */
export function sameSourceIdentity(a: CheckoutIdentity, b: CheckoutIdentity): boolean {
  return (
    a.headSha === b.headSha &&
    a.baseSha === b.baseSha &&
    a.changesSha256 === b.changesSha256 &&
    a.dirty === b.dirty &&
    JSON.stringify(a.changedFiles) === JSON.stringify(b.changedFiles)
  );
}
export function assertCurrentIdentity(identity: CheckoutIdentity): void {
  if (!sameIdentity(identity, captureCheckoutIdentity(identity.checkout, identity.baseSha)))
    throw new Error(`stale checkout/diff identity: ${identity.checkout}`);
}
export function fileArtifact(file: string): Artifact {
  return { path: path.resolve(file), sha256: hashBytes(fs.readFileSync(file)) };
}
export function checkArtifact(ref: Artifact, directory = "."): string {
  const file = path.resolve(directory, ref.path);
  if (hashBytes(fs.readFileSync(file)) !== ref.sha256)
    throw new Error(`artifact digest mismatch: ${ref.path}`);
  return file;
}
export function checkRuntime(runtime: RuntimeIdentity, directory = "."): void {
  runtime.files.forEach((file) => checkArtifact(file, directory));
  if (runtime.source !== undefined) assertCurrentIdentity(runtime.source);
}

export const commandEvidenceSchema = z.strictObject({
  tool: z.literal("doodlebot-command-evidence"),
  schemaVersion: z.literal(1),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  command: z.strictObject({
    executable: text,
    args: z.array(z.string()),
    cwd: text,
    requested: z.array(text).min(1),
  }),
  kit: checkoutIdentitySchema,
  before: checkoutIdentitySchema,
  after: checkoutIdentitySchema,
  runtime: runtimeIdentitySchema.optional(),
  runtimeUnchanged: z.boolean(),
  code: z.number().int().nullable(),
  signal: z.string().nullable(),
  aborted: z.boolean(),
  output: artifactSchema,
  tests: z
    .strictObject({
      executed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
      report: artifactSchema,
    })
    .optional(),
});
export type CommandEvidence = z.infer<typeof commandEvidenceSchema>;

/** Resolve an already-installed exact pnpm; evidence collection never installs a toolchain. */
export function resolveEvidenceCommand(
  checkout: string,
  requested: string[],
  env = process.env,
): {
  executable: string;
  args: string[];
} {
  if (requested.length === 0) throw new Error("evidence run needs a command after --");
  if (requested[0] !== "pnpm") {
    if (/\.(?:cmd|bat)$/i.test(requested[0]!))
      throw new Error("Use a native executable or pnpm; shell scripts are not evidence commands.");
    return {
      executable: requested[0] === "node" ? process.execPath : requested[0]!,
      args: requested.slice(1),
    };
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(checkout, "package.json"), "utf8"));
  const wanted = /^pnpm@([^+]+)(?:\+.*)?$/.exec(manifest.packageManager ?? "")?.[1];
  if (wanted === undefined)
    throw new Error("Subject package.json must pin pnpm for a pnpm evidence run.");
  const dirs = [
    env.VORTEX_AI_PNPM === undefined ? "" : path.dirname(env.VORTEX_AI_PNPM),
    ...(env.PATH ?? env.Path ?? "").split(path.delimiter),
  ].filter(Boolean);
  const candidates = [
    env.npm_execpath,
    ...dirs.flatMap((dir) => [
      path.join(dir, "pnpm.cjs"),
      path.join(dir, "..", "pnpm", "bin", "pnpm.cjs"),
      path.join(dir, "node_modules", "pnpm", "bin", "pnpm.cjs"),
    ]),
  ];
  for (const script of candidates) {
    if (script === undefined || !fs.existsSync(script)) continue;
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(path.dirname(script), "..", "package.json"), "utf8"),
      );
      if (pkg.name === "pnpm" && pkg.version === wanted)
        return {
          executable: process.execPath,
          args: [fs.realpathSync(script), ...requested.slice(1)],
        };
    } catch {
      /* Not an installed pnpm entry point. */
    }
  }
  throw new Error(
    `Pinned pnpm ${wanted} is unavailable; provide its installed entry point via VORTEX_AI_PNPM. No install was attempted.`,
  );
}

/**
 * A doodlebot child (`doodlebot <command>` or `node <…>/doodlebot.cjs <command>`) with
 * `--dev-dir <checkout>` after its command, unless it names a target already. Any other command
 * is returned unchanged: it chooses no Vortex.
 */
export function withDevDir(
  command: { executable: string; args: string[] },
  checkout: string,
): { executable: string; args: string[] } {
  const doodlebot = /(?:^|[\\/])doodlebot(?:\.cjs|\.cmd|\.ps1)?$/i;
  const at = doodlebot.test(command.executable)
    ? 0
    : command.args[0] !== undefined && /(?:^|[\\/])doodlebot\.cjs$/i.test(command.args[0])
      ? 1
      : undefined;
  const word = at === undefined ? undefined : command.args[at];
  if (at === undefined || word === undefined || word.startsWith("-")) return command;
  const named = command.args.some((arg) => /^--(?:dev-dir|release|exe|installed)(?:=|$)/.test(arg));
  if (named) return command;
  return {
    executable: command.executable,
    args: [...command.args.slice(0, at + 1), "--dev-dir", checkout, ...command.args.slice(at + 1)],
  };
}

/** The CLI calls this before loading app configuration; an evidence run never chooses a Vortex. */
export async function collectCommandEvidence(options: {
  checkout: string;
  base: string;
  cwd: string;
  command: string[];
  out: string;
  runtime?: RuntimeIdentity;
  testReport?: string;
  testFormat?: "vitest" | "playwright";
}): Promise<CommandEvidence> {
  const requested = options.command;
  const actual = resolveEvidenceCommand(options.checkout, requested);
  assertNoVortexRunningFrom(options.checkout, "recording evidence in it");
  const before = captureCheckoutIdentity(options.checkout, options.base);
  const kit = captureCheckoutIdentity(REPO_ROOT);
  const cwd = fs.realpathSync.native(path.resolve(options.cwd));
  const relative = path.relative(before.checkout, cwd);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("command cwd must be inside the subject checkout");
  const out = path.resolve(options.out);
  if (fs.existsSync(out) || fs.existsSync(`${out}.log`))
    throw new Error("Evidence output already exists; retain it and choose a new path.");
  if (options.testReport !== undefined && fs.existsSync(options.testReport))
    throw new Error("Test report must be newly produced, not an existing file.");
  if (options.runtime !== undefined) checkRuntime(options.runtime);
  const cancellation = abortOnSignals();
  const startedAt = new Date().toISOString();
  let result: Awaited<ReturnType<typeof runEvidenceProcess>>;
  const env = commandEnv(cwd);
  let child = actual;
  if (options.runtime !== undefined) {
    env.VORTEX_AI_PRODUCTION = options.runtime.mode === "production" ? "1" : "0";
    env.VORTEX_AI_INSTALLED = options.runtime.kind === "installed" ? "1" : "0";
    if (options.runtime.kind === "installed") env.VORTEX_AI_EXE = options.runtime.files[0]!.path;
    else {
      // A doodlebot child reaches a source runtime one way: `--dev-dir <checkout>`, which every
      // launch (and `test`) treats as explicit. Nothing reads a target from the environment.
      delete env.VORTEX_AI_EXE;
      child = withDevDir(actual, options.runtime.source!.checkout);
    }
  }
  try {
    result = await runEvidenceProcess({ ...child, cwd, env, signal: cancellation.signal });
  } finally {
    cancellation.dispose();
  }
  const after = captureCheckoutIdentity(options.checkout, options.base);
  let runtimeUnchanged = true;
  if (options.runtime !== undefined) {
    try {
      checkRuntime(options.runtime);
    } catch {
      runtimeUnchanged = false;
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(`${out}.log`, result.output);
  let tests: CommandEvidence["tests"];
  if (options.testReport !== undefined) {
    const json = JSON.parse(fs.readFileSync(options.testReport, "utf8"));
    const stats =
      options.testFormat === "vitest"
        ? {
            executed: json.numPassedTests + json.numFailedTests,
            failed: json.numFailedTests,
            skipped: (json.numPendingTests ?? 0) + (json.numTodoTests ?? 0),
          }
        : {
            executed: json.stats.expected + json.stats.unexpected + json.stats.flaky,
            failed: json.stats.unexpected + json.stats.flaky,
            skipped: json.stats.skipped,
          };
    tests = { ...stats, report: fileArtifact(options.testReport) };
  }
  const report = commandEvidenceSchema.parse({
    tool: "doodlebot-command-evidence",
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    command: { ...child, cwd, requested },
    kit,
    before,
    after,
    runtime: options.runtime,
    runtimeUnchanged,
    code: result.code,
    signal: result.signal,
    aborted: result.aborted,
    output: fileArtifact(`${out}.log`),
    tests,
  });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
