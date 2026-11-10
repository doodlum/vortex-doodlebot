# doodlebot operating manual

doodlebot is the agent companion for Vortex, the Nexus Mods mod manager. Its Vortex extension is
an MCP server exposing Vortex's state and UI; the harness (this directory, CLI `doodlebot`)
launches isolated profiles of an unmodified Vortex, drives them, captures evidence and runs
Playwright checks. People use it from Claude Code or Codex through one plugin whose commands
call the CLI. A source checkout is optional.

This is the AI operating manual: it documents internals for agents. The site
([docs/index.md](../docs/index.md)) documents setup and commands for people. When shared
behavior changes, update both: `pnpm run docs:generate` refreshes the generated references, and
`pnpm run docs:check` enforces the mapping in `scripts/documentation-map.json`.

- [KNOWLEDGE-ROUTES.md](KNOWLEDGE-ROUTES.md): shared specialist reading paths and evidence rules.
- [KNOWLEDGE.md](../KNOWLEDGE.md): confirmed pitfalls; search the affected area and recheck its scope.
- [WORKFLOWS.md](WORKFLOWS.md): bug reproduction, features, design-first work, supplied visual
  designs, state and window-size matrices.
- [PULL-REQUESTS.md](PULL-REQUESTS.md): Vortex PR titles, description template, reviews.
- [AGENT-WORKFLOW.md](AGENT-WORKFLOW.md): canonical task routing, delegation and handoff.
- [TESTING.md](TESTING.md): kit gates, the core suite and opt-in checks.
- `plugins/doodlebot/`: the plugin (below). Apply the relevant skills; `plugins/doodlebot/skills/design/SKILL.md` (`/doodlebot:design`) is the design-first
  procedure for features and refactors.
- [ARCHITECTURE.md](../ARCHITECTURE.md): where a new capability belongs.

When developing Vortex, **read and follow its own `AGENTS.md`, `CLAUDE.md` when present, its
documentation index and task-specific AI guidance before editing its source**.

## The plugin, the workspace and the `doodlebot` command

This repository is a plugin marketplace named `doodlebot` with one plugin, `doodlebot`. Claude
Code reads `.claude-plugin/marketplace.json`, Codex `.agents/plugins/marketplace.json`; both list
it with `source` `./plugins/doodlebot`. It has a Claude manifest (`.claude-plugin/plugin.json`,
with `icon`) and a Codex manifest (`.codex-plugin/plugin.json`, `"skills": "./skills/"`, with
`brandColor`, `composerIcon` and `logo`); both manifest `version`s equal `package.json`'s. The
icon is `plugins/doodlebot/assets/icon.png` (512×512, rendered from `icon.svg`). Claude Code
ignores `icon` at load time; Codex shows it in its plugin picker.

| Group (`docs/reference/commands.md`) | Skills (`plugins/doodlebot/skills/<name>/SKILL.md`)                         |
| ------------------------------------ | --------------------------------------------------------------------------- |
| Set up and run the test Vortex       | `setup`, `login`, `baseline`, `start`, `stop`, `status`, `update`, `source` |
| Work on Vortex                       | `design`, `fix`, `drive`, `qa`, `ui-test`, `pr`                             |
| Benchmark                            | `measure`, `compare`                                                        |

Agents: `plugins/doodlebot/agents/vortex-runtime-goldfish.md` and `vortex-driver.md`. The
groups are `COMMAND_GROUPS` in `scripts/docs.cjs`; every skill must be in exactly one.

- Commands are `/doodlebot:<skill>` in Claude Code (`/doodlebot:drive`). Claude Code namespaces
  plugin agents: skills dispatch `doodlebot:vortex-runtime-goldfish` and `doodlebot:vortex-driver`
  (`model: sonnet`). Codex plugins ship no agents; there the skills run the procedure inline or
  give a general-purpose subagent the persona file.
- `plugins/doodlebot/resources/` holds the EGM persona `vortex_runtime.md`, the document
  standard `vortex-change-standard.md`, and `knowledge.md`, the procedure skills follow to search
  and record lessons ("Knowledge" below). Skills and agents reach them through
  `${CLAUDE_PLUGIN_ROOT}/resources/…` (in Codex, the plugin root is three folders above a
  `SKILL.md`).
- Every repository path in a skill or agent body is written `<workspace>/<path>` or
  `${CLAUDE_PLUGIN_ROOT}/<path>`; every skill except `setup` starts with
  `doodlebot version --json`, takes `<workspace>` from it, and suggests `/doodlebot:update`
  when its version differs from the plugin's. Skills may name only commands in
  `harness/src/commands.ts`. `harness/src/plugins.test.ts` asserts all of this, and
  `docs/reference/commands.md` is generated from the skills.
- In this checkout `.claude/settings.json` registers the EGM marketplace (pinned to `v0.1.1`)
  and this folder as the `doodlebot` marketplace, and enables `egm@egm` and `doodlebot@doodlebot`.
  After editing a plugin, run `/plugin marketplace update doodlebot`.

A **workspace** is a clone of this repository with dependencies installed and the extension
built; `/doodlebot:setup` creates one (default `%USERPROFILE%\doodlebot`), and a doodlebot
developer may use their own checkout. Caches, profiles, artifacts and `.vortex-src` live in the
workspace, relative to its root.

`bin/doodlebot.cjs` is the CLI entry point. It finds the workspace from its own location and runs
`harness/src/cli.ts` with the workspace's tsx, with the workspace root as the working directory,
`INIT_CWD` set to the caller's directory, inherited stdio, and the CLI's exit code (or
`128 + n` after a signal). Paths you type in flags and positional files resolve against the
caller's directory; kit defaults resolve against the workspace root. Everything after
`doodlebot test <suite>` passes through verbatim and resolves against the workspace root. Where
the shim may not exist (CI, evidence receipts, a fresh clone), run `node bin/doodlebot.cjs …`
from the workspace root.

| Command                           | What it does                                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `doodlebot version [--json]`      | `doodlebot <version> (<commit>[, modified]) at <workspace>`; `--json` prints `{version, commit, dirty, workspace}`                                         |
| `doodlebot link [--bin-dir <d>]`  | Writes `doodlebot.cmd` (Windows) and an extensionless `doodlebot` script into a folder on the PATH; prints `shim: <path>` and `on PATH: yes\|no`           |
| `doodlebot update --ref <ref>`    | Handled by `bin/update.cjs` before tsx loads: moves the workspace to a tag or branch of origin, then `pnpm install --frozen-lockfile` and `pnpm run build` |
| `doodlebot test <suite> [args…]`  | Runs a Playwright suite or check script from the workspace root; `doodlebot test --list` lists them (`harness/src/testCommand.ts`)                         |
| `doodlebot fixture mod --out <z>` | Writes a mod archive with one file, `textures/<name>.txt` (`--name`, default `automation-probe`)                                                           |
| `doodlebot log`                   | The running instance's `<userDataDir>/vortex.log`, filtered: `--level info\|warn\|error` (default `warn`), `--tail <n>` (50), `--since <ISO>`, `--json`    |
| `doodlebot perf-summary`          | Medians, ranges and verdicts from performance-check evidence (`harness/src/perfSummary.ts`; "Opt-in checks")                                               |
| `doodlebot knowledge <sub>`       | Lessons verified on this machine in `~/.doodlebot/knowledge.md`: `add`, `search` (also reads `KNOWLEDGE.md`), `list`, `remove`, `path` ("Knowledge")       |

- `link` writes no `.ps1` and spawns no `npm`. Without `--bin-dir` it takes the first of these
  that is on the PATH and writable: `npm_config_prefix` (its `bin` outside Windows); on Windows
  `%APPDATA%\npm`, then Node's own folder (nvm-windows); elsewhere `<dirname(dirname(node))>/bin`.
  Otherwise it fails with
  `No writable folder on the PATH for the doodlebot shim; pass --bin-dir <folder>.` On Windows,
  look the shim up with the first `.cmd` line of `where.exe doodlebot`; PowerShell's `where` is
  `Where-Object`.
- `update` needs `--ref <tag or branch>` (`^[A-Za-z0-9._/-]+$`). It refuses while
  `~/.doodlebot/instance.json` (or the older `harness/.cache/instance.json`) names a running
  Vortex (`A harness Vortex is running; run doodlebot down before updating.`) and when
  `git status --porcelain` is not empty
  (`The workspace has local changes; commit or remove them before updating.`). A tag is checked
  out with `--detach refs/tags/<ref>`, a branch with `--detach FETCH_HEAD`; neither gives
  `No tag or branch <ref> on origin.`
- `up`, `setup`, `test` and `install` can outlive an agent's tool timeout or wait on a dialog,
  and on Windows a captured `up` may never return (KNOWLEDGE.md). Run them in the background
  with output to a log in `harness/.artifacts/runs/`, and wait for the background process to
  exit. A launch is done when that process has exited and its log has the success line
  (`Vortex is up in` for `up`; `Ready:` for `setup`; for `setup --oauth`, a line ending
  `Setup complete.`, or with `--no-wait` also `Initial setup: click Log in`, which without
  `--no-wait` is printed before the wait and is not success). A cold
  start launches Vortex up to three times on the same port, so `doodlebot status` answering
  is only a liveness hint, never completion. For a command that may raise a dialog, poll
  `doodlebot call ui_active_dialogs`, take `doodlebot snapshot` for the button's ref and answer
  with `doodlebot click --ref <ref>` (`install` times out after 300 s). `install`'s own
  dialog and FOMOD watchers (`autoAnswerDialogs`, `autoAdvanceFomods`) snapshot while it
  runs, so take the snapshot and click in one call and retry on `Stale or unknown ref`. A
  Cancel answer ends `install` with exit 1 and `McpError: canceled by user`.

## Initial setup

Windows, a Node version compatible with package.json, the pinned pnpm (`pnpm@9.15.0`), Git and an
installed Vortex. No game or Nexus account is needed for sandbox tests. `/doodlebot:setup` does
all of this; by hand, from the workspace root:

```powershell
pnpm install --frozen-lockfile
pnpm run build
node bin/doodlebot.cjs link                    # puts doodlebot on the PATH
doodlebot doctor --installed --sandbox
doodlebot setup --installed --sandbox          # in the background, with a log
doodlebot snapshot
doodlebot down
doodlebot test core
```

- `setup` builds the extension when missing and starts an isolated Vortex. `--sandbox` is a
  disposable game with a tiny game-support extension: real archive install, enable, deploy and
  purge, no playable game. `--no-game`: global UI only. A real game:
  `--game <id> --game-path <dir>` (a disposable copy). An invalid explicit path fails, never
  falling back to a real install; without one, common games are found through Steam.
- Use the **same target, game and cache flags on every command** for a profile. Persist regular
  choices in the gitignored `harness/.env`. `VORTEX_AI_INSTALLED=1` makes tests use the installed
  build even when a source checkout exists.
- The extension id is `doodlebot`; the old `vortex-mcp` plugin folder is removed from harness
  profiles automatically.
- On pnpm layout errors, compare `pnpm --version` with package.json before touching the lockfile.
  Vortex checkouts use their `packageManager` pnpm, via `pnpm dlx` when PATH differs (or
  `VORTEX_AI_PNPM`).
- A sandboxed agent may need host approval to launch processes or GUI apps. That is not an OAuth
  or Vortex setup step.

## Nexus login (OAuth): interact once, cache automatically

Local automation needs no account. Collections need OAuth: an API key alone can make `isLoggedIn`
true while collection downloads fail. Don't ask for an API key for local tests or builds.

```powershell
doodlebot setup --oauth --installed     # waits up to 10 min; --no-wait returns at once
doodlebot save-login --installed        # after a timeout or --no-wait, once logged in
doodlebot auth-status                   # presence booleans, never secrets
doodlebot login-import --cache-dir D:\other-cache [--from D:\old-cache] [--force]
```

- From an agent (`/doodlebot:login`): run `doodlebot setup --oauth --installed --no-wait`, ask
  the person to log in, poll `doodlebot auth-status`, then run `doodlebot save-login --installed`.
- setup clears any seeded API key in its isolated profile so Log in appears. **The account owner**
  clicks Log in and completes the browser flow (password, MFA, captcha); agents do the rest. It
  caches access and refresh credentials and checks a fresh restore still has them.
- `save-login` refuses an unsigned or API-key-only profile and one that cannot shut down cleanly.
- **Never put passwords, API keys or OAuth tokens in chat or committed files.** Cache directories
  hold credentials: keep them private (the default is gitignored).
- The login cache is per target (installed or source build), independent of game and API key.
  Fresh and rebuilt profiles inherit credentials, not mod lists or game paths. The extension writes
  `oauth-<target>.json` in harness mode only, on every token rotation; only a real logout writes a
  `null` tombstone. Vortex's forced-logout migration is handled (KNOWLEDGE.md).
- Credential presence does not prove Nexus still accepts them; a revoked login means repeating
  `setup --oauth`.
- A nondefault cache with no OAuth file can inherit the default cache's login automatically.
  A new cache is therefore not proof of anonymous execution; core fixtures write an explicit
  null OAuth tombstone. `login-import` copies the login from `harness/.cache` (or
  `--from`) for the target `--installed`/`--dev-dir` selects; it refuses a logged-out source and
  replaces a login only with `--force`. Copies then rotate apart; if Nexus refuses one, import
  again or repeat setup.
- Optional legacy key: `VORTEX_AI_NEXUS_API_KEY` in `harness/.env`.

## Run and reset

Cold bootstrap registers the selected path with activation disabled, awaits a clean stop,
then launches that same private profile with Vortex's `--game <id>` argument. Await the
active game and verify its discovered path before writing the snapshot marker. This invokes
Vortex's native profile/staging setup even when the Games UI omits locally discovered games.
Do not replace it with a synthetic profile dispatch. Conflicting target `--game`/`--profile`
arguments fail before launch. `--no-game` retains its single cold launch. Setup and shutdown
failures remain separate causes when both occur.

Native `collection` (`installCollection` in `collections.ts`, with the stock completion-view
verifier `waitForCollectionCompletion` from `collectionCompletion.ts`) verifies that the selected
collection's stock install driver reaches review with post-processing finished and its visible
progress panel gone. The coordinator keeps dialog/FOMOD automation alive through this boundary.
A finished driver with a persistent progress panel fails with retained UI evidence; an
unobservable driver fails with `CompletionUnobservable`. Do not resume skipped optional members,
hide the UI, or patch Vortex to obtain a pass. The selected page must be visible and driver
fields readable. Completed-driver render settling has a 30-second grace inside the overall
installation timeout. The read-only `inspectCollectionCompletion` helper records driver state and
panel counts. `downloadProgress()` (`collectionDownloads.ts`) exposes actual queue counts and
received bytes without archive URLs; finished archives alone do not prove that collection
installation/deployment completed.
With `optionalMods: "install"` the coordinator persists optional rules with stock `addModRule`
before starting the driver, reapplies the choice if released Vortex regenerates that exact
manifest's rules, and keeps its finish-dialog policy consistent through both passes.
`collection_status.optionalSelected` counts explicit `ignored:false` rules; absent flags do not
prove the choice. Never ignore required members; changed member counts or collection identity
fail the run.
Collection startup validates the exact driver, reads active dialog text, and clicks Install Now
through scoped dialog snapshots. Count outer dialog containers: stock react-overlays wraps
Bootstrap's modal in another dialog-role element, which is still one physical dialog.
Separate sibling containers remain ambiguous even if their text is identical.
Check physical container and enabled-button uniqueness before
the click, then re-snapshot the selected container because scanning invalidates earlier refs.
Recheck exact driver ownership, query step and finished preparation after that scan and before
the action; the client UI lock does not prevent Vortex's native driver from changing.
`ui_click` reports the target role/name captured after actionability/confirmation checks and
before the input sequence. Native handlers can reuse Install Now as Yes for profile confirmation.
Inspect the next UI/driver state separately; returned target identity is not workflow completion.
Full-page trees can truncate before the footer on large Mods
pages. Missing/ambiguous collection-added dialogs and failed clicks fail the attempt; no action
retry or driver recovery is performed. `collectionStartup.test.ts` exercises this wiring with the
real UI helpers, including a stacked unrelated dialog and a truncated root snapshot.

```powershell
doodlebot up --installed --sandbox
doodlebot down
doodlebot up --installed --sandbox --fresh
doodlebot up --installed --sandbox --rebuild-snapshot
```

| Start                | Behavior                                                                    |
| -------------------- | --------------------------------------------------------------------------- |
| Cold                 | Blank/cached-login profile, manage the game, quit cleanly, snapshot, launch |
| Warm                 | Reopen the working profile with its mods and settings                       |
| `--fresh`            | Replace the working profile with its baseline snapshot                      |
| `--rebuild-snapshot` | Recreate the baseline, keeping the login cache                              |

- Each target, game, path and `--no-game` has its own baseline; an unrelated working profile is
  never reused. The harness never edits Vortex's state database.
- `--sandbox` and `--bethesda-sandbox` don't seed the `.env` API key (with one, each local install
  waits on a 60 s Nexus lookup); `--with-api-key` does. The choice is part of the snapshot key, so
  keep it consistent.
- `up` returns once Vortex answers; Vortex runs detached (stdio in `<cache>/live/vortex-stdio.log`,
  its log in `userData/vortex.log`).
- `down` waits for a clean shutdown. An unresponsive instance is reported and left intact, never
  killed and certified; close that window and retry. A server of another cache is never stopped
  for holding the same port.
- `/doodlebot:baseline` creates or refreshes a baseline (`up … --rebuild-snapshot`, then `down`);
  `doodlebot doctor` reports it as the advisory check `Sandbox baseline` (`present: <marker>` or
  `missing`), and lists `Legacy lease store` when `~/.vortex-ai/leases` from an older kit
  exists. Advisory checks never make `doctor` exit 1.

### One instance

Only one doodlebot Vortex runs at a time **per machine**, driven by one agent. That is a
convention: nothing serializes two commands. Run `down` before starting another profile, the core
suite or independent QA. A few refusals stop the cases where two would damage data.

- **The instance record** is `~/.doodlebot/instance.json` (`USER_STATE_DIR` in `paths.ts`), one
  per user whatever workspace or `--cache-dir` a command uses:
  `{pid, startedAt, cacheDir, userDataDir, mcpPort, sourceDir?}` (`runningVortex.ts`). Every kit
  launcher writes it right after spawn, before readiness: `up`, `setup`, `bootstrap`, the core
  fixture and `doodlebot test zoom --signed-out`. A failed write stops the child and fails the
  launch. Per-cache `instance.pid` and `<cache>/instance.json` files from older kits are deleted
  when found.
- The older record `harness/.cache/instance.json` is read first and deleted unless it names a
  running Vortex; then a launch refuses with
  `A harness Vortex from an older doodlebot is running (pid <pid>); stop it before starting Vortex.`
  and `down` with the same text ending `before stopping Vortex.` Close that Vortex, then retry.
- **A second workspace or cache is refused.** Before stopping its own cache's leftover,
  `bootstrap` checks the record: a running Vortex of another cache (another workspace, a test
  cache) refuses the launch with the message below and is left untouched. A restart of the same
  cache is unchanged.
- A record is **running** only while its pid is alive and that process is `Vortex.exe`,
  `electron.exe`, `vortex` or `electron`. Otherwise it is stale (dead pid, or a pid reused after a
  crash) and is cleared when read.
- A launch while another harness Vortex runs, the core suite (`doodlebot test core`, through
  Playwright's global setup) and the signed-out zoom check refuse with
  ``A harness Vortex is running (pid <pid>, cache <cacheDir>); run `doodlebot down` before <action>.``
  Actions: `starting Vortex`, `the core suite`, `the signed-out zoom check`. `up` and `bootstrap`
  first stop their own cache's leftover, so a repeated `up` on the same profile restarts it.
- `doodlebot update` refuses while either record names a running Vortex (above).
- `build`, source installs and builds, `evidence run`, `pr-preflight`'s revert check and
  `vortex-e2e` refuse when the record's `sourceDir` is the checkout they would change:
  ``A harness Vortex is running from <checkout> (pid <pid>); run `doodlebot down` before <action>.``
  Actions: `building it`, `installing it`, `recording evidence in it`, `reverting it`,
  `patching it`.
- `down` follows the record (`stopRunningInstance`): it stops the running harness Vortex using
  the record's cache and MCP port, so one left in a test cache or another workspace, or started with
  another `--port`, needs no repeated options; for another cache it first prints
  `Stopping the harness Vortex of cache <cacheDir> (MCP port <mcpPort>).`. It asks Vortex to quit
  over MCP (`vortex_quit`) after the profile check, waits up to 30 s for a clean exit (MCP silent
  and the recorded pid gone), then clears the record. With no live record it stops only the
  configured cache. It clears a stale record without waiting. It never signals a pid; an
  instance that does not exit is reported and left intact. `up` and `bootstrap` stop only their
  own cache's leftover, never another cache's instance.
- A pid reused by another Electron app still looks running: `down` waits 30 s and reports it.
  Check that no harness Vortex window is open, then delete `~/.doodlebot/instance.json`.
- A Vortex started outside the kit's launchers (raw Playwright or Electron) writes no record and
  is invisible to these refusals. The record does not detect the operator's own Vortex or a game.
- Vortex source work happens on a branch of `.vortex-src` or in a checkout given with
  `--dev-dir`. Independent QA runs after `down`, in a fresh context, starting with `up --fresh`.

## Drive from any agent or shell

`up` prints the Streamable HTTP MCP endpoint, bearer token and a client example. Every tool is also
callable from the CLI.

```powershell
doodlebot tools --json                              # live tools and input schemas
doodlebot snapshot [--selector <css>]
doodlebot click --ref <ref>                         # or --selector <css>
doodlebot fill --ref <ref> --value example
doodlebot press --key Escape
doodlebot call vortex_query --args-file query.json  # or --args <json>
doodlebot screenshot --label before [--full-page]
doodlebot log --level warn [--tail <n>] [--since <ISO time>] [--json]
```

`doodlebot log` reads `<userDataDir>/vortex.log` of the running instance (from
`automation_status`). `--level` is a threshold (`debug`, `silly` and `verbose` count below
`info`; an unrecognised level counts as `info`); each entry keeps its continuation lines, such as
stack frames, and `--json` appends them to `message`. Driven runs (`/doodlebot:drive`,
`/doodlebot:qa`) also read the renderer console from sequence 0 with
`doodlebot call ui_read_console`, and write a run report to
`harness/.artifacts/runs/<UTC time>-<slug>/report.md` (sections Outcome, Scenario and target,
Steps, Dialogs and prompts answered, Errors and warnings, Evidence, Not checked; defined in
`plugins/doodlebot/skills/drive/SKILL.md`).

`--args-file` avoids shell quoting (a PowerShell BOM is fine); keep credential-bearing ones private.

The loop is snapshot, act, wait, inspect. Refs expire on the next snapshot, reload or element
removal: never reuse one. Filter or scroll virtualized rows into the DOM first. Check
`activeDialogs` when an action seems blocked. Drive the instance from one client at a time;
nothing serializes UI actions from separate clients.

| Tool/path                                                  | Use                                                                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ui_snapshot`                                              | Tree, accessible names, refs, active dialogs; selector/index scope                                                                     |
| `ui_active_dialogs`                                        | Open dialogs only; cheap to poll                                                                                                       |
| `ui_click`, `ui_fill`                                      | Mouse sequence, React-compatible input                                                                                                 |
| `ui_press_key`                                             | DOM key handlers; not native dialogs or text insertion                                                                                 |
| `ui_select_option`                                         | Native select; custom dropdowns need click-then-click                                                                                  |
| `ui_scroll`                                                | Scroll plus events for virtualized lists; not a native wheel                                                                           |
| `ui_wait_for`                                              | Poll selector/text; check `matched`, a timeout returns false                                                                           |
| `ui_hover` / harness `realHover()`                         | JavaScript hover only / real CDP mouse including `:hover`                                                                              |
| harness `realWheel(config, selector, deltaY, { control })` | Native wheel, optionally with Control                                                                                                  |
| `ui_get_viewport`, `ui_set_viewport`                       | Read/resize window and renderer                                                                                                        |
| `ui_detect_layout_issues`, `ui_responsive_sweep`           | Advisory layout findings                                                                                                               |
| `ui_read_console`                                          | Renderer console/errors since a sequence number                                                                                        |
| `nexus_auth_status`                                        | Credential-presence booleans                                                                                                           |
| `automation_status`                                        | Profile paths, renderer lifetime ID, NODE_ENV, `react.build`. The profile is `userDataDir`; Vortex's log is `<userDataDir>/vortex.log` |
| `collection_install_state`                                 | Collection install driver, session and dialogs (below)                                                                                 |
| `vortex_query`, `vortex_dispatch`                          | Inspect state, invoke documented actions/events                                                                                        |

Harness `clickByName`/`fillByName` match exact case-insensitive names (or explicit regexes) and
reject ambiguity; use accessible names and scope modals to their dialog. `{ selector, index? }`
scopes the snapshot so a large table can't exhaust its node budget. Avoid native file pickers:
`install <archive>` or a documented event.

### Scratch scripts and renderer diagnostics

`doodlebot script <file.mts> [args...]` runs a scratch script with the kit's tsx, in the caller's
directory (`INIT_CWD`, which the `doodlebot` shim sets; a relative `<file>` is resolved there too), with the instance's cache, artifacts folder, ports and token in
its environment. The instance flags (`--dev-dir`, `--cache-dir`, `--port`, `--cdp-port`) are the
kit's anywhere, even after the file; other arguments, and all after `--`, are the script's. It
exits with the script's code: 130 after Ctrl+C, `128 + signal` when the script died from a
signal. Outside this repo use `.mts` (top-level `await`) and import the kit by the URL in
`VORTEX_AI_KIT`:

A script's own path: use `fileURLToPath(import.meta.url)`. `new URL(import.meta.url).pathname`
keeps `%20` for the space in "Vortex MCP", and writes beside it fail.

```ts
const kit: typeof import("file:///C:/dev/doodlebot/harness/src/kit.ts") = await import(
  process.env.VORTEX_AI_KIT!
);
const mcp = kit.clientFor(kit.loadConfig());
```

`page.evaluate` with named inner functions works (`NAME_SHIM` in `cdp.ts`). A useful script
becomes a harness module with a test.

`doodlebot eval --expr "<expression>"` (or `eval <file.js>`) evaluates JavaScript in the renderer
over CDP and prints JSON; promises are awaited. Diagnostics only. It refuses unless MCP and CDP both
report a profile in this cache, so it never touches the operator's Vortex.

### Recording a feature

Standalone `doodlebot record --ffmpeg <exe> --seconds <1-60> --label <name>` records the
renderer while a human drives it. For automated actions, run
`kit.recording.startRecording(config, { encoder, label })`, the UI actions and
`recording.stop()` in one `doodlebot script`; stop recording in `finally`.
Do not drive the instance from another command while it records.
The encoder needs MJPEG in and
VP8/WebM out (`pnpm exec playwright install ffmpeg`). Frames repeat, so pauses keep their length;
keep durations when converting. For PR media, `gh pr edit --attach <file>` (GitHub CLI 2.99+)
uploads files that `--body-file` image references name (push access, under 10 MB).

## Install and deploy

```powershell
doodlebot fixture mod --out C:/fixtures/probe.zip [--name automation-probe]
doodlebot install C:/fixtures/example.zip
doodlebot collection <collection-url>
doodlebot deploy --game <active-game-id> [--purge]
doodlebot purge
doodlebot e2e <collection-url> [--runs <n>] [--keep] [--purge] [--no-launch]
```

- `fixture mod` writes an archive with one file, `textures/<name>.txt` containing `<name>`; in
  the sandbox it deploys to `<gamePath>/Data/textures/<name>.txt`.

- `slow-download [--count <n>] [--seconds <n>] [--stagger <s>]` keeps real downloads in flight
  (throttled local files, no network or account) for work on the UI that reports them: the
  spine's download button and panel, the Downloads page. It returns when they finish, so run it
  it with the UI actions inside one `script` using `kit.slowDownload` when automation
  needs to observe downloads in flight. `--stagger` starts each after the one before, so a UI
  that announces arrivals sees them separately.
- `install` waits for the installer; `collection` checks OAuth first and waits for required
  members. FOMODs take defaults; unexpected dialogs stay visible. Add a scoped helper with a test
  when a workflow needs an answer, never a global guess.
- `deploy` refuses while installing or when install state is unreadable. Foreign-instance purge
  prompts are cancelled unless `--purge`. **Use disposable game paths for destructive tests**: a
  moved profile does not isolate writes to a real game's folder or configuration.
- `e2e` also verifies completion, deployment and a newly observed game process, so it needs the
  real game and network; `--no-launch` with a disposable path stops before launch. The sandbox
  executable is never evidence of a game launch.

## Tests and development

```powershell
pnpm run ci                 # typecheck, lint, format, docs checks, unit tests, build; no Vortex
doodlebot test core         # Playwright contract against a real Vortex, account-free
doodlebot test oauth        # opt-in: cached sandbox OAuth survives a fresh restore
doodlebot test --list       # every suite and check script
doodlebot responsive --screenshots --viewports "1024x720,1280x720,1280x1000,1920x1080" [--strict]
```

- `doodlebot test <suite> [args…]` runs from the workspace root with this Node and environment
  (`PLAYWRIGHT_JSON_OUTPUT_FILE` and `VORTEX_AI_*` pass through). `core` and `oauth` run
  Playwright with `harness/playwright.config.ts` / `harness/oauth.playwright.config.ts`, so
  Playwright's own flags follow (`doodlebot test core --reporter=json`); the other suites run
  `harness/src/tests/<suite>.e2e.ts` (`nexus` runs `nexus-collection.e2e.ts`). Every argument
  after the suite is the suite's, verbatim. An unknown suite exits 2 and lists them.
- Say which suite ran and disclose skips. Quote comma lists in PowerShell.
- The core suite launches its own Vortex and refuses while a harness Vortex runs
  (`... before the core suite.`): run `doodlebot down` first.
- See [TESTING.md](TESTING.md) for the core contract, pinned-release CI and opt-in scenarios.
  Feature regressions and performance scripts stay outside the default kit gate.
- Responsive checks: each relevant state with its own label, width and height, real sizes after OS
  clamping, and a visual review against any design (WORKFLOWS.md has the state matrix).
- `doodlebot source` (`/doodlebot:source`) prepares the managed `.vortex-src` (`--update`,
  `--no-build`, `--where`); make your changes on a branch of it, or in a separate checkout passed with
  `--dev-dir`. `up` defaults to the managed source when present. Select `--installed`,
  `--exe <path>` or `--dev-dir <path>` explicitly for reproducible checks.
- Extension work uses one watcher: `doodlebot watch` or `pnpm run dev`, against your
  already-running instance. It observes doodlebot source and runs one finite build/copy/reload
  cycle per settled edit. Build failure never installs partial output. It does not build Vortex
  source. `pnpm run build` is one-shot; `build-extension` or `up --rebuild-extension` forces a
  build. Running the watcher and `build-extension` together is unsupported. Recheck
  `tools --json` after tool registration changes. Do not run the watcher during tests or
  scripted UI actions: a reload can invalidate UI refs mid-action.
- Live CLI attachment and every watch cycle check `automation_status.userDataDir` against the
  exact canonical live profile; a reachable port or changed runtime ID is insufficient.
- Extension builds compile captured source, configuration, package/lock and `info.json` bytes
  in a private directory under `harness/.artifacts`, using the installed dependencies. Only a
  successful, uncancelled build whose inputs still match can replace `dist`. Freshness checks
  validate input/output digests, including metadata, additions and deletions; timestamps are
  insufficient. Failed builds retain the previous generation, which may now be stale.
- Extension publication and profile installation stage a complete generation and use a
  backup/swap with rollback. A failed rollback reports and retains its recovery backup;
  inspect that path before retrying. An interrupted rename sequence may also need manual
  recovery; this is not a crash-atomic filesystem transaction. The current capture covers
  `src` production files and the fixed root build configs, package, lock and metadata, with
  Node/platform/architecture/`NODE_ENV` identity. Install pinned dependencies
  (`pnpm install --frozen-lockfile`) before building, not while a build runs. New external config inputs, environment dependencies or symlinks need an explicit
  capture-contract change; dependency integrity is not proved by the generation marker.
- `doodlebot test nexus` (opt-in; same target, cache and ports as account setup): a separate
  `nexus-smoke` profile and disposable Stardew Valley folder, the five required members of
  revision 1 of `stardewvalley/nudx7b`, SHA-256 checks of deployed files, purge, evidence,
  refreshed credentials copied back. No launch. Needs Nexus Premium for unattended downloads.
  Outages are failures, not a reason to repeat OAuth.

### Design-first work

Features and refactors start with a design written and reviewed with Google's
[Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) plugin (EGM,
`v0.1.1`) before any implementation. Follow `plugins/doodlebot/skills/design/SKILL.md`
(`/doodlebot:design`), which every agent reads (Codex included). Bug fixes, docs and test-only
changes need no design unless the user supplies or asks for one. The approved designs defining
this workflow are `designs/egm-workflow.md` and, for its plugin form, `designs/agent-companion.md`.

```powershell
doodlebot design new <file> --title <t> --target vortex|doodlebot
doodlebot design check <file> [--ready] [--json]
doodlebot design scope <file> --checkout <dir> --base <ref> [--json]
```

- `design new` writes the design template (required sections, `Status: Draft`, today's date);
  it refuses an existing file and needs both `--title` and `--target`.
- `design check` validates the structure (title, status, target, required sections, acceptance
  ids, contracts, file boundary) and the `Approved` line, and prints `content sha256: <d>`. It
  prints `OK <file>` or `ISSUES <file>` with one issue per line and exits 1 on any issue.
  `--ready` applies the approval-time checks (open questions, `TBD`) whatever the Status.
  `--json` prints `{file, contentSha256, issues, design}`. Run `pnpm exec oxfmt <file>` first
  whenever you record the digest: CI formats Markdown, and a format change changes the digest.
- `design scope` lists the checkout's changed files (committed or not, plus untracked
  non-ignored files) against `--base` that fall outside the design's file boundary, as
  `outside: <file>` lines, or `IN SCOPE`; it exits 1 when any file is outside and warns
  `design is not approved` for an unapproved design. The design file itself is exempt when it
  lies inside the checkout.
- Design paths: `designs/<topic>.md` for doodlebot (listed in `designs/SITEMAP.md`),
  `harness/.artifacts/designs/<topic>.md` for Vortex (never in a Vortex PR). EGM's own briefs,
  drafts and stage reports go to `harness/.artifacts/egm`; confirmation-round reports to
  `harness/.artifacts/designs/<topic>.reviews/`.
- The digest covers the whole text except the `Status`, `Date` and `Approved` header bullets.
  Approval is the human's line `- **Approved:** <person>; content <sha256>; <reference>`; any
  body edit afterwards voids it. Each header bullet stays on one line: a wrapped continuation
  counts as body. Never write an `Approved` line the person has not given.
- The confirmation round (after the last edit, on a checkout without implementation changes)
  runs two fresh reviewers: EGM's `implementation_readiness` with its standard, and
  `vortex-runtime-goldfish` (`plugins/doodlebot/agents/vortex-runtime-goldfish.md`, dispatched as
  `doodlebot:vortex-runtime-goldfish`; persona `plugins/doodlebot/resources/vortex_runtime.md`) with
  `plugins/doodlebot/resources/vortex-change-standard.md`.
- After implementing, run `design scope`, then `down`; independent QA starts with `up --fresh`
  in a fresh context. Readiness binds the result to the approved design (next section).

### Recorded checks and readiness

`evidence identity` captures the current subject checkout/diff and kit identity separately.
`evidence runtime` hashes the actual executable and selected build files; list the executable
first, then the app bundle and doodlebot extension bundle. A source runtime also needs
`--checkout` and `--base`. These commands inspect files; they do not build or select an app.
Receipts below use `node bin/doodlebot.cjs`, run from the workspace root, so they work without
the shim; it prints no banner, so redirected JSON stays clean.

```powershell
node bin/doodlebot.cjs evidence identity --checkout . --base <base-sha> > harness/.artifacts/identity.json
node bin/doodlebot.cjs evidence run --checkout . --base <base-sha> --out harness/.artifacts/ci.json -- pnpm run ci
node bin/doodlebot.cjs evidence run --checkout . --base <base-sha> --out harness/.artifacts/scoped.json --test-format vitest --test-report <new-test-report.json> -- pnpm exec vitest run <test-files> --reporter=json --outputFile <new-test-report.json>
```

`evidence run` executes an explicit command in the subject root, or a contained `--cwd`,
using the subject's already-installed pinned pnpm. It never installs a toolchain. It refuses
while the harness Vortex runs from the checkout (`... before recording evidence in it.`),
records the actual executable/arguments/cwd,
retains output and captures before/after source identity. Choose new output/report paths
for every run; existing evidence is never overwritten. A valid failed/interrupted receipt
remains failed evidence. If reporter JSON is missing or malformed, receipt collection fails;
retain the saved `.log` and report that collection failure instead of claiming a valid receipt. Keep artifacts in ignored task storage so creating a report does not itself
change the subject diff.

For released-app core evidence, create a runtime JSON with `--kind installed`, a release
`--label` and `--mode production`, including the actual Vortex executable, app bundle and
`dist/index.js`. Run `down` first: the core suite refuses while a harness Vortex runs. The
collector sets the selected executable and target from that runtime identity. Set `PLAYWRIGHT_JSON_OUTPUT_FILE` to a new absolute path,
pass the same path as `--test-report` with `--test-format playwright`, and run
`node bin/doodlebot.cjs test core --reporter=json` through `evidence run --runtime <runtime.json>`.
Readiness's `kit-core` accepts exactly the command prefixes `node bin/doodlebot.cjs test core`
and `pnpm exec playwright test --config harness/playwright.config.ts`, followed by nothing but an
optional JSON reporter; a filter (`--grep`, a spec path, `--project`) is refused. Only the
Playwright prefix ignores a bare `--`; after `node bin/doodlebot.cjs test core` a `--` is passed
to Playwright verbatim, which reads what follows as a filter, so it is refused.
Core evidence must include the complete unfiltered suite with no skips.

For example, in PowerShell 7, from the kit root (replace paths/version with the actual runtime):

```powershell
node bin/doodlebot.cjs down
node bin/doodlebot.cjs evidence runtime --kind installed --label <actual-version> --mode production C:/Vortex/Vortex.exe C:/Vortex/resources/app.asar dist/index.js > harness/.artifacts/runtime.json
$env:PLAYWRIGHT_JSON_OUTPUT_FILE = Join-Path (Get-Location) 'harness/.artifacts/core-tests.json'
node bin/doodlebot.cjs evidence run --checkout . --base <base-sha> --out harness/.artifacts/core.json --runtime harness/.artifacts/runtime.json --test-format playwright --test-report $env:PLAYWRIGHT_JSON_OUTPUT_FILE -- node bin/doodlebot.cjs test core --reporter=json
(Get-FileHash -Algorithm SHA256 harness/.artifacts/core.json).Hash.ToLowerInvariant()
```

Use the absolute resolved file path and that hash in its artifact reference. Hash the
independent review file the same way. Keep the identity JSON from the same unchanged revision.

Copy [readiness.example.json](readiness.example.json), replace its placeholders with generated
identities/artifact hashes and actual reviewed evidence, and choose the correct target, task
and affected contracts. That example is documentation-only; executable changes need additional
roles such as scoped tests, control and runtime checks. The schema in `src/readiness.ts`
defines all roles. Every artifact reference contains an absolute path and its SHA-256.
The independent reviewer inspects gate applicability against the actual diff.

A feature or refactor (or any task given a design) also names its approved design and one
`design-review` entry from the confirmation round. Fragment of a schema-3 feature manifest
(`<pre-implementation identity>` is the `evidence identity` JSON recorded before implementation,
whose changed files are only the design and `designs/SITEMAP.md`):

```json
{
  "schemaVersion": 3,
  "task": { "kind": "feature", "target": "doodlebot", "author": "author-name" },
  "design": { "path": "C:/abs/designs/<topic>.md", "sha256": "<file sha256>" },
  "acceptance": [{ "id": "same-id-as-design", "criterion": "Same text as the design" }],
  "evidence": [
    {
      "role": "design-review",
      "status": "pass",
      "subject": "<pre-implementation identity>",
      "reason": "Confirmation round <n> clean; no uncontested Blocker or Major",
      "inspectedBy": "goldfish:implementation_readiness,vortex-runtime-goldfish",
      "criteria": [],
      "reviewedDesignSha256": "<design check contentSha256>",
      "artifacts": [
        {
          "path": "C:/abs/harness/.artifacts/designs/<topic>.reviews/round-<n>-implementation_readiness.md",
          "sha256": "<sha256>"
        },
        {
          "path": "C:/abs/harness/.artifacts/designs/<topic>.reviews/round-<n>-vortex-runtime-goldfish.md",
          "sha256": "<sha256>"
        }
      ]
    }
  ]
}
```

Add `contested.md` to the artifacts when it exists. The design rules readiness applies:

- A feature or refactor without `design` fails (`design: an approved design is required for
feature and refactor tasks`); a `design-review` entry without one fails too.
- Every `design check` issue is reported as `design: <issue>`, plus `design: not approved`
  unless Status is Approved. The design's target must equal the task target; its acceptance ids
  and texts (whitespace collapsed) must equal the manifest's; its declared contracts must be in
  `risk.contracts`; every changed file must lie inside its boundary
  (`design: <file> outside the approved boundary`).
- `design-review` requires `reviewedDesignSha256` equal to the approved digest (the field is
  rejected on other roles), `inspectedBy` different from the task author, empty `criteria`,
  both reports from one round, each containing the line `Reviewed content sha256: <digest>` and
  a `Checkout: <headSha> <changesSha256>` line matching its `subject`, a reviewed checkout with no
  implementation changes, the same `baseSha` as the manifest subject (`design-review: reviewed
checkout used another base`), and a reviewed head that is an ancestor of the subject head. It is
  exempt from the current-diff rule. Readiness does not read the findings; the independent
  `review` entry judges the round, `contested.md` and the approval reference.

```powershell
doodlebot readiness --manifest <task-manifest.json> --json
```

Readiness uses schema **v3** and rejects any other version before parsing
(`readiness manifest schemaVersion <v> is not supported; this doodlebot reads schema 3`);
command receipts use **v1**; preflight reports use **v4** and upstream E2E reports **v5**, each
including producing kit identities before and after execution. Current and baseline
native reports must use the manifest's unchanged kit code. Obsolete formats must be rerun.
Scoped and control test receipts require nonempty execution with zero failures and zero skips
or TODO tests; a failed baseline control still requires nonempty execution with zero omissions.
Native assertion controls embed the exact Vitest JSON and its digest for every branch and
reverted test group. Both sides must have complete, consistent execution; the branch passes
and the reverted run must contain an actual failed assertion. Incomplete branch runs prevent
mutation, and incomplete reverted runs fail after restoring the exact branch bytes. Their
reporter bytes and output remain in the native report for diagnosis.
Every performance series receipt needs a concrete production runtime; current runs must match
the manifest runtime. Historical baseline receipts retain the runtime hashes and source identity
verified during their execution, including the unchanged-runtime check; later sequential builds
may replace those files or advance that checkout. Readiness does not require retaining the old
build or compare it with current built bytes. Vortex app/performance source runtimes must match
the corresponding subject head, base and local-change identity. An equivalent separate checkout is allowed; a released app
cannot establish behavior introduced by modified Vortex source.
The evaluator checks current identities, artifacts,
required evidence, controls and E2E comparisons. Its result is an evidence-complete handoff,
not permission to publish, merge or release. Semantic correctness, meaningful independent
review and the correspondence between source and built runtime still require inspection.
A local-diff result cannot certify a later commit.

### Pull request checks

- `doodlebot pr-checks <number-or-url> [--repo <owner/name>] [--json]`: the PR head's checks
  via `gh`, failed jobs expanded to failed steps (a test failure vs. a failed upload). Nonzero while
  any check is pending or failed.
- `doodlebot pr-preflight` (`/doodlebot:pr` runs it) before pushing; put its report in the PR. It diffs
  the committed `HEAD` of `--checkout` (default `.vortex-src`) against its merge-base with `--base`
  (default `upstream/master`), prints PASS/WARN/FAIL/SKIP per check with file:line, exits 1 on any
  FAIL or INCONCLUSIVE. `--json` lists every hit. The revert check refuses while the harness
  Vortex runs from the checkout (`... before reverting it.`); run one check at a time.

| Check                    | Result                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Size                     | WARN over 400 changed lines or 10 files, excluding lockfiles, `etc/*.api.md`, snapshots, build output                                                                    |
| Callers outside the diff | WARN list: uses outside the diff's hunks of each touched export, class member, class/component (default imports, barrels) and private helper (one level up); tests apart |
| Readers of changed state | WARN: readers of each class field whose assignment changed, and of its getters                                                                                           |
| Dispatchers of reducers  | WARN: each changed reducer's action creator, its calls and type-string uses                                                                                              |
| Revert check             | Branch failure or a reverted pass is FAIL; a reverted failure is INCONCLUSIVE until its intended assertion is inspected                                                  |
| Measurements in comments | WARN for timing or size figures in added comments                                                                                                                        |
| PR description           | With `--pr <n>`: FAIL on a non-Conventional or >72-char title, missing section, "Not run", no head sha                                                                   |

- Test code (`*.test.*`, `*.spec.*`, `__tests__`, `__mocks__`, `__fixtures__`, `test-utils`) is
  never reverted or counted as a caller.
- Revert check: `pnpm exec vitest run` on `--test <path>` (repeatable) or the tests the diff
  touches, from each test's nearest `package.json` (`--project-dir` overrides). `--revert <path>`
  reverts only those files; `--revert-hunk <file>:<line>` only the hunk holding that head line.
  It is the only check that writes: it refuses uncommitted changes, backs up, restores exact bytes
  after handled cancellation and confirmed child exit, then verifies hashes and `git status`.
  A forcibly terminated wrapper requires inspection before recovery. `--skip-revert` skips it;
  `--head <ref>` checks a ref without checkout (and without the revert check).
- Discovery is regex-based (`touchedSymbols`, `parseImports` in `prPreflight.ts`): object-literal
  methods, renamed callers and `require()` are missed, member matches include unrelated objects.
  Read the list.

### Vortex's own E2E suite

Only when requested, `doodlebot vortex-e2e --checkout <dir>` runs `<checkout>/packages/e2e` as
upstream CI does (`CI=1`, `VORTEX_E2E_HEADED` unset, one worker, no retries). It needs a built
checkout and refuses while the harness Vortex runs from it (`... before patching it.`); a harness
Vortex running from elsewhere is noted in the report because it may affect timings. Run one
`vortex-e2e` at a time.
Its temporary fixture writes require source-mutation authorization. For the run only it:

- applies `harness/patches/` (`e2e-window-startup.patch`; KNOWLEDGE.md explains the local
  startup problem). It refuses a dirty checkout, fails if `git apply --check` does,
  skips patches already present, and restores exact bytes after confirmed child exit, including
  handled Ctrl+C. Inspect state after forcible termination;
- leaves out, via `--grep-invert`, tests needing absent `E2E_NEXUS_FREE_USER_*` /
  `E2E_NEXUS_PREMIUM_USER_*` credentials (environment or `packages/e2e/.env`), reported as
  credential-skipped, and refuses if Playwright's filtered count differs from its own.

| Flag                      | Effect                                                             |
| ------------------------- | ------------------------------------------------------------------ |
| `--checkout <dir>`        | Vortex checkout (default `.vortex-src`)                            |
| `--spec <file>`           | Relative to `packages/e2e` or `packages/e2e/src/tests`; repeatable |
| `--grep`, `--grep-invert` | Passed to Playwright (credential filter added to the latter)       |
| `--compare <report.json>` | Regressions, pre-existing and fixed against an earlier run         |
| `--json`                  | Report as JSON; Playwright's output to stderr                      |

Reports use schema v5 and go to `harness/.artifacts/vortex-e2e/<time>-<sha>.json`. Old or malformed
baseline formats must be rerun. Comparison reports distinguish regressions, lost coverage,
changed failure causes and execution-condition differences. A successful exploratory command
does not establish final readiness; use the strict revision-bound readiness manifest described
in AGENT-WORKFLOW.md. For a PR, run master as the baseline, then the
branch with `--compare`. For an upstream CI failure, run its exact spec, save before/after
reports, don't substitute the harness app, and read the workflow's flags, credentials and test
summary. Animation tests need a rendered window (KNOWLEDGE.md). Test credential skips with the
account variables empty.

Final readiness is stricter than an exploratory comparison: skipped, credential-skipped and
flaky tests block it. Regressions, changed failures, missing coverage and execution-condition
drift cannot be dispositioned away. Only an unchanged pre-existing product failure can have
an inspected disposition, bound to its exact failure fingerprint and supporting evidence.
External blockers and unknown causes remain blocked.

### A Bethesda game without the game

`up --dev-dir <checkout> --bethesda-sandbox` manages a fake Fallout 4 that Vortex's own support
accepts (plugins, LOOT, the Plugins page, Missing Masters): a stand-in `Fallout4.exe` and
`Fallout4.esm`, plugins with real TES4 headers (`pluginBytes`, `writePlugin` in
`bethesdaSandbox.ts`), and a private `LocalAppData` and `Documents\My Games\Fallout4` under the
cache (Documents moved by a `NODE_OPTIONS=--require` preload, `mainPreload.ts`).

- **The harness refuses to manage the game unless `automation_status.paths` shows both
  redirects**, so the operator's real Fallout 4 profile is never written.
- **Source builds only**: packaged Vortex ignores NODE_OPTIONS and is stopped before a game
  activates. For a release's behaviour, build its tag from source.
- `--isolate-user-folders` gives any game the same private folders.
- `setDeterministicLoadOrder(mcp)` turns LOOT autosort off, orders natives, masters, light plugins
  and plugins by name, and verifies `state.loadOrder`, so Plugins page values compare across runs.
- `doodlebot test bethesda`: Missing Masters flags an absent master before and after an offline
  collection, whose postprocess must fire and plugin list apply; a game-version mismatch prompt
  must appear and Continue must complete.

### Offline collections

`offlineCollection.ts` builds collections with bundled members and installs them with no account.

- **Manifest**: `optional` members (a `recommends` rule); `plugins: [{ name, enabled }]`, by
  default every root `.esp/.esm/.esl` enabled (the gamebryo parser throws without it,
  KNOWLEDGE.md); `modRules` between members; a member `fileExpression` overrides its bundle name.
- **Direct members** (`direct: [{ name, url, optional?, tag?, logicalFilename?, plugins? }]`)
  download from a URL instead of the archive. Serve them with `startArchiveServer(archives,
{ fail })` (`downloadServer.ts`, `kit.downloads`): `fail(name, attempt)` resets that GET's
  connection. Vortex retries a failed download itself (4 GETs in all), so to make a member fail,
  fail it until the install ends, then stop failing and `resumeViaNotification` (the round trip is
  `doodlebot test collection-download-retry`). `closeCollectionReviews(mcp)` closes any review a script or a
  resume left open; one left open makes the next install find no Install Now.
- `addOfflineCollection` registers the archive as a download and runs `start-install-download`, so
  the mod has an `archiveId`; `via: "file"` uses `start-install <path>` instead.
- `gameVersions: [MISMATCHED_GAME_VERSION]` makes Install Now show "Game version mismatch" (and
  records a pending vote); `answerGameVersionPrompt(mcp, "continue" | "cancel")` answers it.
- `installOfflineCollection(mcp, archive, options)` drives Install Now, the prompt and the review.
  Options: `gameVersions`, `gameVersionAnswer`, `allowIncomplete`, `onPhase`, and `optionals`: skip (default),
  `"install"` or `"stand-in"`. An incomplete review fails unless `allowIncomplete`. Returns
  `closedWith` and `postprocessed`. `onPhase` marks install-now, game-version-answered,
  review-shown, optionals-install, optionals-stand-in, review-closing, review-closed.
- Installing bundled optionals has stalled until Vortex's 5 min watchdog, so the default skips
  them. `completeOptionalsWithoutInstall(mcp, id)` stands in after Install optional mods so the
  review returns. **No member files exist: never use it to test installation.**
- `updateOfflineCollection(mcp, oldId, archive, { remove, keep })` does what `collectionUpdate`
  does after download, returning `removeMs`. The changelog, the "Remove mods from old revision?"
  question and re-enabling optionals are not reproduced.
- `resumeViaNotification(mcp, id)` is the only login-free path to `InstallDriver.start`: after
  Later it enables and deploys the collection, then clicks "Collection incomplete"'s Resume (toast
  in classic layout, Notifications popover in modern). Once per collection per session; deploys,
  so sandboxes only.
- **Find dialogs by their own text and buttons, never a full snapshot** (it hits its node limit on
  large lists; dialog text is cut at 400 chars). `waitForInstallNow`, `dialogButtons(mcp, text)`
  (disabled marked), `clickInsideDialog` (throws on a miss; pollers pass `{ required: false }`),
  `reviewDialogsFor(mcp, id)`.

### Where a collection install is

Collection startup observes the exact current driver before any resume or Install Now action. A newly added manifest uses stock did-install-mod -> driver.query; wait for its queued preparation and ownership instead of dispatching resume. Idle means a found collectionless driver at prepare or completed review, with preparing===false; only an existing manifest in that state can receive one resume. Dispatch failures propagate including Already installing text. Queued or unobservable preparation waits/fails within the startup deadline, including the final observation before clicking. A foreign current collection is refused even at review. The startup wait mounts the requested view at most once, bounds missing/queued-driver observation to 60 seconds inside the overall deadline, and clicks Install Now only at the exact owned query step. Completion verification remains separate; lastCollectionId alone does not establish active ownership.

Native `collection` never recovers errors or retries failed actions. Collection notices (title and message, including warning notices), exact native failed session members and unresolved selected failed downloads are recorded as warnings. `installCollection({warningsAsErrors:true})` fails on any warning; the lower-level default permits warnings only after all selected members and the final completion boundary pass. A warning-bearing install without a supplied final functional/UI completion verifier fails conservatively; driver counters alone cannot prove the visible completion boundary. The native CLI supplies the stock completion-view verifier, prints warnings as they occur and supports --warnings-as-errors. Any remaining failed session/member record at completion fails regardless of policy. `collection_download_failures` uses the stock matcher without changing failed state. Normal dialogs/FOMOD steps advance the requested installation; failed UI actions propagate once and are not retried. An absent dialog is a normal waiting observation; a rejected host confirmation predicate inspects another candidate without clicking. Watcher errors during teardown cannot turn a failed action into success.

The completion poll fails immediately on an owned native review dialog whose text begins with the Collection installation incomplete heading. A match later in the body or a mod name does not establish failure; DOM text may concatenate the heading and body without whitespace. It requires a found review driver with current collectionId equal to the pinned manifest and strong dialog attribution (driver or collection-prop); a present session must match both collection and game. installDone=false is normal at this failed review. Review/postprocessing=false alone does not prove finalization has settled. Selected optional failure also terminates when the matching session has only terminal statuses, a failed recommends witness and unsatisfied selected optional rules. Pending/unknown statuses prevent that optional inference. Warning evidence is recorded before the failure; the detector performs no resume, retry, dismissal or selection repair.

The concurrent dialog watcher reads the exact owned native review and collection status before any COMPLETE review action. It blocks terminal failures independently of warningsAsErrors, allowing the completion poll to retain warnings and throw. With optionalMods=install it can start only one optional round; after that click its review policy permits Done only, and blocks every review answer while selected optionals remain unsatisfied. A settled installed-but-unsatisfied observation without a failed-member witness stays open until the existing timeout, rather than being retried or dismissed. Final successful completion clicks Done only. Tests run the actual watcher with autoAnswer=true, including failures appearing between its 1.5-second polls and the coordinator's 5-second polls.

Matching active session failed records block COMPLETE review clicks even if every collection rule is satisfied. The completion coordinator checks failed session/download records before returning satisfied counts, rechecks them before any final dialog dismissal or verifyCompletion call, and checks again afterward. Historical notifications may be warnings; remaining owned failed records never qualify as functional completion. Foreign session failures are not attributed to this collection.

`collection_install_state` (`doodlebot call collection_install_state`, cheap to poll) reads
Vortex's private `InstallDriver` through the React fiber tree; when a build stops passing its
`driver` prop, `driver.found` is false with a reason.

- `driver`: `step` (`prepare`, `changelog`, `query` = Install Now shown, `start`, `disclaimer`,
  `installing`, `review`), `installDone`, `postprocessing`, collection id and name, `preparing`,
  `starting` (null on builds without the game-version Cancel fix), `lastCollectionId`.
- `session`: the active session's members by status and type, and the outstanding ones.
- `dialogs`: open modals with their step (`query`, `game-version-prompt`, `review`) and collection
  (`collectionId`, `collectionName`, `via`: `driver`, `collection-prop` or `text`).

To wait on a plain `events.emit` event: `vortex_dispatch` with `action: "onEvent", args:
["<event>", "__CALLBACK__"]`, then `poll_listener`. There is one listener per event name, so take
`lastSeq` first (`watchEvent` in `offlineCollection.ts`).

### Measuring renderer, main process and checks

- `perf_trace_start` / `perf_trace_stop` (write tier): count, total and max ms per action type,
  tasks over 50 ms, heap start/max/end. React rendering shows as long tasks.
- `profileRenderer(page, run)` (`profiling.ts`): a CDP CPU profile summarised by function and
  file, `inclusive`, `inclusiveApp`, `longestBusy`, plus a DevTools `.cpuprofile` and
  `pageStartMs`; `summariseWindows(profile, windowsFromMarks(marks, durationMs))` splits by marks.
- `tableProbes.ts`, for any SuperTable (`#table-<id>`) or modal: `measureRowIdentity`,
  `measureAfter` (blocking until a page condition holds), `recordDialogFade`, `rowsOnScreen`,
  `wheelScroll`, `jumpAndSample`, `probeRowDropdown`, `columnWidths`, `seedConflictPairs`,
  `conflictEditorCounts`.
- `markLog` / `readSince` / `summariseLog` (`vortexLog.ts`): Vortex's log over an operation
  (persist:diff per hive, slow writes, sort timings, backups, memory warnings, crashes).
- `check_probe_counts`: health-check runs per event in harness instances; a count that stops
  rising while its event fires means those checks are suppressed.
- **Keep the observer light**: poll `ui_active_dialogs` / `openDialogs` (`uiDriver.ts`), never
  repeated full `ui_snapshot`s, which dominate a profile on large lists.

**Production.** Source builds run NODE_ENV=development with React's slow development build, so any
timing meant to reflect users needs production:

- `doodlebot build --checkout <dir> [--production]` runs the checkout's `pnpm run build` with
  its pinned pnpm, refusing while the harness Vortex runs from it (`... before building it.`), with
  NODE_ENV=production for the build only (unset otherwise). It restores `etc/vortex.api.md` and
  `etc/Dependency Report.md` if rewritten. The caller's environment is untouched; in the agent
  sandbox clear a variable with `$env:NODE_ENV=$null`.
- `up --dev-dir <checkout> --production` **fails unless `automation_status` shows
  `nodeEnv: "production"` and `react.build: "production"`**, and warns on a development bundle.
- Compare A/B builds in the same mode from the same `--fresh` baseline; record
  `automation_status.react` with the numbers.

### Opt-in checks

Outside `doodlebot test core`; each runs against the running instance (`up` first, with the
flags in "Needs") and writes JSON evidence (and screenshots or a `.cpuprofile`) under
`harness/.artifacts`, printing `evidence: <path>` where it measures. Keep CPU-heavy work off the
machine while they measure.

| Command                                                       | Needs                              | Fails on                                                                    |
| ------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| `doodlebot test collection-scale --members <n>`               | sandbox                            | a freeze over 10 s in a phase                                               |
| `doodlebot test plugins-page --plugins <n> [--vortex-order]`  | fake Fallout 4                     | blocking on scroll, filter, clear or toggle; a row not following its toggle |
| `doodlebot test collection-download-retry`                    | fake Fallout 4                     | a member whose downloads failed not being installed by a resume             |
| `doodlebot test plugins-mod-link --mods <n>`                  | fake Fallout 4                     | the Mod link not scrolling the last-sorted mod (default 300) into view      |
| `doodlebot test download-churn --downloads <n> --seconds <s>` | any                                | nothing; measures persist:diff, slow writes, dispatches, long tasks         |
| `doodlebot test large-library`                                | sandbox                            | see below                                                                   |
| `doodlebot test mods-scroll --mods <n>`                       | sandbox                            | see below                                                                   |
| `doodlebot test zoom [--signed-out]`                          | source build with zoom             | zoom controls, shortcuts, timers, animation, layout                         |
| `doodlebot test panels`                                       | source build, `--bethesda-sandbox` | right-hand split view behaviour                                             |

- **collection-scale** options (`collectionScale.ts`, deterministic; none = required members, no
  rules): `--optional <f>`, `--glob <f>`, `--duplicates <n>`, `--rules <n>`, `--update` (revision
  2, `--extra <n>` default 50), `--missing-optional`, `--optionals skip|install|stand-in`.
  `phases.install` and `phases.update` report wall time, `longestFreezeMs`, long tasks, step
  timings, `dispatches`, `marks`, `windows`, `inclusive`, `inclusiveApp`, `longestBusy`. Realistic:
  `--members 2000 --optional 0.1 --glob 0.04 --duplicates 20 --rules 1000 --update`.
- **large-library** (3,000 seeded mods, `largeLibrary.ts`): more than 200 rendered rows, a filter
  clear blocking over 2 s, blank rows at any depth, a task over 1.5 s across 10 installs, or a
  modern deploy over 1.6× the classic-layout deploy (or `--max-deploy-ms`). Flags: `--mods <n>`,
  `--layout modern|classic`, `--installs <n>`, `--no-deploy`, `--settings-deploy`. Run against a
  source build and against `--installed` as baseline.
- **mods-scroll** (real wheel, `--mods` default 3,000): more than 200 rows on arrival, a flick
  frame gap over `--max-frame-gap` (300 ms), blank rows 1 s after scrolling, a clipped edge
  dropdown, the Status column narrowing back, or with `--conflicts <pairs>` over 200 conflict
  editor entries rendered. Rows kept after a scroll-through only warn unless
  `--max-accumulated <n>`; `--no-scroll-through` skips it.
- **zoom** needs no game or account and restores zoom, layout and window size. `--signed-out`
  starts its own anonymous profile (`<cache>/zoom-signed-out`) on the default ports, so it refuses
  while a harness Vortex runs (`... before the signed-out zoom check.`); run `down` first. It
  never logs out the main profile.
- **panels**: runs against the running instance; it saves and restores workspaces and
  window size. The toggle is `[data-split-view-toggle]` (`aria-pressed`), the chooser
  `[data-panel-chooser="panel"]`; both panes stay at least 440 px.

### Benchmarking: `perf-summary` and the benchmark commands

`/doodlebot:measure` and `/doodlebot:compare` (`plugins/doodlebot/skills/`) are agent procedures
over the performance checks `mods-scroll`, `large-library`, `collection-scale` (sandbox),
`download-churn` (any game) and `plugins-page` (`--bethesda-sandbox`, source builds only).
Builds are given as `--exe <path>` or `--dev-dir <path>` (built with
`doodlebot build --checkout <dir> --production` and launched with `--production`); nothing is
downloaded. Each build gets its own new `VORTEX_AI_CACHE_DIR` with a null OAuth tombstone, and
runs alternate A and B, five each by default (three at least). Each run is
`doodlebot up <build flags> <game flags> --fresh`, `doodlebot call automation_status`
(recording `vortexVersion` and `nodeEnv`), `doodlebot test <check> <options>` (capturing the
`evidence: <path>` line) and `doodlebot down`. A run whose check exits 1 after writing evidence
counts, with its failures listed; a run with no evidence is not counted.

```powershell
doodlebot perf-summary --check mods-scroll --a <a1.json> --a <a2.json> --a <a3.json> [--b <b1.json> ...] --out <report.md> [--json]
```

- `perfSummary.ts` reads a fixed metric table per check (milliseconds, or per minute for
  `download-churn`'s `persistDiffs.perMinute`; lower is better). A metric missing from a file is
  left out for that file.
- Per metric: each side's median (the mean of the middle two for an even count), minimum,
  maximum and count, to one decimal place, and `(median B − median A) / median A × 100`
  computed from those rounded medians (omitted when the rounded median A is 0), itself rounded.
- Verdicts compare the rounded minimum and maximum the table shows, so they never contradict
  it: **Blocked** if either side has fewer than three values (applied first); **Faster**
  if B's maximum is below A's minimum; **Slower** if B's minimum is above A's maximum;
  otherwise **No clear difference**. Overall: Blocked if either side has fewer than three runs
  or every metric is Blocked; else Slower if any metric is, else Faster if any is, else No clear
  difference. It also states the chance of a non-overlap by chance.
- Without `--b` there is no difference column, no Verdict section and no overall verdict.
- Reports go to `harness/.artifacts/benchmarks/<UTC time>-<slug>/report.md`; the skill adds the
  question, builds, measurement, conditions and the machine-quiet caveat.

## Knowledge

Doodlebot learns from verified work. There are two stores, both searched by
`doodlebot knowledge search <words...> [--json]`. Each word must appear (case-insensitive);
local lessons are listed before shared sections.

- **Shared:** `KNOWLEDGE.md` in the workspace, reviewed lessons as `### ` entries under `## `
  area headings. Search matches each entry on its own, titled `<area> › <entry>`; text under an
  area heading before its first entry is a section of its own. Skills never edit it: it changes
  through doodlebot pull requests, and an edit would make `update` refuse.
- **Local:** `~/.doodlebot/knowledge.md` (`KNOWLEDGE_FILE` in `knowledgeCommand.ts`), next to the
  instance record. It survives `update` and re-setup and is shared by Claude Code, Codex and
  every workspace. It is a Markdown file with one `## <title>` section per lesson, holding:
  - `- **Id:** k-<yyyymmdd>-<6 hex>`;
  - `- **<Field>:** <text>` lines for Area, Symptom, Cause, Remedy, Scope, Evidence, Vortex and
    Seen.

  It is rewritten through a temporary file and a rename.

`doodlebot knowledge add`:

- requires `--title`, `--area`, `--symptom`, `--cause`, `--remedy`, `--scope` and
  `--evidence`, and takes `--vortex <version>` optionally;
- sets `Seen` to today's date;
- refuses a duplicate title (case-insensitive);
- refuses any value that looks like a credential: a `Bearer` header, or an unbroken run of 32
  or more base64-style characters mixing letters and digits that is not pure hex. Paths, slugs
  and commit SHAs pass.

The other sub-commands:

- `list` prints the lessons with their ids;
- `remove <id>` deletes one;
- `path` prints the file's location;
- `--json` gives JSON output from `add`, `list` and `search`.

`plugins/doodlebot/resources/knowledge.md` is the procedure. Before acting, `fix`, `drive`,
`design` and `ui-test` search for the symptom or area, and treat every match as a lead to
recheck against the source. After acting, `fix`, `drive` and `qa` record a lesson only when:

- the cause was confirmed;
- the lesson would have saved real time;
- neither store has it already.

Guesses stay in the run report. A local lesson that keeps holding is shared as a doodlebot pull
request to `KNOWLEDGE.md`, and only when the person asks.

## Configuration and recovery

| Variable                                   | Purpose/default                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `VORTEX_AI_EXE`                            | Installed Vortex executable, otherwise auto-detected                       |
| `VORTEX_AI_DEV_DIR`                        | Explicit Vortex source directory                                           |
| `VORTEX_AI_INSTALLED`                      | `1` forces installed Vortex, including tests                               |
| `VORTEX_AI_GAME_ID`, `VORTEX_AI_GAME_PATH` | Game and install path                                                      |
| `VORTEX_AI_CACHE_DIR`                      | Profiles/login cache; default `harness/.cache`                             |
| `VORTEX_AI_ARTIFACT_DIR`                   | Screenshots/reports; default `harness/.artifacts`                          |
| `VORTEX_MCP_PORT`, `VORTEX_AI_CDP_PORT`    | MCP/CDP; default 3701/9222                                                 |
| `VORTEX_MCP_TOKEN`                         | Bearer token shared by harness and MCP client                              |
| `VORTEX_AI_NEXUS_API_KEY`                  | Optional legacy key; sandboxes need `--with-api-key`                       |
| `VORTEX_AI_HEADLESS`                       | Hide window; screenshots may be blank                                      |
| `VORTEX_AI_PNPM`                           | A pnpm of the Vortex checkout's pinned version, used instead of `pnpm dlx` |
| `VORTEX_AI_KIT`                            | Set by `script`: the `file://` URL of `kit.ts`                             |

Relative paths in these variables resolve against the workspace root (the shim's working
directory), not the caller's directory; `VORTEX_AI_SOURCE_DIR` (the managed source, default
`.vortex-src`) and `VORTEX_AI_DEV_DIR` are resolved explicitly. An explicit `--dev-dir` that is
not a built checkout fails with
`--dev-dir <abs> is not a built Vortex checkout: <reason>` (`doctor` reports it as a failing
`Vortex` check instead); a `VORTEX_AI_DEV_DIR` or managed checkout keeps the fallback.

- Unclear prerequisites: `doctor` with the same flags. No UI write tools: Vortex started without a
  token. HTTP 403: token, host or origin mismatch.
- `A harness Vortex is running ...`: run `doodlebot down`; it follows the instance record, even
  from another workspace, so no cache or port options are needed. If no harness Vortex window is
  open and the refusal persists (a reused pid), delete `~/.doodlebot/instance.json`
  ("One instance").
- `doodlebot` not found: run `node bin/doodlebot.cjs link` in the workspace (or
  `/doodlebot:setup`); `link` reports `on PATH: no` when its folder must be added to the PATH.
- Startup errors name the isolated `userData/vortex.log`. Don't print whole logs: auth flows may
  log sensitive URLs.
- An instance predating `automation_status`: update its extension and restart it with its MCP
  `vortex_quit` tool first.
- **Never treat a port collision as permission to stop an unrelated Vortex.** Never commit
  profiles, screenshots with private data, or credentials.
