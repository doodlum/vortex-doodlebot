#!/usr/bin/env -S node --experimental-strip-types
/**
 * `doodlebot` — the operator-facing entry point to the AI harness.
 *
 * Two audiences, one binary. A human runs `doctor`/`up`/`watch` to get a driven
 * Vortex running; an agent then talks to that instance over MCP and only comes
 * back here for things MCP cannot do (start a process, rebuild a bundle). The
 * one-shot commands (`snapshot`, `click`, `responsive`, ...) exist so the whole
 * thing is usable from a plain shell before any MCP client is wired up — which
 * is also how you tell a broken harness from a broken MCP config.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ANONYMOUS, bootstrap, liveDir, readMarker, snapshotDir } from "./bootstrap";
import { parseArgs, type ParsedArgs } from "./cliArgs";
import {
  ConfigError,
  REPO_ROOT,
  loadConfig,
  resolveTargetSafely,
  type ConfigOverrides,
  type HarnessConfig,
} from "./config";
import { runDoctor, formatDoctorReport } from "./doctor";
import { parseJson, stripBom } from "./jsonFile";
import { RendererEvalRefused, evalInRenderer } from "./rendererEval";
import { assertStandaloneWatch, watchAndReload } from "./hotReload";
import { abortOnSignals } from "./processRunner";
import { LIVE_COMMANDS, withLiveOperation } from "./liveOperation";
import { inheritedOperation, type OperationContext } from "./operations";
import {
  attachedLeaseResources,
  authCacheFile,
  ensureExtensionBuilt,
  stopStaleInstance,
} from "./instance";
import { VortexMcpClient } from "./mcpClient";
import { requireRunning } from "./runningProfile";
import { formatReport, runResponsiveSweep, viewportList } from "./responsive";
import { captureScreenshot } from "./cdp";
import { startRecording } from "./recording";
import {
  formatPullRequestChecks,
  inspectPullRequestChecks,
  pullRequestChecksPassed,
} from "./prChecks";
import { PreflightError, formatPreflightReport, runPreflight } from "./prPreflight";
import { readinessFromFile } from "./readiness";
import {
  captureCheckoutIdentity,
  collectCommandEvidence,
  runtimeIdentitySchema,
  fileArtifact,
} from "./evidence";
import { buildCheckout } from "./vortexBuild";
import { captureLogin } from "./bootstrap";
import { requireOAuth, waitForOAuth, type AuthStatus } from "./auth";
import { localOnlyConfig, sandboxConfig } from "./sandbox";
import { bethesdaSandboxConfig, isolateUserFolders } from "./bethesdaSandbox";
import { installLocalMod } from "./localMod";
import { runSlowDownloads } from "./slowDownload";
import { installCollection } from "./collections";
import { deployMods, needsDeployment, purgeGame } from "./deployment";
import { runE2e } from "./e2e";
import {
  acquireLeases,
  checkoutResource,
  formatLeaseStates,
  listLeases,
  readLease,
  releaseLease,
  releaseOwnerLeases,
  resolveOwner,
  requireNamedOwner,
  renewLease,
  waitForLease,
  type LeaseState,
  type ReleaseResult,
} from "./lease";
import { runUnderLease } from "./leaseCommand";
import { kitLockHolder, lockKit, pushKit, syncKit, unlockKit } from "./kitLock";
import { formatSlots, instanceResource, listSlots, parseSlot } from "./slots";
import { addWorktree, listWorktrees, removeWorktree, worktreeDir } from "./worktree";
import { importLogin } from "./loginImport";
import { e2eExitCode, formatE2eReport, playwrightRunner, runVortexE2e } from "./vortexE2e";
import {
  buildVortexSource,
  detectGitHubUser,
  ensureVortexSource,
  hasVortexSource,
  resolveVortexRepo,
  vortexSourceDir,
} from "./source";

function configFrom(flags: ParsedArgs["flags"]): HarnessConfig {
  const overrides: ConfigOverrides = {};
  if (typeof flags.game === "string") overrides.gameId = flags.game;
  if (typeof flags["game-path"] === "string") overrides.gamePath = flags["game-path"];
  if (typeof flags.worktree === "string" && typeof flags["dev-dir"] === "string")
    throw new ConfigError("Choose one of --worktree and --dev-dir.");
  const devDir =
    typeof flags.worktree === "string"
      ? worktreeDir(flags.worktree)
      : typeof flags["dev-dir"] === "string"
        ? flags["dev-dir"]
        : undefined;
  if (devDir !== undefined || typeof flags.exe === "string" || flags.installed === true) {
    overrides.target = resolveTargetSafely({
      devDir,
      exe: typeof flags.exe === "string" ? flags.exe : undefined,
      preferInstalled: flags.installed === true,
    });
  }
  if (typeof flags.port === "string") overrides.mcpPort = Number(flags.port);
  if (typeof flags["cdp-port"] === "string") overrides.cdpPort = Number(flags["cdp-port"]);
  if (typeof flags["cache-dir"] === "string") overrides.cacheDir = path.resolve(flags["cache-dir"]);
  if (flags.headless === true) overrides.headless = true;
  if (flags.production === true) overrides.production = true;
  if (typeof flags.owner === "string") overrides.owner = flags.owner;
  if (typeof flags.slot === "string") overrides.slot = parseSlot(flags.slot);
  const config = loadConfig(overrides);
  if (flags.sandbox === true && flags["bethesda-sandbox"] === true) {
    throw new ConfigError("Choose one of --sandbox and --bethesda-sandbox.");
  }
  const keepKey = flags["with-api-key"] === true;
  if (flags["bethesda-sandbox"] === true) {
    return localOnlyConfig(bethesdaSandboxConfig(config), keepKey);
  }
  const chosen = flags.sandbox === true ? localOnlyConfig(sandboxConfig(config), keepKey) : config;
  return flags["isolate-user-folders"] === true ? isolateUserFolders(chosen) : chosen;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** A client for an instance someone else started — the normal case for one-shots. */
function clientFor(config: HarnessConfig): VortexMcpClient {
  return new VortexMcpClient({ port: config.mcpPort, token: config.mcpToken });
}

const HELP = `doodlebot — automation for stock Vortex and Vortex development

First run (no account or installed game required)
  pnpm install
  pnpm run build
  pnpm run ai -- doctor --installed --sandbox
  pnpm run ai -- setup --installed --sandbox
  pnpm run ai:test

Initial account setup (only for Nexus collections)
  setup --oauth          Open isolated Vortex, wait for browser login, cache OAuth
                         automatically, verify credentials survive a fresh start
    --no-wait            Return with login pending; finish with save-login
  auth-status            Print presence booleans only; never print credentials
  save-login             Verify OAuth, stop cleanly, capture the current baseline
  login-import --from <cache-dir>
                         Reuse the saved login of another cache dir (default: the
                         harness cache) in --cache-dir; --force replaces one

Instance lifecycle
  doctor                 Report prerequisites and actionable fixes
  up                     Start/restart the matching working profile
    --fresh              Reset working state from its baseline; reuse current OAuth
    --no-game            Global UI without managing a game
    --rebuild-snapshot   Rebuild baseline with current OAuth cache
    --rebuild-extension  Force extension build
  bootstrap              Build/reset baseline and launch (--no-game supported)
  down                   Quit this cache's Vortex and wait for clean exit
  status                 Show endpoint and profile cache status
  source                 Find your fork, clone to .vortex-src and build Vortex
    --update             Fetch origin and upstream in an existing clone
    --no-build           Clone only
    --where              Print managed source path
  pr-checks <pr>         Diagnose current GitHub checks and their failed steps
    --repo <owner/name>  Repository to inspect (default: Nexus-Mods/Vortex)
  readiness              Evaluate strict revision-bound task evidence; never runs gates
    --manifest <json>   Required task/evidence manifest (schema version 2)
    --json              Print the readiness report; exit 0 ready, 1 incomplete
  evidence identity --checkout <dir> --base <ref>
                         Print current subject and kit identities, including local diff
  evidence runtime --kind installed|source --label <version> <binary> [bundle...]
                         Hash runtime files; source also needs --checkout and --base
  evidence run --checkout <dir> --base <ref> --out <new-json> -- <command...>
                         Record actual command/cwd/output and before/after identities
    --cwd <dir>         Command directory inside subject (default checkout root)
    --runtime <json>    Runtime identity from evidence runtime for app checks
    --test-report <json> --test-format vitest|playwright
                         Newly produced JSON reporter output, required for test counts
  pr-preflight           Mechanical checks on a Vortex branch before pushing: size,
                         callers outside the diff, revert check (negative control),
                         measurements in comments, PR description
    --checkout <dir>     Vortex checkout (default: .vortex-src)
    --base <ref>         Base to diff from (default: upstream/master, via merge-base)
    --head <ref>         Compare this ref without checking it out (no revert check)
    --test <path>        Test file for the revert check; repeatable (default: the
                         test files the diff adds or changes)
    --project-dir <dir>  Where to run vitest (default: each test's nearest package.json)
    --revert <path>      Revert only this file; repeatable (default: every non-test file)
    --revert-hunk <file>:<line>  Revert only the hunk of <file> holding that head line (a call
                         site in a file that also defines the new code); repeatable
    --skip-revert        Skip the revert check
    --pr <number|url>    Also lint that PR's title and description (--repo as above)
    --json               Machine-readable report; exit code 1 on any failure
  build                  Build a Vortex checkout with its pinned pnpm under its lock:
    --checkout <dir>     (default .vortex-src)
    --production         NODE_ENV=production for the build only (else NODE_ENV unset);
                         etc/vortex.api.md and etc/Dependency Report.md are put back if
                         the build rewrote them. Refuses while a Vortex runs from it.
  vortex-e2e             Run Vortex's own E2E suite (packages/e2e, CI=1, one worker, no
                         retries) under the instance lease, with the kit's fixture
                         patches applied for the run and restored byte-identically, and
                         account specs left out when their credentials are absent
    --checkout <dir>     Vortex checkout (default: .vortex-src)
    --spec <file>        Spec to run, relative to packages/e2e or src/tests; repeatable
    --grep <re> --grep-invert <re>   Playwright title filters
    --compare <json>     Diff against an earlier report: regressions vs pre-existing
    --json               Print the report as JSON (Playwright's output goes to stderr)

Parallel sessions (harness/AGENTS.md, "Parallel sessions")
  kit lock               Take the global kit lock before changing doodlebot itself (knowledge,
                         skills, harness, docs): --owner <name> [--ttl <min>, default 30]
                         [--wait <min>]. Take it again to renew.
  kit sync               Under the lock: switch to main and fast-forward to origin/main
  kit push               Under the lock: rebase main onto origin/main and push it
  kit renew              Renew the original live lock: --acquisition <id> [--ttl <min>]
  kit unlock             Release your original lock: --acquisition <id>; --force is inspected recovery
  kit status             Show who holds it; --json includes its acquisition ID
  --slot <n|auto>        Instance slot: its own cache, artifacts, ports and instance lease.
                         0 (default) is harness/.cache on 3701/9222; n uses harness/.slots/<n>
                         on 3701+10n/9222+10n. auto: this owner's own slot, kept across
                         commands (needs --owner). Or VORTEX_AI_SLOT. Pass it to every command.
  slots                  Every slot: who was given it, whether its Vortex runs (--json)
  worktree add <name>    A Vortex worktree of .vortex-src for one session's work, in
                         .vortex-worktrees/<name>: [--base <ref>, default upstream/master]
                         [--branch <name>, default <name>] [--no-build] [--no-install]
                         [--ref <branch|sha>: that ref detached, e.g. to review a branch
                         another worktree has checked out]
  worktree list          The worktrees and their branches
  worktree remove <name> Remove one (refuses uncommitted changes without --force)
  --worktree <name>      Use that worktree as the target, like --dev-dir

Leases (one harness Vortex per cache; several agents may share the kit)
  lease status           Who holds what, live or stale (--json)
  lease acquire          Hold the instance lease: --owner <name> [--purpose <text>]
                         [--ttl <minutes>, default 60; 0 = none] [--pid <n>] [--wait <min>]
                         [--checkout <dir>: that checkout's lock AS WELL, all or nothing;
                         --checkout-only: just the checkout]. Re-run to renew.
  lease release          --owner <name>: every lease that owner holds (instance and
                         checkouts). [--checkout <dir>: only that checkout] [--force]
  lease run [flags] [--] <cmd...>
                         Hold the lease (and --checkout's) while <cmd> runs; exit code
                         propagated. --owner <name> [--wait <minutes>] [--purpose <text>]
                         Flags go before the command, which starts at its first word.
  Commands that start or stop Vortex take the lease implicitly and refuse while another
  owner holds it; up keeps it until down. Vortex run from a checkout also locks that
  checkout until it exits. Owner: --owner, else VORTEX_AI_OWNER, else "anonymous".

Driving a running instance
  tools --json           Discover every live tool and its full input schema
  call <tool> --args-file <json-file>   Invoke any tool with structured arguments
    --args <json>        Inline alternative (mind shell quoting)
  snapshot               Accessibility tree; optional --selector <css>
  click --ref <ref>       Or use --selector <css>
  fill --ref <ref> --value <text>
  press --key <Enter>     DOM key events; native typing/defaults require CDP
  screenshot             Save PNG; --label <name>, --full-page
  eval --expr "<js>"     Diagnostics only: evaluate JavaScript in a harness instance's
    eval <file.js>       renderer over CDP and print the JSON result (refuses any Vortex
                         whose profile is not in this cache). Promises are awaited.
  script <file.mts> [args...]
                         Run a scratch script with the kit's tsx under the instance lease.
                         --owner, --wait and the instance flags (--slot, --worktree, --dev-dir,
                         --cache-dir, --port, --cdp-port) are the kit's anywhere, even after the
                         file; every other argument (and all after --) is the script's.
                         VORTEX_AI_KIT holds the import URL of harness/src/kit.ts
  record                 Save WebM; --ffmpeg <path> --seconds <1-60> --label <name>
  install <archive>      Install local ZIP/7z through Vortex; no account needed
  slow-download          Real Vortex downloads of throttled local files, for download UI
                         work; returns once they finish (run it in the background)
    --count <n> --seconds <n> --stagger <s>   (defaults 1, 30, 0)
  collection <url>       Install exact Nexus collection/revision using OAuth
  deploy                 Deploy enabled mods for the active game
    --purge              Permit purging a foreign deployment in a disposable game
  purge                  Remove files recorded in this game's deployment manifest
  e2e <collection>       Fresh start, install, verify, deploy, launch real game
    --runs <n> --keep --purge; --no-launch for installation/deployment only

Testing and iteration
  responsive             Scan width AND height changes; persist JSON evidence
    --viewports 1024x720,1280x720,1280x1080,1920x1080   (quote the list in PowerShell)
    --screenshots        Save PNG per viewport
    --strict             Nonzero exit for viewport-dependent findings or overflow
  watch                  Watch doodlebot source; finite build/copy/reload cycles
                         Needs an existing owned app; run directly, outside command wrappers
  build-extension        Force extension build

Target and isolation (repeat the same flags for all commands)
  --installed            Use released Vortex even when .vortex-src exists
  --exe <path>           Explicit Vortex.exe
  --dev-dir <path>       Explicit source checkout
  --sandbox              Disposable test game for local install/deploy tests
  --bethesda-sandbox     Fake Fallout 4 (plugins, LOOT, masters) with private
                         LocalAppData and Documents; no game install needed
  --with-api-key         Seed harness/.env's API key into a sandbox profile too (off by
                         default: with a key, every local install waits on a Nexus lookup)
  --isolate-user-folders Give any game private LocalAppData and Documents folders
  --game <id> --game-path <dir>   Real game integration; use a disposable copy
  --cache-dir <dir>      Profiles and private OAuth cache
  --port <n> --cdp-port <n>      MCP/CDP endpoints (3701/9222 by default)
  --owner <name>         Required live/provisioning worker (or VORTEX_AI_OWNER)
  --headless             Hide the window; screenshots/layout may differ
  --production           Run a source build as releases run (production React);
                         use for any timing meant to reflect users' experience.
                         up fails unless the renderer loaded production React

Without a target flag: .vortex-src if present, otherwise installed Vortex.
Read harness/AGENT-WORKFLOW.md and relevant sources in harness/KNOWLEDGE-ROUTES.md.
For Vortex changes also follow its AGENTS.md and linked task-specific docs.
`;
async function main(): Promise<number> {
  const commandLine = process.argv.slice(2);
  const argv = commandLine[0] === "--" ? commandLine.slice(1) : commandLine;
  const parsed = parseArgs(argv);
  const { command, flags, positional, lists, passthrough } = parsed;

  if (command === "help" || flags.help === true) {
    log(HELP);
    return 0;
  }

  if (command === "pr-checks") {
    const ref = positional[0];
    if (ref === undefined) throw new ConfigError("pr-checks needs a PR number or URL.");
    const report = await inspectPullRequestChecks(
      ref,
      typeof flags.repo === "string" ? flags.repo : undefined,
    );
    log(flags.json === true ? JSON.stringify(report, null, 2) : formatPullRequestChecks(report));
    return pullRequestChecksPassed(report) ? 0 : 1;
  }

  if (command === "readiness") {
    if (typeof flags.manifest !== "string")
      throw new ConfigError("readiness needs --manifest <json>.");
    const report = readinessFromFile(flags.manifest);
    log(
      flags.json === true
        ? JSON.stringify(report, null, 2)
        : `${report.ready ? "EVIDENCE COMPLETE" : "INCOMPLETE"}: ${report.taskId} at ${report.subject.headSha}\n${report.meaning}\n${report.issues.join("\n")}`,
    );
    return report.ready ? 0 : 1;
  }

  if (command === "evidence") {
    const text = (name: string): string | undefined =>
      typeof flags[name] === "string" ? flags[name] : undefined;
    const checkout = text("checkout");
    const base = text("base") ?? "HEAD";
    if (positional[0] === "runtime") {
      const kind = text("kind");
      const runtime = runtimeIdentitySchema.parse({
        kind,
        label: text("label"),
        mode: text("mode") ?? (kind === "installed" ? "production" : "development"),
        files: positional.slice(1).map(fileArtifact),
        ...(kind === "source" && checkout !== undefined
          ? { source: captureCheckoutIdentity(checkout, base) }
          : {}),
      });
      log(JSON.stringify(runtime, null, 2));
      return 0;
    }
    if (checkout === undefined)
      throw new ConfigError("evidence needs an explicit --checkout; it never defaults to Vortex.");
    if (positional[0] === "identity") {
      log(
        JSON.stringify(
          {
            subject: captureCheckoutIdentity(checkout, base),
            kit: captureCheckoutIdentity(REPO_ROOT),
          },
          null,
          2,
        ),
      );
      return 0;
    }
    if (positional[0] !== "run" || text("out") === undefined)
      throw new ConfigError(
        "Use evidence identity, runtime, or run --out <new-json> -- <command...>.",
      );
    const format = text("test-format");
    if (text("test-report") !== undefined && format !== "vitest" && format !== "playwright")
      throw new ConfigError("--test-report needs --test-format vitest|playwright.");
    const runtimeFile = text("runtime");
    const result = await collectCommandEvidence({
      checkout,
      base,
      cwd: text("cwd") ?? checkout,
      owner: requireNamedOwner(text("owner")),
      command: passthrough,
      out: text("out")!,
      runtime:
        runtimeFile === undefined
          ? undefined
          : runtimeIdentitySchema.parse(parseJson(fs.readFileSync(runtimeFile, "utf8"))),
      testReport: text("test-report"),
      testFormat: format as "vitest" | "playwright" | undefined,
    });
    log(JSON.stringify(result, null, 2));
    return result.code === 0 && !result.aborted ? 0 : 1;
  }

  if (command === "pr-preflight") {
    const text = (name: string): string | undefined =>
      typeof flags[name] === "string" ? flags[name] : undefined;
    let report;
    try {
      report = await runPreflight({
        checkout: text("checkout") ?? vortexSourceDir(),
        base: text("base"),
        head: text("head"),
        tests: [...(lists.test ?? []), ...positional],
        projectDir: text("project-dir"),
        revert: lists.revert,
        revertHunks: lists["revert-hunk"],
        skipRevert: flags["skip-revert"] === true,
        pr: text("pr"),
        repo: text("repo"),
        onProgress: (message) => process.stderr.write(`${message}\n`),
        owner: text("owner"),
      });
    } catch (err) {
      if (err instanceof PreflightError) throw new ConfigError(err.message);
      throw err;
    }
    log(flags.json === true ? JSON.stringify(report, null, 2) : formatPreflightReport(report));
    return report.passed ? 0 : 1;
  }

  // This suite owns its own disposable instances; never load the operator's app/profile config.
  if (command === "vortex-e2e") {
    const text = (name: string): string | undefined =>
      typeof flags[name] === "string" ? flags[name] : undefined;
    const owner = requireNamedOwner(text("owner"));
    const report = await runVortexE2e({
      checkout: text("checkout") ?? vortexSourceDir(),
      owner,
      artifactDir: text("artifact-dir") ?? path.join(REPO_ROOT, "harness", ".artifacts"),
      specs: [...(lists.spec ?? []), ...positional],
      grep: text("grep"),
      grepInvert: text("grep-invert"),
      compare: text("compare"),
      runner: playwrightRunner(flags.json === true ? process.stderr : process.stdout),
      onProgress: (message) => process.stderr.write(`${message}\n`),
    });
    log(flags.json === true ? JSON.stringify(report, null, 2) : formatE2eReport(report));
    return e2eExitCode(report);
  }

  if (command === "lease") return leaseCommand(positional, flags, passthrough);
  if (command === "slots") {
    log(formatSlots(listSlots(), flags.json === true));
    return 0;
  }
  if (command === "worktree") return worktreeCommand(positional, flags);
  if (command === "kit") return kitCommand(positional, flags);

  if (command === "build") {
    const checkout = typeof flags.checkout === "string" ? flags.checkout : vortexSourceDir();
    const report = await buildCheckout({
      checkout,
      production: flags.production === true,
      owner: typeof flags.owner === "string" ? flags.owner : undefined,
      onProgress: (message) => log(`[build] ${message}`),
    });
    log(
      `[build] exit ${String(report.exitCode)} after ${String(Math.round(report.elapsedMs / 1000))}s; ` +
        `renderer bundle: ${report.bundleMode}` +
        (report.restored.length > 0 ? `; restored ${report.restored.join(", ")}` : ""),
    );
    if (report.exitCode === 0 && flags.production === true && report.bundleMode !== "production") {
      log(
        "[build] warning: --production was given but the renderer bundle still reads as a " +
          "development build (productionMode.ts). Check the build's output above.",
      );
    }
    return report.exitCode === 0 ? 0 : 1;
  }

  if (
    LIVE_COMMANDS.has(command) ||
    command === "watch" ||
    command === "build-extension" ||
    (command === "source" && flags.where !== true)
  )
    requireNamedOwner(typeof flags.owner === "string" ? flags.owner : undefined);
  const config = configFrom(flags);
  const dispatch = async (context?: OperationContext): Promise<number> => {
    switch (command) {
      case "install": {
        const file = positional[0];
        if (!file) throw new ConfigError("install needs the path to a local mod archive.");
        log(JSON.stringify(await installLocalMod(await requireRunning(config), file), null, 2));
        return 0;
      }
      case "slow-download": {
        const number = (name: string, fallback: number) =>
          typeof flags[name] === "string" ? Number(flags[name]) : fallback;
        const result = await runSlowDownloads(await requireRunning(config), {
          count: number("count", 1),
          seconds: number("seconds", 30),
          staggerSeconds: number("stagger", 0),
          onStarted: (name) => log(`started ${name}`),
        });
        log(JSON.stringify(result, null, 2));
        return 0;
      }
      case "setup": {
        const result = await bootstrap(config, {
          context,
          skipGame: flags.oauth === true || flags["no-game"] === true,
          onProgress: log,
        });
        if (flags.oauth !== true) {
          log(`Ready: ${result.instance.mcp.url}. Use snapshot or call to drive it.`);
          return 0;
        }
        const auth = await result.instance.mcp.call<AuthStatus>("nexus_auth_status");
        if (auth.oauthPresent && auth.oauthRefreshable) {
          await captureLogin(config, { context, onProgress: log });
          const restored = await bootstrap(config, {
            context,
            skipGame: true,
            fresh: true,
            onProgress: log,
          });
          await requireOAuth(restored.instance.mcp);
          log("Existing OAuth login cached and present after a fresh restore. Setup complete.");
          return 0;
        }
        // Only this harness-owned profile is changed; a seeded API key hides the
        // login button, preventing the initial OAuth flow.
        if (auth.apiKeyPresent) {
          await result.instance.mcp.call("vortex_dispatch", {
            action: "type:SET_USER_API_KEY",
            args: [null],
          });
        }
        log("Initial setup: click Log in in the isolated Vortex and complete the browser flow.");
        if (flags["no-wait"] === true) {
          log("Then run `pnpm run ai -- save-login` with these same configuration flags.");
          return 0;
        }
        log("Waiting up to 10 minutes; OAuth login will be cached automatically.");
        await waitForOAuth(result.instance.mcp);
        await captureLogin(config, { context, onProgress: log });
        const restored = await bootstrap(config, {
          context,
          skipGame: true,
          fresh: true,
          onProgress: log,
        });
        await requireOAuth(restored.instance.mcp);
        log("OAuth credentials cached and verified after a fresh restore. Setup complete.");
        return 0;
      }
      case "auth-status": {
        const mcp = await requireRunning(config);
        log(JSON.stringify(await mcp.call<AuthStatus>("nexus_auth_status"), null, 2));
        return 0;
      }
      case "call": {
        const name = positional[0];
        if (!name)
          throw new ConfigError("call needs a tool name; run tools --json to inspect schemas.");
        const raw =
          typeof flags["args-file"] === "string"
            ? fs.readFileSync(flags["args-file"], "utf8")
            : typeof flags.args === "string"
              ? flags.args
              : "{}";
        // Windows PowerShell 5.1 writes UTF-8 with a byte-order mark, which JSON.parse rejects.
        const args: unknown = parseJson(raw);
        if (args === null || typeof args !== "object" || Array.isArray(args))
          throw new ConfigError("Tool arguments must be a JSON object.");
        const mcp = await requireRunning(config);
        log(JSON.stringify(await mcp.call(name, args as Record<string, unknown>), null, 2));
        return 0;
      }
      case "doctor": {
        const report = await runDoctor(config, { skipGame: flags["no-game"] === true });
        log(formatDoctorReport(report));
        return report.ok ? 0 : 1;
      }

      case "bootstrap": {
        const result = await bootstrap(config, {
          context,
          skipGame: flags["no-game"] === true,
          rebuildSnapshot: flags["rebuild-snapshot"] === true,
          rebuildExtension: flags["rebuild-extension"] === true,
          fresh: true,
          onProgress: (m) => log(`  ${m}`),
        });
        log(
          `\nReady in ${String(Math.round(result.elapsedMs / 1000))}s (${result.tier}). ` +
            `Game: ${result.game.gameId} at ${result.game.gamePath}`,
        );
        log(`MCP: ${result.instance.mcp.url}`);
        return 0;
      }

      case "up": {
        const result = await bootstrap(config, {
          context,
          fresh: flags.fresh === true,
          rebuildSnapshot: flags["rebuild-snapshot"] === true,
          skipGame: flags["no-game"] === true,
          rebuildExtension: flags["rebuild-extension"] === true,
          onProgress: (m) => log(`  ${m}`),
        });
        log(
          `\nVortex is up in ${String(Math.round(result.elapsedMs / 1000))}s (${result.tier} start).`,
        );
        log(`  MCP:  ${result.instance.mcp.url}`);
        if (config.slot !== 0) log(`  Slot: ${String(config.slot)} (${config.cacheDir})`);
        log(`  Game: ${result.game.gameId} (${result.game.gamePath})`);
        log(`\nConnect an agent:`);
        log(
          `  claude mcp add --transport http vortex ${result.instance.mcp.url} ` +
            `-H "Authorization: Bearer ${config.mcpToken}"`,
        );
        // The instance is detached; returning here leaves it running on purpose.
        return 0;
      }

      case "down": {
        log(
          (await stopStaleInstance(config, { context }))
            ? "Vortex exited cleanly."
            : "Nothing is running.",
        );
        return 0;
      }

      case "status": {
        const apiKey = config.apiKey;
        const snapshot = snapshotDir(
          config,
          apiKey?.trim() || ANONYMOUS,
          flags["no-game"] === true,
        );
        const live = liveDir(config);
        const running = await clientFor(config).ping();

        log(`MCP port ${String(config.mcpPort)}: ${running ? "answering" : "not running"}`);
        log(`Game:     ${config.gameId}`);
        log(`API key:  ${apiKey === undefined ? "NOT SET" : "set"}`);
        if (snapshot !== undefined) {
          const marker = readMarker(snapshot);
          log(
            `Snapshot: ${marker === undefined ? "none (next start is cold)" : `cached ${marker.createdAt}`}`,
          );
        }
        log(
          `Live dir: ${fs.existsSync(path.join(live, "userData")) ? `${live} (warm start)` : "none"}`,
        );
        return 0;
      }

      case "tools": {
        const mcp = await requireRunning(config);
        const tools = await mcp.listTools();
        if (flags.json === true) {
          log(JSON.stringify(tools, null, 2));
          return 0;
        }
        log(`${String(tools.length)} tools:\n`);
        for (const tool of tools) {
          log(`  ${tool.name.padEnd(28)} ${tool.description.slice(0, 90)}`);
        }
        return 0;
      }

      case "snapshot": {
        const mcp = await requireRunning(config);
        const result = await mcp.call(
          "ui_snapshot",
          typeof flags.selector === "string" ? { selector: flags.selector } : {},
        );
        log(JSON.stringify(result, null, 2));
        return 0;
      }

      case "click": {
        const mcp = await requireRunning(config);
        const result = await mcp.call("ui_click", targetFrom(flags));
        log(JSON.stringify(result, null, 2));
        return 0;
      }

      case "fill": {
        const mcp = await requireRunning(config);
        if (typeof flags.value !== "string") throw new ConfigError("fill needs --value <text>");
        const result = await mcp.call("ui_fill", { ...targetFrom(flags), value: flags.value });
        log(JSON.stringify(result, null, 2));
        return 0;
      }

      case "press": {
        const mcp = await requireRunning(config);
        if (typeof flags.key !== "string") throw new ConfigError("press needs --key <Key>");
        const result = await mcp.call("ui_press_key", { key: flags.key });
        log(JSON.stringify(result, null, 2));
        return 0;
      }

      case "responsive": {
        const mcp = await requireRunning(config);
        const report = await runResponsiveSweep(mcp, config, {
          viewports: parseViewports(viewportList(flags.viewports, positional)),
          screenshots: flags.screenshots === true,
          label: typeof flags.label === "string" ? flags.label : undefined,
        });
        log(formatReport(report));
        return (report.regressions.length > 0 || report.overflowViewports.length > 0) &&
          flags.strict === true
          ? 1
          : 0;
      }

      case "watch": {
        assertStandaloneWatch();
        const cancellation = abortOnSignals();
        try {
          const mcp = await withLiveOperation(config, "watch attach", () => requireRunning(config));
          log("Watching doodlebot source; finite build/copy/reload cycles. Ctrl-C to stop.");
          await watchAndReload(mcp, config, {
            liveDir: liveDir(config),
            signal: cancellation.signal,
            onEvent: (event) => {
              switch (event.type) {
                case "watching":
                  for (const file of event.files) log("  watching " + file);
                  break;
                case "changed":
                  log(
                    "source changed: " + event.files.map((file) => path.basename(file)).join(", "),
                  );
                  break;
                case "building":
                  log("  building extension...");
                  break;
                case "reloaded":
                  log("  reloaded in " + String(event.elapsedMs) + "ms");
                  break;
                case "waiting":
                  log("  waiting for resources: " + event.message);
                  break;
                case "error":
                  log("  " + event.message);
                  break;
              }
            },
          });
          return cancellation.signal.aborted ? 130 : 0;
        } finally {
          cancellation.dispose();
        }
      }

      case "record": {
        const seconds = Number(flags.seconds ?? 15);
        if (
          !Number.isFinite(seconds) ||
          seconds < 1 ||
          seconds > 60 ||
          typeof flags.ffmpeg !== "string"
        ) {
          throw new ConfigError(
            "record requires --ffmpeg <executable> and --seconds between 1 and 60",
          );
        }
        await requireRunning(config);
        const recording = await startRecording(config, {
          encoder: flags.ffmpeg,
          label: typeof flags.label === "string" ? flags.label : "recording",
        });
        log(`Recording Vortex for ${seconds} seconds`);
        try {
          await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        } finally {
          log(await recording.stop());
        }
        return 0;
      }

      case "screenshot": {
        await requireRunning(config);
        const file = await captureScreenshot(config, {
          label: typeof flags.label === "string" ? flags.label : undefined,
          fullPage: flags["full-page"] === true,
        });
        log(file);
        return 0;
      }

      case "source": {
        // Everything needed to go from "just cloned this repo" to "can build and
        // test Vortex", in one command.
        if (flags.where === true) {
          log(vortexSourceDir());
          return 0;
        }

        if (!hasVortexSource() || flags.update === true) {
          if (!hasVortexSource()) {
            const user = await detectGitHubUser();
            log(`GitHub user: ${user ?? "(unknown)"}`);
            const repo = await resolveVortexRepo();
            log(`Fork:        ${repo.fullName}`);
          }
          const source = await ensureVortexSource({
            owner: config.owner,
            update: flags.update === true,
            onProgress: (m) => log(`  ${m}`),
          });
          log(source.cloned ? `Cloned to ${source.dir}` : `Using existing clone at ${source.dir}`);
        } else {
          log(`Clone already present at ${vortexSourceDir()}`);
        }

        if (flags.build !== false && flags["no-build"] !== true) {
          await buildVortexSource({ owner: config.owner, onProgress: (m) => log(`  ${m}`) });
        }

        log("");
        log("Ready. `pnpm run ai:up` will now drive this clone.");
        return 0;
      }

      case "collection": {
        const mcp = await requireRunning(config);
        const target = typeof flags.url === "string" ? flags.url : positional[0];
        if (target === undefined) {
          throw new ConfigError(`collection needs a collection to install, e.g.
  doodlebot collection https://next.nexusmods.com/fallout4/collections/<slug>`);
        }
        const result = await installCollection(mcp, target, {
          onProgress: (m) => log(`  ${m}`),
        });
        log("");
        log(`Installed collection ${result.ref.slug} (${result.ref.gameId})`);
        log(`  mod id: ${result.modId ?? "unknown"}`);
        log(
          `  required mods installed: ${String(result.modCount)}/${String(result.expectedModCount)}`,
        );
        if (!result.complete) {
          log("");
          log("  Not every required mod installed. `View failed mods` on the");
          log("  collection page says which, and its archive is usually already");
          log("  downloaded, so a retry from there does not re-fetch it.");
        }
        return result.complete ? 0 : 1;
      }

      case "deploy": {
        const mcp = await requireRunning(config);
        await deployMods(mcp, config.gameId, {
          allowForeignPurge: flags.purge === true,
          allowIncomplete: flags["allow-incomplete"] === true,
          onProgress: (m) => log(`  ${m}`),
        });
        const pending = await needsDeployment(mcp, config.gameId);
        log("");
        log(
          pending
            ? `${config.gameId} still reports undeployed changes.`
            : `Deployed ${config.gameId}.`,
        );
        return pending ? 1 : 0;
      }

      case "purge": {
        const mcp = await requireRunning(config);
        await purgeGame(mcp, { allowForeignPurge: true, onProgress: (m) => log(`  ${m}`) });
        log("");
        log(`Purged ${config.gameId}; the game directory is back to unmodded.`);
        return 0;
      }

      case "login-import": {
        const from =
          typeof flags.from === "string" ? flags.from : path.join(REPO_ROOT, "harness", ".cache");
        const source = importLogin(from, authCacheFile(config), flags.force === true);
        log(`Saved login imported from ${source} into ${config.cacheDir}.`);
        log("Takes effect on the next start (`up --fresh` or a restart).");
        return 0;
      }

      case "save-login": {
        const snapshot = await captureLogin(config, { context, onProgress: (m) => log(`  ${m}`) });
        log("");
        log("Login captured. `up --fresh` will now start already signed in.");
        log(`  ${snapshot}`);
        log("");
        log("Vortex was stopped to flush its state; bring it back with `doodlebot up`.");
        return 0;
      }

      case "e2e": {
        const target = typeof flags.url === "string" ? flags.url : positional[0];
        if (target === undefined) {
          throw new ConfigError("e2e needs a collection, e.g.\n  doodlebot e2e <collection url>");
        }
        const runs = typeof flags.runs === "string" ? Number.parseInt(flags.runs, 10) : 1;
        if (!Number.isInteger(runs) || runs < 1)
          throw new ConfigError("--runs must be a positive integer");

        const outcomes: boolean[] = [];
        for (let run = 1; run <= runs; run++) {
          log("");
          log(`=== run ${String(run)} of ${String(runs)} ===`);
          try {
            const result = await runE2e(config, {
              context,
              collection: target,
              fresh: flags.keep !== true,
              purge: flags.purge === true,
              skipLaunch: flags["no-launch"] === true,
              onProgress: (m) => log(m),
            });
            outcomes.push(result.ok);
            log(`run ${String(run)} PASSED in ${String(Math.round(result.elapsedMs / 1000))}s`);
          } catch (err) {
            outcomes.push(false);
            log(`run ${String(run)} FAILED: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const passed = outcomes.filter(Boolean).length;
        log("");
        log(`${String(passed)}/${String(runs)} runs passed`);
        return passed === runs ? 0 : 1;
      }

      case "eval": {
        const file = positional[0];
        const source =
          typeof flags.expr === "string"
            ? flags.expr
            : file !== undefined
              ? stripBom(fs.readFileSync(file, "utf8"))
              : undefined;
        if (source === undefined || source.trim() === "") {
          throw new ConfigError(
            'eval needs --expr "<expression>" or a file holding one, e.g.\n' +
              '  doodlebot eval --expr "document.title"\n' +
              "  doodlebot eval probe.js      (an async IIFE for statements)",
          );
        }
        try {
          const result = await evalInRenderer(config, source);
          log(JSON.stringify(result.value ?? null, null, 2));
          if (!result.rendererConfirmed) {
            process.stderr.write(
              "note: the renderer could not confirm its profile; the MCP server's check passed.\n",
            );
          }
        } catch (err) {
          if (err instanceof RendererEvalRefused) throw new ConfigError(err.message);
          throw err;
        }
        return 0;
      }

      case "script": {
        const file = positional[0];
        if (file === undefined) {
          throw new ConfigError("script needs a file: doodlebot script <file.mts> [its args...]");
        }
        const abs = path.resolve(file);
        if (!fs.existsSync(abs)) throw new ConfigError(`${abs} does not exist.`);
        const insideRepo = !path.relative(REPO_ROOT, abs).startsWith("..");
        if (!/\.(?:mts|mjs)$/.test(abs) && !insideRepo) {
          throw new ConfigError(
            `${path.basename(abs)}: name a script outside this repo .mts. tsx treats a .ts file ` +
              "with no ESM package.json above it as CommonJS, where top-level await and imports fail.",
          );
        }
        const kit = pathToFileURL(path.join(REPO_ROOT, "harness", "src", "kit.ts")).href;
        const owner = resolveOwner(config.owner);
        // --owner, --wait and the instance flags are the kit's wherever they appear (cliArgs.ts).
        log(`script: ${abs} as owner "${owner}" (VORTEX_AI_KIT=${kit})`);
        return runUnderLease({
          context,
          command: process.execPath,
          args: [tsxCli(), abs, ...passthrough],
          owner,
          // The running Vortex's checkout too, so nobody rebuilds it under the script.
          resources: attachedLeaseResources(config),
          purpose: `script ${path.basename(abs)}`,
          waitMs: (typeof flags.wait === "string" ? Number(flags.wait) : 0) * 60_000,
          shell: false,
          // The script's loadConfig() then sees the same instance this command was given.
          env: {
            VORTEX_AI_KIT: kit,
            VORTEX_AI_CACHE_DIR: config.cacheDir,
            VORTEX_AI_ARTIFACT_DIR: config.artifactDir,
            VORTEX_MCP_PORT: String(config.mcpPort),
            VORTEX_AI_CDP_PORT: String(config.cdpPort),
            VORTEX_MCP_TOKEN: config.mcpToken,
          },
          onWaiting: (err) => log(`Waiting for the lease:\n${err.message}\n`),
        });
      }

      case "build-extension": {
        const root = await ensureExtensionBuilt({ rebuild: true, owner: config.owner });
        log(`Built the extension at ${root}`);
        return 0;
      }

      default:
        log(`Unknown command "${command}".\n`);
        log(HELP);
        return 1;
    }
  };
  return LIVE_COMMANDS.has(command)
    ? withLiveOperation(config, command, dispatch, {
        context: inheritedOperation(requireNamedOwner(config.owner)),
      })
    : dispatch();
}

async function kitCommand(positional: string[], flags: ParsedArgs["flags"]): Promise<number> {
  const owner = resolveOwner(typeof flags.owner === "string" ? flags.owner : undefined);
  const minutes = (name: string): number | undefined => {
    if (typeof flags[name] !== "string") return undefined;
    const value = Number(flags[name]);
    if (!Number.isFinite(value) || value < 0) throw new ConfigError(`--${name} must be minutes.`);
    return value;
  };
  switch (positional[0]) {
    case "lock": {
      const result = await waitForLease(
        () => lockKit(owner, { ttlMinutes: minutes("ttl") }),
        (minutes("wait") ?? 0) * 60_000,
        (err) => log(`Waiting for the kit lock:\n${err.message}\n`),
      );
      log(
        `${result.joined ? "Renewed" : "Took"} the kit lock for "${owner}" until ` +
          `${result.lease.expiresAt ?? "released"}. Now: kit sync, edit, pnpm run ci, commit, ` +
          `kit push, kit unlock --acquisition ${result.lease.acquisitionId}.`,
      );
      return 0;
    }
    case "unlock": {
      const result = unlockKit(owner, {
        force: flags.force === true,
        acquisitionId: typeof flags.acquisition === "string" ? flags.acquisition : undefined,
        repo: REPO_ROOT,
      });
      log(
        result.released ? "Released the kit lock." : `Not released: ${result.reason ?? "unknown"}.`,
      );
      return result.released || result.reason === "not held" ? 0 : 1;
    }
    case "status":
    case undefined: {
      const holder = kitLockHolder();
      if (flags.json === true) {
        const state = readLease("kit");
        log(JSON.stringify(state === undefined ? [] : [state], null, 2));
        return 0;
      }
      log(holder === undefined ? "The kit lock is free." : `The kit lock is held by "${holder}".`);
      return 0;
    }
    case "renew": {
      if (typeof flags.acquisition !== "string")
        throw new ConfigError("kit renew requires --acquisition from kit status --json.");
      const lease = renewLease("kit", owner, flags.acquisition, minutes("ttl") ?? 30);
      log(`Renewed ${lease.acquisitionId} until ${lease.expiresAt}.`);
      return 0;
    }
    case "sync": {
      const sha = await syncKit({ owner, onProgress: (m) => log(`  ${m}`) });
      log(`The kit is at ${sha.slice(0, 9)}.`);
      return 0;
    }
    case "push": {
      const sha = await pushKit({ owner, onProgress: (m) => log(`  ${m}`) });
      log(
        `Pushed the kit at ${sha.slice(0, 9)}. Release the lock: kit unlock --owner ${owner} --acquisition <original-id>`,
      );
      return 0;
    }
    default:
      throw new ConfigError("kit takes lock, renew, unlock, status, sync or push.");
  }
}

async function worktreeCommand(positional: string[], flags: ParsedArgs["flags"]): Promise<number> {
  const name = positional[1];
  switch (positional[0]) {
    case "add": {
      if (name === undefined) throw new ConfigError("worktree add needs a name.");
      const worktree = await addWorktree({
        owner: requireNamedOwner(typeof flags.owner === "string" ? flags.owner : undefined),
        name,
        base: typeof flags.base === "string" ? flags.base : undefined,
        branch: typeof flags.branch === "string" ? flags.branch : undefined,
        ref: typeof flags.ref === "string" ? flags.ref : undefined,
        install: flags["no-install"] !== true,
        build: flags["no-build"] !== true,
        onProgress: (m) => log(`  ${m}`),
      });
      log(`
Worktree ${worktree.name} on ${worktree.branch ?? "a detached HEAD"}: ${worktree.dir}`);
      log(`  Run it:  pnpm run ai -- up --worktree ${worktree.name} --slot auto --owner <you>`);
      return 0;
    }
    case "list": {
      const worktrees = await listWorktrees();
      if (flags.json === true) log(JSON.stringify(worktrees, null, 2));
      else if (worktrees.length === 0) log("No worktrees. Make one with `worktree add <name>`.");
      else
        for (const w of worktrees)
          log(`${w.name}: ${w.branch ?? "(detached)"} at ${w.head.slice(0, 9)}  ${w.dir}`);
      return 0;
    }
    case "remove": {
      if (name === undefined) throw new ConfigError("worktree remove needs a name.");
      log(
        `Removed ${await removeWorktree(name, flags.force === true, requireNamedOwner(typeof flags.owner === "string" ? flags.owner : undefined))}; any branch it had is kept.`,
      );
      return 0;
    }
    default:
      throw new ConfigError("worktree takes add <name>, list or remove <name>.");
  }
}

async function leaseCommand(
  positional: string[],
  flags: ParsedArgs["flags"],
  passthrough: string[],
): Promise<number> {
  const text = (name: string): string | undefined =>
    typeof flags[name] === "string" ? flags[name] : undefined;
  const minutes = (name: string, fallback: number): number => {
    const raw = text(name);
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new ConfigError(`--${name} must be a number of minutes.`);
    }
    return value;
  };
  const owner =
    positional[0] === "status" ? resolveOwner(text("owner")) : requireNamedOwner(text("owner"));
  const checkout = text("checkout");
  // The instance of the slot (or cache) these flags pick, as every other command sees it.
  const instance = instanceResource(configFrom(flags).cacheDir);
  // `lease run` and `lease acquire` hold the instance and, with --checkout, that checkout too
  // (`acquire --checkout-only`: just the checkout).
  const resources =
    checkout === undefined
      ? [instance]
      : flags["checkout-only"] === true
        ? [checkoutResource(checkout)]
        : [instance, checkoutResource(checkout)];
  const onReclaim = (state: LeaseState): void =>
    log(
      `Reclaimed a stale ${state.lease.resource} lease from "${state.lease.owner}" (${state.reason}).`,
    );

  switch (positional[0]) {
    case "status": {
      const states = listLeases();
      log(flags.json === true ? JSON.stringify(states, null, 2) : formatLeaseStates(states));
      return 0;
    }
    case "acquire": {
      const pid = text("pid") === undefined ? undefined : Number(text("pid"));
      if (pid !== undefined && (!Number.isInteger(pid) || pid <= 0))
        throw new ConfigError("--pid must be a process id.");
      const ttl = minutes("ttl", 60);
      // All or nothing: refused one, none newly taken is left held.
      const results = await waitForLease(
        () =>
          acquireLeases(resources, owner, {
            mode: "explicit",
            purpose: text("purpose"),
            ttlMinutes: ttl,
            boundPid: pid,
          }),
        minutes("wait", 0) * 60_000,
        (err) =>
          log(`Waiting for the lease:
${err.message}
`),
      );
      for (const result of results) {
        if (result.reclaimed !== undefined) onReclaim(result.reclaimed);
        const until =
          result.lease.expiresAt === undefined
            ? "with no expiry"
            : `until ${result.lease.expiresAt}`;
        log(
          `${result.joined ? "Renewed" : "Acquired"} the ${result.lease.resource} lease for "${owner}" ${until}` +
            (pid === undefined ? "" : `, while pid ${String(pid)} runs`) +
            ".",
        );
      }
      log(
        `Renew by acquiring again; release everything "${owner}" holds with \`lease release --owner ${owner}\`.`,
      );
      return 0;
    }
    case "release": {
      // --checkout: that checkout only. Otherwise every lease the owner holds, instance and
      // checkouts alike, so one call ends a session.
      // `--force` with neither --owner nor --checkout clears the instance lease, whoever holds it.
      const one = (resource: string): ReleaseResult & { resource: string } => ({
        resource,
        ...releaseLease(resource, owner, { force: flags.force === true }),
      });
      const released: Array<ReleaseResult & { resource: string }> =
        checkout !== undefined
          ? [one(checkoutResource(checkout))]
          : flags.force === true && text("owner") === undefined
            ? [one(instance)]
            : releaseOwnerLeases(owner, { force: flags.force === true });
      if (released.length === 0) {
        log(`"${owner}" holds no leases.`);
        return 0;
      }
      let code = 0;
      for (const result of released) {
        const { resource } = result;
        if (!result.released) {
          log(`${resource}: not released: ${result.reason ?? "unknown"}.`);
          if (result.reason !== "not held") code = 1;
        } else if (result.keptForRunning === true) {
          log(
            `${resource}: released your hold, but it stays locked while Vortex (pid ` +
              `${result.stillRunning.join(", ")}) runs from it. \`down\` ends that; --force clears it.`,
          );
        } else {
          log(`${resource}: released.`);
          if (result.stillRunning.length > 0) {
            log(
              `  A harness Vortex (pid ${result.stillRunning.join(", ")}) is still running; the next ` +
                "owner's up or down will stop it. Run `down` first to stop it yourself.",
            );
          }
        }
      }
      return code;
    }
    case "run": {
      const [cmd, ...args] = passthrough;
      if (cmd === undefined) {
        throw new ConfigError(
          "lease run needs a command after --, e.g. lease run --owner qa -- pnpm run verify",
        );
      }
      return runUnderLease({
        command: cmd,
        args,
        owner,
        resources,
        purpose: text("purpose"),
        waitMs: minutes("wait", 0) * 60_000,
        onWaiting: (err) => log(`Waiting for the lease:\n${err.message}\n`),
        onReclaim,
      });
    }
    default:
      throw new ConfigError(
        "lease needs acquire, release, status or run. See help, or harness/AGENTS.md.",
      );
  }
}

function targetFrom(flags: ParsedArgs["flags"]): Record<string, unknown> {
  if (typeof flags.ref === "string") return { ref: flags.ref };
  if (typeof flags.selector === "string") return { selector: flags.selector };
  throw new ConfigError("Provide --ref <e12> (from `doodlebot snapshot`) or --selector <css>.");
}

/** tsx's CLI in this repo's node_modules, run with this Node. */
function tsxCli(): string {
  try {
    return createRequire(import.meta.url).resolve("tsx/cli");
  } catch {
    return path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  }
}

function parseViewports(
  value: string | boolean | undefined,
): { width: number; height: number }[] | undefined {
  if (typeof value !== "string") return undefined;
  return value.split(",").map((pair) => {
    const [w, h] = pair.trim().split("x");
    const width = Number(w);
    const height = Number(h);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new ConfigError(`Bad viewport "${pair}" — expected WIDTHxHEIGHT, e.g. 1280x800.`);
    }
    return { width, height };
  });
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    // A ConfigError is a message written for a human to act on — print it as-is
    // rather than burying the instructions under a stack trace.
    if (err instanceof ConfigError) {
      process.stderr.write(`\n${err.message}\n\n`);
    } else {
      process.stderr.write(
        `\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
    }
    process.exitCode = 1;
  });
