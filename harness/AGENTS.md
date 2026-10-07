# doodlebot operating manual

doodlebot is an agentic development and testing tool for Vortex, the Nexus Mods mod manager. Its
Vortex extension is an MCP server exposing Vortex's state and UI; the harness (this directory,
CLI `doodlebot`, run as `pnpm run ai -- <command>`) launches isolated profiles of an unmodified
Vortex, drives them, captures evidence and runs Playwright checks. A source checkout is optional.

- [KNOWLEDGE.md](../KNOWLEDGE.md): non-obvious Vortex behaviour. Read before debugging.
- [WORKFLOWS.md](WORKFLOWS.md): bug reproduction, features, designs, state and window-size
  matrices, several issues at once.
- [PULL-REQUESTS.md](PULL-REQUESTS.md): Vortex PR titles, description template, reviews.
- `.claude/skills/`: `drive-vortex`, `vortex-dev`, `vortex-ui-test`. Apply the relevant ones.
- [ARCHITECTURE.md](../ARCHITECTURE.md): where a new capability belongs.

When developing Vortex, **read and follow its own `AGENTS.md`, `CLAUDE.md` when present, its
documentation index and task-specific AI guidance before editing its source**.

## Initial setup

Windows, a Node version compatible with package.json, the pinned pnpm (`pnpm@9.15.0`), Git and an
installed Vortex. No game or Nexus account is needed for sandbox tests.

```powershell
pnpm install --frozen-lockfile
pnpm run ai -- setup --installed --sandbox
pnpm run ai -- doctor --installed --sandbox
pnpm run ai -- snapshot
pnpm run ai:test
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
pnpm run ai -- setup --oauth --installed     # waits up to 10 min; --no-wait returns at once
pnpm run ai -- save-login --installed        # after a timeout or --no-wait, once logged in
pnpm run ai -- auth-status                   # presence booleans, never secrets
pnpm run ai -- login-import --cache-dir D:\other-cache [--from D:\bench-cache] [--force]
```

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
- A new `--cache-dir` starts logged out. `login-import` copies the login from `harness/.cache` (or
  `--from`) for the target `--installed`/`--dev-dir` selects; it refuses a logged-out source and
  replaces a login only with `--force`. Copies then rotate apart; if Nexus refuses one, import
  again or repeat setup.
- Optional legacy key: `VORTEX_AI_NEXUS_API_KEY` in `harness/.env`.

## Run and reset

```powershell
pnpm run ai -- up --installed --sandbox
pnpm run ai -- down
pnpm run ai -- up --installed --sandbox --fresh
pnpm run ai -- up --installed --sandbox --rebuild-snapshot
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
- For another instance take a slot (next section), not a hand-picked `--cache-dir`, `--port`
  and `--cdp-port`.

## Parallel sessions: a worktree and a slot per agent

Each doodlebot session works in its own worktree and slot, so their Vortex instances coexist, and
changes the kit only under the kit lock (WORKFLOWS.md, "Several agents at once").

```powershell
pnpm run ai -- worktree add fix-a --base upstream/master   # .vortex-worktrees/fix-a, installed and built
pnpm run ai -- up --owner fix-a --worktree fix-a --slot auto --bethesda-sandbox
pnpm run ai -- slots                                       # who has which slot, and whether it runs
pnpm run ai -- down --owner fix-a --slot auto
pnpm run ai -- worktree list
pnpm run ai -- worktree remove fix-a                       # the branch stays
```

- **Slots** (`slots.ts`). Slot 0 is `harness/.cache` and `harness/.artifacts` on MCP 3701 and CDP
  9222, the default. Slot n (1–19) is `harness/.slots/<n>/cache` and `…/artifacts` on 3701+10n and
  9222+10n, with its own instance lease. `--slot auto` (or `VORTEX_AI_SLOT=auto`; needs an owner)
  gives the owner a slot of its own, recorded in `<lease dir>/slots.json` and reused later; when all
  19 are given out, the least recently used idle one. `--slot <n>` picks one. Explicit
  `--cache-dir`, `--port` or `--cdp-port` win over the slot.
- **Pass the same `--owner` and `--slot` to every command.** `ai:test:*` scripts read
  `VORTEX_AI_SLOT` and `VORTEX_AI_OWNER`; `script` passes its instance on.
- A slot's first `up` copies slot 0's OAuth login; the copies then refresh separately. If Nexus
  refuses one, `login-import --slot <n> --force`.
- **Worktrees** (`worktree.ts`) of `.vortex-src` share its object store. `add` fetches the base
  (default `upstream/master`), creates `--branch` (default the name) or checks out an existing one,
  then installs and builds with the pinned pnpm (`--no-install`, `--no-build`). `--worktree <name>`
  To review a branch another worktree has checked out, `worktree add <name> --ref origin/<branch>`
  makes a detached worktree at it (QA must not commit to the author's branch anyway).
  on any command means `--dev-dir` for it. `remove` refuses while a Vortex runs from it, or with
  uncommitted changes unless `--force`.
- Shared by all: `dist/` (rebuilt by whoever changes the extension, under the kit lock), the pnpm
  store, the CPU. Don't take timings while other slots are busy (`slots`).
- **The kit lock** (`kit lock --owner <you> [--wait <min>]`, `kit sync`, `kit push`, `kit unlock`,
  `kit status`): one session at a time edits and pushes this repo. `kit push` rebases `main` onto
  `origin/main` and pushes, refusing without the lock, with uncommitted changes or off `main`.
- `vortex-e2e` has its own lease (`vortex-e2e`): E2E runs wait for each other, not for instances.
- `pnpm run ai:test:parallel-sessions -- [--a <checkout>] [--b <checkout>]` checks two sessions side
  by side: own ports, profile and lease, isolated installs, clean stop.

## The instance lease: one agent drives each Vortex

A lease per instance in `~/.vortex-ai/leases` (shared by every kit checkout; `VORTEX_AI_LEASE_DIR`
overrides) says who drives it. Owner: `--owner`, else `VORTEX_AI_OWNER`, else `anonymous`. Use one
owner name per session.

```powershell
pnpm run ai -- lease status                     # who holds what, live or stale (--json)
pnpm run ai -- lease acquire --owner qa --purpose "PR QA" --ttl 120 --checkout C:\dev\vx-ab
pnpm run ai -- up --owner qa --sandbox          # joins qa's lease
pnpm run ai -- down --owner qa
pnpm run ai -- lease release --owner qa         # everything qa holds
pnpm run ai -- lease run --owner qa --wait 60 -- pnpm run verify
```

- `up`, `bootstrap`, `setup`, `save-login`, `down`, `e2e`, `vortex-e2e`, `ai:test` (whole run) and
  `ai:test:*` take it implicitly: free or stale, taken; same owner, joined; another live owner,
  **refused before anything stops**, naming the holder and how to wait.
- `up` leaves it held by the running Vortex until `down` or exit.
- `lease acquire` lasts `--ttl` minutes (default 60, `0` none) or, with `--pid <n>`, that process's
  life. Re-acquire to renew. `--checkout <dir>` also takes that checkout's lock, all or nothing;
  `--checkout-only` just the checkout.
- `lease release --owner <name>` releases all that owner holds; `--checkout <dir>` only that one. A
  checkout a Vortex runs from stays locked until `down`.
- `lease run [flags] [--] <cmd...>` holds the lease for the command, passes `VORTEX_AI_OWNER`,
  always releases and returns the command's exit code. Flags go first (PowerShell 5.1 strips
  `--`). Use it for `pnpm run verify` and anything touching Vortex outside the kit.
- `--wait <minutes>` (`lease run`, `lease acquire`, `script`) polls until the holder is done.
- Stale: every holding process exited, or an explicit TTL passed; the next acquirer reclaims it and
  says so. Reclaiming an expired lease whose Vortex runs means the next `up`/`down` stops it.
- `lease release --force` clears the instance lease; `--owner <name> --force` all of an owner's.
  **Only a human, after checking the holder is gone.**
- Checkout locks (`checkout:<path>`): `pr-preflight`'s revert check, `vortex-e2e`'s patch, `build`,
  and every launch from `--dev-dir`, `--worktree` or `.vortex-src` (held until that Vortex exits).
  `script` and `ai:test:*` take the checkout recorded in `<cache>/instance.json`.
- Liveness is a PID check, so a reused PID can keep a dead lease looking live. The lease cannot stop
  a process that ignores it.

## Drive from any agent or shell

`up` prints the Streamable HTTP MCP endpoint, bearer token and a client example. Every tool is also
callable from the CLI.

```powershell
pnpm run ai -- tools --json                              # live tools and input schemas
pnpm run ai -- snapshot [--selector <css>]
pnpm run ai -- click --ref <ref>                         # or --selector <css>
pnpm run ai -- fill --ref <ref> --value example
pnpm run ai -- press --key Escape
pnpm run ai -- call vortex_query --args-file query.json  # or --args <json>
pnpm run ai -- screenshot --label before [--full-page]
```

`--args-file` avoids shell quoting (a PowerShell BOM is fine); keep credential-bearing ones private.

The loop is snapshot, act, wait, inspect. Refs expire on the next snapshot, reload or element
removal: never reuse one. Filter or scroll virtualized rows into the DOM first. Check
`activeDialogs` when an action seems blocked. Independent clients must coordinate UI actions.

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

`doodlebot script <file.mts> [args...]` runs a scratch script with the kit's tsx under the instance
lease, with the instance's cache, ports and token in its environment. `--owner`, `--wait` and the
instance flags (`--slot`, `--worktree`, `--dev-dir`, `--cache-dir`, ports) are the kit's anywhere; other arguments, and all after `--`, are the script's. Outside this repo use
`.mts` (top-level `await`) and import the kit by the URL in `VORTEX_AI_KIT`:

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

`doodlebot record --ffmpeg <exe> --seconds <1-60> --label <name>` records the renderer to WebM
while you drive it; `startRecording` (`recording.ts`) scripts it. The encoder needs MJPEG in and
VP8/WebM out (`pnpm exec playwright install ffmpeg`). Frames repeat, so pauses keep their length;
keep durations when converting. For PR media, `gh pr edit --attach <file>` (GitHub CLI 2.99+)
uploads files that `--body-file` image references name (push access, under 10 MB).

## Install and deploy

```powershell
pnpm run ai -- install C:/fixtures/example.zip
pnpm run ai -- collection <collection-url>
pnpm run ai -- deploy --game <active-game-id> [--purge]
pnpm run ai -- purge
pnpm run ai -- e2e <collection-url> [--runs <n>] [--keep] [--purge] [--no-launch]
```

- `slow-download [--count <n>] [--seconds <n>] [--stagger <s>]` keeps real downloads in flight
  (throttled local files, no network or account) for work on the UI that reports them: the
  spine's download button and panel, the Downloads page. It returns when they finish, so run it
  in the background and drive the UI meanwhile. `--stagger` starts each after the one before, so
  a UI that announces arrivals sees them separately. Scripts: `kit.slowDownload`.
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
pnpm run ci         # typecheck, lint, format, unit tests, build; no Vortex
pnpm run ai:test:core # Playwright contract against a real Vortex, account-free (ai:test alias)
pnpm run ai:test:oauth # opt-in: cached sandbox OAuth survives a fresh restore
pnpm run ai -- responsive --screenshots --viewports "1024x720,1280x720,1280x1000,1920x1080" [--strict]
```

- Say which suite ran and disclose skips. Quote comma lists in PowerShell.
- See [TESTING.md](TESTING.md) for the core contract, pinned-release CI and opt-in scenarios.
  Feature regressions and performance scripts stay outside the default kit gate.
- Responsive checks: each relevant state with its own label, width and height, real sizes after OS
  clamping, and a visual review against any design (WORKFLOWS.md has the state matrix).
- `pnpm run ai:source` prepares `.vortex-src` (`--update`, `--no-build`, `--where`), which `up`
  then prefers. `--installed`, `--exe <path>`, `--dev-dir <path>` or `--worktree <name>` pick a
  target.
- Extension work: `pnpm run dev` with `pnpm run ai:watch` (`--build`), which reloads and waits for
  a new renderer lifetime. Main-process changes need a restart. Recheck `tools --json` after
  changing tool registration. `build-extension` or `up --rebuild-extension` forces a build.
- `ai:test:nexus` (opt-in; same target, cache and ports as account setup): a separate
  `nexus-smoke` profile and disposable Stardew Valley folder, the five required members of
  revision 1 of `stardewvalley/nudx7b`, SHA-256 checks of deployed files, purge, evidence,
  refreshed credentials copied back. No launch. Needs Nexus Premium for unattended downloads.
  Outages are failures, not a reason to repeat OAuth.

### Pull request checks

- `pnpm run ai -- pr-checks <number-or-url> [--repo <owner/name>] [--json]`: the PR head's checks
  via `gh`, failed jobs expanded to failed steps (a test failure vs. a failed upload). Nonzero while
  any check is pending or failed.
- `pnpm run ai:preflight` (= `pr-preflight`) before pushing; put its report in the PR. It diffs
  the committed `HEAD` of `--checkout` (default `.vortex-src`) against its merge-base with `--base`
  (default `upstream/master`), prints PASS/WARN/FAIL/SKIP per check with file:line, exits 1 on any
  FAIL. `--json` lists every hit.

| Check                    | Result                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Size                     | WARN over 400 changed lines or 10 files, excluding lockfiles, `etc/*.api.md`, snapshots, build output                                                                    |
| Callers outside the diff | WARN list: uses outside the diff's hunks of each touched export, class member, class/component (default imports, barrels) and private helper (one level up); tests apart |
| Readers of changed state | WARN: readers of each class field whose assignment changed, and of its getters                                                                                           |
| Dispatchers of reducers  | WARN: each changed reducer's action creator, its calls and type-string uses                                                                                              |
| Revert check             | FAIL unless tests pass on the branch and fail with non-test changes reverted                                                                                             |
| Measurements in comments | WARN for timing or size figures in added comments                                                                                                                        |
| PR description           | With `--pr <n>`: FAIL on a non-Conventional or >72-char title, missing section, "Not run", no head sha                                                                   |

- Test code (`*.test.*`, `*.spec.*`, `__tests__`, `__mocks__`, `__fixtures__`, `test-utils`) is
  never reverted or counted as a caller.
- Revert check: `pnpm exec vitest run` on `--test <path>` (repeatable) or the tests the diff
  touches, from each test's nearest `package.json` (`--project-dir` overrides). `--revert <path>`
  reverts only those files; `--revert-hunk <file>:<line>` only the hunk holding that head line.
  It is the only check that writes: it refuses uncommitted changes, backs up, restores exact bytes
  on any exit including Ctrl+C, then verifies hashes and `git status`. `--skip-revert` skips it;
  `--head <ref>` checks a ref without checkout (and without the revert check).
- Discovery is regex-based (`touchedSymbols`, `parseImports` in `prPreflight.ts`): object-literal
  methods, renamed callers and `require()` are missed, member matches include unrelated objects.
  Read the list.

### Vortex's own E2E suite

`pnpm run ai:vortex-e2e -- --checkout <dir>` (= `vortex-e2e`) runs `<checkout>/packages/e2e` as
upstream CI does (`CI=1`, `VORTEX_E2E_HEADED` unset, one worker, no retries). It needs a built
checkout and holds the instance lease and checkout lock. For the run only it:

- applies `harness/patches/` (`e2e-window-startup.patch`; KNOWLEDGE.md says why stock gives no
  local result). It refuses uncommitted changes to those files, fails if `git apply --check` does,
  skips patches already present, and restores exact bytes afterwards, even on Ctrl+C;
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
| `--owner <name>`          | Lease owner                                                        |

Reports go to `harness/.artifacts/vortex-e2e/<time>-<sha>.json`. Exit 1 on any failure, a
regression under `--compare`, or a failed restore. For a PR, run master as the baseline, then the
branch with `--compare`. For an upstream CI failure, run its exact spec, save before/after
reports, don't substitute the harness app, and read the workflow's flags, credentials and test
summary. Animation tests need a rendered window (KNOWLEDGE.md). Test credential skips with the
account variables empty.

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
- `pnpm run ai:test:bethesda`: Missing Masters flags an absent master before and after an offline
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
  `ai:test:collection-download-retry`). `closeCollectionReviews(mcp)` closes any review a script or a
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

- `pnpm run ai -- build --checkout <dir> [--production]` runs the checkout's `pnpm run build` with
  its pinned pnpm under the checkout lock, refusing while a Vortex runs from it, with
  NODE_ENV=production for the build only (unset otherwise). It restores `etc/vortex.api.md` and
  `etc/Dependency Report.md` if rewritten. The caller's environment is untouched; in the agent
  sandbox clear a variable with `$env:NODE_ENV=$null`.
- `up --dev-dir <checkout> --production` **fails unless `automation_status` shows
  `nodeEnv: "production"` and `react.build: "production"`**, and warns on a development bundle.
- Compare A/B builds in the same mode from the same `--fresh` baseline; record
  `automation_status.react` with the numbers.

### Opt-in checks

Outside `ai:test`; each writes JSON evidence (and screenshots or a `.cpuprofile`) under
`harness/.artifacts`. Keep CPU-heavy work off the machine while they measure.

| Command                                                   | Needs                              | Fails on                                                                    |
| --------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| `ai:test:collection-scale -- --members <n>`               | sandbox                            | a freeze over 10 s in a phase                                               |
| `ai:test:plugins-page -- --plugins <n> [--vortex-order]`  | fake Fallout 4                     | blocking on scroll, filter, clear or toggle; a row not following its toggle |
| `ai:test:collection-download-retry`                       | fake Fallout 4                     | a member whose downloads failed not being installed by a resume             |
| `ai:test:plugins-mod-link -- --mods <n>`                  | fake Fallout 4                     | the Mod link not scrolling the last-sorted mod (default 300) into view      |
| `ai:test:download-churn -- --downloads <n> --seconds <s>` | any                                | nothing; measures persist:diff, slow writes, dispatches, long tasks         |
| `ai:test:large-library`                                   | sandbox                            | see below                                                                   |
| `ai:test:mods-scroll -- --mods <n>`                       | sandbox                            | see below                                                                   |
| `ai:test:zoom [-- --signed-out]`                          | source build with zoom             | zoom controls, shortcuts, timers, animation, layout                         |
| `ai:test:panels`                                          | source build, `--bethesda-sandbox` | right-hand split view behaviour                                             |

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
  uses a separate anonymous profile on the next ports and never logs out the active one.
- **panels**: match `VORTEX_AI_OWNER` to the instance owner; it saves and restores workspaces and
  window size. The toggle is `[data-split-view-toggle]` (`aria-pressed`), the chooser
  `[data-panel-chooser="panel"]`; both panes stay at least 440 px.

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
| `VORTEX_AI_OWNER`                          | Lease owner when `--owner` is absent; `anonymous`                          |
| `VORTEX_AI_SLOT`                           | Instance slot (`0`–`19` or `auto`) when `--slot` is absent                 |
| `VORTEX_AI_PNPM`                           | A pnpm of the Vortex checkout's pinned version, used instead of `pnpm dlx` |
| `VORTEX_AI_LEASE_DIR`                      | Lease files; default `~/.vortex-ai/leases`                                 |
| `VORTEX_AI_KIT`                            | Set by `script`: the `file://` URL of `kit.ts`                             |

- Unclear prerequisites: `doctor` with the same flags. No UI write tools: Vortex started without a
  token. HTTP 403: token, host or origin mismatch.
- Startup errors name the isolated `userData/vortex.log`. Don't print whole logs: auth flows may
  log sensitive URLs.
- An instance predating `automation_status`: update its extension and restart it with its MCP
  `vortex_quit` tool first.
- **Never treat a port collision as permission to stop an unrelated Vortex.** Never commit
  profiles, screenshots with private data, or credentials.
