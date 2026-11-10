# Doodlebot as an agent companion for Vortex

- **Author:** egm-overhaul (agent), for doodlum
- **Status:** Approved
- **Approved:** doodlum; content 8b740299706fbb2b6b3b5197045ea5af8c82e0dca568da33c826e1797477c182; chat 2026-11-10, answer "Approve, implement now" to the approval question after confirmation round 7, with the dispositions in contested.md
- **Target:** doodlebot
- **Date:** 2026-11-09
- **Base:** `802ce4a4d798b18dfc0e5e0c3af78c5b7bf8565b` (`egm-overhaul`)

---

## Overview

Doodlebot becomes an **agent companion for Vortex**, in the way Google's
[Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model)
(EGM) is a companion for design work. A person installs it as plugins in
Claude Code or Codex and uses it entirely from the agent window, through
commands. Nothing in doodlebot is set up or used outside the agent.

The repository becomes a **plugin marketplace** named `doodlebot` with three
plugins whose commands never mix:

| Plugin      | Commands (Claude Code form)                                                            | For                                                         |
| ----------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `doodlebot` | `/doodlebot:setup`, `login`, `baseline`, `start`, `stop`, `status`, `update`, `source` | Installing and running the companion and its test Vortex    |
| `vortex`    | `/vortex:design`, `fix`, `drive`, `qa`, `ui-test`, `pr`                                | Working on Vortex: designs, bug fixes, driving the app, PRs |
| `benchmark` | `/benchmark:measure`, `/benchmark:compare`                                             | Measuring Vortex performance and comparing versions         |

The commands call one command-line tool, `doodlebot`, which replaces
`pnpm run ai -- …` and the `ai:*` scripts. `/doodlebot:setup` installs the
runtime (this repository, its dependencies and the built extension) into a
**workspace** folder and puts `doodlebot` on the PATH.

The benchmark engine (catalog, SDK, runner, collection preparation and the
setup wizard) is removed. Benchmarking becomes an agent task: the
`benchmark` commands run doodlebot's existing performance checks against
one or two Vortex builds. A new deterministic summarizer,
`doodlebot perf-summary`, turns the checks' evidence into a report.

This design builds on the approved `designs/egm-workflow.md` (design first,
one instance). Where the two differ on files, folders, commands or
documentation, this design supersedes it; that design's text stays unchanged
as history. One change to the one-instance model is needed: the instance
record moves to a per-user location, so the "one doodlebot Vortex" guard
spans every workspace on the machine.

### Terms used here

- **Workspace**: a clone of this repository that `/doodlebot:setup` creates
  (default `%USERPROFILE%\doodlebot`), with dependencies installed and the
  extension built. Caches, profiles, artifacts and `.vortex-src` stay where
  they are today relative to the repository root, so they survive plugin
  updates. A doodlebot developer may use their own checkout as the
  workspace.
- **Plugin root**: the folder a plugin is installed to. Claude Code
  substitutes `${CLAUDE_PLUGIN_ROOT}` in skill and agent bodies; in Codex it
  is three folders above a skill's `SKILL.md` (EGM `docs/codex.md`).
- **Performance check**: one of doodlebot's existing timed scripts, each of
  which attaches to the running test Vortex, writes one JSON evidence file
  and prints `evidence: <path>`:
  - `mods-scroll`: sandbox.
  - `large-library`: sandbox.
  - `collection-scale`: sandbox.
  - `download-churn`: any game.
  - `plugins-page`: the Bethesda sandbox, source builds only.
- **Driven run**: a scenario an agent carries out in Vortex through
  `/vortex:drive` or `/vortex:qa`, ending in a run report.
- **X**: the released Vortex 2.8.0 at
  `C:/dev/doodlebot/harness/.artifacts/vortex-release/Vortex.exe`. It is
  already on the owner's machine and was used for the core runs recorded on
  the base. Its folder holds a `package.json` with `"type": "commonjs"`;
  without it, Node treats X's bundled plugins as ES modules because X sits
  inside the `harness` package.
- **App environment**: every verification step that launches Vortex sets
  - `VORTEX_AI_EXE=X` and `VORTEX_AI_INSTALLED=1` (unless it names a source
    build);
  - a new temporary `VORTEX_AI_CACHE_DIR`;
  - the null OAuth tombstone for that cache and target. To write it, run
    `doodlebot script <A>/tombstone.mts` from the workspace that will launch,
    with the step's own flags and environment. The script writes `null` to
    `authCacheFile(loadConfig())` and prints that path, `cacheDir` and
    `target.kind`.

  The target guard in the Verification Plan checks the `target:` line that
  `up` prints.

## The Problem

1. **Two audiences, two setups.** The README, the documentation site and the
   `pnpm run setup` wizard teach people to clone the repository, run pnpm
   scripts and write TypeScript tests and benchmarks "without an LLM". The
   agent manuals teach agents the same tools separately. Neither is how the
   owner wants doodlebot used.
2. **Agents find doodlebot only inside this repository.** Its skills live in
   `.claude/skills`, which only Claude Code reads and only when it starts in
   this folder. Codex discovers skills in `.agents/skills` and sees none of
   them; it reaches the design procedure only because `AGENTS.md` names a
   path.
3. **Commands are mixed and missing.** `vortex-dev`, `drive-vortex`,
   `vortex-ui-test` and `vortex-elephant` mix setting up doodlebot with
   working on Vortex. There is no command for setup, login, status or
   benchmarking.
4. **`pnpm run ai -- <command>`** is the only way to run the CLI, from the
   repository root, with pnpm's argument quirks.
5. **No report from agent-driven checks.** When an agent drives Vortex
   through a scenario, nothing records what worked, what logged errors and
   which dialogs it had to click through. No CLI command reads the Vortex
   log.
6. **Benchmarks are a separate product.** About 7,600 lines (`benchmarks/`,
   `harness/benchmarks/`) implement a catalog, SDK and runner for people. The
   owner's question is "is version B slower than version A at X?", which an
   agent can answer with the existing performance checks.
7. **Known defects.**
   - A relative `--dev-dir` silently falls back to the installed target:
     `peekDevElectron` calls `createRequire` with a relative path, and
     `resolveTargetSafely` swallows the error.
   - `ci.yml` does not run `benchmark:check`, although `pnpm run ci` does.
   - `harness/src/zoomDemo.ts` is unreferenced.
   - The removed lease store `~/.vortex-ai/leases` is left on machines that
     used it.

## Goals

- Doodlebot installs as plugins in Claude Code and Codex from this
  repository's marketplace, and every capability a person needs is a command
  in one of three separate plugins.
- `/doodlebot:setup` takes a machine with Git, Node, pnpm and a released
  Vortex to a working companion, without the person typing a terminal
  command.
- One `doodlebot` CLI replaces `pnpm run ai` and the `ai:*` scripts.
- `/vortex:drive` and `/vortex:qa` produce a run report from a driven
  scenario, using a low-cost model in Claude Code.
- `/benchmark:measure` and `/benchmark:compare` measure a performance check
  on one or two Vortex builds and report the results with their spread and a
  rule-based verdict.
- The documentation site walks a person through installing and using the
  companion, task by task, in the style of Google developer documentation.
- Everything designed for use outside an agent is removed, including the
  benchmark engine.
- The defects in The Problem item 7 are fixed.

## Non-Goals

- Publishing the plugins to a public plugin directory, or tagging a release.
  The owner does that after merge.
- An MCP server entry in the plugin manifests (see Alternatives).
- Supporting Cursor, Gemini CLI or other agents.
- Proving Codex loading before merge. Codex installs marketplaces from GitHub
  (`codex plugin marketplace add <owner>/<repo>`). The owner checks Codex
  after merge, and the PR lists that check as pending.
- Changing Vortex, the MCP tool set, the performance checks' measurements, or
  readiness beyond the accepted core command.
- Downloading or installing Vortex releases for comparison. The person
  provides each build: an installed or extracted release (`--exe`) or a
  source checkout (`--dev-dir`).
- Migrating old workspaces automatically.

## Open Questions

None.

## Acceptance Criteria

- `plugin-manifests`: The two marketplace files and six plugin manifests exist with the fields and values in phase 3. Every manifest `version` equals `package.json`'s (`2.0.0`). Skill names are unique across the plugins, and every skill has a `SKILL.md` with `name` and `description`. The moved `vortex-runtime-goldfish` agent keeps `tools: Read, Grep, Glob`, `omitClaudeMd: true` and its persona reference. `harness/src/plugins.test.ts` asserts all of it.
- `plugins-load`: In Claude Code (2.1.271 or later), with this checkout open, a person confirms that:
  - the three plugins and their commands appear, and `/agents` lists each plugin agent once;
  - `/vortex:drive` with the step-8 scenario dispatches `vortex:vortex-driver`, which finishes and returns a report with every section that passes step 8's independent checks;
  - a dispatch of `vortex:vortex-runtime-goldfish` reads its persona and standard.

  The agent records what the person reports; without a person, the criterion is reported blocked. Codex loading is not part of this criterion: Codex documents installing a marketplace only from GitHub, so it is checked by the owner after merge (see Non-Goals).

- `commands-use-real-cli`: Every `doodlebot <command>` that a plugin skill or agent file names in inline code or a fenced block is a command in `harness/src/commands.ts`. For a command with sub-commands, its sub-command is listed too. The commands that `cli.ts` and `bin/doodlebot.cjs` dispatch are exactly the commands listed there. `harness/src/plugins.test.ts` and `harness/src/commands.test.ts` assert both.
- `commands-documented`: `docs/reference/commands.md` is generated from the skills, and `pnpm run docs:check` fails when it is stale, shown by a `scripts/docs.test.cjs` case.
- `doodlebot-cli`: `node bin/doodlebot.cjs <args>` runs the CLI from any directory, with the path rules in phase 1. `version`, `link`, `test`, `update`, `fixture`, `log` and `perf-summary` behave as specified. Unit tests cover parsing, path resolution, dispatch, shims, suite commands, update refusals and ref resolution. Live runs of `link`, `version` and `update` succeed. The core suite runs through `node bin/doodlebot.cjs test core` with a readiness-accepted receipt.
- `one-instance-machine-wide`: The instance record is `~/.doodlebot/instance.json`. Launchers in two workspaces refuse while either one's Vortex runs. `runningVortex.test.ts` and `instance.test.ts` cover the path and the legacy-file deletion.
- `setup-skill`: Following `/doodlebot:setup` inline yields:
  - installed dependencies and a built extension;
  - a working shim in a temporary bin folder that reports the new workspace;
  - a sandbox baseline marker, and no running instance;
  - a doctor report that names the legacy lease store when it exists.

  This run uses a new temporary workspace cloned from the pushed branch, with a temporary bin folder and cache. A second run skips the clone, install, build and baseline steps, and leaves `node_modules`, `dist` and the marker unchanged.

- `benchmark-commands`:
  - `doodlebot perf-summary` computes medians, ranges and verdicts by the rule in phase 1, and `perfSummary.test.ts` covers Faster, Slower and No clear difference with fixed numbers.
  - The `measure` and `compare` skills contain the per-run sequence and run-outcome rules under "Benchmarking on command" (`plugins.test.ts`), and a live `measure` produces a one-sided report with no verdict.
  - A live `compare` of X against X with `mods-scroll --mods 300` and five runs each produces a report whose numbers equal its evidence files, with the overall verdict _No clear difference_.
- `driven-run-report`: The `drive` and `qa` skills define the report in phase 3. A driven run of the scenario in step 8 produces a report with every section, and its claims match independent observations. The Sonnet `vortex-driver` producing such a report is shown in step 10.
- `standalone-removed`: These are gone:
  - `benchmarks/`, `harness/benchmarks/` (except `collectionCompletion.ts`, which moves to `harness/src`), and the setup wizard;
  - the human SDK and benchmark pages, and the documentation example checker;
  - the `setup`, `benchmark*`, `ai` and `ai:*` package scripts.

  `harness/src/companion.test.ts` asserts that no file outside its allow-list contains the removed command forms or imports.

- `docs-walkthrough`:
  - The site navigation is the walkthrough in phase 4, and every Markdown page under `docs/` is in it (a `docs.test.cjs` case).
  - `mkdocs build --strict` passes in the Documentation workflow on the branch.
  - An independent fresh-context review confirms the pages are task-based setup and usage instructions that match the commands.
- `defects-fixed`:
  - A relative `--dev-dir` resolves to the dev target, shown by:
    - the `config.test.ts` case, with an intended-assertion control that it fails on the base;
    - a live run that the managed default cannot satisfy.
  - `ci.yml` and the `ci` script run the same checks (a `companion.test.ts` assertion).
  - `zoomDemo.ts` is deleted.
  - `doodlebot doctor` reports the legacy lease store (a `doctor.test.ts` case), and the `setup` skill offers to delete it.

## Affected Contracts

- `public-api`: the CLI entry point and path rules, package scripts, plugin commands, new CLI commands, the deleted benchmark SDK and the documented commands change; `pnpm run setup` and the TypeScript-first documentation are removed.
- `runtime`: dev-target resolution changes, the core suite runs through the new entry point, and the instance record moves.
- `persistent-data`: the instance record moves from `harness/.cache/instance.json` to `~/.doodlebot/instance.json`. The old file is deleted when found (the same rule as today's legacy files). Caches, profiles and credentials keep their paths and formats. An existing `harness/.cache/benchmark-setup.json` is left on disk unread.

`ui` is not affected: UI driving, screenshots and recording change only in
their messages. `performance` is not affected: no measured code path changes,
and the performance checks are run, not modified.

## Critical User Journeys (CUJs)

### CUJ 1: Install and set up

- **Given**: Windows with Git, Node 20.19 or later, pnpm 9.15.0 and a
  released Vortex, and Claude Code or Codex.
- **When**: The person adds the marketplace, installs the three plugins and
  runs `/doodlebot:setup`.
- **Then**: The agent:
  - checks prerequisites;
  - asks where to put the workspace, then clones and installs it;
  - writes the `doodlebot` shim;
  - prepares a sandbox baseline and stops Vortex;
  - reports what is ready and what to try next.

### CUJ 2: Check a Vortex flow and get a report

- **Given**: A set-up companion.
- **When**: The person runs `/vortex:drive install this mod, deploy, and
report anything odd`.
- **Then**: The Sonnet `vortex-driver` agent starts the test Vortex, carries
  out the scenario, answers dialogs it must, and returns a run report.

### CUJ 3: Compare two Vortex versions

- **Given**: Released 2.8.0, and a source branch.
- **When**: The person runs `/benchmark:compare 2.8.0 against my branch on
the Mods table with 3,000 mods`.
- **Then**: The agent:
  - builds the branch in production mode;
  - picks `mods-scroll --mods 3000`;
  - runs it alternately on both builds, five times each;
  - runs `doodlebot perf-summary` and returns its report: each metric's
    median and range per build, the difference, and the verdict.

### CUJ 4: Fix a Vortex bug

- **Given**: A bug report.
- **When**: The person runs `/vortex:fix <report>`.
- **Then**: The agent prepares the source clone if needed, reproduces on the
  base, fixes it on a branch, verifies the reported scenario, and offers
  `/vortex:pr`.

### CUJ 5: Design a Vortex feature

- **Given**: A feature request, with EGM installed.
- **When**: The person runs `/vortex:design <request>`.
- **Then**: The Elephant procedure runs unchanged, except that its persona,
  standard and Goldfish agent now come from the `vortex` plugin.

## Technical Plan (Architecture)

```text
 Claude Code / Codex window
   /doodlebot:*   /vortex:*   /benchmark:*      (plugins from the doodlebot marketplace)
          |            |            |
          +------------+-----+------+
                             v
                doodlebot  (doodlebot.cmd shim on the PATH)
                             v
          node <workspace>/bin/doodlebot.cjs  ->  tsx harness/src/cli.ts
                             v
   workspace (clone of this repo): harness, built extension, caches, .vortex-src
                             v
       one isolated test Vortex per machine (record: ~/.doodlebot/instance.json)
```

### Marketplace and plugins

This repository is the marketplace:

- Claude Code reads `.claude-plugin/marketplace.json`.
- Codex reads `.agents/plugins/marketplace.json`.
- Each marketplace lists the three plugins with `source` `./plugins/<name>`.
- Each plugin has a Claude manifest (`.claude-plugin/plugin.json`) and a
  Codex manifest (`.codex-plugin/plugin.json`, `"skills": "./skills/"`), as
  EGM v0.1.1 does.

Agents:

- Claude Code namespaces plugin agents, so skills dispatch
  `vortex:vortex-runtime-goldfish` and `vortex:vortex-driver`.
- EGM's adapters show that plugin agents accept `omitClaudeMd` on Claude Code
  2.1.271 or later; step 10 checks this for ours.
- Codex plugins ship no agents. In Codex, skills run a general-purpose
  subagent given the persona file, or run the procedure inline.

Install (also on the site):

| Agent       | Commands                                                                                                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | `/plugin marketplace add doodlum/vortex-doodlebot`, then `/plugin install doodlebot@doodlebot`, `/plugin install vortex@doodlebot`, `/plugin install benchmark@doodlebot`         |
| Codex       | `codex plugin marketplace add doodlum/vortex-doodlebot`, then `codex plugin add doodlebot@doodlebot`, `codex plugin add vortex@doodlebot`, `codex plugin add benchmark@doodlebot` |

- These GitHub install paths work only after merge to `main`. Checking them
  is the owner's post-merge task.
- The `vortex` plugin's `design` command needs EGM (`egm@egm`), installed the
  same way from `google/elephant-goldfish-model`.
- In this repository, `.claude/settings.json` registers both marketplaces and
  enables the four plugins. Doodlebot's marketplace is read from this folder,
  so its developers use the plugins they are editing; after an edit, they run
  `/plugin marketplace update doodlebot`.
- `.claude/skills` and `.claude/agents` are removed.

Skill names are unique across the three plugins. Generic names such as
`setup` or `status` can still collide with skills from other plugins in
Codex's flat list; each description begins "Doodlebot:" so the right one is
recognizable.

### The workspace, the shim and path rules

`bin/doodlebot.cjs` starts with `#!/usr/bin/env node`. It finds the
workspace root from its own location. It handles `update` itself, in plain
Node, before tsx loads (below). For every other command it:

- spawns `process.execPath` with `<root>/node_modules/tsx/dist/cli.mjs`,
  `<root>/harness/src/cli.ts` and the arguments;
- sets `cwd` to the workspace root and `INIT_CWD` to the caller's directory;
- uses `stdio: "inherit"`;
- forwards the exit code, or `128 + n` on a signal.

Path rules, applied in `cliArgs.ts` at parse time:

- **Resolved against `callerCwd()`:**
  - the flags `--dev-dir`, `--checkout`, `--out`, `--cache-dir`,
    `--artifact-dir`, `--game-path`, `--test-report`, `--runtime`,
    `--manifest`, `--exe`, `--bin-dir`, `--args-file`, `--from`, `--cwd`,
    `--compare`, `--ffmpeg`, and every value of the repeated `--a` and
    `--b`;
  - the positional files of `design new|check|scope`, `script`, `eval`,
    `install` and `evidence runtime`.
- **Unchanged:**
  - `pr-preflight`'s `--project-dir`, `--test`, `--revert`, `--revert-hunk`
    and its positional tests, all relative to the checkout;
  - `vortex-e2e --spec`, relative to `packages/e2e`;
  - every argument passed through after `doodlebot test <suite>`, which the
    suite resolves against the workspace root.
- **Environment variables** with relative paths (`VORTEX_AI_CACHE_DIR`,
  `VORTEX_AI_ARTIFACT_DIR`, `VORTEX_AI_GAME_PATH`, `VORTEX_AI_EXE`) resolve
  against `REPO_ROOT` through the shim's working directory, as they do today.
  `config.ts` applies `path.resolve(REPO_ROOT, value)` explicitly to
  `VORTEX_AI_SOURCE_DIR` and `VORTEX_AI_DEV_DIR`, because `createRequire`
  rejects a relative path (a `config.test.ts` case).
- **Kit defaults** (cache, artifacts, Playwright and suite files) resolve
  against `REPO_ROOT`.
- `cliArgs.test.ts` has a case for each rule.

`doodlebot link [--bin-dir <dir>]` writes the shims into the bin folder, as
npm does for its own global commands:

- **`doodlebot.cmd`** (Windows only), containing
  `@"<node>" "<root>\bin\doodlebot.cjs" %*`. PowerShell and cmd resolve
  `doodlebot` through PATHEXT and run it.
- **`doodlebot`**, an extensionless script on every platform, containing
  `#!/bin/sh` then `exec "<node>" "<root>/bin/doodlebot.cjs" "$@"`, written
  with forward slashes. Git Bash, which is Claude Code's Bash tool on
  Windows, ignores PATHEXT and runs this file. PowerShell and cmd do not
  treat an extensionless file as a command, so they still run the `.cmd`.

`linkCommand.test.ts` asserts both files and their contents. Step 5 checks
that bare `doodlebot` works in PowerShell 5.1, cmd and Git Bash.

`<node>` is `process.execPath`. Without `--bin-dir`, `link` uses the first
of these candidates that is on the PATH and writable:

1. `process.env.npm_config_prefix` (its `bin` subfolder outside Windows);
2. on Windows, `%APPDATA%\npm`, which npm's built-in configuration uses as the
   global prefix and the Node installer puts on the PATH;
3. on Windows, `path.dirname(process.execPath)`, which is where nvm-windows
   keeps global shims;
4. elsewhere, `<dirname(dirname(execPath))>/bin`.

If none qualifies, `link` fails with
`No writable folder on the PATH for the doodlebot shim; pass --bin-dir <folder>.`
`linkCommand.test.ts` covers each branch with injected environment, PATH and
writability.

`link` prints `shim: <absolute shim path>` (the `.cmd` on Windows, the
extensionless script elsewhere; asserted in `linkCommand.test.ts`) and
`on PATH: yes|no`. On Windows, `where.exe doodlebot` can list the
extensionless script first. Anything that looks the shim up takes the first
`.cmd` match on Windows; PowerShell's `where` is an alias for
`Where-Object`, so it is never used. `link` spawns
no `npm` process and writes no `.ps1`, so pnpm's `node_modules` and
PowerShell's execution policy are not involved, and `npm link` is not used.

### Versions and updates

**Version check.** Each skill reads its plugin's version from
`${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
`<plugin root>/.codex-plugin/plugin.json` (Codex). It compares that with
`doodlebot version --json` (`{version, commit, dirty, workspace}`; the text
form is `doodlebot <version> (<commit>[, modified]) at <workspace>`) and
suggests `/doodlebot:update` when they differ. Skills take the workspace path
from the same output.

**`doodlebot update --ref <ref>`** is implemented in `bin/update.cjs` and runs
before tsx loads. The ref must match `^[A-Za-z0-9._/-]+$`.

- **Refusals:**
  - while `<state dir>/instance.json` names a running Vortex. The state
    folder defaults to `~/.doodlebot`. The rule is the one `runningVortex()`
    uses: the pid is alive and its image is `vortex.exe`, `electron.exe`,
    `vortex` or `electron` (`tasklist` on Windows, `/proc/<pid>/comm`
    elsewhere). The same check also applies to the older record at
    `<root>/harness/.cache/instance.json`. The message is:
    `A harness Vortex is running; run doodlebot down before updating.`;
  - when `git status --porcelain` is not empty:
    `The workspace has local changes; commit or remove them before updating.`
- **Tag or branch:**
  - If `git ls-remote --exit-code --tags origin refs/tags/<ref>` succeeds, it
    runs `git fetch origin tag <ref>` and `git checkout --detach refs/tags/<ref>`.
  - Otherwise, if `git ls-remote --exit-code --heads origin <ref>` succeeds,
    it runs `git fetch origin <ref>` and `git checkout --detach FETCH_HEAD`.
  - Otherwise it fails with `No tag or branch <ref> on origin.`
- **Build:** it then runs `pnpm install --frozen-lockfile` and `pnpm run build`.
- **Spawning:** `git` is spawned directly. `pnpm` runs with `shell: true` and
  these fixed argument strings; no input reaches the shell.
- **Skill fallback:** the `update` skill passes `v<plugin version>`, and on
  `No tag or branch` it passes `main`.

### Long-running and blocking commands from an agent

`doodlebot up`, `setup`, `test` and `install` can outlive an agent's tool
timeout or wait on a dialog. On Windows, a Vortex launched from a command
whose output is captured can also keep that capture open, so the command
never returns. That has been observed with `up`, and Phase 5 adds it to
`KNOWLEDGE.md`. Skills and the driver therefore:

- run these commands in the background, with output to a log file in
  `<workspace>/harness/.artifacts/runs/`:
  - PowerShell:
    `Start-Process -FilePath <shim> -ArgumentList <args> -RedirectStandardOutput <log> -RedirectStandardError <log>.err -NoNewWindow -PassThru`;
  - Bash: `nohup <shim> <args> > <log> 2>&1 &`;
- poll `doodlebot status` until MCP is "answering" or the command exits;
- for a command that may raise a dialog (for example a reinstall), poll
  `doodlebot call ui_active_dialogs` while it runs, then:
  - read the dialog's text;
  - take `doodlebot snapshot` to get the button's ref;
  - answer with `doodlebot click --ref <ref>`.

  `install`'s own call times out after 300 seconds, so the dialog must be
  answered before then;

- for login, run `doodlebot setup --oauth --installed --no-wait`, ask the
  person to log in, poll `doodlebot auth-status`, then run
  `doodlebot save-login --installed`.

### Driven runs and the run report

`/vortex:drive <scenario>` acts directly for a short interactive task. For a
scenario, or when asked for a report, it delegates to `vortex-driver`. In
Claude Code that agent has `model: sonnet`; in Codex, the skill runs the same
procedure inline. `/vortex:qa` delegates the same way, with
`doodlebot up --fresh` and the change's acceptance criteria. The driver:

- uses only the `doodlebot` CLI;
- answers a dialog only when the scenario needs it;
- reads the renderer console from sequence 0
  (`doodlebot call ui_read_console`);
- reads Vortex log warnings and errors with `doodlebot log --level warn`;
- reads notifications from state;
- writes the report (phase 3).

### Benchmarking on command

`/benchmark:measure <what> [on <build>]` and
`/benchmark:compare <build A> <build B> <what>` are agent procedures. The
agent:

1. **Picks the check.** It maps "what" to a performance check and its options
   (for example, "Mods table with 3,000 mods" is
   `doodlebot test mods-scroll --mods 3000`) and states the choice. Only the
   five checks are supported. A request outside them is answered with the
   nearest check, or declined.
2. **Fixes the builds.** A build is an executable (`--exe <path>`) or a
   source checkout (`--dev-dir <path>`). The person names each build; nothing
   is downloaded or installed. A source checkout is built with
   `doodlebot build --checkout <dir> --production` and launched with
   `--production`, so it runs in production mode like a release. Each build
   gets its own new `VORTEX_AI_CACHE_DIR`, used for its `up`, check and
   `down`. Baselines are keyed by target kind, so two builds of the same kind
   would otherwise share one.
3. **Runs alternately.** It runs A and B alternately (ABAB…), five times each
   by default (three at least). Each run is:
   1. `doodlebot up <build flags> <game flags> --fresh`. The game flags are
      `--sandbox` for the sandbox checks, and `--bethesda-sandbox` for
      `plugins-page`, which needs a source build.
   2. `doodlebot call automation_status`, recording `vortexVersion` and
      `nodeEnv`.
   3. `doodlebot test <check> <options>`, capturing the `evidence: <path>`
      line.
   4. `doodlebot down`.

   Run outcomes:
   - A run whose check exits 1 after writing evidence (a budget failure)
     counts, and its failures are listed.
   - A run with no evidence is failed and not counted.
   - A side with fewer than three counted runs makes the report _Blocked_.

4. **Summarizes.** It runs
   `doodlebot perf-summary --check <check> --a <file> --a <file> … [--b <file> …] --out <report.md>`
   (one evidence file per repeated `--a` or `--b`, read from the parser's
   repeated-flag lists), then adds the question, the builds and the conditions
   to the report.

`doodlebot perf-summary` (`harness/src/perfSummary.ts`) reads the evidence
files with a fixed metric table. Every metric is in milliseconds, or per
minute where noted, and lower is better:

| Check              | Metrics (JSON paths)                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `mods-scroll`      | `wheel.maxFrameGapMs`, `wheel.p95FrameMs`, `wheel.blockedMs`, `wheel.wallMs`, `scrollThrough.clearAfter.elapsedMs`                       |
| `large-library`    | `filter.elapsedMs`, `filter.blockedMs`, `clear.elapsedMs`, `clear.blockedMs`, `installs.wallMs`, `installs.longestMs`, `deployMs.onMods` |
| `collection-scale` | `phases.install.wallMs`, `phases.install.longestFreezeMs`, `phases.install.longTasks.totalMs`, `phases.update.wallMs`                    |
| `download-churn`   | `wallMs`, `persistDiffs.perMinute` (per minute), `slowWrites.totalMs`, `dispatches.totalMs`, `longTasks.totalMs`                         |
| `plugins-page`     | `scroll.elapsedMs`, `filter.elapsedMs`, `clear.elapsedMs`, `toggle.elapsedMs`, `toggle.longestMs`                                        |

A metric missing from a file (for example `scrollThrough` with
`--no-scroll-through`) is left out for that file.

Per metric, the report gives each side's median, minimum, maximum and value
count, and the difference `(median B − median A) / median A × 100` in percent
(omitted when median A is 0). The median of an even count is the mean of the
two middle values. With two sides, the verdict for that metric is:

- **Faster** if B's maximum is below A's minimum;
- **Slower** if B's minimum is above A's maximum;
- otherwise **No clear difference**;
- **Blocked** if either side has fewer than three values for that metric.
  This test is applied first, before the three above.

The overall verdict:

- **Blocked** if either side has fewer than three counted runs, or every
  metric is Blocked;
- otherwise **Slower** if any metric is Slower;
- otherwise **Faster** if any metric is Faster;
- otherwise **No clear difference**.

Blocked metrics are listed but do not decide the overall verdict.

With five runs per side, two sets from the same distribution fail to overlap
by chance in about 0.8% of cases per metric (2 in 252). Across five metrics,
that is about 4%. The report states this, and that a verdict is only as good
as the machine's quiet conditions. When a comparison of a build with itself,
or a surprising result, gives a verdict other than No clear difference, the
skill reruns the whole comparison once and reports both.

The benchmark report sections are:

- **Question.**
- **Builds:** path, `vortexVersion` and mode.
- **Measurement:** command and options.
- **Conditions:** machine, date, and what else was running.
- **Results:** a table per metric.
- **Verdict.**
- **Evidence:** every run's JSON path, and any budget failures.
- **Caveats.**

`perf-summary` writes Results, Verdict, Evidence and the statistical part of
Caveats. Its printed summary is the overall verdict, then one line per
metric with its verdict and medians. The skill adds Question, Builds,
Measurement, Conditions, and the machine-quiet caveat.

`measure` has one side and no verdict. Reports are written to
`<workspace>/harness/.artifacts/benchmarks/<UTC time>-<slug>/report.md`.

### Four kinds of check

| Kind            | Tool                                       | Agent during the run   | Result            |
| --------------- | ------------------------------------------ | ---------------------- | ----------------- |
| Regression test | `doodlebot test core`, `/vortex:ui-test`   | None                   | Playwright report |
| Driven run      | `/vortex:drive`, `/vortex:qa`              | `vortex-driver`        | Run report        |
| Benchmark       | `/benchmark:measure`, `/benchmark:compare` | Orchestrates only      | Benchmark report  |
| Design review   | `/vortex:design`                           | EGM and the Goldfishes | Approved design   |

## Alternatives Considered

- **Run the kit from the plugin folder.** Rejected by the owner: plugin
  updates would replace the code under a live install and its caches.
- **One plugin with all commands.** Rejected by the owner: doodlebot,
  Vortex and benchmark commands must be separate.
- **Keep the benchmark engine with a CLI.** Rejected by the owner: the agent
  benchmarks and compares versions on request instead.
- **`npm link` for the PATH.** npm 7 and later reify the linked package, which
  can rewrite pnpm's `node_modules`, and its `.ps1` shim is blocked under
  restrictive PowerShell policies.
- **A per-workspace instance record, with skills stopping other workspaces
  first.** Rejected: nothing reliably lists other workspaces, so the record
  moves to one per-user path instead.
- **Declare doodlebot's MCP server in the plugin manifests.** The server
  exists only while the test Vortex runs, so the agent would show a failed
  server most of the time. The CLI already exposes every tool.
- **Symlink `.agents/skills` to `.claude/skills`.** It needs symlink rights on
  Windows and keeps the skills tied to this folder.

## Non-Functional Requirements

- Commands are short and named by verb. Each `SKILL.md` description starts
  with the plugin name ("Doodlebot:", "Vortex:" or "Benchmark:") and says
  when to use the command in one sentence. `argument-hint` shows its input.
- `disable-model-invocation: true` (run only when the person asks) is set on
  `setup`, `update`, `stop`, `baseline`, `measure` and `compare`.
- No command asks for a secret: the person logs in in the browser.
- Setup never installs Node, Git or Vortex. It asks before enabling pnpm
  (`corepack enable`, then `corepack prepare pnpm@9.15.0 --activate`). It
  never runs a Vortex installer.

## Detailed Implementation Plan

### Target Scope & File Boundary

**Design**

- `designs/SITEMAP.md`
- `designs/agent-companion.md`

**Marketplace and plugins**

- `.claude-plugin/marketplace.json`
- `.agents/plugins/marketplace.json`
- `plugins/doodlebot/.claude-plugin/plugin.json`
- `plugins/doodlebot/.codex-plugin/plugin.json`
- `plugins/doodlebot/skills/setup/SKILL.md`
- `plugins/doodlebot/skills/login/SKILL.md`
- `plugins/doodlebot/skills/baseline/SKILL.md`
- `plugins/doodlebot/skills/start/SKILL.md`
- `plugins/doodlebot/skills/stop/SKILL.md`
- `plugins/doodlebot/skills/status/SKILL.md`
- `plugins/doodlebot/skills/update/SKILL.md`
- `plugins/doodlebot/skills/source/SKILL.md`
- `plugins/vortex/.claude-plugin/plugin.json`
- `plugins/vortex/.codex-plugin/plugin.json`
- `plugins/vortex/skills/design/SKILL.md`
- `plugins/vortex/skills/fix/SKILL.md`
- `plugins/vortex/skills/drive/SKILL.md`
- `plugins/vortex/skills/qa/SKILL.md`
- `plugins/vortex/skills/ui-test/SKILL.md`
- `plugins/vortex/skills/pr/SKILL.md`
- `plugins/vortex/agents/vortex-runtime-goldfish.md`
- `plugins/vortex/agents/vortex-driver.md`
- `plugins/vortex/resources/vortex_runtime.md`
- `plugins/vortex/resources/vortex-change-standard.md`
- `plugins/benchmark/.claude-plugin/plugin.json`
- `plugins/benchmark/.codex-plugin/plugin.json`
- `plugins/benchmark/skills/measure/SKILL.md`
- `plugins/benchmark/skills/compare/SKILL.md`

**Claude Code project files and the files moved out of them**

- `.claude/settings.json`
- `.claude/skills/drive-vortex/SKILL.md`
- `.claude/skills/vortex-dev/SKILL.md`
- `.claude/skills/vortex-elephant/SKILL.md`
- `.claude/skills/vortex-ui-test/SKILL.md`
- `.claude/agents/vortex-runtime-goldfish.md`
- `harness/egm/vortex_runtime.md`
- `harness/egm/vortex-change-standard.md`

**Shim, package and build configuration**

- `bin/doodlebot.cjs`
- `bin/update.cjs`
- `package.json`
- `pnpm-lock.yaml`
- `harness/tsconfig.json`
- `vitest.config.ts`
- `.github/workflows/ci.yml`

**Benchmark engine (deleted)**

- `benchmarks/*` (deleted)
- `harness/benchmarks/*` (deleted, except `collectionCompletion.ts`, which moves)
- `harness/src/collectionCompletion.ts`
- `src/uiAutomation.test.ts`

**CLI and harness code**

- `harness/src/cli.ts`
- `harness/src/cliArgs.ts`
- `harness/src/cliArgs.test.ts`
- `harness/src/commands.ts`
- `harness/src/commands.test.ts`
- `harness/src/config.ts`
- `harness/src/config.test.ts`
- `harness/src/configRelativeDevDir.test.ts`
- `harness/src/bootstrap.test.ts`
- `scripts/cli-commands.cjs`
- `harness/src/readiness.ts`
- `harness/src/readiness.test.ts`
- `harness/src/paths.ts`
- `harness/src/runningVortex.ts`
- `harness/src/runningVortex.test.ts`
- `harness/src/instance.ts`
- `harness/src/instance.test.ts`
- `harness/src/fixtureCleanup.test.ts`
- `harness/src/testCommand.ts`
- `harness/src/testCommand.test.ts`
- `harness/src/versionCommand.ts`
- `harness/src/versionCommand.test.ts`
- `harness/src/linkCommand.ts`
- `harness/src/linkCommand.test.ts`
- `harness/src/update.test.ts`
- `harness/src/fixtureCommand.ts`
- `harness/src/fixtureCommand.test.ts`
- `harness/src/logCommand.ts`
- `harness/src/logCommand.test.ts`
- `harness/src/perfSummary.ts`
- `harness/src/perfSummary.test.ts`
- `harness/src/doctor.ts`
- `harness/src/doctor.test.ts`
- `harness/src/plugins.test.ts`
- `harness/src/companion.test.ts`
- `harness/src/egmResources.test.ts`
- `harness/src/singleInstance.test.ts`
- `harness/src/zoomDemo.ts` (deleted)
- `harness/src/kit.ts`
- `harness/src/bootstrap.ts`
- `harness/src/auth.ts`
- `harness/src/cdp.ts`
- `harness/src/collectionScale.ts`
- `harness/src/tableProbes.ts`
- `harness/src/collectionDownloads.ts`
- `harness/src/runningProfile.ts`
- `harness/src/processRunner.ts`
- `harness/src/processRunner.test.ts`
- `harness/src/productionMode.ts`
- `harness/src/evidence.test.ts`
- `harness/src/sourceBuild.test.ts`
- `harness/src/vortexBuild.test.ts`
- `harness/src/vortexE2e.test.ts`

**Opt-in check scripts**

- `harness/src/tests/bethesda.e2e.ts`
- `harness/src/tests/collection-download-retry.e2e.ts`
- `harness/src/tests/collection-scale.e2e.ts`
- `harness/src/tests/download-churn.e2e.ts`
- `harness/src/tests/large-library.e2e.ts`
- `harness/src/tests/mods-scroll.e2e.ts`
- `harness/src/tests/nexus-collection.e2e.ts`
- `harness/src/tests/plugins-mod-link.e2e.ts`
- `harness/src/tests/plugins-page.e2e.ts`
- `harness/src/tests/zoom.e2e.ts`

**Documentation tooling**

- `scripts/docs.cjs`
- `scripts/docs.test.cjs`
- `scripts/docs-run.cjs`
- `scripts/docs-examples.cjs` (deleted)
- `scripts/documentation-map.json`
- `mkdocs.yml`

**Documentation pages kept or rewritten**

- `docs/index.md`
- `docs/contributing.md`
- `docs/credits.md`
- `docs/security.md`
- `docs/troubleshooting.md`
- `docs/guides/source-development.md`
- `docs/reference/configuration.md`
- `docs/reference/cli.md` (generated)
- `docs/reference/mcp-tools.md` (generated)

**Documentation pages created**

- `docs/get-started/requirements.md`
- `docs/get-started/install.md`
- `docs/get-started/set-up.md`
- `docs/get-started/first-session.md`
- `docs/guides/drive-vortex.md`
- `docs/guides/fix-a-bug.md`
- `docs/guides/design-a-feature.md`
- `docs/guides/regression-tests.md`
- `docs/guides/pull-requests.md`
- `docs/guides/benchmark.md`
- `docs/guides/sign-in.md`
- `docs/guides/games-and-baselines.md`
- `docs/concepts/how-it-works.md`
- `docs/concepts/one-test-vortex.md`
- `docs/concepts/design-first.md`
- `docs/concepts/evidence.md`
- `docs/reference/commands.md` (generated)
- `docs/reference/run-report.md`
- `docs/reference/benchmark-report.md`

**Documentation pages deleted**

- `docs/architecture.md`
- `docs/maintaining-documentation.md`
- `docs/getting-started/first-session.md`
- `docs/getting-started/setup.md`
- `docs/guides/agent-plugins.md`
- `docs/guides/calling-tools.md`
- `docs/guides/capture.md`
- `docs/guides/design-review.md`
- `docs/guides/evidence.md`
- `docs/guides/mod-workflows.md`
- `docs/guides/ui-automation.md`
- `docs/reference/collections.md`
- `docs/reference/index.md`
- `docs/reference/package-scripts.md`
- `docs/reference/results.md`
- `docs/reference/runner.md`
- `docs/reference/sessions.md`
- `docs/reference/tables.md`
- `docs/testing/adding-benchmarks.md`
- `docs/testing/benchmarks.md`
- `docs/testing/integration.md`
- `docs/testing/proposal.md`
- `docs/testing/results.md`
- `docs/testing/running.md`
- `docs/testing/table-fixtures.md`
- `docs/testing/unit.md`

**Readme and agent manuals**

- `README.md`
- `AGENTS.md`
- `ARCHITECTURE.md`
- `KNOWLEDGE.md`
- `harness/AGENTS.md`
- `harness/AGENT-WORKFLOW.md`
- `harness/WORKFLOWS.md`
- `harness/TESTING.md`
- `harness/KNOWLEDGE-ROUTES.md`
- `harness/PULL-REQUESTS.md`

**Generated references**

- `harness/reference/*.md` (generated)

The listed `harness/src` files that are not otherwise described below get
message-only edits (`pnpm run ai -- x` becomes `doodlebot x`); their behavior
does not change.

### Target Files to Create/Modify

The work runs in five phases.

- **Phases 1–4** each end with `pnpm run typecheck` and `pnpm run test`
  passing.
- **Phase 5** ends with the full `pnpm run ci` passing. The documentation
  pairing check, the documentation tests and the companion test can only
  pass once the documentation and manuals are rewritten.

**Phase 1. CLI, shim, instance record and readiness (Create/Modify/Delete)**

- **Command list.** `harness/src/commands.ts` exports
  `commands: { name: string; subcommands?: string[]; handledBy?: "bin" }[]`.
  - It lists every command that `cli.ts` handles (with `command === "<x>"` or
    `case "<x>":`, excluding `help`), plus `version`, `test`, `link`,
    `fixture` (sub-command `mod`), `log`, `perf-summary`, and `update`
    (`handledBy: "bin"`).
  - Sub-commands are listed for `evidence` (`identity run runtime`) and
    `design` (`new check scope`).
  - `harness/src/commands.test.ts` extracts the handled names from `cli.ts`
    with the same TypeScript AST rules `scripts/docs.cjs` uses: `===` whose
    left side is `command`, and `case` labels inside `switch (command)`. The
    rules move into a new module, `scripts/cli-commands.cjs`, which exports
    `dispatchedCommands(sourceFile)`. That module is created in Phase 1, and
    `docs.cjs` switches to it in Phase 2. The nested `switch` on watch events
    is therefore excluded the same way. The test asserts that the names
    equal the list's entries without `handledBy`. It also asserts that the
    commands `bin/doodlebot.cjs` handles itself (its `command === "<x>"`
    comparisons) equal the `handledBy: "bin"` entries.
- **Shim and update.** `bin/doodlebot.cjs` is as described above.
  `bin/update.cjs` exports
  `update(root, ref, run, deps?: { stateDir?: string; imageName?: (pid: number) => string | undefined })`.
  Its defaults are `~/.doodlebot` and the `tasklist` or `/proc` lookup, and
  `run` is injectable.
  - `harness/src/update.test.ts` loads it with `createRequire` and casts the
    result to an inline interface declared in the test, so no `.d.cts` and no
    `allowJs` are needed.
  - Every case passes a temporary `stateDir`, so the real `~/.doodlebot` is
    never read or written.
  - It covers the two refusals:
    - a record in the temporary state folder holding `process.pid`, with an
      `imageName` that returns `vortex.exe` for it;
    - a dirty synthetic git repository.
  - It covers the missing-ref error (`update needs --ref <tag or branch>.`),
    the invalid-ref error, and tag, branch and missing-ref resolution against
    a synthetic remote.
  - It covers the command sequence. The `run` contract is
    `run(cmd: string, args: string[], opts: { cwd: string; shell?: boolean }) => { status: number; stdout: string }`.
    The recorded sequences are:
    - **Tag:** `git ls-remote --exit-code --tags origin refs/tags/<ref>`
      (status 0), then `git fetch origin tag <ref>`, then
      `git checkout --detach refs/tags/<ref>`, then
      `pnpm install --frozen-lockfile` (shell), then `pnpm run build` (shell).
    - **Branch:** the tag lookup (status 2), then
      `git ls-remote --exit-code --heads origin <ref>` (status 0), then
      `git fetch origin <ref>`, then `git checkout --detach FETCH_HEAD`, then
      the two `pnpm` commands.
  - `bin/doodlebot.cjs` accepts `update --ref <ref>` and `update --ref=<ref>`.
    Any other argument to `update` is an error.
- **Instance record.** `harness/src/paths.ts` adds
  `USER_STATE_DIR = path.join(os.homedir(), ".doodlebot")`. In
  `runningVortex.ts`, `INSTANCE_RECORD` becomes
  `path.join(USER_STATE_DIR, "instance.json")`.
  - In `instance.ts`, `removeLegacyInstanceFiles` reads
    `<DEFAULT_CACHE_DIR>/instance.json` first:
    - if it is valid and names a running Vortex (the `runningVortex()` rule),
      the caller refuses. A launch refuses with
      `A harness Vortex from an older doodlebot is running (pid N); stop it before starting Vortex.`.
      `down` (through `stopStaleInside`) refuses with the same text, ending
      `before stopping Vortex.` instead;
    - otherwise the file is deleted.
  - **Refusal before restart.** In `bootstrap()`, before
    `stopStaleInstance(config)`, if `runningVortex()` names a different
    `cacheDir` (compared with `normalizedPath`), it calls
    `assertNoHarnessVortex("starting Vortex")`. A second workspace or cache
    therefore gets the documented refusal, not a port error. A restart of the
    same cache is unchanged. `bootstrap.test.ts` covers a live record of
    another cache (refused, and that instance not touched) and of the same
    cache (restarted).
  - The tests that relocate the record mock `USER_STATE_DIR`:
    `runningVortex.test.ts`, `instance.test.ts`, `evidence.test.ts`,
    `fixtureCleanup.test.ts`, `sourceBuild.test.ts`, `vortexBuild.test.ts`
    and `vortexE2e.test.ts`.
  - `instance.test.ts` adds three cases: a stale legacy default-cache file is
    deleted, a live one refuses a launch, and a live one refuses `down`.
- **`harness/src/cliArgs.ts`:**
  - after `test <suite>`, every argument passes through verbatim, as for
    `script`;
  - `BOOLEAN_FLAGS` gains `list` (`json` and the `--x=value` form already
    exist);
  - `--a` and `--b` may repeat, and are read from the parser's `lists`;
  - the path rules above are applied;
  - `cliArgs.test.ts` has a case for each.
- **`doodlebot version [--json]`** (`harness/src/versionCommand.ts`): as
  above, where `workspace` is the real path of the repository root.
- **`doodlebot link [--bin-dir <dir>]`** (`harness/src/linkCommand.ts`): as
  above. `linkCommand.test.ts` checks both shim contents, the default-folder
  rule, and the PATH detection.
- **`doodlebot test <suite> [args…]` and `doodlebot test --list`**
  (`harness/src/testCommand.ts`). Each suite runs from `REPO_ROOT` through
  `runInteractive(process.execPath, …)` with `env: process.env`, so
  `PLAYWRIGHT_JSON_OUTPUT_FILE` passes through. `tsxCli()` moves from
  `cli.ts` to `processRunner.ts` and is exported.

  | Suite                                                                                                                                                               | Runs                                                                                                                       |
  | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
  | `core`                                                                                                                                                              | `createRequire(import.meta.url).resolve("@playwright/test/cli")`, then `test --config harness/playwright.config.ts <args>` |
  | `oauth`                                                                                                                                                             | the same, with `harness/oauth.playwright.config.ts`                                                                        |
  | `zoom`, `panels`, `large-library`, `bethesda`, `collection-download-retry`, `collection-scale`, `plugins-mod-link`, `plugins-page`, `download-churn`, `mods-scroll` | `tsxCli()`, then `harness/src/tests/<suite>.e2e.ts <args>`                                                                 |
  | `nexus`                                                                                                                                                             | `tsxCli()`, then `harness/src/tests/nexus-collection.e2e.ts <args>`                                                        |
  - An unknown suite exits 2 and lists the suites.
  - `testCommand.test.ts` checks the argv for each suite.

- **`doodlebot fixture mod --out <zip> [--name <text>]`**
  (`harness/src/fixtureCommand.ts`): writes a mod archive with one file,
  `textures/<name>.txt`, containing `<name>`. The default name is
  `automation-probe`. In the sandbox, the file deploys to
  `<gamePath>/Data/textures/<name>.txt`. `fixtureCommand.test.ts` unzips it
  with fflate.
- **`doodlebot log [--level info|warn|error] [--tail <n>] [--since <ISO time>]`**
  (`harness/src/logCommand.ts`): reads `<userDataDir>/vortex.log` from the
  running instance's `automation_status` with `parseLogLine`. `--level` is a
  threshold, compared case-insensitively: `debug`, `silly` and `verbose` <
  `info` < `warn` < `error`. An unrecognised level counts as `info`, and the
  default is `warn`. `--since` keeps
  entries whose `Date.parse(entry.time)` is at or after the given time.
  `--tail` keeps the last n matches (default 50). `logCommand.test.ts`
  covers each filter on a synthetic log.

  Output: one entry per block, its raw first line followed by any
  continuation lines that `parseLogLine` rejects (for example stack frames),
  kept under the entry they follow. With `--json` it prints
  `LogEntry[]`, with the continuation lines appended to `message`.
  `logCommand.test.ts` includes a continuation-line case.

- **`doodlebot perf-summary --check <check> --a <file> [--a <file> …] [--b <file> …] [--out <file>] [--json]`**
  (`harness/src/perfSummary.ts`): the metric table, statistics and verdicts
  above. It writes Markdown to `--out` and prints a summary; with `--json` it
  prints the result object. `perfSummary.test.ts` uses fixed-number evidence
  for:
  - each verdict, an even run count, and the percent formula;
  - a metric missing from some files that leaves a side under three values
    (that metric Blocked);
  - fewer than three counted runs (overall Blocked);
  - every check's metric paths, with fixtures built from the result shapes
    the five e2e scripts write.

  Only `mods-scroll` has live coverage (step 7). The other four checks' paths
  are covered only by these fixtures.

- **`doodlebot doctor`** (`harness/src/doctor.ts`) adds two advisory `Check`s.
  Being advisory, they never make `doctor` exit 1:
  - name `Sandbox baseline`, detail `present` or `missing`. Present means
    `readMarker(snapshotDir(config, config.apiKey?.trim() || ANONYMOUS)) !== undefined`,
    which is the same test `checkCache` and `status` use. When present, the
    detail also gives the marker file's path;
  - name `Legacy lease store`, detail the path, shown only when
    `~/.vortex-ai/leases` exists.

  When `configFrom` passes a `targetError`, `runDoctor` copies it onto the
  `DoctorReport`, and `formatDoctorReport` prints it as a failing `Vortex`
  check. The home folder and cache are injectable. `doctor.test.ts` covers
  each check and `targetError`.

- **Benchmark removal:**
  - `harness/benchmarks/collectionCompletion.ts` moves to
    `harness/src/collectionCompletion.ts`.
    - It defines `export class CompletionUnobservable extends Error {}` and
      throws that where it threw `BenchmarkBlocked`. No caller checks the
      class; the tests check messages.
    - `cli.ts` and `src/uiAutomation.test.ts` import it from there.
  - Every other file in `benchmarks/` and `harness/benchmarks/` is deleted.
  - `harness/tsconfig.json` and `vitest.config.ts` drop their benchmark
    entries.
  - `collectionDownloads.ts` drops its "benchmark profile" wording.
  - The refusal actions `a benchmark session` and `benchmark setup`
    disappear with their callers.
- **`--dev-dir`** (`harness/src/config.ts` only; `electronRuntime.ts` is
  unchanged):
  - `resolveTarget` applies `path.resolve(devDir)` (the process's working
    directory) to an explicit `devDir`. Under the shim the CLI has already
    resolved `--dev-dir` against the caller's directory.
  - `resolveTarget` throws
    `ConfigError("--dev-dir <abs> is not a built Vortex checkout: <reason>")`
    when its Electron cannot be resolved (it wraps the error
    `peekDevElectron` throws).
  - `resolveTargetSafely` rethrows for an explicit `overrides.devDir` only. A
    `VORTEX_AI_DEV_DIR` or managed checkout keeps today's safe fallback.
  - `configFrom(flags, command)` catches that `ConfigError` only when
    `command === "doctor"`, and passes the message as `targetError` (see
    `doodlebot doctor` above).
  - `config.test.ts` adds two cases:
    - an explicit non-built `devDir` throws the `ConfigError`, and
      `resolveTargetSafely` rethrows it;
    - the same path given through `VORTEX_AI_DEV_DIR` does not throw.
  - A new file, `harness/src/configRelativeDevDir.test.ts`, holds only the
    relative cases, so the control in step 3 runs nothing else. It uses only
    `resolveTarget`, an API present at the base. It:
    - builds, in a temporary folder, a fake checkout with
      `src/main/package.json` and a resolvable fake `node_modules/electron`
      (`package.json` and `index.js`), as `electronRuntime.test.ts` does;
    - changes the working directory to that folder's parent, on the same
      drive;
    - passes the relative path as `devDir`, and in a second case as
      `VORTEX_AI_DEV_DIR`;
    - asserts `kind === "dev"` and that `sourceDir` equals the absolute
      fixture.

    At the base, both cases fail on `createRequire`'s `ERR_INVALID_ARG_VALUE`
    ("must be a file URL object, file URL string, or absolute path string").
    That output has no missing-module, compile or setup pattern, so the
    revert check classifies it as unclassified. `config.test.ts` also gains a
    relative `VORTEX_AI_SOURCE_DIR` case.
- **Readiness** (`harness/src/readiness.ts`): `kit-core` accepts exactly the
  argv prefixes `node bin/doodlebot.cjs test core` and
  `pnpm exec playwright test --config harness/playwright.config.ts`, with the
  same tail rule. It no longer accepts `pnpm run ai:test:core`.
  `readiness.test.ts` adds three cases: the new form is accepted, the old
  script is refused, and a filtered tail is refused.
- **`cli.ts`:** dispatches the new commands. `version`, `link`, `test`,
  `fixture` and `perf-summary` are early `command === "<x>"` branches before
  `configFrom(flags, command)`, like `build`; `log` comes after it, because
  it needs the running instance. HELP drops "First run" and the human-guide
  line and names the plugins. Messages use `doodlebot …`. `cli.ts` runs
  `main()` when imported, so the `doctor`-only catch in `configFrom` is
  proved live in step 5. `doodlebot doctor --dev-dir <a folder that is not a
built checkout>` prints a failing `Vortex` check with the `ConfigError`
  text and does not crash.
- **`package.json`:**
  - adds `"bin": {"doodlebot": "bin/doodlebot.cjs"}` and sets `version` to
    `2.0.0`. That is the companion's version. The Vortex extension's own
    version in `info.json` stays independent and unchanged;
  - removes `setup`, every `benchmark*` script, `ai` and every `ai:*`;
  - `ci` becomes `pnpm run typecheck && pnpm run lint && pnpm run format:check && pnpm run docs:check && pnpm run docs:test && pnpm run test && pnpm run build`.
- **`.github/workflows/ci.yml`:**
  - the `ci` job runs `pnpm run` with the same seven scripts, in the same
    order;
  - `core-released` runs `node bin/doodlebot.cjs test core`.
- **Deleted:** `harness/src/zoomDemo.ts`.

**Phase 2. Documentation tooling (Modify/Delete)**

- `scripts/docs-examples.cjs` is deleted.
- **`scripts/docs.cjs`:**
  - drops the `benchmarks.*` and `proposal.*` modules (lines 136–150), and
    points `collectionCompletion` at `harness/src/collectionCompletion.ts`;
  - drops the contract-block pages (lines 291–331);
  - drops both `package-scripts.md` outputs, and deletes
    `harness/reference/package-scripts.md`;
  - generates `docs/reference/commands.md` from `plugins/*/skills/*/SKILL.md`:
    - one section per plugin, in marketplace order (`doodlebot`, `vortex`,
      `benchmark`);
    - each section is a table with the columns Command (`/<plugin>:<name>`),
      What it does (the `description` without its "Plugin:" prefix) and
      Arguments (`argument-hint`, or "none");
    - rows follow a `COMMAND_ORDER` constant in `docs.cjs`:
      - `doodlebot`: `setup`, `login`, `baseline`, `start`, `stop`,
        `status`, `update`, `source`;
      - `vortex`: `design`, `fix`, `drive`, `qa`, `ui-test`, `pr`;
      - `benchmark`: `measure`, `compare`.

      Generation fails when the skills on disk differ from that list;
  - replaces these hard-coded strings and links:

    | Line | Before                                                                                                                  | After                                                                                                  |
    | ---- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
    | 231  | `pnpm run ai -- tools --json`                                                                                           | `doodlebot tools --json`                                                                               |
    | 242  | `../guides/calling-tools.md`                                                                                            | `../guides/drive-vortex.md`                                                                            |
    | 260  | `../getting-started/first-session.md`, `../getting-started/setup.md`, `pnpm run ai -- <command>`, `pnpm run ai -- help` | `../get-started/first-session.md`, `../get-started/set-up.md`, `doodlebot <command>`, `doodlebot help` |
    | 350  | the package-scripts output                                                                                              | removed                                                                                                |

- **`scripts/documentation-map.json`** becomes these groups:

  | Group                           | Sources                                                                                                                                                         | Human                                                                                                       | AI                                                                                                       |
  | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
  | Plugins and commands            | `^plugins/`, `^\.claude-plugin/`, `^\.agents/plugins/`                                                                                                          | `docs/reference/commands.md`, `docs/get-started/install.md`                                                 | `AGENTS.md`, `harness/AGENTS.md`                                                                         |
  | MCP and renderer tools          | `^src/.*\.ts$`                                                                                                                                                  | `docs/reference/mcp-tools.md`, `docs/guides/drive-vortex.md`, `docs/security.md`, `docs/troubleshooting.md` | `harness/reference/mcp-tools.md`, `harness/AGENTS.md`, `ARCHITECTURE.md`, `KNOWLEDGE.md`                 |
  | CLI and configuration           | `^bin/`, `^harness/src/(cli\|cliArgs\|commands\|config\|doctor\|paths\|versionCommand\|linkCommand\|testCommand\|fixtureCommand\|logCommand\|perfSummary)\.ts$` | `docs/reference/cli.md`, `docs/reference/configuration.md`, `docs/get-started/set-up.md`                    | `harness/reference/cli.md`, `harness/AGENTS.md`                                                          |
  | Lifecycle and authentication    | as today                                                                                                                                                        | `docs/concepts/one-test-vortex.md`, `docs/guides/sign-in.md`, `docs/security.md`, `docs/troubleshooting.md` | `harness/AGENTS.md`, `KNOWLEDGE.md`, `harness/TESTING.md`                                                |
  | Reusable script helpers         | as today                                                                                                                                                        | `docs/guides/drive-vortex.md`, `docs/guides/benchmark.md`                                                   | `harness/reference/script-api.md`, `harness/AGENTS.md`, `harness/TESTING.md`                             |
  | Builds and evidence             | as today                                                                                                                                                        | `docs/guides/source-development.md`, `docs/concepts/evidence.md`, `docs/contributing.md`                    | `harness/AGENT-WORKFLOW.md`, `harness/WORKFLOWS.md`, `harness/TESTING.md`, `harness/AGENTS.md`           |
  | Checks                          | `^harness/src/tests/`, `\.test\.ts$`, `^harness/.*playwright\.config\.ts$`, `^vitest\.config\.ts$`, `^package\.json$`                                           | `docs/guides/regression-tests.md`, `docs/contributing.md`                                                   | `harness/TESTING.md`                                                                                     |
  | Harness implementation coverage | as today                                                                                                                                                        | `docs/reference/cli.md`, `docs/reference/configuration.md`, `docs/concepts/how-it-works.md`                 | `harness/reference/script-api.md`, `harness/reference/cli.md`, `harness/AGENTS.md`, `harness/TESTING.md` |
  | Design-first workflow           | `^harness/src/design(Command)?\.ts$`, `^plugins/vortex/(resources\|agents)/`, `^designs/SITEMAP\.md$`                                                           | `docs/guides/design-a-feature.md`, `docs/concepts/design-first.md`                                          | `harness/AGENT-WORKFLOW.md`, `harness/AGENTS.md`                                                         |
  | Documentation maintenance       | as today                                                                                                                                                        | `docs/contributing.md`                                                                                      | `AGENTS.md`, `harness/KNOWLEDGE-ROUTES.md`, `harness/AGENT-WORKFLOW.md`                                  |

  The "Human benchmark SDK and proposal cases" group is removed.

- **`scripts/docs.test.cjs`:**
  - removes the four example cases (lines 148, 152, 174, 184) and the
    `docs-examples.cjs` `require` (line 7);
  - rewrites the paired-documentation case to use the new pages: the
    "Lifecycle and authentication" pairing with
    `docs/concepts/one-test-vortex.md`, and the missing-page check with
    `docs/get-started/set-up.md`;
  - drops `harness/benchmarks` and `benchmarks` from the fixture copy, and
    adds `plugins`, `.claude-plugin` and `mkdocs.yml`;
  - adds two cases. The first checks that the navigation covers every page,
    reading `mkdocs.yml` as text with no YAML parser:
    - collect the lines matching `^\s*- .*?:\s*(\S+\.md)\s*$` (and bare
      `^\s*- (\S+\.md)\s*$`) that come after `nav:` and before the next
      top-level key;
    - prefix each with `docs/` (nav paths are relative to `docs_dir`) and
      compare them with every `docs/**/*.md`, leaving out `docs/theme/` and
      `docs/stylesheets/`.

    The second checks that a stale
    `commands.md` fails the check.
- `mkdocs.yml` sets `validation.nav.omitted_files: warn`, so `--strict` fails
  on an unlisted page.
- `scripts/docs-run.cjs` drops its reference to the deleted page.

**Phase 3. Plugins (Create/Modify/Delete)**

- **`.claude-plugin/marketplace.json`:**
  `{"name": "doodlebot", "owner": {"name": "doodlum"}, "plugins": [...]}`.
  Each entry is
  `{"name": "<plugin>", "source": "./plugins/<plugin>", "description": "<plugin description>"}`.
- **`.agents/plugins/marketplace.json`:**
  `{"name": "doodlebot", "interface": {"displayName": "Doodlebot"}, "plugins": [...]}`.
  Each entry is
  `{"name", "source", "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"}, "category": "Developer Tools"}`.
- **Claude manifests** carry `name`, `displayName`, `version`, `description`,
  `author: {"name": "doodlum"}`,
  `homepage: "https://doodlum.github.io/vortex-doodlebot/"`,
  `repository: "https://github.com/doodlum/vortex-doodlebot"` and
  `license: "GPL-3.0-only"`. The `vortex` plugin's two agents live in its
  default `agents/` folder, so Claude Code discovers them without an `agents`
  field; listing them as well could register them twice.
- **Codex manifests** carry, at the top level, `name`, `version`,
  `description`, `author`, `homepage`, `repository` and `license`, plus
  `"skills": "./skills/"` and `"requires_local_executor": true`. As in EGM's
  Codex manifest, `displayName` and `shortDescription` sit only inside
  `interface`. `interface` also carries `developerName` "doodlum" and
  `category` "Developer Tools". Per plugin, the table below gives
  `interface.displayName` and `interface.shortDescription`, then
  `interface.capabilities` and `interface.defaultPrompt`, using the key names
  in EGM's `.codex-plugin/plugin.json`:

  | Plugin      | Display name and short description                    | Capabilities                                                                      | Default prompts                                                                                                               |
  | ----------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
  | `doodlebot` | "Doodlebot", "Set up and run a test copy of Vortex"   | "Set up the companion", "Sign in to Nexus Mods", "Start and stop the test Vortex" | "Set up doodlebot on this machine.", "Is doodlebot ready?", "Start the test Vortex with the sandbox game."                    |
  | `vortex`    | "Vortex", "Fix, design and check Vortex changes"      | "Reproduce and fix bugs", "Design features with EGM", "Drive Vortex and report"   | "Reproduce this Vortex bug.", "Check that installing a mod works and report.", "Prepare a pull request for my Vortex branch." |
  | `benchmark` | "Benchmark", "Measure and compare Vortex performance" | "Measure a flow", "Compare two Vortex versions", "Explain the difference"         | "How fast is the Mods table with 3,000 mods?", "Compare 2.8.0 with my branch.", "Is my change slower?"                        |

- **Every skill except `setup`** starts with `doodlebot version --json`. If
  `doodlebot` is not found, it stops and suggests `/doodlebot:setup`.
- **Workspace paths.** Every repository path in a plugin skill or agent body
  is written `<workspace>/<path>`. Examples are `<workspace>/harness/AGENTS.md`,
  `<workspace>/harness/.artifacts/designs/<topic>.md` and
  `<workspace>/.vortex-src`. `<workspace>` comes from
  `doodlebot version --json`, so a command works from any folder.
  - `/vortex:design` passes
    `EGM artifact directory: <workspace>/harness/.artifacts/egm` to EGM
    explicitly.
  - `/vortex:design` gives `doodlebot design …` absolute paths.
  - `plugins.test.ts` checks every inline code span and fenced-block token in
    skill and agent bodies that contains a `harness/`, `designs/` or
    `.vortex-src` path segment. Each must start with `<workspace>/` or
    `${CLAUDE_PLUGIN_ROOT}/`.
- **`plugins/doodlebot/skills/<name>/SKILL.md`**, with frontmatter `name`,
  `description`, `argument-hint`, and `disable-model-invocation` where listed:
  - **`setup`:**
    - **Inputs:** the folder, `--ref` and `--bin-dir`. The cache is whatever
      `VORTEX_AI_CACHE_DIR` selects.
    - **The shim path `<shim>`:** `<bin-dir>/doodlebot.cmd` (or
      `<bin-dir>/doodlebot` outside Windows) when `--bin-dir` is given;
      otherwise the first `.cmd` match from `where.exe doodlebot` on Windows
      (`command -v doodlebot` elsewhere), and then the path `link` prints.
    - **Running doodlebot:** once `link` has run, the skill calls the shim by
      the absolute path that `link` printed (`shim: <path>`), so the run never
      depends on the shell's PATH. When `link` reports `on PATH: no`, the
      skill tells the person which folder to add to their PATH so later
      commands find `doodlebot`.
    - **"Already set up"** means all of:
      - `<dir>/node_modules/.modules.yaml` exists;
      - `<dir>/dist/index.js` exists;
      - `<shim> version --json` reports `<dir>`;
      - `<shim> doctor --installed --sandbox` shows the advisory check
        `Sandbox baseline` with detail `present`.

      When all hold, it only runs `doctor` and reports.

    - **Otherwise** it repairs only what is missing, in this order:
      1. Check Git, Node 20.19 or later, and pnpm 9.15.0; offer corepack for
         pnpm.
      2. Ask for the folder (default `%USERPROFILE%\doodlebot`, or an
         existing checkout).
      3. `git clone https://github.com/doodlum/vortex-doodlebot.git <dir>`
         and check out the ref (default `v<plugin version>`, falling back to
         `main`; a branch is checked out with `--detach origin/<ref>`).
      4. `pnpm install --frozen-lockfile`.
      5. `pnpm run build`.
      6. `node bin/doodlebot.cjs link [--bin-dir]`.
      7. `doodlebot version`.
      8. `doodlebot doctor --installed --sandbox`. If Vortex is missing, it
         says how to install it and stops. If doctor reports the legacy lease
         store, it offers to delete it.
      9. `doodlebot setup --installed --sandbox` in the background.
      10. `doodlebot down`.
    - It ends by reporting what is ready and suggesting `/doodlebot:login`
      and `/vortex:drive`.
  - **`login`:** the `--no-wait` login sequence above. Collections need it;
    local checks do not.
  - **`baseline`:** create or refresh a baseline profile:
    - sandbox: `doodlebot up --installed --sandbox --rebuild-snapshot`;
    - a real game copy: `--game <id> --game-path <dir>`; the game is copied,
      never written;
    - or a source build.

    It then runs `doodlebot down`, so no Vortex is left running.

  - **`start`:** `doodlebot up` with the target named (installed, source,
    sandbox, Bethesda sandbox or real game), in the background; prints the
    MCP endpoint.
  - **`stop`:** `doodlebot down`.
  - **`status`:**
    - runs `doodlebot version --json` and `doodlebot status`;
    - runs `doodlebot auth-status` only when status reports MCP
      "answering";
    - runs `doodlebot doctor` on request;
    - summarizes in plain words.
  - **`update`:** as described under "Versions and updates".
  - **`source`:** `doodlebot source`, then a branch of `.vortex-src`.
- **`plugins/vortex/skills/<name>/SKILL.md`:**
  - **`design`:** the `vortex-elephant` procedure, unchanged in substance.
    - Persona and standard paths become `${CLAUDE_PLUGIN_ROOT}/resources/…`
      (the plugin root in Codex).
    - The Goldfish type is `vortex:vortex-runtime-goldfish`.
    - Report names stay `round-<n>-vortex-runtime-goldfish.md`.
  - **`fix`:** from `vortex-dev`: source if needed, reproduce on the base,
    fix on a branch, verify the reported scenario, evidence; then offer
    `/vortex:pr`.
  - **`drive`:** from `drive-vortex`, plus report mode, delegation, and the
    blocking-command procedure.
  - **`qa`:** independent QA through `vortex:vortex-driver`, with
    `doodlebot up --fresh` and the acceptance criteria.
  - **`ui-test`:** from `vortex-ui-test`: write a Playwright regression test
    in the workspace and run it with `doodlebot test core`.
  - **`pr`:** `doodlebot pr-preflight`, the description from
    `harness/PULL-REQUESTS.md` with the footer, then `doodlebot pr-checks`.
    It never pushes or opens a PR unless asked.
- **`plugins/vortex/agents/vortex-runtime-goldfish.md`:** the current
  adapter (`tools: Read, Grep, Glob`, `model: inherit`,
  `omitClaudeMd: true`), reading
  `${CLAUDE_PLUGIN_ROOT}/resources/vortex_runtime.md`.
- **`plugins/vortex/agents/vortex-driver.md`:** `model: sonnet`,
  `tools: Bash, PowerShell, Read, Write, Grep, Glob`. It carries out a
  scenario with the `doodlebot` CLI and writes the report.
- **`plugins/vortex/resources/vortex_runtime.md` and
  `vortex-change-standard.md`:** moved from `harness/egm/`.
- **Run report**, defined in the `drive` skill and used by `qa`. It is
  written to `<workspace>/harness/.artifacts/runs/<UTC time>-<slug>/report.md`,
  and summarized in chat. The driver copies each screenshot it takes from the
  artifacts folder into the run folder. Sections:
  - **Outcome:** Worked, Worked with errors, Blocked or Failed, with one
    sentence.
  - **Scenario and target.**
  - **Steps.**
  - **Dialogs and prompts answered:** title, button and why.
  - **Errors and warnings:** console errors, `doodlebot log` warnings and
    notifications.
  - **Evidence:** paths.
  - **Not checked.**
- **`plugins/benchmark/skills/measure/SKILL.md` and `compare/SKILL.md`:**
  the procedure under "Benchmarking on command".
- **`.claude/settings.json`** becomes exactly the JSON below. Neither this
  checkout nor EGM's docs confirm that Claude Code resolves a relative
  `directory` marketplace path against the project, so step 10 checks it.
  If the plugins do not appear, the owner runs `/plugin marketplace add ./`
  from the checkout, and the `doodlebot` marketplace entry is removed from
  `settings.json`. The `enabledPlugins` entries and the EGM entry stay. The
  docs then tell developers to add the local marketplace once. The
  `egmResources.test.ts` assertion follows whichever form step 10 confirms.

  ```json
  {
    "extraKnownMarketplaces": {
      "egm": {
        "source": { "source": "github", "repo": "google/elephant-goldfish-model", "ref": "v0.1.1" }
      },
      "doodlebot": { "source": { "source": "directory", "path": "." } }
    },
    "enabledPlugins": {
      "egm@egm": true,
      "doodlebot@doodlebot": true,
      "vortex@doodlebot": true,
      "benchmark@doodlebot": true
    }
  }
  ```

- **`harness/src/plugins.test.ts`** asserts:
  - the manifests, skills and agent frontmatter;
  - name uniqueness and versions;
  - the report templates, by their section headings:
    - the run report in `plugins/vortex/skills/drive/SKILL.md`;
    - the benchmark report in `plugins/benchmark/skills/compare/SKILL.md`
      and `measure/SKILL.md`;
  - that `measure` and `compare` contain the four-step per-run sequence and
    the run-outcome rules from "Benchmarking on command";
  - that the `setup` skill names the legacy lease store.

  It also checks command names. It reads every `plugins/**/*.md`, taking only
  inline code spans that begin with `doodlebot ` and fenced-block lines that
  begin with `doodlebot ` (after optional leading spaces), and matches
  `^doodlebot ([a-z][a-z-]*)( ([a-z][a-z-]*))?` on each. Prose is never
  matched.
  - Spans that do not match (such as `doodlebot <command>`) are ignored.
  - The first group must be a command in `commands.ts`, or `help`.
  - The second group is checked only for commands that have sub-commands.
  - Suite names after `test` are checked against `testCommand.ts`'s list.

- **`egmResources.test.ts`** is updated in step with the files it reads, so
  each phase's checkpoint passes:
  - **Phase 3:** the frontmatter and file assertions point at the new
    persona, standard, agent and skill paths and the new `settings.json`.
    Its assertions on the text of `AGENTS.md` and `AGENT-WORKFLOW.md` stay
    as they are until Phase 5.
  - **Phase 4:** its install-page assertions move to
    `docs/get-started/install.md` (created in that phase), with the same
    strings: `v0.1.1`, both EGM Codex commands, `2.1.271` and `issues/237`.
  - **Phase 5:** its manual-text assertions expect the plugin paths.
- **Deleted:** `.claude/skills/*`, `.claude/agents/*` and `harness/egm/*`.

**Phase 4. Documentation site (Create/Modify/Delete)**

Every page is task-based, in Google developer-documentation style:

- what it is for;
- "Before you begin";
- numbered steps with the commands;
- the expected result;
- "What's next".

`mkdocs.yml` navigation (titles in quotes):

- **"Overview":** `docs/index.md`. What the companion does, the three plugins,
  and how it relates to EGM.
- **"Get started":**
  - "Requirements": `docs/get-started/requirements.md`.
  - "Install the plugins": `install.md`, with Claude Code and Codex sections,
    the EGM install, and EGM's limits per agent (from the old
    `agent-plugins.md`).
  - "Set up doodlebot": `set-up.md`.
  - "Your first session": `first-session.md` (start, drive with a report,
    stop).
- **"Guides":**
  - "Drive Vortex and get a report": `docs/guides/drive-vortex.md`.
  - "Fix a Vortex bug": `fix-a-bug.md`.
  - "Design a feature": `design-a-feature.md`, including approving a design
    (from the old `design-review.md`).
  - "Add a regression test": `regression-tests.md`.
  - "Open a pull request": `pull-requests.md`.
  - "Measure and compare performance": `benchmark.md`.
  - "Sign in to Nexus Mods": `sign-in.md`.
  - "Use real games and baselines": `games-and-baselines.md`.
  - "Work on Vortex source": `source-development.md`.
- **"Concepts":**
  - "How doodlebot works": `docs/concepts/how-it-works.md`.
  - "One test Vortex at a time": `one-test-vortex.md`.
  - "Design first": `design-first.md`.
  - "Evidence and readiness": `evidence.md`.
- **"Reference":**
  - "Commands": `docs/reference/commands.md`, generated.
  - "doodlebot CLI": `cli.md`, generated.
  - "Configuration": `configuration.md`.
  - "MCP tools": `mcp-tools.md`, generated.
  - "Run report": `run-report.md`.
  - "Benchmark report": `benchmark-report.md`.
- **"Help":**
  - "Troubleshooting": `docs/troubleshooting.md`.
  - "Security and privacy": `docs/security.md`.
  - "Contribute": `docs/contributing.md`, absorbing
    `maintaining-documentation.md`, `testing/unit.md` and `integration.md`.
  - "Credits": `docs/credits.md`.

Deleted:

- `docs/getting-started/first-session.md` and `setup.md`.
- `docs/guides/ui-automation.md`, `calling-tools.md`, `capture.md`,
  `mod-workflows.md`, `evidence.md`, `agent-plugins.md` and
  `design-review.md`.
- Every `docs/testing/*.md`.
- `docs/reference/index.md`, `sessions.md`, `runner.md`, `tables.md`,
  `collections.md`, `results.md` and `package-scripts.md`.
- `docs/architecture.md` and `docs/maintaining-documentation.md`.

`README.md` becomes a short introduction with the install commands and a link
to the site.

**Phase 5. Agent manuals and the companion test (Modify/Create)**

- Manuals: `AGENTS.md`, `harness/AGENTS.md`, `harness/AGENT-WORKFLOW.md`,
  `harness/WORKFLOWS.md`, `harness/TESTING.md`,
  `harness/KNOWLEDGE-ROUTES.md`, `harness/PULL-REQUESTS.md`, `KNOWLEDGE.md`
  and `ARCHITECTURE.md`:
  - commands become `doodlebot …`, and skill paths become plugin paths;
  - the instance record path becomes `~/.doodlebot/instance.json`;
  - the benchmark SDK sections and benchmark-only knowledge entries are
    removed;
  - the "Human benchmark documentation" and "two documentation audiences"
    sections are replaced by "the site documents setup and commands for
    people; the manuals document internals for agents";
  - `AGENTS.md` names `plugins/vortex/skills/design/SKILL.md` as the
    Elephant procedure;
  - `KNOWLEDGE.md` gains an entry. On Windows, a command that launches
    Vortex (`doodlebot up`), run with its output captured, can keep the
    capture open so it never returns. Run it in the background with output
    to a log file instead.
- `harness/reference/*.md` are regenerated.
- `harness/src/companion.test.ts` scans tracked and untracked non-ignored
  files, as `singleInstance.test.ts` does.
  - It fails on `pnpm run ai`, `pnpm --silent run ai`, `run ai -- `,
    `ai:test`, `pnpm run setup`, `pnpm run benchmark`, `my-first-test`,
    `harness/benchmarks`, `withVortex(` or `BenchmarkSession`.
  - The allow-list is exactly `designs/egm-workflow.md`,
    `designs/agent-companion.md`, `harness/src/companion.test.ts`,
    `harness/src/singleInstance.test.ts` and
    `harness/src/readiness.test.ts`.
  - It asserts CI parity. Within the `ci:` job of `ci.yml` (from the line
    `  ci:` to the next line at the same two-space indentation), the lines
    matching `^\s+- run: pnpm run (\S+)$` must list the same scripts, in the
    same order, as the `ci` script split on `&&`.

### Verification Plan

Task kind `feature`, target `doodlebot`, contracts `public-api`, `runtime`
and `persistent-data`.

Shorthand:

- `E` is `node bin/doodlebot.cjs evidence run --checkout . --base 802ce4a4d798b18dfc0e5e0c3af78c5b7bf8565b`.
- `A` is `harness/.artifacts/agent-companion`.
- Every output and report path is new, and every attempt is kept.

**Readiness entries** (one per role):

- `scoped-tests`: step 1.
- `kit-ci`: step 2.
- `control`: step 3.
- `kit-core`: step 4.
- `design-review`: the confirmation round.
- `review`: one entry carrying every artifact of steps 5–12, with criteria
  `doodlebot-cli`, `one-instance-machine-wide`, `defects-fixed`,
  `setup-skill`, `driven-run-report`, `benchmark-commands`, `plugins-load`
  and `docs-walkthrough`. Its `inspectedBy` is an independent reviewer, not
  the author, who inspects every step's artifacts, including the record of
  the owner's step 10, before the entry becomes `pass`.

**Not applicable:**

- `app-qa`: no Vortex behavior changes.
- `performance`: no measured code changes.
- `vortex-e2e`: not a Vortex change.

**Readiness and the pull request.** The pull request is opened as a draft
after step 12. Until the owner completes step 10, the single `review` entry
is `blocked`. Readiness then reports `review: blocked` and "no passing
evidence" for every criterion that entry carries, so it is not ready. After
step 10 the entry is recorded as passing, final readiness is run, and the
pull request is marked ready.

**Prerequisites** for steps 5–10:

- the work is committed and pushed to `egm-overhaul`;
- GitHub and the npm registry are reachable, and
  `https://github.com/doodlum/vortex-doodlebot.git` can be cloned (it is
  public, or this machine's Git credentials can read it);
- `.vortex-src` in this checkout exists and is built (otherwise the dev-dir
  part of step 5 is blocked);
- the checkout's folder name is written below as `<name>` (here
  `doodlebot`).

**Final head.** Steps 1–10 run on the final committed and pushed head. Any
code change after a step means rerunning that step, and every step whose
evidence depends on the changed files. Each step records `git rev-parse HEAD`
of the checkout it ran, and that value must equal the manifest subject's
`headSha`. The `review` entry's artifacts include those records.

**Target guard.** Every app step reads the `target:` line that `up` (or
`setup`) prints for the step's own flags and environment, and stops if the
kind or executable is not the one the step names: `installed` with X, or
`dev` with the named checkout. This catches a gitignored `harness/.env` that
overrides the environment.

1. **Scoped tests** (`scoped-tests`). Criteria: `plugin-manifests`,
   `commands-use-real-cli`, `doodlebot-cli`, `one-instance-machine-wide`,
   `standalone-removed`, `defects-fixed`, `benchmark-commands`.
   - **Command:**
     `E --out A/scoped.json --test-format vitest --test-report A/scoped-tests.json -- pnpm exec vitest run <files> --reporter=json --outputFile A/scoped-tests.json`.
   - **Files** (under `harness/src` unless noted):
     - new tests: `plugins.test.ts`, `commands.test.ts`, `companion.test.ts`,
       `versionCommand.test.ts`, `linkCommand.test.ts`, `update.test.ts`,
       `testCommand.test.ts`, `fixtureCommand.test.ts`, `logCommand.test.ts`,
       `perfSummary.test.ts`, `doctor.test.ts`;
     - changed tests: `cliArgs.test.ts`, `config.test.ts`,
       `readiness.test.ts`, `runningVortex.test.ts`,
       `instance.test.ts`, `egmResources.test.ts`, `bootstrap.test.ts`,
       `configRelativeDevDir.test.ts` (new),
       `evidence.test.ts`, `fixtureCleanup.test.ts`, `sourceBuild.test.ts`,
       `vortexBuild.test.ts`, `vortexE2e.test.ts`, `processRunner.test.ts`,
       and `src/uiAutomation.test.ts`.
2. **Kit gate** (`kit-ci`). Criteria: `commands-documented`,
   `docs-walkthrough`, and all others.
   - **Command:** `E --out A/ci.json -- pnpm run ci`. The `review` entry
     quotes the name of the `docs.test.cjs` stale-`commands.md` case and its
     pass line from the receipt's output.
3. **Intended-assertion control** (`control`, `intended-assertion`).
   Criterion: `defects-fixed`.
   - **Command:**
     `node bin/doodlebot.cjs pr-preflight --checkout . --base 802ce4a4d798b18dfc0e5e0c3af78c5b7bf8565b --test harness/src/configRelativeDevDir.test.ts --revert harness/src/config.ts --json > A/preflight.json`,
     run after commit, with a clean tree.
   - **Command receipt:** A/scoped.json.
   - **Assessment:** `A/preflight.json`. Its expected assertion: a relative
     `--dev-dir` or `VORTEX_AI_DEV_DIR` resolves to the dev target with the
     absolute `sourceDir`.
   - **Expected:** the branch passes. The reverted run loads (the test uses
     only `resolveTarget`) and fails in the relative-dev-dir test with
     `ERR_INVALID_ARG_VALUE` ("must be a file URL object, file URL string, or
     absolute path string"). That text is recorded as the observed assertion
     and must appear in the reverted output.
   - **Not covered:** the path-rule half of the fix (`cliArgs.ts`). The live
     run in step 5 is its only proof.
4. **Core suite** (`kit-core`). Criterion: `doodlebot-cli`.
   - **Environment:** the app environment, with X.
   - **Command:** `node bin/doodlebot.cjs down`, then
     `node bin/doodlebot.cjs evidence runtime --kind installed --label 2.8.0 --mode production X <X folder>/resources/app.asar dist/index.js > A/runtime.json`.
     Then, with `PLAYWRIGHT_JSON_OUTPUT_FILE` set to a new absolute path,
     `E --out A/core.json --runtime A/runtime.json --test-format playwright --test-report <same path> -- node bin/doodlebot.cjs test core --reporter=json`.
   - **Base:** the base result is
     `C:/dev/doodlebot/harness/.artifacts/egm-overhaul/core.json`, recorded
     on this base's tree with identical X bytes (21/21, no skips). It goes
     into the `review` entry with its SHA-256.
   - **Expected:** the change passes 21/21 with no skips.
     - `kit-core` uses one complete passing receipt.
     - If an attempt fails, the whole suite is rerun up to twice, and every
       failing attempt goes into the `review` entry.
     - A failure the base did not have blocks the step, whatever the reruns
       show. It is a regression to fix, not a flake to pass.
5. **Live CLI checks** (`review`). Criteria: `doodlebot-cli`,
   `defects-fixed`, `one-instance-machine-wide`.
   - **Link and version:**
     - With a new temporary bin folder prepended to `PATH`, run
       `node bin/doodlebot.cjs link --bin-dir <bin>`. It must print
       `on PATH: yes`, and the SHA-256 of `node_modules/.modules.yaml` must
       be unchanged.
     - From another folder, the first `.cmd` match that `where.exe doodlebot`
       prints is in `<bin>`, and `doodlebot version --json` reports
       `workspace` equal to this checkout's real path. Both PowerShell 5.1 and
       cmd are checked.
     - In Git Bash, `command -v doodlebot` resolves into `<bin>`, and bare
       `doodlebot version --json` reports the same workspace. That proves the
       extensionless shim.
     - `doodlebot doctor --dev-dir <a new empty temporary folder>` prints a
       failing `Vortex` check with the `ConfigError` text and does not
       crash. That proves the `doctor`-only catch.
   - **Relative `--dev-dir`:**
     - Run from the parent folder, in a new temporary cache with its
       tombstone. Set `VORTEX_AI_SOURCE_DIR` to a path that does not exist,
       so the managed default cannot be used, and unset
       `VORTEX_AI_EXE`/`VORTEX_AI_INSTALLED`.
     - Run `doodlebot up --dev-dir <name>/.vortex-src --sandbox` in the
       background with a log. The `target:` line it prints must give the kind
       `dev`. This step expects `dev` despite the unset installed variables.
     - `~/.doodlebot/instance.json` must give a `sourceDir` equal to the
       absolute `.vortex-src`. Then `doodlebot down`.
     - **Base comparison:** clone the base commit 802ce4a from this checkout
       into a temporary folder, then run `pnpm install --frozen-lockfile` and
       `pnpm run build`. With the same environment, from that clone's root,
       run `pnpm run ai -- up --dev-dir <relative path from the clone to this checkout's .vortex-src> --sandbox`.
       Its log must contain `target: installed — ` followed by nothing, and
       `No Vortex executable resolved`. No Vortex may start: no
       `instance.json` appears in the base clone's `harness/.cache`, and the
       `Vortex.exe`/`electron.exe` process list is the same before and after.
   - **One instance across workspaces:**
     - This sub-step starts again from the app environment, with X. The
       dev-dir sub-step's changed variables are not kept.
     - Make a second clone of the pushed `egm-overhaul` in a temporary
       folder, then install and build it.
     - Give each workspace its own new temporary cache, with its own
       tombstone written by its own kit. Each tombstone run prints its
       `cacheDir`, which shows the two differ.
     - The target guard (installed, X) applies in both directions.
     - **Direction 1:** start `doodlebot up --sandbox` from this checkout.
       `node <second clone>/bin/doodlebot.cjs up --sandbox` must refuse with
       `A harness Vortex is running`, and the first pid must still be alive.
       Then `doodlebot down`.
     - **Direction 2:** the same, with the roles swapped.
   - **Clean up:** delete the temporary caches, the bin folder and the base
     clone. The second clone is kept for step 6b.
6. **Setup skill** (`review`). Criterion: `setup-skill`.
   - **Run:** the agent follows `plugins/doodlebot/skills/setup/SKILL.md`
     inline, in the app environment, with:
     - a new temporary folder;
     - `--ref egm-overhaul`;
     - `--bin-dir <new temporary bin>`;
     - that bin folder prepended to `PATH`.

     The agent pauses after the skill's `link` step, and writes the
     tombstone for the new cache with the new workspace's kit, before the
     skill launches Vortex.

   - **Observations:**
     - `node_modules/.modules.yaml` and `dist/index.js` exist;
     - `<shim> version --json` reports the temporary workspace;
     - `<shim> doctor --installed --sandbox` reports
       the advisory check `Sandbox baseline` with detail `present` and the
       marker's path;
     - the legacy lease store: its existence is recorded before the run. If
       it exists, `doctor` lists `Legacy lease store` and the skill presents
       the deletion offer; the deletion is left to the owner. If it is
       absent, the skill's `doctor` step is run once more, read-only (doctor
       launches nothing), with `USERPROFILE` and `HOME` pointed at a
       temporary home holding `.vortex-ai\leases`. That run must list it,
       and the skill must present the offer. Either way the sub-check can
       pass, and nothing is created in the real home folder;
     - no instance record remains.
   - **Second run:** it reuses the first run's cache, bin folder and `PATH`,
     and reports "already set up". Recorded before and after, all unchanged:
     - the SHA-256 and timestamps of `node_modules/.modules.yaml` and
       `dist/index.js`;
     - the baseline marker's path, SHA-256 and timestamp.

     No Vortex process and no instance record appears during the run. The
     `Vortex.exe`/`electron.exe` process list and the record's existence are
     compared before and after.

   - **Rerun rule:** this step runs on the final pushed head. A later code
     change means running it again.

   **6b. Update** (`review`; `doodlebot-cli`), in the step-6 workspace:
   - Keep the final updater bytes, and move that workspace's HEAD off the
     target. The workspace is already at `origin/egm-overhaul`, detached.
     Make an empty local commit with
     `git -C <ws> -c user.name=doodlebot -c user.email=doodlebot@invalid commit --allow-empty -m probe`.
     The tree stays clean, and HEAD now differs from `origin/egm-overhaul`.
     Record HEAD.
   - `node <ws>/bin/doodlebot.cjs update --ref egm-overhaul` must leave HEAD
     equal to `git -C <ws> rev-parse origin/egm-overhaul`. Its log must show
     `pnpm install` and `pnpm run build` running.
   - With `node <ws>/bin/doodlebot.cjs up --sandbox` running, the same
     `update` must refuse with the running-Vortex message. Then `down`.
   - This checkout's HEAD and `git status` must be unchanged throughout.
   - **Clean up:** delete the step-6 workspace, the bin folder and the second
     clone.

7. **Benchmark compare** (`review`). Criterion: `benchmark-commands`.
   - **Run:** in the app environment, the agent follows the `compare` skill
     inline: X against X with `mods-scroll --mods 300`, five runs each,
     alternating. Every run records `automation_status.vortexVersion`, which
     must be 2.8.0; steps 4 and 8 record it too.
   - **Measure:** the agent then follows the `measure` skill once: X,
     `mods-scroll --mods 300`, three runs. Its report must have every section
     except the verdict.
   - **Expected:**
     - the report has every section;
     - for every `mods-scroll` metric in the table, a separate script (not
       `perfSummary.ts`, kept in `A`) recomputes directly from the ten
       evidence files:
       - the median, minimum, maximum and count per side;
       - the percent difference;
       - the per-metric verdict.

       All of them must equal the report's;

     - the overall verdict is _No clear difference_.
   - **Other verdicts:** the expected chance of another verdict is about 4%.
     If it happens, the whole comparison is rerun once with every attempt
     kept. The step passes if the rerun gives _No clear difference_, and both
     results are reported.
8. **Driven run** (`review`). Criterion: `driven-run-report`.
   - **Environment:** the app environment.
   - **Setup:**
     1. `doodlebot fixture mod --out <temp>/probe.zip`.
     2. `doodlebot up --sandbox`.
     3. `doodlebot install <temp>/probe.zip`.
     4. Record the mod's name, id and install time through
        `doodlebot call vortex_query`.
     5. From a separate shell (not the driver), run
        `doodlebot eval --expr "console.error('report-probe')"`, and record
        the renderer lifetime ID from `automation_status`.

     The `drive` procedure does not restart a running instance: when
     `doodlebot status` already reports MCP answering for the configured
     cache, it uses that instance and skips `up`. It reads the console from
     sequence 0 as its last step before writing the report. The renderer
     lifetime ID is recorded again after the run and must be unchanged, so
     the probe is still in the buffer.

   - **Scenario:** the agent follows the `drive` skill's report procedure
     inline, with the scenario "enable the probe mod and deploy; then install
     the same archive again and keep the existing mod".
   - **Expected:**
     - The reinstall raises a dialog whose text matches
       `/is already installed on your system/` (title "Install options" in
       current source). The driver records the exact title and buttons it
       sees on X.
     - Any dialog before that one (for example a duplicate-download prompt)
       is answered with the choice that continues the install, and is
       recorded too.
     - If no `/is already installed on your system/` dialog appears within
       the install timeout, the step is recorded as failed (or blocked), with
       the dialogs seen. It does not pass.
     - The driver answers with the button that keeps the existing mod
       (**Cancel** in current source), within `install`'s 300-second limit.
       The background `install` then ends, and its exit code is recorded.
     - The report lists that dialog and its button under Dialogs, and
       `report-probe` under Errors and warnings.
   - **Independent checks:**
     - the deployed `<gamePath>/Data/textures/automation-probe.txt` holds
       `automation-probe`;
     - `doodlebot call vortex_query` shows exactly one probe mod, with the
       recorded id and install time, enabled;
     - every screenshot path in the report exists.
   - **Clean up:** `doodlebot down`, then delete the cache.
9. **Site** (`review`). Criterion: `docs-walkthrough`.
   - **Prerequisite:** `gh` is authenticated with workflow permission.
     Running the workflow is authorized below.
   - **Run:** `gh workflow run docs.yml --ref egm-overhaul`. The copy of
     `docs.yml` on `main` already has `workflow_dispatch`; a dispatch on this
     branch was run on 2026-11-09. Then:
     - find the run with
       `gh run list --workflow docs.yml --branch egm-overhaul --event workflow_dispatch --limit 5 --json databaseId,headSha,createdAt`,
       polling until a run whose `headSha` equals the manifest head appears;
     - run `gh run watch <id> --exit-status`.
   - **Fallback:** if dispatch is unavailable, use the `pull_request` run on
     the draft PR.
   - **Expected:** the run succeeds, with its build using `--strict`.
   - **Review:** a fresh-context reviewer reads the site as a new user and
     checks every page against the commands and the CLI.
10. **Owner checks** (`review`). Criteria: `plugins-load`,
    `driven-run-report`.
    - **Prerequisites (owner-provided):**
      - Claude Code 2.1.271 or later.
      - Before starting Claude Code, on the final head, the agent runs
        `node bin/doodlebot.cjs link --bin-dir <a folder on the owner's PATH>`.
        It first records any existing `doodlebot` shim there, and restores
        it after step 10.
      - The agent writes the tombstone for a new temporary
        `VORTEX_AI_CACHE_DIR`.
      - The owner starts Claude Code with the app environment:
        `VORTEX_AI_EXE=X`, `VORTEX_AI_INSTALLED=1` and that cache.
      - In that cache, before the owner sends `/vortex:drive`, the agent runs
        step 8's setup items 1–5.
    - **Agent checks:** the agent records:
      - the `target:` line that the setup `up` prints, which must be
        installed and X;
      - that the `commit` from `doodlebot version --json` equals the
        manifest's `headSha`;
      - the renderer lifetime ID before and after, which must be unchanged.
    - **In Claude Code**, with this checkout open, the owner:
      - runs `/plugin` and confirms the three plugins and their commands;
      - runs `/agents` and confirms each plugin agent appears once, with no
        error about its `tools` list;
      - runs `/vortex:drive` with step 8's scenario and setup. It must
        delegate to `vortex:vortex-driver` and return a report with every
        section. The agent then applies step 8's independent checks to that
        report;
      - asks for a review of a small design, and confirms that
        `vortex:vortex-runtime-goldfish`'s report begins with
        `Reviewed content sha256:` (the persona's rule) and cites a rule found
        only in the standard, such as its required-sections list.
    - **Recording:** the agent records what the owner reports. Without the
      owner, this step is blocked.
    - **Codex:** checked by the owner after merge (Non-Goals), and listed as
      pending in the pull request.
11. **Scope:**
    `node bin/doodlebot.cjs design scope designs/agent-companion.md --checkout . --base 802ce4a4d798b18dfc0e5e0c3af78c5b7bf8565b --json`
    reports nothing outside the boundary.
12. **Independent review** (`review`): a fresh five-lens review of the diff
    with skeptic verification, then a re-review of the fixes. Readiness on
    the final tree follows step 10.

**Authorization.** The owner, in chat on 2026-11-09:

- asked for this repositioning;
- chose the workspace runtime;
- asked for separate doodlebot, Vortex and benchmark command groups, a
  `doodlebot` CLI, and driven runs on a low-cost model;
- asked to replace the benchmark engine with agent benchmarking and version
  comparison;
- set the goal of filing the pull request.

Approving this design authorizes:

- the verification steps, including launching disposable instances of X and
  the existing `.vortex-src` build (no source changes);
- temporary clones from GitHub;
- dispatching the Documentation workflow on the branch;
- committing to `egm-overhaul`, pushing it, and opening the pull request to
  `main` as a draft, then marking it ready after step 10.

The agent never closes the owner's own Vortex, never runs a Vortex
installer, and never deletes the owner's legacy lease store without a yes.
