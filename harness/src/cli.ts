#!/usr/bin/env -S node --experimental-strip-types
/**
 * `doodlebot` — the companion's command line, run through bin/doodlebot.cjs (the `doodlebot`
 * shim) by the doodlebot plugin's commands.
 *
 * An agent runs `up` to get a driven Vortex running, then drives that instance over MCP or
 * with the one-shot commands here (`snapshot`, `click`, `call`, ...), and comes back for what
 * MCP cannot do (start a process, rebuild a bundle, run a suite). commands.ts lists every
 * command; commands.test.ts keeps that list and this dispatcher equal.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { ANONYMOUS, bootstrap, liveDir, readMarker, snapshotDir } from "./bootstrap";
import { parseArgs, type ParsedArgs } from "./cliArgs";
import {
  ConfigError,
  REPO_ROOT,
  SUITE_CHECKOUT_ENV,
  TARGET_EXE_ENV,
  loadConfig,
  requireCheckout,
  resolveTarget,
  resolveTargetSafely,
  vortexCheckoutOf,
  type ConfigOverrides,
  type HarnessConfig,
} from "./config";
import { runDoctor, formatDoctorReport } from "./doctor";
import { parseJson, stripBom } from "./jsonFile";
import { RendererEvalRefused, evalInRenderer } from "./rendererEval";
import { watchAndReload } from "./hotReload";
import { abortOnSignals, callerCwd, runInteractive, tsxCli } from "./processRunner";
import { ensureExtensionBuilt, stopRunningInstance } from "./instance";
import { VortexMcpClient } from "./mcpClient";
import { requireRunning } from "./runningProfile";
import { formatReport, runResponsiveSweep, viewportList } from "./responsive";
import { attachToRenderer, captureScreenshot, type RendererHandle } from "./cdp";
import { startRecording } from "./recording";
import {
  formatPullRequestChecks,
  inspectPullRequestChecks,
  pullRequestChecksPassed,
} from "./prChecks";
import { PreflightError, formatPreflightReport, runPreflight } from "./prPreflight";
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
import { bethesdaSandboxConfig } from "./bethesdaSandbox";
import { installLocalMod } from "./localMod";
import { runSlowDownloads } from "./slowDownload";
import { installCollection } from "./collections";
import { deployMods, needsDeployment, purgeGame } from "./deployment";
import { runE2e } from "./e2e";
import { versionCommand } from "./versionCommand";
import { formatLink, link } from "./linkCommand";
import { testCommand } from "./testCommand";
import { fixtureCommand } from "./fixtureCommand";
import { knowledgeCommand } from "./knowledgeCommand";
import { logCommand, vortexLogFile } from "./logCommand";
import { perfSummaryCommand } from "./perfSummary";
import { gameCommand } from "./gameCommand";
import { inventoryCommand } from "./inventory";
import { qaCommand } from "./qaCatalog";
import { cleanCommand } from "./diskUse";
import { checkCommand } from "./checkCommand";
import { recordCollection } from "./content";
import { releaseCli, windowsProductVersion } from "./releaseFetch";
import { assertNoHarnessVortex, runningVortex } from "./runningVortex";
import { settlePendingRestores } from "./userFolders";
import { waitForCollectionCompletion } from "./collectionCompletion";
import {
  NO_FORK_NOTE,
  cloneVortex,
  commandEnv,
  detectGitHubUser,
  formatPrepared,
  prepareCheckout,
  resolveVortexRepo,
} from "./source";
import { sourceBuildIsCurrent } from "./productionMode";
import { gapCommand } from "./gapCommand";
import { IssuesDisabledError } from "./share";
import { pushSessionBranch } from "./prPush";

/** Commands that launch Vortex: an unbuilt session checkout refuses instead of falling back. */
const LAUNCHES = new Set(["up", "bootstrap", "setup"]);

/**
 * The configuration the flags select. Without a target flag the session's checkout (the Vortex
 * checkout holding the caller's folder) comes first. An explicit `--dev-dir` that is not a built
 * checkout throws its ConfigError, as does an unbuilt session checkout for a launch, except for
 * `doctor`, which reports it as its failing Vortex check (`targetError`) against an empty
 * installed target.
 */
function configFrom(
  flags: ParsedArgs["flags"],
  command: string,
): { config: HarnessConfig; targetError?: string; sessionCheckout?: string | null } {
  const overrides: ConfigOverrides = {};
  let targetError: string | undefined;
  /** The session's checkout when probed: null for none, undefined when a flag named the target. */
  let sessionCheckout: string | null | undefined;
  if (typeof flags.game === "string") overrides.gameId = flags.game;
  if (typeof flags["game-path"] === "string") overrides.gamePath = flags["game-path"];
  const devDir = typeof flags["dev-dir"] === "string" ? flags["dev-dir"] : undefined;
  const release = typeof flags.release === "string" ? flags.release : undefined;
  if (
    devDir !== undefined ||
    typeof flags.exe === "string" ||
    flags.installed === true ||
    release !== undefined
  ) {
    try {
      overrides.target = resolveTargetSafely({
        devDir,
        exe: typeof flags.exe === "string" ? flags.exe : undefined,
        preferInstalled: flags.installed === true,
        ...(release === undefined ? {} : { release }),
      });
    } catch (error) {
      if (!(error instanceof ConfigError) || command !== "doctor") throw error;
      targetError = error.message;
      overrides.target = { kind: "installed", executable: "", args: [], appName: "Vortex" };
    }
  } else {
    // The session's checkout, probed once (doctor reports it as well).
    sessionCheckout = vortexCheckoutOf(callerCwd()) ?? null;
    try {
      overrides.target = resolveTarget({ cwd: callerCwd(), checkout: sessionCheckout });
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      // A launch from an unbuilt session checkout refuses with the build command, rather than
      // quietly starting the installed Vortex instead; doctor reports it as its Vortex check. A
      // command that launches nothing talks to the running instance, so an unbuilt checkout is
      // not its concern: it gets the empty installed target (loadConfig would refuse it).
      if (LAUNCHES.has(command)) throw error;
      if (command === "doctor" && sessionCheckout !== null) targetError = error.message;
      overrides.target = { kind: "installed", executable: "", args: [], appName: "Vortex" };
    }
  }
  if (typeof flags.port === "string") overrides.mcpPort = Number(flags.port);
  if (typeof flags["cdp-port"] === "string") overrides.cdpPort = Number(flags["cdp-port"]);
  if (typeof flags["cache-dir"] === "string") overrides.cacheDir = path.resolve(flags["cache-dir"]);
  if (flags.headless === true) overrides.headless = true;
  if (flags.production === true) overrides.production = true;
  const config = loadConfig(overrides);
  if (flags.sandbox === true && flags["bethesda-sandbox"] === true) {
    throw new ConfigError("Choose one of --sandbox and --bethesda-sandbox.");
  }
  const keepKey = flags["with-api-key"] === true;
  const result = (chosen: HarnessConfig) => ({
    config: chosen,
    ...(targetError === undefined ? {} : { targetError }),
    ...(sessionCheckout === undefined ? {} : { sessionCheckout }),
  });
  if (flags["bethesda-sandbox"] === true) {
    return result(localOnlyConfig(bethesdaSandboxConfig(config), keepKey));
  }
  return result(flags.sandbox === true ? localOnlyConfig(sandboxConfig(config), keepKey) : config);
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** A client for an instance someone else started — the normal case for one-shots. */
function clientFor(config: HarnessConfig): VortexMcpClient {
  return new VortexMcpClient({ port: config.mcpPort, token: config.mcpToken });
}

const HELP = `doodlebot — the agent companion for Vortex: automation for stock Vortex and Vortex development

Used from Claude Code or Codex through the doodlebot plugin, whose eight commands
(/doodlebot:setup, try, prototype, investigate, fix, qa, measure and pr) run these.

The companion itself
  version [--json]       This workspace's version, commit and path
  link [--bin-dir <dir>] Write the doodlebot shims into a folder on the PATH
  update --ref <ref>     Move this workspace to a tag or branch of origin, then install
                         and build (refuses while a harness Vortex runs or with local changes)

Initial account setup (only for Nexus collections)
  setup --oauth          Open isolated Vortex, wait for browser login, cache OAuth
                         automatically, verify credentials survive a fresh start
    --no-wait            Return with login pending; finish with save-login
  auth-status            Print presence booleans only; never print credentials
  save-login             Verify OAuth, stop cleanly, capture the current baseline
                         The login is one file, ~/.doodlebot/login/oauth-<target>.json,
                         used directly by the default cache only; other caches are
                         signed out. Nothing copies it. Lost or expired: setup --oauth

Instance lifecycle
  doctor                 Report prerequisites and actionable fixes
  check [--json]         The read-only status table /doodlebot:setup --check prints: the
                         workspace, doctor, EGM, this session's Vortex checkout, the
                         inventory, the login, the copy folder, pending restores, open kit
                         gaps, local lessons KNOWLEDGE.md now holds, and disk use (warns
                         below 10 GB free); a Vortex clone an older doodlebot kept in the
                         workspace is reported with its worktrees, never deleted
  up                     Start/restart the matching working profile
    --fresh              Reset working state from its baseline; reuse current OAuth
    --no-game            Global UI without managing a game
    --rebuild-snapshot   Rebuild baseline with current OAuth cache
    --rebuild-extension  Force extension build
    --stale-ok           Launch a source build whose build record no longer matches its
                         checkout, and say so (otherwise refused, naming a changed file);
                         a build with no record is launched with a warning
  bootstrap              Build/reset baseline and launch (--no-game, --stale-ok supported)
  down                   Quit the recorded harness Vortex (any cache), wait for clean exit,
                         then restore the game's user folders and the nxm link handler
  status                 Show endpoint and profile cache status

Game copies and released builds (registered in ~/.doodlebot/content.json)
  game copy <gameId> [--to <folder>] [--new]
                         Copy the Steam install into <folder>/<gameId> and register it;
                         reuses a registered copy of the same version unless --new
  game register <gameId> <dir>
                         Register an existing copy (never a store install)
  game restore <gameId>  List the user-folder files changed since the last backup;
    --all | --keep | --file <path>   restore them all, keep them all, or restore some
  game folder [<dir>]    Store the folder game copy copies into (asked once); without a
                         folder, print the stored one
  release get <version>  Download an official release, check its published SHA-256 and
                         extract it with 7-Zip into ~/.doodlebot/releases (never runs
                         the installer); use it with --release <version>
  release list [--json]  The registered releases
  inventory [--json]     What doodlebot can test against (builds, games, snapshots,
                         sandboxes, collections, login); each item not ready names the
                         exact command that makes it ready. Reads only; never launches
    --need <need>        Repeatable: instead, the content chosen for these needs (sandbox,
                         sandbox:fallout4, game, game:<id>, collection, collection:offline,
                         collection:nexus, login): each item with its flag and why, or each
                         unmet need with the command that meets it
  clean [--older-than <days>] [--dry-run] [--yes]
                         List what disk use to free (default 30 days): binaries in old
                         run, QA and benchmark folders (each report.md and files under
                         1 MB stay), unused baselines and caches, releases content.json
                         no longer names, and the Vortex clone older kits kept in the
                         workspace (no longer used); deletes only with --yes. Never
                         touches game copies, the login, pending restores or the running
                         instance
  source                 Prepare this session's Vortex checkout (the one holding the folder
                         you run doodlebot in, or --dev-dir): refuse an upstream remote
                         that is not Nexus-Mods/Vortex (changing nothing), report origin,
                         install with its pinned pnpm and build it; reports the rest
    --add-upstream       Add Nexus-Mods/Vortex as upstream when it is missing
    --exclude            Add .doodlebot/ and .claude/worktrees/ (the Claude desktop app's
                         worktrees) to $(git rev-parse --git-common-dir)/info/exclude,
                         which every worktree of the checkout shares
    --clone <dir>        Clone your fork (origin) and Nexus-Mods/Vortex (upstream) into
                         <dir>, outside the workspace; without a fork, clone upstream alone
                         (enough to build and test; pushing needs a fork). No default
    --update             Fetch every remote of the checkout
    --branch <name>      Cut a new work branch from upstream/<default branch>
    --no-build           Skip install and build
    --where              Print the session's checkout
  push-branch            Push the session's branch (the one /doodlebot:pr opens the PR from)
                         to origin with -u, after the same fork check. Refuses a detached
                         HEAD, a proto/* prototype branch (never shipped) and the default
                         branch
    --checkout <dir>     Vortex checkout (default: this session's)
  pr-checks <pr>         Diagnose current GitHub checks and their failed steps
    --repo <owner/name>  Repository to inspect (default: Nexus-Mods/Vortex)
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
                         measurements in comments, branch (a proto/* branch fails), PR
                         description
    --checkout <dir>     Vortex checkout (default: this session's)
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
  build                  Build a Vortex checkout with its pinned pnpm:
    --checkout <dir>     (default: this session's checkout)
    --production         NODE_ENV=production for the build only (else NODE_ENV unset);
                         etc/vortex.api.md and etc/Dependency Report.md are put back if
                         the build rewrote them. Refuses while a Vortex runs from it.
                         A successful build writes the build record,
                         $(git rev-parse --git-dir)/doodlebot-build.json (HEAD, a hash of
                         the working-tree changes, the mode), which up checks

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
                         Run a scratch script with the kit's tsx. The instance flags
                         (--dev-dir, --cache-dir, --port, --cdp-port) are the kit's anywhere,
                         even after the file; every other argument (and all after --) is the
                         script's.
                         VORTEX_AI_KIT holds the import URL of harness/src/kit.ts
  record                 Save WebM; --ffmpeg <path> --seconds <1-60> --label <name>
  install <archive>      Install local ZIP/7z through Vortex; no account needed. Takes one
                         path: quote one with spaces, or a split path is refused
  slow-download          Real Vortex downloads of throttled local files, for download UI
                         work; returns once they finish (run it in the background)
    --count <n> --seconds <n> --stagger <s>   (defaults 1, 30, 0)
  collection <url>       Install exact Nexus collection/revision using OAuth
    --warnings-as-errors Fail on any collection warning; warnings are printed by default
  deploy                 Deploy enabled mods for the active game
    --purge              Permit purging a foreign deployment in a disposable game
  purge                  Remove files recorded in this game's deployment manifest
  e2e <collection>       Fresh start, install, verify, deploy, launch real game
    --runs <n> --keep --purge; --no-launch for installation/deployment only
  log                    The running instance's Vortex log, filtered
    --level info|warn|error  Lowest level kept (default warn); Vortex's INFO, WARN
                         and ERRO codes rank as info, warn and error
    --tail <n>           Last n entries (default 50)
    --since <ISO time>   Entries at or after this time
    --json               LogEntry[] with continuation lines in each message
  fixture mod --out <zip> [--name <text>]
                         A one-file mod archive (textures/<name>.txt) for install checks
  fixture fomod --out <zip> [--name <text>]
                         A FOMOD installer archive (one step, one option), so install
                         opens Vortex's installer dialog

Knowledge (lessons verified on this machine, in ~/.doodlebot/knowledge.md)
  knowledge search <words...> [--json]
                         Local lessons and the workspace's KNOWLEDGE.md holding every word
  knowledge add --title <t> --area <a> --symptom <s> --cause <c> --remedy <r>
                --scope <s> --evidence <e> --vortex <version> [--third-party <text>] [--json]
                         Record a lesson whose cause you checked (never credentials)
  knowledge note <id> <text>   Append a dated note, e.g. "does not hold on <version>"
  knowledge list [--json] | knowledge remove <id> | knowledge path
                         --json (list, search): each lesson's fields at the top level
  knowledge share <id>   Print the redacted lesson for a GitHub issue on
                         doodlum/vortex-doodlebot; publishes nothing without --yes. When
                         the repository has issues disabled, prints the text and the
                         reason, creates nothing and exits 2
    --yes                Publish (after the person confirmed the printed text); an open
                         issue with the same title gets a comment instead
    --print              Only the text, to paste into an issue by hand (no gh)
    --include-third-party  Include data marked third-party (confirmed separately)
    --nexus-user <name>  Your Nexus user name, redacted too (or VORTEX_AI_NEXUS_USER)

Kit gaps (what the kit should have done and didn't, in ~/.doodlebot/gaps.md)
  gap add --title <t> --command <c> --needed <x> --happened <x> --blocked yes|no
          [--workaround <x>] [--third-party <text>] [--json]
                         Same command and title: counts it again; a wontfix gap is not
                         recorded; a gap closed --by a commit re-opens only when this kit
                         contains that commit
  gap list [--all] [--json]    Open gaps (--all: closed too; --json always lists all, each
                               gap's fields at the top level: command, status, ...)
  gap close <id> --by <commit> | --wontfix
  gap share <id> [--yes] [--print] [--include-third-party]   As knowledge share

Testing and iteration
  test <suite> [args...] Run a suite or check from the workspace root; every argument after
                         the suite is the suite's (core: Playwright's), except the kit's
                         --release <version> and --stale-ok. A source checkout (--dev-dir,
                         else the session's) must be built and current before it starts
  test --list            List the suites (also test --help or test -h)
  qa list [--touching <paths...>] [--allow-logout] [--json]
                         The QA catalogue (harness/qa/catalog.json): checks Vortex's own
                         e2e suite lacks. With --touching (paths relative to the Vortex
                         root), the entries whose guards match, the others with the
                         reason, and the files no entry guards. --json gives each selected
                         entry its content (the inventory items chosen for its needs, or
                         each unmet need with the command that meets it) and its verdict
                         rule. --allow-logout also selects entries that log out of the
                         account (only with the person's go-ahead)
  qa check               Validate the catalogue; in a Vortex checkout, also list specs added
                         since its recorded commit and guards that match no file (outside
                         one, that comparison is skipped and the output says so)
  perf-summary --check <check> --a <file> [--a <file>...] [--b <file>...] [--out <md>] [--json]
                         Medians, ranges and a verdict from performance-check evidence; one
                         side (no --b) has no verdict
  responsive             Scan width AND height changes; persist JSON evidence
    --viewports 1024x720,1280x720,1280x1080,1920x1080   (quote the list in PowerShell)
    --screenshots        Save PNG per viewport
    --strict             Nonzero exit for viewport-dependent findings or overflow
  watch                  Watch doodlebot source; finite build/copy/reload cycles
  build-extension        Force extension build

Target and isolation (repeat the same flags for all commands)
  --installed            Use released Vortex even in a Vortex checkout
  --exe <path>           Explicit Vortex.exe
  --release <version>    A release registered by release get
  --dev-dir <path>       Explicit source checkout
  --sandbox              Disposable test game for local install/deploy tests
  --bethesda-sandbox     Fake Fallout 4 (plugins, LOOT, masters); no game install needed.
                         The real Fallout 4 user folders are backed up and restored at down
  --with-api-key         Seed harness/.env's API key into a sandbox profile too (off by
                         default: with a key, every local install waits on a Nexus lookup)
  --game <id> --game-path <dir>   Real game integration: a registered copy only
  --cache-dir <dir>      Profiles and private OAuth cache
  --port <n> --cdp-port <n>      MCP/CDP endpoints (3701/9222 by default)
  --headless             Hide the window; screenshots/layout may differ
  --production           Run a source build as releases run (production React);
                         use for any timing meant to reflect users' experience.
                         up fails unless the renderer loaded production React

Without a target flag: this session's Vortex checkout (the git top level holding the folder you
run doodlebot in, when its package.json is @vortex/monorepo; a worktree counts), otherwise the
installed Vortex. build, source (except --clone), push-branch and pr-preflight
need a checkout:
outside one they refuse.
Relative paths you type are yours: they resolve against the directory you run doodlebot in.
For Vortex changes follow its contribution rules and task-specific documentation.
`;
async function main(): Promise<number> {
  const commandLine = process.argv.slice(2);
  const argv = commandLine[0] === "--" ? commandLine.slice(1) : commandLine;
  const parsed = parseArgs(argv);
  const { command, flags, positional, lists, passthrough } = parsed;

  // `doodlebot test --help` (or `-h`) lists the suites; testCommand handles it.
  if (command === "help" || (flags.help === true && command !== "test")) {
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
        checkout: checkoutFlag(flags),
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
      });
    } catch (err) {
      if (err instanceof PreflightError) throw new ConfigError(err.message);
      throw err;
    }
    log(flags.json === true ? JSON.stringify(report, null, 2) : formatPreflightReport(report));
    return report.passed ? 0 : 1;
  }

  if (command === "build") {
    const checkout = checkoutFlag(flags);
    const report = await buildCheckout({
      checkout,
      production: flags.production === true,
      onProgress: (message) => log(`[build] ${message}`),
    });
    log(
      `[build] exit ${String(report.exitCode)} after ${String(Math.round(report.elapsedMs / 1000))}s; ` +
        `renderer bundle: ${report.bundleMode}` +
        (report.restored.length > 0 ? `; restored ${report.restored.join(", ")}` : "") +
        (report.record === undefined ? "" : `; build record ${report.record}`),
    );
    if (report.exitCode === 0 && flags.production === true && report.bundleMode !== "production") {
      log(
        "[build] warning: --production was given but the renderer bundle still reads as a " +
          "development build (productionMode.ts). Check the build's output above.",
      );
    }
    return report.exitCode === 0 ? 0 : 1;
  }

  if (command === "version") {
    log(versionCommand(flags));
    return 0;
  }

  if (command === "link") {
    const result = link(typeof flags["bin-dir"] === "string" ? { binDir: flags["bin-dir"] } : {});
    log(formatLink(result));
    return 0;
  }

  if (command === "test") {
    return testCommand(positional, flags, passthrough);
  }

  if (command === "fixture") {
    log(fixtureCommand(positional, flags));
    return 0;
  }

  if (command === "knowledge" || command === "gap") {
    try {
      log(command === "gap" ? gapCommand(positional, flags) : knowledgeCommand(positional, flags));
      return 0;
    } catch (err) {
      // share on a repository without issues: the text and the reason on stdout, exit 2.
      if (!(err instanceof IssuesDisabledError)) throw err;
      log(err.output);
      return err.exitCode;
    }
  }

  if (command === "push-branch") {
    const { branch, fork } = pushSessionBranch(checkoutFlag(flags));
    log(`pushed ${branch} to ${fork}`);
    return 0;
  }

  if (command === "perf-summary") {
    log(perfSummaryCommand(flags, lists));
    return 0;
  }

  if (command === "game") {
    if (positional[0] === "restore") assertNoHarnessVortex("restoring user folders");
    const result = await gameCommand(positional, flags, lists, {
      fileVersion: windowsProductVersion,
    });
    log(result.text);
    return result.code;
  }

  if (command === "release") {
    log(await releaseCli(positional, flags));
    return 0;
  }

  if (command === "inventory") {
    log(inventoryCommand(flags, {}, lists));
    return 0;
  }

  if (command === "qa") {
    const vortexDir = vortexCheckoutOf(callerCwd());
    const result = qaCommand(
      positional,
      flags,
      lists,
      vortexDir === undefined ? {} : { vortexDir },
    );
    log(result.text);
    return result.code;
  }

  if (command === "check") {
    // Doctor for the installed target and the sandbox unless the person named others.
    const targeted = ["installed", "exe", "dev-dir", "release"].some((name) => name in flags);
    const gamed = ["sandbox", "bethesda-sandbox", "game", "no-game"].some((name) => name in flags);
    const doctorFlags = {
      ...flags,
      ...(targeted ? {} : { installed: true }),
      ...(gamed ? {} : { sandbox: true }),
    };
    log(
      await checkCommand(flags, {
        doctor: async () => {
          const { config, targetError, sessionCheckout } = configFrom(doctorFlags, "doctor");
          const report = await runDoctor(config, {
            skipGame: flags["no-game"] === true,
            ...(targetError === undefined ? {} : { targetError }),
            ...(sessionCheckout === undefined ? {} : { checkout: sessionCheckout ?? undefined }),
          });
          return report.checks;
        },
      }),
    );
    return 0;
  }

  if (command === "clean") {
    const result = cleanCommand(flags);
    log(result.text);
    return result.code;
  }

  const { config, targetError, sessionCheckout } = configFrom(flags, command);
  const dispatch = async (): Promise<number> => {
    switch (command) {
      case "log": {
        const mcp = await requireRunning(config);
        const status = await mcp.call<{ userDataDir: string }>("automation_status");
        log(logCommand(vortexLogFile(status.userDataDir), flags));
        return 0;
      }
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
          skipGame: flags.oauth === true || flags["no-game"] === true,
          onProgress: log,
        });
        if (flags.oauth !== true) {
          log(`Ready: ${result.instance.mcp.url}. Use snapshot or call to drive it.`);
          return 0;
        }
        const auth = await result.instance.mcp.call<AuthStatus>("nexus_auth_status");
        if (auth.oauthPresent && auth.oauthRefreshable) {
          await captureLogin(config, { onProgress: log });
          const restored = await bootstrap(config, {
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
          log("Then run `doodlebot save-login` with these same configuration flags.");
          return 0;
        }
        log("Waiting up to 10 minutes; OAuth login will be cached automatically.");
        await waitForOAuth(result.instance.mcp);
        await captureLogin(config, { onProgress: log });
        const restored = await bootstrap(config, {
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
        const report = await runDoctor(config, {
          skipGame: flags["no-game"] === true,
          ...(targetError === undefined ? {} : { targetError }),
          ...(sessionCheckout === undefined ? {} : { checkout: sessionCheckout ?? undefined }),
        });
        log(formatDoctorReport(report));
        return report.ok ? 0 : 1;
      }

      case "bootstrap": {
        const result = await bootstrap(config, {
          skipGame: flags["no-game"] === true,
          rebuildSnapshot: flags["rebuild-snapshot"] === true,
          rebuildExtension: flags["rebuild-extension"] === true,
          staleOk: flags["stale-ok"] === true,
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
          fresh: flags.fresh === true,
          rebuildSnapshot: flags["rebuild-snapshot"] === true,
          skipGame: flags["no-game"] === true,
          rebuildExtension: flags["rebuild-extension"] === true,
          staleOk: flags["stale-ok"] === true,
          onProgress: (m) => log(`  ${m}`),
        });
        log(
          `\nVortex is up in ${String(Math.round(result.elapsedMs / 1000))}s (${result.tier} start).`,
        );
        log(`  MCP:  ${result.instance.mcp.url}`);
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
        const live = runningVortex() !== undefined;
        const stopped = await stopRunningInstance(config);
        log(stopped ? "Vortex exited cleanly." : "Nothing is running.");
        // After the confirmed exit, the run's user folders go back; after an unclean end the
        // changed files are listed for `game restore` instead.
        await settlePendingRestores({ clean: live || stopped, write: log });
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
        const cancellation = abortOnSignals();
        try {
          const mcp = await requireRunning(config);
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
        // A new checkout: cloned into the folder the person named, never into the workspace.
        if (typeof flags.clone === "string") {
          const user = await detectGitHubUser();
          log(`GitHub user: ${user ?? "(unknown)"}`);
          const repo = await resolveVortexRepo();
          log(`Fork:        ${repo?.fullName ?? "(none; cloning upstream)"}`);
          const source = await cloneVortex(flags.clone, {
            resolveRepo: async () => repo,
            onProgress: (m) => log(`  ${m}`),
          });
          if (!source.hasFork) log(`  ${NO_FORK_NOTE}`);
          log("");
          log(
            `Open Claude in ${source.dir}. The first command that needs a build there (/doodlebot:try, fix, qa or prototype) prepares it.`,
          );
          return 0;
        }

        const checkout = checkoutFlag(flags);
        if (flags.where === true) {
          log(checkout);
          return 0;
        }
        const prepared = await prepareCheckout({
          checkout,
          addUpstream: flags["add-upstream"] === true,
          exclude: flags.exclude === true,
          update: flags.update === true,
          ...(typeof flags.branch === "string" ? { branch: flags.branch } : {}),
          build: flags.build !== false && flags["no-build"] !== true,
          onProgress: (m) => log(`  ${m}`),
          upToDate: sourceBuildIsCurrent,
          runBuild: (dir) =>
            buildCheckout({
              checkout: dir,
              production: false,
              onProgress: (message) => log(`  [build] ${message}`),
            }),
        });
        log("");
        log(formatPrepared(prepared));
        return prepared.build === "failed" ? 1 : 0;
      }

      case "collection": {
        const mcp = await requireRunning(config);
        const target = typeof flags.url === "string" ? flags.url : positional[0];
        if (target === undefined) {
          throw new ConfigError(`collection needs a collection to install, e.g.
  doodlebot collection https://next.nexusmods.com/fallout4/collections/<slug>`);
        }
        let renderer: RendererHandle | undefined;
        let result;
        let installFailed = false;
        let rendererCleanupFailure: { error: unknown } | undefined;
        try {
          result = await installCollection(mcp, target, {
            warningsAsErrors: flags["warnings-as-errors"] === true,
            onWarning: (warning) =>
              log(
                `  Warning [${warning.source}; original ${warning.originalSeverity}]: ${warning.message}`,
              ),
            onProgress: (m) => log(`  ${m}`),
            verifyCompletion: async (modId, timeoutMs) => {
              renderer = await attachToRenderer(config);
              await waitForCollectionCompletion(renderer.page, modId, {
                timeoutMs,
                onObservation: () => undefined,
              });
            },
          });
        } catch (error) {
          installFailed = true;
          throw error;
        } finally {
          try {
            await renderer?.close();
          } catch (error) {
            rendererCleanupFailure = { error };
            if (installFailed)
              log(
                `  Renderer cleanup also failed: ${error instanceof Error ? error.message : String(error)}`,
              );
          }
        }
        if (rendererCleanupFailure) throw rendererCleanupFailure.error;
        // Recorded so content choice (inventory) and `test nexus` can use it later.
        if (result.complete) recordCollection(result.ref);
        log("");
        log(`Installed collection ${result.ref.slug} (${result.ref.gameId})`);
        if (result.warnings.length > 0) log(`  Passed with ${result.warnings.length} warning(s)`);
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

      case "save-login": {
        const snapshot = await captureLogin(config, { onProgress: (m) => log(`  ${m}`) });
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
        // The script runs in the caller's directory, so a relative path is read from there too.
        const cwd = callerCwd();
        const abs = path.resolve(cwd, file);
        if (!fs.existsSync(abs)) throw new ConfigError(`${abs} does not exist.`);
        const insideRepo = !path.relative(REPO_ROOT, abs).startsWith("..");
        if (!/\.(?:mts|mjs)$/.test(abs) && !insideRepo) {
          throw new ConfigError(
            `${path.basename(abs)}: name a script outside this repo .mts. tsx treats a .ts file ` +
              "with no ESM package.json above it as CommonJS, where top-level await and imports fail.",
          );
        }
        const kit = pathToFileURL(path.join(REPO_ROOT, "harness", "src", "kit.ts")).href;
        // The instance flags are the kit's wherever they appear (cliArgs.ts).
        log(`script: ${abs} (VORTEX_AI_KIT=${kit})`);
        return runInteractive(process.execPath, [tsxCli(), abs, ...passthrough], {
          cwd,
          // The script's loadConfig() then sees the same instance this command was given.
          env: {
            ...commandEnv(cwd),
            VORTEX_AI_KIT: kit,
            VORTEX_AI_CACHE_DIR: config.cacheDir,
            VORTEX_AI_ARTIFACT_DIR: config.artifactDir,
            VORTEX_MCP_PORT: String(config.mcpPort),
            VORTEX_AI_CDP_PORT: String(config.cdpPort),
            VORTEX_MCP_TOKEN: config.mcpToken,
            // The target this command chose is named explicitly, so the script's loadConfig()
            // never re-resolves it from the caller's folder (an unbuilt worktree would refuse).
            ...(config.target.kind === "dev" && config.target.sourceDir !== undefined
              ? { [SUITE_CHECKOUT_ENV]: config.target.sourceDir }
              : config.target.executable !== ""
                ? { [TARGET_EXE_ENV]: config.target.executable }
                : {}),
          },
        });
      }

      case "build-extension": {
        const root = await ensureExtensionBuilt({ rebuild: true });
        log(`Built the extension at ${root}`);
        return 0;
      }

      default:
        log(`Unknown command "${command}".\n`);
        log(HELP);
        return 1;
    }
  };
  return dispatch();
}

/** `--checkout`, else `--dev-dir`, else the session's checkout; refuses outside one. */
function checkoutFlag(flags: ParsedArgs["flags"]): string {
  const explicit =
    typeof flags.checkout === "string"
      ? flags.checkout
      : typeof flags["dev-dir"] === "string"
        ? flags["dev-dir"]
        : undefined;
  return requireCheckout(explicit, callerCwd());
}

function targetFrom(flags: ParsedArgs["flags"]): Record<string, unknown> {
  if (typeof flags.ref === "string") return { ref: flags.ref };
  if (typeof flags.selector === "string") return { selector: flags.selector };
  throw new ConfigError("Provide --ref <e12> (from `doodlebot snapshot`) or --selector <css>.");
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
