/**
 * `doodlebot build --checkout <dir> [--production]`: build a Vortex checkout the way the kit's
 * A/B runs need it, without the three things agents kept getting wrong by hand.
 *
 *   - **The pinned pnpm.** Vortex pins its package manager (`packageManager`, pnpm 11) and this
 *     repo runs pnpm 9; a nested run inherits the parent's (KNOWLEDGE.md). The build runs the
 *     checkout's own version, through `pnpm dlx pnpm@<version>` when the pnpm on PATH differs,
 *     with the parent's `npm_*`/`PNPM_*` variables stripped.
 *   - **NODE_ENV for the build only.** Vortex's bundlers inline NODE_ENV at build time, so a
 *     plain build is a development bundle (productionMode.ts). `--production` sets
 *     NODE_ENV=production in the build's own environment; without it NODE_ENV is removed, so a
 *     value left in the caller's shell cannot leak in. The caller's environment is untouched,
 *     which matters in an agent sandbox that refuses `Remove-Item Env:NODE_ENV`.
 *   - **Generated files.** The build can rewrite `etc/vortex.api.md` and
 *     `etc/Dependency Report.md`, tracked files, which then make the checkout dirty and the next
 *     preflight refuse. Their bytes are saved first and put back when the build changed them.
 *
 * It holds the checkout's lock for the build, and refuses while a Vortex runs from the checkout:
 * the running app holds native modules open (KNOWLEDGE.md) and would be rebuilt underneath.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ConfigError } from "./errors";
import { withCheckoutOperation } from "./checkoutOperation";
import { type OperationContext } from "./operations";
import { abortOnSignals, runEvidenceProcess } from "./processRunner";
import { type LeaseEnv } from "./lease";
import { bundleModeOf, type BundleMode } from "./productionMode";
import {
  childEnv,
  missingBuildOutputs,
  nestedPath,
  parsePnpmVersion,
  selectPnpmCommand,
  needsShell,
} from "./source";

/** Tracked files Vortex's build regenerates. */
export const GENERATED_FILES = ["etc/vortex.api.md", "etc/Dependency Report.md"];

/** The build's environment: the caller's, minus package-manager pins, with NODE_ENV decided. */
export function buildEnvironment(base: NodeJS.ProcessEnv, production: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { CI: "1" };
  for (const [key, value] of Object.entries(base)) {
    if (/^(npm_|PNPM_|COREPACK_)/i.test(key)) continue;
    // Windows environment names are case-insensitive: drop every spelling.
    if (key.toUpperCase() === "NODE_ENV") continue;
    if (value === undefined) continue;
    // the checkout's own scripts call pnpm too; they must get its version (source.ts)
    env[key] = key.toUpperCase() === "PATH" ? nestedPath(value) : value;
  }
  if (production) env.NODE_ENV = "production";
  return env;
}

export interface SavedFile {
  file: string;
  bytes: Buffer | undefined;
}

export function saveFiles(dir: string, files: string[]): SavedFile[] {
  return files.map((file) => {
    const abs = path.join(dir, file);
    return { file, bytes: fs.existsSync(abs) ? fs.readFileSync(abs) : undefined };
  });
}

/** Put back each saved file the build changed, created or deleted; returns those restored. */
export function restoreChanged(dir: string, saved: SavedFile[]): string[] {
  const restored: string[] = [];
  for (const { file, bytes } of saved) {
    const abs = path.join(dir, file);
    const now = fs.existsSync(abs) ? fs.readFileSync(abs) : undefined;
    const same =
      now === undefined || bytes === undefined ? now === bytes : Buffer.compare(now, bytes) === 0;
    if (same) continue;
    if (bytes === undefined) fs.rmSync(abs, { force: true });
    else fs.writeFileSync(abs, bytes);
    restored.push(file);
  }
  return restored;
}

export type BuildRunner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; context?: OperationContext; leaseEnv?: LeaseEnv },
) => Promise<number>;

/** Run with the output streamed: a Vortex build prints for minutes, captured it looks hung. */
export const streamingRunner: BuildRunner = async (command, args, options) => {
  const cancellation = abortOnSignals();
  try {
    // One command line: through a shell (pnpm is a .cmd on Windows), separate args are
    // concatenated unescaped anyway, and Node warns about it (DEP0190).
    const line = [command, ...args]
      .map((part) => (/^[\w@%+=:,./\\-]+$/.test(part) ? part : `"${part.replace(/"/g, '\\"')}"`))
      .join(" ");
    const shell = needsShell(command);
    const result = await runEvidenceProcess({
      executable: shell ? line : command,
      args: shell ? [] : args,
      cwd: options.cwd,
      env: options.env,
      shell,
      stdin: "inherit",
      context: options.context,
      leaseEnv: options.leaseEnv,
      signal: cancellation.signal,
      onOutput: (chunk) => process.stdout.write(chunk),
    });
    return result.aborted ? 130 : (result.code ?? 1);
  } finally {
    cancellation.dispose();
  }
};

export interface BuildOptions {
  context?: OperationContext;
  checkout: string;
  production: boolean;
  owner?: string;
  /** The pnpm version on PATH, when known; default: asked (`pnpm --version`). */
  installedPnpm?: string;
  runner?: BuildRunner;
  leaseEnv?: LeaseEnv;
  onProgress?: (message: string) => void;
}

export interface BuildReport {
  checkout: string;
  command: string;
  nodeEnv: "production" | "unset";
  exitCode: number;
  elapsedMs: number;
  /** Generated files the build rewrote and that were put back. */
  restored: string[];
  /** What the renderer bundle is afterwards (productionMode.ts's check). */
  bundleMode: BundleMode;
}

async function installedPnpmVersion(dir: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn("pnpm --version", { cwd: dir, env: childEnv(), shell: true });
    let out = "";
    child.stdout?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.once("error", () => resolve(undefined));
    child.once("close", (code) => resolve(code === 0 ? out.trim() || undefined : undefined));
  });
}

/** Build a checkout under its lock; see the module comment. */
export async function buildCheckout(options: BuildOptions): Promise<BuildReport> {
  const dir = path.resolve(options.checkout);
  const manifestFile = path.join(dir, "package.json");
  if (!fs.existsSync(manifestFile) || !fs.existsSync(path.join(dir, "src", "main"))) {
    throw new ConfigError(`${dir} is not a Vortex checkout (no package.json and src/main).`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { packageManager?: string };
  const wanted = parsePnpmVersion(manifest.packageManager);
  const report = options.onProgress ?? ((): void => undefined);
  return withCheckoutOperation(
    dir,
    options.owner,
    "build checkout",
    { context: options.context, leaseEnv: options.leaseEnv, rewriting: true },
    async (context) => {
      const pnpm = selectPnpmCommand(
        wanted,
        options.installedPnpm ?? (await installedPnpmVersion(dir)),
      );
      const args = [...pnpm.args, "run", "build"];
      const command = [pnpm.cmd, ...args].join(" ");
      const env = buildEnvironment(process.env, options.production);
      report(
        `building ${dir} with ${command} (NODE_ENV=${options.production ? "production" : "unset"}` +
          `${pnpm.exact ? "" : `; pnpm on PATH is not ${wanted}`})`,
      );
      const saved = saveFiles(dir, GENERATED_FILES);
      const started = Date.now();
      let exitCode = 1;
      let restored: string[] = [];
      try {
        exitCode = await (options.runner ?? streamingRunner)(pnpm.cmd, args, {
          cwd: dir,
          env,
          context,
          leaseEnv: options.leaseEnv,
        });
      } finally {
        restored = restoreChanged(dir, saved);
      }
      if (restored.length > 0) report(`restored ${restored.join(", ")} (the build rewrote them)`);
      // A build nx restored from cache can lack a worker @vortex/main doesn't declare as an
      // output (KNOWLEDGE.md); Vortex then fails at its first install. Build main directly.
      const missing = missingBuildOutputs(dir);
      if (exitCode === 0 && missing.length > 0 && !missing.includes("main.cjs")) {
        report(`the build left out ${missing.join(", ")}; running src/main/build.mjs`);
        exitCode = await (options.runner ?? streamingRunner)("node", ["./build.mjs"], {
          cwd: path.join(dir, "src", "main"),
          env,
          context,
          leaseEnv: options.leaseEnv,
        });
        const still = missingBuildOutputs(dir);
        if (exitCode === 0 && still.length > 0) {
          report(`still missing after build.mjs: ${still.join(", ")}`);
          exitCode = 1;
        }
      }
      return {
        checkout: dir,
        command,
        nodeEnv: options.production ? "production" : "unset",
        exitCode,
        elapsedMs: Date.now() - started,
        restored,
        bundleMode: bundleModeOf(dir),
      };
    },
  );
}
