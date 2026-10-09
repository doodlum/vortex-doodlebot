/**
 * Launching and stopping a Vortex instance with this extension loaded.
 *
 * The default target is a **stock, officially released Vortex** — no patched
 * build, no source checkout. That is the whole point: everything the extension
 * does is reachable from the renderer, so an agent can drive the Vortex a user
 * actually has installed.
 *
 * Deliberately `spawn`-based rather than Playwright's `_electron.launch`: an
 * instance started by `doodlebot up` has to outlive the process that started it,
 * so an agent can drive it across many separate tool calls. A Playwright-owned
 * Electron dies with its controlling script. The Playwright specs get their own
 * fixture (src/tests/fixtures.ts), because a test genuinely does want that.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  extensionRoot,
  LEGACY_EXTENSION_IDS,
  MCP_EXTENSION_ID,
  type HarnessConfig,
} from "./config";
import { VortexMcpClient } from "./mcpClient";
import {
  buildExtension,
  extensionOutputResource,
  type ExtensionBuildOptions,
} from "./extensionBuild";
import {
  extensionIsFresh,
  replaceExtensionDirectory,
  requireFreshExtension,
  verifyExtensionGeneration,
} from "./extensionGeneration";
import {
  ChildRegistrationError,
  inheritedOperation,
  trackOperationChild,
  withOperationsSync,
  type OperationOptions,
} from "./operations";
import { withLiveOperation } from "./liveOperation";
import { resolveDevElectron } from "./electronRuntime";
import { installSandboxExtension } from "./sandbox";
import { instanceResource } from "./slots";
import { preparePreload, verifyPreload } from "./mainPreload";
import {
  addInstancePid,
  checkoutResource,
  holdLease,
  removeInstancePid,
  requireNamedOwner,
  type HoldResult,
  type LeaseEnv,
  type LeaseIdentity,
} from "./lease";
import {
  ProductionModeError,
  bundleModeOf,
  devBundleWarning,
  productionErrorMessage,
  productionProblem,
  type ProductionStatus,
} from "./productionMode";

/**
 * Hold the machine-wide instance lease for the rest of this process (see lease.ts).
 *
 * Every path that starts or stops Vortex calls this first, so one agent cannot quit or
 * replace another's instance. Free or stale: taken. Same owner: joined. Another live
 * owner: LeaseHeldError, naming the holder and how to wait or release.
 */
export interface InstanceLease extends HoldResult {
  identities: readonly LeaseIdentity[];
}

export function claimInstanceLease(
  config: HarnessConfig,
  purpose: string,
  leaseEnv: LeaseEnv = {},
  options: { attach?: boolean } = {},
): InstanceLease {
  const owner = requireNamedOwner(config.owner);
  const held: HoldResult[] = [];
  const resources =
    options.attach === true ? attachedLeaseResources(config) : instanceLeaseResources(config);
  try {
    // The instance first: a caller refused it has touched nothing else.
    for (const resource of resources) {
      held.push(
        holdLease(resource, owner, {
          ...leaseEnv,
          purpose,
          onReclaim: (state) =>
            process.stderr.write(
              `[lease] reclaimed a stale ${resource} lease from "${state.lease.owner}" (${state.reason})\n`,
            ),
        }),
      );
    }
  } catch (err) {
    for (const hold of held.toReversed()) hold.release();
    throw err;
  }
  const first = held[0]!;
  return {
    ...first,
    identities: held.map(({ lease }) => ({
      resource: lease.resource,
      owner: lease.owner,
      acquisitionId: lease.acquisitionId,
    })),
    release: () => held.toReversed().forEach((hold) => hold.release()),
  };
}

/**
 * The leases a running Vortex needs: this cache's instance, and for a source build the checkout it
 * runs from, so nobody rebuilds or switches that checkout underneath it (and a holder of
 * the checkout lock who starts Vortex also takes the instance).
 */
export function instanceLeaseResources(config: HarnessConfig): string[] {
  const checkout = config.target.kind === "dev" ? config.target.sourceDir : undefined;
  const instance = instanceResource(config.cacheDir);
  return checkout === undefined ? [instance] : [instance, checkoutResource(checkout)];
}

/**
 * The leases a command driving an already-running Vortex needs: the instance, and the
 * checkout that Vortex was launched from (recorded in the cache at launch), not whatever
 * checkout this command's own configuration would pick.
 */
export function attachedLeaseResources(config: HarnessConfig): string[] {
  const running = runningInstance(config);
  const instance = instanceResource(config.cacheDir);
  return running?.sourceDir === undefined
    ? [instance]
    : [instance, checkoutResource(running.sourceDir)];
}

interface InstanceRecord {
  pid: number;
  leases: readonly LeaseIdentity[];
  /** The Vortex checkout it runs from, for a source build. */
  sourceDir?: string;
}

function instanceRecordFile(config: HarnessConfig): string {
  return path.join(config.cacheDir, "instance.json");
}

function runningInstanceRecord(config: HarnessConfig): InstanceRecord | undefined {
  try {
    return JSON.parse(fs.readFileSync(instanceRecordFile(config), "utf8")) as InstanceRecord;
  } catch {
    return undefined;
  }
}

/** The harness Vortex this cache last launched, while it still runs. */
export function runningInstance(config: HarnessConfig): InstanceRecord | undefined {
  const record = runningInstanceRecord(config);
  return record !== undefined && Number.isInteger(record.pid) && isAlive(record.pid)
    ? record
    : undefined;
}

/** Record a launched Vortex on every lease it needs, so they outlive the launching command. */
export function recordLaunchedPid(
  identities: readonly LeaseIdentity[],
  pid: number,
  leaseEnv: LeaseEnv = {},
): void {
  for (const identity of identities) addInstancePid(identity, pid, leaseEnv);
}

/** Forget a Vortex that has exited, on every lease it was recorded on. */
export function forgetLaunchedPid(
  identities: readonly LeaseIdentity[],
  pid: number,
  leaseEnv: LeaseEnv = {},
): void {
  for (const identity of identities) removeInstancePid(identity, pid, leaseEnv);
}

/** A failed launch registration must settle its exact child before dropping partial protection. */
export async function registerLaunchedProcess(
  child: ChildProcess,
  identities: readonly LeaseIdentity[],
  options: OperationOptions & { onProcessSpawn?: (child: ChildProcess) => void } = {},
): Promise<void> {
  if (child.pid === undefined) return;
  let releaseChild: (() => void) | undefined;
  try {
    if (options.context !== undefined)
      releaseChild = trackOperationChild(options.context, child.pid, [], options.leaseEnv);
    recordLaunchedPid(identities, child.pid, options.leaseEnv);
    options.onProcessSpawn?.(child);
  } catch (error) {
    if (error instanceof ChildRegistrationError) releaseChild = error.release;
    const failures = [error];
    try {
      child.kill("SIGKILL");
      if (!(await waitForExit(child, 5_000)))
        throw new Error(
          `Vortex ${child.pid} survived failed registration; preserve its profile and inspect its recorded leases.`,
          { cause: error },
        );
    } catch (stopError) {
      // The known child keeps any successful ownership/operation registrations.
      throw new AggregateError(
        [...failures, stopError],
        "Launch registration and child shutdown failed; protection retained.",
        { cause: stopError },
      );
    }
    try {
      forgetLaunchedPid(identities, child.pid, options.leaseEnv);
      releaseChild?.();
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    if (failures.length > 1)
      throw new AggregateError(failures, "Launch registration and cleanup failed.", {
        cause: error,
      });
    throw error;
  }
  releaseChild?.();
}

export function authCacheFile(config: HarnessConfig): string {
  const key = createHash("sha256")
    .update(`${config.target.kind}:${config.target.appName}`)
    .digest("hex")
    .slice(0, 16);
  return path.join(config.cacheDir, `oauth-${key}.json`);
}

export interface VortexInstance {
  process: ChildProcess;
  userDataDir: string;
  mcp: VortexMcpClient;
  stop: (options?: OperationOptions & { force?: boolean }) => Promise<void>;
}

/**
 * Build the environment for an isolated Vortex instance.
 *
 * `VORTEX_E2E=1` is doing two jobs here and both are required:
 *   1. It is the gate on `ELECTRON_USERDATA`/`ELECTRON_APPDATA` being honoured
 *      at all — without it the instance writes to the user's real Vortex data.
 *   2. It skips the single-instance lock, so a harness instance can run
 *      alongside the operator's own Vortex.
 *
 * Both are honoured by the *released* build, not just a source checkout, which
 * is what makes isolated automation against a stock install possible.
 *
 * Its third effect is a real trade-off: it also disables startup game
 * discovery. The harness works around that by setting the game path explicitly
 * (see gameSetup.ts), which is faster than a scan and deterministic anyway.
 */
/** Where the harness reads a Nexus API key from; stripped from Vortex's env unless in use. */
export const API_KEY_VARIABLES = ["VORTEX_AI_NEXUS_API_KEY", "NEXUS_API_KEY"] as const;

export function buildInstanceEnv(
  userDataDir: string,
  config: HarnessConfig,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // ELECTRON_RUN_AS_NODE would make the child start as a plain Node process
    // rather than an Electron app — inherited from a tsx parent otherwise.
    if (
      key !== "ELECTRON_RUN_AS_NODE" &&
      key !== "VORTEX_AI_OPERATION_CONTEXT" &&
      value !== undefined
    )
      env[key] = value;
  }

  env.ELECTRON_USERDATA = path.join(userDataDir, "userData");
  env.ELECTRON_APPDATA = path.join(userDataDir, "appData");
  env.VORTEX_E2E = "1";
  env.VORTEX_MCP_TOKEN = config.mcpToken;
  env.VORTEX_MCP_PORT = String(config.mcpPort);
  env.VORTEX_AI_AUTH_CACHE = authCacheFile(config);
  if (config.headless) env.VORTEX_E2E_HEADLESS = "1";
  // Vortex reads LOCALAPPDATA straight from the environment for plugins.txt and
  // loadorder.txt, in both processes. Documents cannot be moved this way; see
  // mainPreload.ts.
  if (config.profileRedirect !== undefined) {
    env.LOCALAPPDATA = config.profileRedirect.localAppData;
  }
  // A source checkout only loads its extensions and devtools wiring under
  // development; a released build ignores this.
  if (config.target.kind === "dev") {
    // Set, never deleted: a plain `pnpm run build` inlines NODE_ENV="development" into
    // main.cjs, so main never switches itself to production, and a renderer launched
    // without NODE_ENV loads React's development build (see productionMode.ts).
    env.NODE_ENV = config.production ? "production" : "development";
  }
  // Sandbox runs are local-only and withhold the API key; harness/.env has put it in this
  // process's environment, and nothing a launched Vortex runs needs to inherit it.
  if (config.apiKey === undefined || config.apiKey.trim() === "") {
    for (const key of API_KEY_VARIABLES) delete env[key];
  }

  return env;
}

/**
 * Create the directory layout Vortex expects before first launch.
 *
 * The app-name subdirectory under appData is where Vortex writes startup.json,
 * and it must exist beforehand. The name differs between a released build
 * (`Vortex`) and a source checkout (`@vortex/main`) — getting it wrong makes
 * Vortex quit during startup with an unrecoverable ENOENT that looks nothing
 * like a naming problem.
 */
export function prepareUserDataDir(userDataDir: string, appName: string): void {
  fs.mkdirSync(path.join(userDataDir, "appData", ...appName.split("/")), { recursive: true });
  fs.mkdirSync(path.join(userDataDir, "userData", "plugins"), { recursive: true });
}

/**
 * Copy the built extension into an instance's plugins directory.
 *
 * Vortex loads user extensions from `<userData>/plugins/<id>`, and `<id>` must
 * match info.json's `id` or Vortex treats it as a different extension next run.
 */
export function installMcpExtension(
  userDataDir: string,
  source = extensionRoot(),
  options: OperationOptions & { owner?: string } = {},
): void {
  const owner = requireNamedOwner(options.owner);
  withOperationsSync(
    [extensionOutputResource(source)],
    owner,
    {
      ...options,
      context: options.context ?? inheritedOperation(owner, process.env, options.leaseEnv),
    },
    () => installExtensionInside(userDataDir, source),
  );
}

function installExtensionInside(userDataDir: string, source: string): void {
  const generation = requireFreshExtension(source);
  const plugins = path.join(userDataDir, "userData", "plugins");
  const target = path.join(plugins, MCP_EXTENSION_ID);
  fs.mkdirSync(userDataDir, { recursive: true });
  const stage = fs.mkdtempSync(path.join(userDataDir, ".doodlebot-install-"));
  try {
    const stagedPlugin = path.join(stage, MCP_EXTENSION_ID);
    fs.cpSync(path.join(source, "dist"), stagedPlugin, { recursive: true });
    if (verifyExtensionGeneration(stagedPlugin).outputDigest !== generation.outputDigest)
      throw new Error(
        "Extension generation changed while copying; the installed plugin was preserved.",
      );
    requireFreshExtension(source);
    replaceExtensionDirectory(stagedPlugin, target, userDataDir);
    // Remove old IDs only after the complete new plugin has been published.
    for (const legacy of LEGACY_EXTENSION_IDS)
      fs.rmSync(path.join(plugins, legacy), { recursive: true, force: true });
  } finally {
    try {
      fs.rmSync(stage, { recursive: true, force: true });
    } catch {
      process.stderr.write(
        `Temporary extension copy retained at ${stage}; remove it after inspection.\n`,
      );
    }
  }
}

async function assertPortAvailable(port: number): Promise<void> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", () =>
      reject(
        new Error(
          `Port ${port} is occupied. Choose unused --port and --cdp-port values; no new Vortex was launched.`,
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}

/** Ensure the extension is built, building it when needed. Returns this repo's root. */
export async function ensureExtensionBuilt(
  options: ExtensionBuildOptions & { rebuild?: boolean } = {},
): Promise<string> {
  const owner = requireNamedOwner(options.owner);
  const source = options.source ?? extensionRoot();
  const needsBuild = (): boolean => options.rebuild === true || !extensionIsFresh(source);
  const context = options.context ?? inheritedOperation(owner, process.env, options.leaseEnv);
  const needed = withOperationsSync(
    [extensionOutputResource(source)],
    owner,
    { ...options, context },
    needsBuild,
  );
  if (needed) await buildExtension({ ...options, source, owner, context, needed: needsBuild });
  withOperationsSync([extensionOutputResource(source)], owner, { ...options, context }, () =>
    requireFreshExtension(source),
  );
  return source;
}

/**
 * Remove an instance directory, retrying past transient Windows locks.
 *
 * Vortex's state database keeps file handles open for a moment after the
 * process exits, so an immediate rmSync loses a race and throws EPERM. Retrying
 * turns that into a short wait rather than a failed run.
 */
export function removeInstanceDir(dir: string, attempts = 5): void {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === attempts) {
        throw new Error(
          `Could not remove ${dir} after ${String(attempts)} attempts: ` +
            `${err instanceof Error ? err.message : String(err)}. ` +
            `A Vortex process is probably still holding it — close it and retry.`,
          { cause: err },
        );
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 400);
    }
  }
}

/** Where the PID of the most recently launched instance is recorded. */
function pidFile(config: HarnessConfig): string {
  return path.join(config.cacheDir, "instance.pid");
}

function recordPid(
  config: HarnessConfig,
  pid: number | undefined,
  leases: readonly LeaseIdentity[],
): void {
  if (pid === undefined) return;
  try {
    fs.mkdirSync(config.cacheDir, { recursive: true });
    fs.writeFileSync(pidFile(config), String(pid));
    const record: InstanceRecord = {
      pid,
      leases,
      ...(config.target.kind === "dev" && config.target.sourceDir !== undefined
        ? { sourceDir: config.target.sourceDir }
        : {}),
    };
    fs.writeFileSync(instanceRecordFile(config), `${JSON.stringify(record)}\n`);
  } catch {
    // Best-effort bookkeeping; never fail a launch over it.
  }
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission/existence check without delivering one.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Shut down an instance left behind by an earlier run.
 *
 * Two mechanisms, because they cover different failures. MCP is the graceful
 * path and flushes state. But the case that actually strands a directory is an
 * instance whose extension never loaded — it holds the user-data directory and
 * answers nothing, so there is no polite channel to it at all. That is why the
 * PID is recorded at launch: it is the only handle on a Vortex that is running
 * but unreachable, and without it the next run fails on an EPERM that says
 * nothing about the real cause.
 */
export async function stopStaleInstance(
  config: HarnessConfig,
  options: OperationOptions = {},
): Promise<boolean> {
  return withLiveOperation(
    config,
    "stop harness instance",
    () => stopStaleInside(config, options.leaseEnv),
    options,
  );
}

async function stopStaleInside(config: HarnessConfig, leaseEnv: LeaseEnv = {}): Promise<boolean> {
  // Refuses before touching anything when another owner holds the instance.
  claimInstanceLease(config, "stop a harness instance", leaseEnv);
  let stopped = false;
  const file = pidFile(config);
  const pid = fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8").trim()) : undefined;
  const mcp = new VortexMcpClient({ port: config.mcpPort, token: config.mcpToken });
  if (await mcp.ping()) {
    const status = await mcp.call<{ userDataDir: string | null }>("automation_status");
    const relative =
      status.userDataDir === null
        ? ".."
        : path.relative(path.resolve(config.cacheDir), path.resolve(status.userDataDir));
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(
        `Port ${config.mcpPort} belongs to a different Vortex profile. Choose another --port and --cdp-port.`,
      );
    }
    await mcp.call("vortex_quit");
    stopped = true;
  }
  const deadline = Date.now() + 30_000;
  const recordedProcessAlive = (): boolean =>
    pid !== undefined && Number.isInteger(pid) && pid > 0 && isAlive(pid);
  while (recordedProcessAlive() || (await mcp.ping())) {
    if (Date.now() >= deadline) {
      throw new Error(
        "Vortex did not exit cleanly. The profile has been preserved; close the harness window before retrying. No snapshot was copied and no PID was killed.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const record = runningInstanceRecord(config);
  fs.rmSync(file, { force: true });
  fs.rmSync(instanceRecordFile(config), { force: true });
  if (pid !== undefined && Number.isInteger(pid)) {
    // Captured at launch, including its source checkout; never edit a successor's lease.
    if (record !== undefined) forgetLaunchedPid(record.leases, pid, leaseEnv);
  }
  return stopped;
}

export interface LaunchOptions extends OperationOptions {
  userDataDir: string;
  config: HarnessConfig;
  /** Progress and warnings, such as a development bundle under --production. */
  onProgress?: (message: string) => void;
  /** Monotonic timestamp immediately before process creation, for startup measurements. */
  onSpawn?: (at: number) => void;
  /** Exact child immediately after spawn/PID recording, before any readiness await. */
  onProcessSpawn?: (child: ChildProcess) => void;
}

/** Where a detached Vortex's own stdout and stderr go: `<instance dir>/vortex-stdio.log`. */
export function stdioLogFile(userDataDir: string): string {
  return path.join(userDataDir, "vortex-stdio.log");
}

function openStdioLog(userDataDir: string): number | undefined {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    return fs.openSync(stdioLogFile(userDataDir), "w");
  } catch {
    return undefined;
  }
}

/**
 * How Vortex is spawned. Detached, so it outlives the `doodlebot` process that started it, and
 * with none of that process's stdio: stdin is ignored and stdout/stderr go to a log file (or
 * nowhere). A Vortex holding the caller's pipes keeps a shell that captures `up`'s output
 * (PowerShell `*>`, `| Select-String`, a tool reading stdout) waiting until Vortex exits.
 * Nothing else Vortex writes is lost that way: its own log is `userData/vortex.log`.
 */
export function launchStdio(logFd: number | undefined): {
  stdio: ["ignore", number | "ignore", number | "ignore"];
  detached: true;
  windowsHide: false;
} {
  const out = logFd ?? "ignore";
  return { stdio: ["ignore", out, out], detached: true, windowsHide: false };
}

/**
 * Start Vortex and wait until its MCP server answers.
 *
 * CDP is always enabled. Electron parses `--remote-debugging-port` from argv
 * itself, so this works on the released build too — and it is what screenshots
 * and the Playwright specs attach to, replacing what would otherwise have to be
 * a patch to Vortex core.
 *
 * "Answers MCP" rather than "process started" is the readiness signal on
 * purpose: the extension registers in `context.once`, which runs only after the
 * renderer has loaded its extensions and the store is live. A port check or a
 * fixed sleep would both report ready while the app is still on the splash
 * screen, and every subsequent tool call would fail confusingly.
 */
export async function launchVortex(options: LaunchOptions): Promise<VortexInstance> {
  return withLiveOperation(
    options.config,
    "launch Vortex",
    (context) => launchInside({ ...options, context }),
    options,
  );
}

async function launchInside(options: LaunchOptions): Promise<VortexInstance> {
  const { userDataDir, config } = options;
  const { target } = config;
  if (target.kind === "dev" && target.args[0] !== undefined && !fs.existsSync(target.executable))
    target.executable = resolveDevElectron(target.args[0]);
  const lease = claimInstanceLease(config, "launch Vortex", options.leaseEnv);
  installSandboxExtension(userDataDir, config);
  await assertPortAvailable(config.mcpPort);
  await assertPortAvailable(config.cdpPort);

  if (target.executable === "") {
    throw new Error(
      "No Vortex executable resolved. Run `doodlebot doctor` — it will say what is missing.",
    );
  }

  const redirect = config.profileRedirect;
  const env = buildInstanceEnv(userDataDir, config);
  const preload =
    redirect !== undefined
      ? preparePreload(userDataDir, { documents: redirect.documents })
      : undefined;
  if (preload !== undefined) {
    env.NODE_OPTIONS = [env.NODE_OPTIONS, preload.nodeOptions].filter(Boolean).join(" ");
  }

  const logFd = openStdioLog(userDataDir);
  let child: ChildProcess;
  try {
    options.onSpawn?.(performance.now());
    child = spawn(
      target.executable,
      [...target.args, `--remote-debugging-port=${String(config.cdpPort)}`],
      { env, cwd: path.dirname(target.executable), ...launchStdio(logFd) },
    );
  } finally {
    // The child has its own copy; this process must not keep the log open.
    if (logFd !== undefined) fs.closeSync(logFd);
  }
  child.unref();
  recordPid(config, child.pid, lease.identities);
  // A detached instance keeps the lease after this process exits, until `down`.
  await registerLaunchedProcess(child, lease.identities, options);

  if (redirect !== undefined && preload !== undefined) {
    try {
      // The record is written on the main process's first line; game activation, the
      // first thing that writes under Documents, is seconds later in the renderer.
      await verifyPreload(preload.recordFile, { documents: redirect.documents }, 5_000);
    } catch (err) {
      // Stopped before a game could activate: nothing reached the real folders.
      child.kill();
      throw err;
    }
  }

  const mcp = new VortexMcpClient({ port: config.mcpPort, token: config.mcpToken });

  // Fail fast on an early crash rather than waiting out the readiness timeout.
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.once("exit", (code, signal) => (exited = { code, signal }));
  let spawnError: Error | undefined;
  child.once("error", (err) => {
    spawnError = err;
  });

  const readyController = new AbortController();
  const readiness = mcp.waitUntilReady(180_000, 500, readyController.signal);
  let timer: ReturnType<typeof setInterval>;
  const crashWatch = new Promise<never>((_resolve, reject) => {
    timer = setInterval(() => {
      if (spawnError !== undefined) {
        clearInterval(timer);
        reject(spawnError);
      } else if (exited !== undefined) {
        clearInterval(timer);
        reject(
          new Error(
            `Vortex exited (code=${String(exited.code)} signal=${String(exited.signal)}) before ` +
              `its MCP server came up. Check ` +
              `${path.join(userDataDir, "userData", "vortex.log")}.`,
          ),
        );
      }
    }, 250);
    timer.unref();
  });

  try {
    await Promise.race([readiness, crashWatch]);
  } finally {
    clearInterval(timer!);
    readyController.abort();
  }

  const instance: VortexInstance = {
    process: child,
    userDataDir,
    mcp,
    stop: (stopOptions = {}) =>
      withLiveOperation(
        config,
        "stop launched Vortex",
        () =>
          stopInstance(child, mcp, {
            ...stopOptions,
            leases: lease.identities,
            leaseEnv: options.leaseEnv,
          }),
        stopOptions,
      ),
  };
  await checkProductionMode(instance, config, options.onProgress, options);
  return instance;
}

/**
 * Under `--production`, refuse an instance whose renderer is not running production React,
 * stopping it cleanly first. Also warn when the checkout is a development bundle.
 */
async function checkProductionMode(
  instance: VortexInstance,
  config: HarnessConfig,
  report: ((message: string) => void) | undefined,
  options: OperationOptions,
): Promise<void> {
  if (config.target.kind !== "dev" || !config.production) return;
  const sourceDir = config.target.sourceDir;
  if (sourceDir !== undefined && bundleModeOf(sourceDir) === "development") {
    (report ?? ((message: string) => process.stderr.write(`${message}\n`)))(
      `warning: ${devBundleWarning(sourceDir)}`,
    );
  }
  const status = await instance.mcp.call<ProductionStatus>("automation_status");
  const problem = productionProblem(status);
  if (problem === undefined) return;
  await instance
    .stop(options)
    .catch(() => instance.stop({ ...options, force: true }).catch(() => undefined));
  throw new ProductionModeError(productionErrorMessage(problem));
}

/**
 * Stop an instance, preferring Vortex's own graceful shutdown.
 *
 * This matters more than it looks: Vortex flushes its state store on a clean
 * quit. A hard kill can leave the cached profile half-written, which then makes
 * the *next* warm start fail in a way that looks unrelated.
 */
export async function stopInstance(
  child: ChildProcess,
  mcp: VortexMcpClient,
  options: {
    force?: boolean;
    timeoutMs?: number;
    leases?: readonly LeaseIdentity[];
    leaseEnv?: LeaseEnv;
  } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 20_000;

  if (options.force !== true) {
    // vortex_quit closes the window, which is Vortex's own clean-shutdown path.
    // Best-effort: if the app is already gone the call just fails, and the exit
    // wait below settles immediately anyway.
    await mcp.call("vortex_quit").catch(() => undefined);
  }

  const exited = await waitForExit(child, timeoutMs);
  if (!exited) {
    if (options.force !== true)
      throw new Error(
        "Vortex did not exit cleanly; refusing to snapshot potentially unflushed state.",
      );
    child.kill("SIGKILL");
    if (!(await waitForExit(child, 5_000)))
      throw new Error("Vortex did not exit after forced shutdown.");
  }
  if (child.pid !== undefined && options.leases !== undefined)
    forgetLaunchedPid(options.leases, child.pid, options.leaseEnv);
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}
