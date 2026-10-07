# Vortex behaviours worth knowing

Non-obvious behaviours of Vortex and of this kit that fail silently, or with a message that
points somewhere else. Use [knowledge routes](harness/KNOWLEDGE-ROUTES.md) and search the
relevant symptom or subsystem rather than loading the whole catalogue for every task.

Entries state symptom, confirmed cause, remedy, applicable scope and source/test evidence.
A matching symptom is a lead to verify against the current revision. Keep measurements,
incident history and unconfirmed explanations in task artifacts. Promote only verified,
reviewed lessons under [the workflow](harness/AGENT-WORKFLOW.md#improve-from-verified-lessons)
and kit lock. Correct disproved claims and remove obsolete workarounds; retain useful
preventive tests. Existing undated entries require rechecking before a task relies on them.

## Extensions

### Harness and extension invariants that broke once

The next three entries were checked during the 2026-10-07 workflow rework on kit base
`df5d2feef23b2dce2134d1433d299fad612741cb` plus its identified local changes. Recheck the linked
source/tests when using another revision.

- A shared owner name joins ownership leases; it does not serialize independent commands.
  Supported commands also take UUID operation guards. Pass an execution context only to
  intentionally nested commands; give parallel workers distinct owners and slots.
  Scope: supported harness operations in the 2026-10-07 workflow rework; raw clients are outside
  these guards. Evidence: [operations.ts](harness/src/operations.ts),
  [leaseCommand.ts](harness/src/leaseCommand.ts) and the same-owner/nested-process cases in
  [operations.test.ts](harness/src/operations.test.ts).
- Repeated E2E test IDs can fail for different causes, and passed tests can disappear or skip.
  Reconcile selection, outcome and failure evidence before declaring readiness.
  Scope: native Vortex E2E reports and final readiness in the 2026-10-07 workflow rework.
  Evidence: `compareRuns`/`e2eReportSchema` in [vortexE2e.ts](harness/src/vortexE2e.ts),
  [vortexE2e.test.ts](harness/src/vortexE2e.test.ts) and [readiness.test.ts](harness/src/readiness.test.ts).
- Configuration must not require Electron's auto-installing module. Resolve paths without
  side effects, then install only inside the guarded launch/provisioning operation.
  Scope: source-target resolution in the 2026-10-07 workflow rework. Evidence: `resolveTarget` in
  [config.ts](harness/src/config.ts), `peekDevElectron`/`resolveDevElectron` in
  [electronRuntime.ts](harness/src/electronRuntime.ts), and the separate-process installation
  exclusion checks in [electronRuntime.test.ts](harness/src/electronRuntime.test.ts).

- A ref counter that restarts at `e1` lets an old ref hit a new element. Refs carry a renderer
  lifetime and never reuse a counter within it. Test that old refs are rejected.
- A dialog watcher can invalidate a foreground snapshot before its click. `withUiLock` serialises
  snapshot/action transactions within one client; separate clients need their own coordination.
- An MCP Protocol object owns one transport. Overlapping HTTP requests sharing it send responses
  to the wrong client.
- Plain-string UI name matching is exact and case-insensitive, and ambiguity is an error.
  Substring matching made `Games` match `Save games`.
- A no-game snapshot needs its own key and marker, or every no-game start is cold.
- Worker fixtures share one app; a lifecycle test on their ports stops it under later tests. Give
  every extra app its own cache, MCP port and CDP port.
- Collection lookup must match slug and revision, and completion the returned collection mod ID.
  Taking the first collection reported unrelated work as complete.
- Nexus can return HTTP 504 on dependency lookups: dependency-error notifications with no active
  downloads. Report it and keep the profile; logging in again does not fix an outage.
- Playwright can emit `window` while the renderer is still `about:blank`; watch navigation too, or
  fixture setup times out. After a renderer reload wait for the title bar: extension loading can
  outlast the default 5 s assertion timeout.
- Width-only report labels hide height-dependent failures; record requested, actual and inner
  dimensions. A fake game executable does not isolate a game's Documents or LocalAppData.

### Extensions are renderer-only

`onceMain` is deprecated ("won't work as expected"), so `webContents.capturePage`,
`desktopCapturer` and `BrowserWindow` are out of reach. Use CDP from outside (`harness/src/cdp.ts`);
it works against a released build.

### Install paths that fail silently

- An extension under an ESM package root never runs. Vortex says only
  `corrupt extension, failed to initialize: {"name":"doodlebot",...}`. Node takes a `.js` file's
  module type from the nearest `package.json`, so under `"type": "module"` the CommonJS bundle
  parses as ESM and never runs.
  `installMcpExtension` writes `{"type":"commonjs"}` into the installed directory.
- Vortex needs `<appData>/<appName>/startup.json` before launch: `Vortex` for a release,
  `@vortex/main` for a source checkout. The wrong one quits with ENOENT on `startup.json`, which
  reads like a corrupt profile.
- `installMcpExtension` takes the _instance_ directory and appends `userData/plugins/<id>`.
  Passing userData writes `userData/userData/...`, which Vortex never reads, so the old build keeps
  running and changes seem to have no effect.

### Verify tool schemas after reload; a responding port can still be the old server

A reload can leave the old tool registration in place. A new parameter is then stripped by the old
schema, and the new handler returns a normal result without it, which looks like the new code not
loading. The harness waits for `automation_status.runtimeId` to change. After a schema change check
`tools --json`, and if the schema is missing run `pnpm run ai -- down` then `up`. A successful
request does not prove the rebuilt extension loaded.

## Accounts

### An API key logs you in, but not for collections

`isLoggedIn` is `truthy(APIKey) || truthy(OAuthCredentials)`, so an API key alone shows the account
as signed in. Collection downloads use OAuth, and with only an API key they 401 minutes later
with "You are not logged in to Nexus Mods!". Check `OAuthCredentials` specifically; a snapshot
marker alone never proves a usable login. The API key also hides the fix: Vortex offers only
Logout, which ends someone's session, so ask first. OAuth needs a captcha, so one interactive
`setup --oauth` is unavoidable.

### The saved OAuth login lives outside the profile

`src/authCache.ts` keeps OAuth credentials in a harness-only file that follows refresh-token
rotation across `--fresh` and game switches. A real logout writes `null` there as a tombstone, so
fresh starts stay logged out rather than resurrecting a snapshot's login. If every start is logged
out, look for that tombstone and repeat `setup --oauth`.

### A source build's second launch logs you out

`migrate()` runs migrations against the prior `app.appVersion`. On a new profile that is `""`,
`semver.lt` throws "Invalid Version" and nothing runs. That launch stores the source build's
`1.0.0`, so the next runs `forceLogoutForOauth_1_9`, clearing the API key and OAuth and setting
`ForcedLogout`. Releases and `NODE_ENV=development` are unaffected. The extension marks that
migration complete in harness profiles (in `once`, before `migrate()`), and treats a clear followed
by `SET_FORCED_LOGOUT(true)` in one dispatch run as automated, re-applying the cached credentials.
A user's Log out and `refuseLogin` never set `ForcedLogout`, so they still tombstone.

### A seeded API key makes every local install wait a minute

With an API key Vortex looks each local archive up on Nexus, and for a fixture archive that ends
only at its 60 s timeout, so every sandbox install looks hung. Sandbox runs leave the key out of
the profile and drop `VORTEX_AI_NEXUS_API_KEY` and `NEXUS_API_KEY` from Vortex's environment
unless `--with-api-key` is given. Both are needed: `harness/.env` puts the key in the harness's own
environment, which Vortex inherits.

## Isolation

### `VORTEX_E2E=1` is load-bearing, and hostile to discovery

`ELECTRON_USERDATA` / `ELECTRON_APPDATA` are honoured only when it is set, and it skips the
single-instance lock, so a harness instance runs beside the user's Vortex (releases honour all
three). It also disables quick discovery and `discover-game`, so the Games page never lists a
game by itself. Register the path with a raw `type:ADD_DISCOVERED_GAME` dispatch.

## Building Vortex from here

### lease run ran the kit's scripts, under the kit's pnpm

`pnpm run ai -- lease run … pnpm run verify`, typed in a worktree, failed at the `assets` step
with `ERR_PNPM_BROKEN_LOCKFILE`. `pnpm run` starts the CLI in the kit's own root, so the command
ran there too, with the kit's pnpm 9 first on PATH. `lease run` now takes the caller's directory
from `INIT_CWD`, and a command outside the kit gets a cleaned environment (`commandEnv` in
`source.ts`). Anything else that spawns a Vortex command must do the same: `childEnv` for kit
code, `commandEnv` for a user's command.

### Worktree chores a build or commit trips on

- `pnpm nx run @vortex/renderer:build` and `pnpm run verify` rewrite `etc/vortex.api.md` (and
  `etc/Dependency Report.md`) with drift that isn't yours. Restore them before committing; only
  the kit's `build` and `worktree add` do it for you. Commit a real API change's own lines only.
- Vortex's husky pre-commit hook runs pnpm: a commit from a shell without pnpm 11 on PATH fails
  with "pnpm: command not found". Prepend the node22 PATH in the same command.
- In some sandboxed agent shells a worktree's install fails at electron-rebuild (MSBuild C1083,
  "Cannot open compiler generated file"), and `pnpm exec vitest` re-runs that install, so even
  unit tests can't run. Give such an agent a worktree built from an unsandboxed shell. For unit tests
  alone, a vitest config that aliases the native modules (`winapi-bindings`, `drivelist`,
  `leveldown`, `xxhash-addon`, `@nexusmods/fomod-installer-native`, `@parcel/watcher`) to a
  Proxy stub, run as `node node_modules/vitest/vitest.mjs run -c <config>`, gets the suites going.

### The first vitest run in a new worktree installs

`pnpm exec vitest` in a worktree nobody has run tests in yet starts an install and postinstall,
native-module rebuild included, even while a Vortex runs from that worktree. Run the first scoped
test before `up`, or expect the wait.

### A running app holds native modules open

A running source Vortex keeps plugin DLLs such as `libloot.dll` open, watcher or not. An nx cache
restore then reports only "Access is denied"; an uncached build names the file in
`copy-extensions`. Run `pnpm run ai -- down` before Vortex's `verify` gate or a rebuild.

### A nested package-manager run inherits the wrong pnpm

`pnpm exec` exports `npm_*` / `PNPM_*` variables that pin child processes to the parent's pnpm,
whatever the child's `packageManager`. Vortex's `pnpm install` run from this repo used pnpm 9 and
failed with:

```
WARN  Ignoring broken lockfile ... expected a single document in the stream
ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER  node@runtime:24.17.0
```

Neither names a version; pnpm 9 just cannot read pnpm 11's lockfile. `childEnv()` in
`harness/src/source.ts` strips the variables, and source setup runs Vortex's exact
`packageManager` version (`pnpm` if it matches, else `pnpm dlx` or `VORTEX_AI_PNPM`), so a newer
global pnpm can't silently replace the dependency layout either.

### A cached Vortex build starts, then fails at the first install

`start-install` fails with `Cannot find module '…\src\main\build\hash-worker.cjs'`. nx restored
`@vortex/main:build` from cache, which restores only declared outputs, and `src/main/project.json`
lists `bsdiff-worker.cjs` but not `hash-worker.cjs`, which `build.mjs` also bundles. The kit checks
every `bundleWorker(…, "<name>")` output after a build (`missingBuildOutputs`), runs
`node build.mjs` when one is missing, and `up` refuses such a checkout. The real fix is Vortex's
`project.json` outputs.

### `--production` needs a production bundle, and is checked

Vortex's bundlers inline `NODE_ENV` at build time, and nx caches both modes. A plain
`pnpm run build` makes a development bundle, whose "switch to production" branches are dead code,
so `--production` on it used to load development React. `up --production` now fails unless the
renderer reports production NODE_ENV, react and react-dom (`automation_status.react`), and warns
when `src/main/build/renderer.js` is a development bundle. For release parity build with
`pnpm run ai -- build --checkout <dir> --production`, which sets NODE_ENV for the build only; one
left in the shell silently makes later builds production. Distrust any timing whose
`automation_status.nodeEnv` was not `"production"`.

### `vi.resetModules()` trips `@vortex/shared`'s duplicate-module guard

`src/shared/src/errors/base.ts` registers `VortexError` on a `globalThis` symbol and throws
"Duplicate @vortex/shared error module detected in this process" when a second copy loads, so
`vi.resetModules()` then `await import(...)` throws at import like broken setup. Test fresh state
another way (an exported reset, a bound argument), or delete
`globalThis[Symbol.for("vortex.errors.VortexError")]` first and say so in the test.

### Capturing output makes a slow step look like a hang

`pnpm install` in a Vortex checkout runs for many minutes; captured, it looks wedged and gets
killed. Long steps stream. Likewise a check piped through `Select-String` or `Select -Last` shows
nothing until it exits: tee to a file, or watch the game directory and `list_notifications`.

### A renderer-only rebuild leaves Tailwind stale

After `pnpm exec webpack` in `src/renderer` and a reload, a new utility class does nothing: a
`bg-*` stays transparent, a `w-*` slot measures 0. The page loads `css/tailwind-v4.css`, which
`src/stylesheets` builds separately (`pnpm run tailwind` writes `dist/tailwind-v4.css`) and the
full build copies to `src/main/build/assets/css/`. Run it and copy the file before reloading, or
keep `pnpm run tailwind:watch` running, which writes there directly. Check a class exists with
`[...document.styleSheets]` before blaming the component.

### On a small-memory machine `build` exits 1 with a usable build

With about 4 GB of RAM, and other work running, `build` fails with "JavaScript heap out of memory"
in one or two `typecheck` tasks, while `src/main/build` already holds `main.cjs`, the renderer
bundle, the bundled plugins and the CSS, and `up` works. Treat the build as usable but the gate as
not run: typecheck the failing projects alone, or rerun on an idle machine. With most tasks in the
nx cache it doesn't happen; for a full `verify`, see "Under x64 emulation, `pnpm run verify` runs
out of memory…" (`NX_PARALLEL=2`).

### Getting code into Vortex's main process

- `--inspect-brk` hangs every install: workers inherit break-on-start and Vortex hashes archives
  in one, while the renderer looks healthy. Stripping `process.execArgv` does not help.
- `inspector.close()` from the attached session deadlocks main (0% CPU, no logging).
- A `--require` preload's `require("electron")` resolves to the npm package's path string. Hook
  `Module._load` and act on the app's own first `require("electron")`, as `mainPreload.ts` does.
- In NODE_OPTIONS quoted backslashes are escapes; use forward slashes.

Packaged Vortex ignores NODE_OPTIONS, so this works only on source builds. The harness checks the
preload's record and kills the instance within 5 s otherwise; `automation_status.paths` shows what
Vortex resolved.

### Vortex's E2E suite cannot give a local baseline as-is

Stock `packages/e2e` fails locally: account specs at once ("Missing required environment variable
E2E_NEXUS_FREE_USER_USERNAME"), and most others in fixture setup with "Vortex process exited
unexpectedly with code 0 before the main window appeared" after a 6-minute timeout, a startup race
in `packages/e2e/src/fixtures/vortex-app.ts`. Upstream CI runs E2E only for `packages/e2e` changes
or on schedule, so for most PRs the local run is the only E2E gate. Use
`pnpm run ai:vortex-e2e -- --checkout <dir>` (harness/AGENTS.md, "Vortex's own E2E suite"): it
applies `harness/patches/e2e-window-startup.patch` for the run, restores the file byte for byte,
and leaves out account specs without credentials by reading each describe's
`test.use({ nexusUser })` and tier title (files mix tiers). Don't run bare `playwright test`.

## Games and profiles

### What did Play actually launch?

The `launch_game` MCP tool resolves the executable its own way, so its result is no evidence of
what Vortex's Play button does. Play goes `ToolsSection` → `useTools.handlePlay` →
`StarterInfo.run(primaryStarter)`: the tool named by `settings.interface.primaryTool[gameId]`
when it has an `exePath`, otherwise the game's own starter (on Steam, a store launch). To see which
one ran, click Play and read Vortex's log: a sandbox's stand-in executables fail to start, and the
`Failed to run tool` line names the one tried. Play's analytics event also carries
`launch_method` (`"store"` for the game starter).

### A user's state.v2 copy settles what the log can't

A user's `state.v2` folder is a LevelDB copy of their Vortex state. Read it, never in place and
never their original, with `leveldown` from a Vortex checkout's `node_modules`, over a copy of
the folder (set `NODE_PATH=<checkout>\src\main\node_modules` so `levelup`/`leveldown` resolve).
In the launcher report it showed `tools.pinned.skyrimse.skse64=true`, and a
`primaryTool.skyrimse = "skse64"` written only at the restart that "fixed" it: the user had
pinned SKSE, and the launcher was set by activation after the restart, not before. Check the
timestamps as well as the values.

### `activate-game` is a dead end for a game with no profile

It opens a "Choose profile" dialog with an empty list and takes no callback, so it and
`vortex_dispatch`'s `__CALLBACK__` hang forever. `manageGameDiscovered` is not in `registerAPI`.
Use the UI: Games page → search → hover the tile → the manage button. Its label moves between
versions (2.6.x: `button.action-manage`, "Manage", in a `.hover-content` wrapper at `opacity: 0`;
newer: "Add game" or "Manual add"), so match the class first and the label as a fallback.

### A reset profile does not reset the game directory

`--fresh`, cold and rebuild starts replace profile and staging, but the game folder keeps the last
run's files and `vortex.deployment.json`, so the next deploy stops on External Changes, "Source
files were deleted". Bootstrap empties a disposable game's `Data` (keeping `Fallout4.esm`) and
plugin lists on reset, only for games inside the cache. It also removes what engine-injector
(`dinput`) mods deployed into the game root, from their `vortex.deployment.<type>.json`. Left
there, a script extender from the last run was discovered at the next fresh activation, and a
"found after activation" bug looked fixed.

## The UI

### setOpenMainPage returns before the page has changed

A capture right after `vortex_dispatch setOpenMainPage` can catch the previous page. It still
does, if a page from an earlier session, Settings say, was left open. Wait for a selector the target
page renders before screenshotting.

### Vortex's state verifiers only check a value's type

A stored setting that has become invalid but still has the right type (a removed design's number)
passes the verifier, so a verifier can't migrate it. Resolve it where it's read, and have the
reducer rewrite it.

### The first-launch notifications cover the bottom of the menu

A fresh profile opens the notifications popover over the menu's lower part, where Play and the
deploy control sit. Dismiss notifications before screenshots of that area.

### A placeholder row hit-tests as the table, not as a row

A virtualised row that hasn't rendered is a `tr` with a single cell, so an `elementFromPoint`
probe to the right of that cell hits the `TABLE`, not a `tr`. A probe that counts "not a row" as
fine hides every blank. Count a hit inside the table but outside any cell as blank. The kit's
mods-scroll sampling runs 50 ms or more after scrolling stops, so it can't see rows that are blank
_during_ a scrollbar drag. That needs a per-frame probe.

### Three ways a snapshot can silently go blank

Each deleted part or all of the UI from `ui_snapshot` rather than failing:

1. **`display: contents` wrappers** have no box, so `getClientRects()` is empty while children
   render; pruning on it removed the game grid. Zero rects only disqualify _clicking_.
2. **`getComputedStyle().opacity` can be `""`**, and `Number("") === 0`. Only a value that parses
   to 0 is transparent.
3. **`aria-hidden` on the app root.** react-bootstrap sets it on `#content` and `#overlays` while
   a modal is open. It is reported per node as `ariaHidden`, never treated as unrendered.

Also: a hover-revealed button's computed opacity can be `1` while its parent strip is still fading
in. Wait for the parent's transition before a scoped snapshot.

### Modals and footers fall past the snapshot's node limit

`ui_snapshot` stops at its node limit and modals render at the end of the DOM. On a big Mods page
`waitForNode({ name: "Install Now" })` timed out with the dialog open, and a large External
Changes dialog lost its footer buttons. Find dialogs with `ui_active_dialogs` and click inside
them with `clickInsideDialog` (scoped snapshots).

### Synthetic hover cannot trigger CSS `:hover`

`mouseover`/`mouseenter` run React handlers but not `:hover`, so hover-revealed controls stay at
`opacity: 0` and the snapshot correctly calls them hidden. Click anyway (`ui_click` with
`requireActionable: false`), or use `realHover()`, a real mouse over CDP. Likewise
`HTMLElement.click()` sends only `click`, while dropdown toggles and row selection listen on
`mousedown` (`ui_click` sends the full sequence), and after `el.value = …` React swallows the
`input` event (`ui_fill` calls the prototype's native setter first).

### Title bar drag regions: happy-dom can't see them, Windows can

A Vortex unit test that asserts `-webkit-app-region` reads `null`: happy-dom drops the property
from `style`. Check drag regions in the app instead, without moving the operator's cursor: send
`WM_NCHITTEST` (and `WM_NCLBUTTONDBLCLK` for double-click to maximize) to Vortex's window from
PowerShell. On a scaled display call `SetThreadDpiAwarenessContext(-4)` first; otherwise the
coordinates come out halved and the right half of the bar reads as the resize border (code 11).

### Layout at its limits: preview-only UI, account states, zoom, measurements

- The STAGING pill renders only in preview builds. Set `process.env.IS_VORTEX_PREVIEW = "true"` in
  the renderer and re-render the header (toggling the menu collapse button twice does it); delete
  the variable afterwards.
- Zoom with `vortex_dispatch` `setZoomFactor` plus `webFrame.setZoomFactor`, and restore 1 after.
- `innerWidth` is an integer while layout is fractional, so an edge check against it can report a
  control as clipped by under a pixel. Use `document.documentElement.getBoundingClientRect().width`.
- `document.body.focus()` doesn't reset where Tab starts in Chromium. Focus the first control, then
  press Tab.
- A reload straight after `SET_USE_MODERN_LAYOUT false` can come back in the modern layout while
  the state already reads false. Reload again after a few seconds, and check which layout rendered.

### A button's accessible name is not its text

Snapshots report accessible names, and `aria-label`/`title` often differ from the text: External
Changes' Confirm is named "Confirm changes", its Cancel "Cancel deployment". A policy written from
devtools text matches nothing, the modal stays open and it reads as a hang. Match snapshot names,
prefer a prefix (`/^confirm/`); icon buttons have no text at all.

### Stacked modals: `:nth-of-type()` cannot select between them

Each modal mounts under its own parent, so `div:nth-of-type(n)` matches both and `querySelector`
returns the first. An unanswered purge prompt behind a collection report read as a hung install.
Pass `index` with `selector` to `ui_snapshot` for the nth match; `[role="dialog"]` can match
several elements of one dialog, so confirm by its text, as `clickInsideDialog` does.

### A dialog's text is not its snapshot tree's text

The tree names inputs by placeholder, so a dialog's `textContent` need not appear in it, and
matching on it made `clickInsideDialog` click nothing quietly. Compare a scoped snapshot's
`rootText`, built like the `activeDialogs` entry. `clickInsideDialog` throws when it clicks nothing
or the wrong element; pollers pass `{ required: false }`.

### A dialog's text runs its buttons together and stops at 400 characters

`activeDialogs` and `ui_active_dialogs` give `textContent` cut at 400 characters. Button labels
run together ("…LaterInstall Now", so `/\binstall now\b/` fails), and come last, so a long
description drops them. Match a dialog by its heading ("<game> collection added", "Collection
installation complete") and read buttons with `dialogButtons` or a scoped snapshot. Buttons can
also be disabled while a review postprocesses, and `clickInsideDialog` finds only enabled ones, so
one failed click proves nothing.

### The modern layout keeps notifications in a popover, with zero-width spaces

There are no `.notification` toasts; actions such as a collection's "Resume" exist only in the
popover the title bar's Notifications button opens, as flat siblings under `.nxm-popover-panel`
with no stable class. Names contain zero-width spaces ("Kit\u200bVerify"); strip them before
comparing. `resumeViaNotification` handles both layouts.

### Virtualised rows are not in the DOM

Mod, plugin and game rows do not exist until filtered or scrolled to (except the modern Mods page
without the sticky-header fix, below). Filter with the search box rather than scrolling; a scroll
needs a real `scroll` event, not just `scrollTop`, or new rows never mount.

### The modern Mods page renders every row, and that is the large-list slowdown

The modern Mods page passes `stickyHeader` to SuperTable, setting `.table-main-pane
{ overflow: visible }` so the page scrolls, but each row's `VisibilityProxy` still roots its
IntersectionObserver at that pane. A non-clipping root sees every row as visible, so all render.
Nothing errors: deploys, filter clears and collection installs just slow with mod count. The page
stays mounted while hidden, so every page is slow, Settings and Plugins included. The classic
layout is unaffected; use it as the in-build control (`ai:test:large-library`). The fix roots the
observer at the element that scrolls (`scrollContainerOf`). `ai:test:mods-scroll` reports rows
rendered against rows on screen. Time only `--production` builds.

### A sticky-header table's scroll-to did nothing

Same root: `scrollToItem` set the non-scrolling pane's `scrollTop` from the row's `offsetTop`,
which does nothing and throws nothing. Every `mods-scroll-to` (Plugins' Mod column link,
health-check "show mod", a collection's mod link) opened Mods at the top, and Page Up/Down sized
jumps from the pane's height. It looks like the 200 ms `show-main-page` timeout losing a race; it
isn't. The fix scrolls `mScrollContainer` (or `document.scrollingElement`) and measures with
`getBoundingClientRect`. `pnpm run ai:test:plugins-mod-link` reproduces it, but passes on a broken
build in the classic layout, which survives `up`'s reset: check its reported `layout`.

### A row stays rendered forever once it has been on screen

`VisibilityProxy` ignores "not visible" within 1 s of becoming visible
(`now - this.mVisibleTime > 1000`), and IntersectionObserver reports only changes, so a row
scrolled past quickly stays rendered. Scrolling undoes virtualisation bit by bit, in both layouts
and with the sticky-header fix. `ai:test:mods-scroll` warns, and fails with
`--max-accumulated <n>`.

### Measuring a slow Vortex without measuring the harness

- Polling a full `ui_snapshot` measures every element, and `getBoundingClientRect` tops the
  profile. Poll with `ui_active_dialogs`.
- "fetch failed: ECONNRESET" means the renderer froze: the MCP server lives there, and a late
  keep-alive timeout closed a reused socket. Idle sockets now live 10 minutes and pollers retry.
- Development React inflates rendering timings; see "`--production` needs a production bundle".
- Registered dialogs are always mounted: `DialogContainer` renders every `registerDialog` dialog
  all session and `show` only hides the Modal, so their hooks run on store changes while
  invisible (a `useMemo` over `persistent.mods` in `InstallFinishedDialog` slowed collection
  installs). Check hidden dialogs, and gate expensive state on the dialog's show condition.
- Open leads: disabling one mod changes every row's `loadOrder`, so every Mods row re-renders
  (`measureRowIdentity`); download progress and speed each dispatch once a second into the
  persisted `persistent.downloads`.

### A hidden Electron window does not paint like a visible one

Vortex's E2E suite defaults to `VORTEX_E2E_HEADLESS=1` and `--disable-gpu`, so a headed pass is not
a CI pass: a hidden window gives few animation frames, and Headless UI exit transitions can outlive
their timers. `setBackgroundThrottling(false)` doesn't help. Reproduce with `CI=1` and
`VORTEX_E2E_HEADED` unset. Animation tests show their window without focus
(`await (await vortexApp.browserWindow(vortexWindow)).evaluate(w => w.showInactive())`) and keep
their frame, geometry and timer assertions. On fork PRs, CI's encrypted report step exits 255
without secrets, and a green `continue-on-error` step doesn't mean its tests passed: read the
Playwright summary (`pr-checks` flags this as a post-processing failure).

### Zoom: check frames and real bounds, not settled screenshots

Settled bounds can pass while chrome jumps mid-zoom: Electron's native zoom can replay an older
factor after React compensated for a newer one. Modern zoom uses CSS scaling and a shared CSS
variable, and `ai:test:zoom` samples every frame of rapid scaling. At non-default zoom Playwright's
viewport screenshot crops right and bottom, so title-bar buttons look off-screen; the harness uses
CDP `Page.captureScreenshot` without a clip. Check rendered bounds too.

### Split panes and panel content

- Content mounts through stable portals to keep page state. The split view doesn't track panel
  focus; don't add pointer or focus listeners to the frame to change the sidebar page.
- A hidden panel makes legacy SuperTable measure zero-width proxy columns, and its header debounce
  flashes collapsed columns on return. Keep the last valid widths; observe the proxy row's size.
- React can batch a split's collapsed and expanded states into one paint: `transitionDuration`
  says 150ms but the pane jumps. Hold the collapsed state one painted frame, and assert
  intermediate widths. Sidebar width checks likewise wait for the final width.
- The 20–80% ratio alone doesn't keep the two-pane minimum. Clamp drag and keyboard ratios to the
  measured width and refit a saved ratio when the window narrows.
- A minimum-width pane can be narrower than a sticky toolbar (gamebryo Plugins hid its counters);
  `.mainpage-header` in split panes scrolls. Test by scrolling it to the end.

### A mod exists in state before it is installed

A mod appears when its install _starts_, at `state: "installing"`, disabled and named after its
archive, until the installer (or a FOMOD wizard) finishes. Counting mods then reports 8/8 while
members still install, and deploy links a half-installed set. Wait for `state === "installed"`
**and** nothing `installing`; "nothing installing" is briefly true between members. Refuse to
write to the game directory while mods install.

### FOMOD steps do not have a predictably-named forward button

The forward button is named after the step (`Next`, `Install`, `Finish`, `Readme and information`,
…), so label matching stalls silently on an unknown one. Take the last button of
`#fomod-installer-dialog .fomod-nav-buttons` (Back, progress bar, forward; Cancel is
`#fomod-cancel`), as `advanceFomod()` does. Scope to the nav bar: the last button of "Purge files
from different instance?" is _Purge_, and a page-wide `Close` is the window control. Don't filter
out disabled buttons first, or you walk Back forever; if the last is disabled, re-poll.

### Compare a large-library deploy against the classic layout, not another page

The modern Mods page stays mounted while hidden, so a deploy started from Settings pays the same
rendering cost as one from the Mods page. A Mods-against-Settings ratio stays near 1 on a broken
build and a fixed one alike. The classic layout's table always virtualised, so it is the in-build
baseline (`ai:test:large-library` compares against it).

### Bundled optional collection members can stall the install

Installing an offline collection's optional members, bundled in the archive, has stalled until
Vortex's stall watchdog fired (5 minutes). The cause isn't known. `installOfflineCollection`
skips optional members by default; `optionals: "stand-in"` exercises the review around an
optionals pass without installing them. A test that needs real optional installs should expect
the stall and say so.

### A skip meant for an optional member can land on a required one

At install start `InstallDriver.start` marks each optional member with no ignore choice as
skipped through `markCollectionMemberSkipped` (`util/collectionSkip.ts`). It accepted the first
member whose tag, file hash **or** logical file name matched, so a required member listed earlier
that shares a logical file name ("Main File" is common) or an archive hash got a durable
`rule.ignored = true`, with nothing logged. An ignored member counts as resolved: the review says
complete, and every later resume skips it. Tag-first matching (doodlum/Vortex#17) isn't enough on
its own: nexus members with a fuzzy policy (`prefer`/`latest`) get a `deterministicReferenceTag`
of just mod page plus install spec, so two files from one page share a tag.

Before blaming this for a user's "ignored" members, check their collection's real member list.
It's public: `collectionRevision(slug, revision) { modFiles { optional fileId updatePolicy file {
name modId } } }` on `https://api.nexusmods.com/v2/graphql`, no auth; the slug and revision are
in vortex.log. In the report that led here no optional shared a name or file with a required
member, and the `ignored` count matched declined optionals. A transient download failure alone
leaves a member failed, and a resume installs it (`ai:test:collection-download-retry`).

### After a completed collection, Vortex stops running its checks

`InstallDriver.startInstall` suppresses `plugins-changed`, `mod-installed`, `mod-activated` and
`settings-changed` checks during a collection install, and only cancel or pause released them, not
the review's Done/Close. Missing Masters and the rest never run again until restart, with nothing
logged. `ai:test:bethesda` reproduces it; `check_probe_counts` shows `plugins-changed` stop rising.

### A Bethesda collection without a plugin list skips the end of its postprocessing

The gamebryo parser reads `collection.plugins.find(…)` for each installed plugin
(`util/gameSupport/gamebryo.tsx`). A hand-made collection.json without the list throws, the error
is swallowed, and plugin enabling and `collection-postprocess-complete` are skipped while the
install looks complete. `offlineCollection.ts` writes the list; `installOfflineCollection` reports
`postprocessed` from the event.

### A collection installed from a file has no revision

`start-install <archive>` uses `archiveId: null`, and the driver reads revision, slug and
`revisionInfo` (with `gameVersions`) from the download, so the game-version prompt silently never
happens. Register a download first (`addLocalDownload`, then `start-install-download`), as
`addOfflineCollection` does; `nexus.revisionInfo.modFiles` on it replaces the Nexus lookup.

### The collection InstallDriver is not reachable from an extension

`registerAPI` exposes only `getActiveCollectionInstallSession`, not the driver's `step`, so state
can't tell "waiting at Install Now" from "about to begin". `collection_install_state` reads the
`driver` prop of Vortex's always-mounted collection dialogs from React's fiber tree, a private
shape; it says `found: false` when a build stops passing it.

### On Windows, "make a folder unreadable" doesn't make stat fail

`fs.stat` on a directory still succeeds with a deny-all ACL, or while another process holds it
open exclusively, so neither reproduces a stat failure. And Vortex's `fs.statAsync`
(`util/fs.ts`, `genFSWrapperAsync`/`errorRepeat`) silently retries `EPERM`, `EBUSY`, `EIO`,
`EMFILE` and `UNKNOWN`, then shows a blocking File busy, permission or I/O dialog: such an error
reaches a caller's `.catch` only after the user cancels. Inject the error in a unit test instead.

## Deployment

### The setModEnabled action doesn't make a deployment needed

Dispatching `setModEnabled` through `vortex_dispatch` changes the profile, but nothing marks
the game as needing a deploy, so a Deploy button or reminder never appears. The
`set_mods_enabled` tool goes through Vortex's own path, which does. Use the tool.

### A cleared primary tool is `null`, not absent

Clearing a primary tool writes `null`, which an `!== undefined` check launches as a tool named
"null"; treat `null` and `""` as unset. A restored snapshot's tool path may be gone, or its binary
stale, spawning and exiting having started nothing. `runExecutable` resolving means only that a
process started, and a working loader exits too. Watch for the **game's** process and fall back to
launching it directly, as `launchGame` does (`processWaitMs` for tests).

### Deploy prompts whose default destroys files

"Purge files from different instance?": answer Cancel unattended. A real install has tens of
thousands of deployed files, and Vortex calls that purge direction less reliable. Use a disposable
game directory. In External Changes, "Source files were deleted" → Save removes deployed copies whose source is gone; the harness
confirms it. "Links were deleted" → every row defaults to **Save change (delete file)**, which
deletes the mods' _staging_ files; the harness refuses and reports it. Answer with **Revert all
changes**. Never delete files a purge left while `vortex.deployment.json` lists them (unlisted
copies are safe). A deploy timing needs the prior purge to have removed the files, and install
auto-deploy races a purge, so timing checks turn auto-deploy off.

## Shutdown

### Kill the process and you can corrupt the profile

Vortex flushes state only on a proper window close; a hard kill can half-write the state database,
which shows up much later as a stale or corrupt profile. `vortex_quit` and `pnpm run ai -- down`
close the window. Stop cleanly before copying a profile. Even then Windows releases the database's
handles just after exit, so an immediate `rmSync` hits EPERM: retry with backoff. Directory renames
can hit EPERM from indexers however often you retry, so build in place and write a marker last.

## Leases

### Slots and worktrees: what is still shared

The instance lease is per cache (`instance:<cache dir>`, bare `instance` for the default), and
`--slot <n|auto>` gives each owner its own cache, artifacts and ports. Still shared:

- **The checkout.** A `--dev-dir` or `--worktree` launch also takes (or joins) `checkout:<dir>`
  and holds it until that Vortex exits, even if you release it. Checks driving a running instance
  take the checkout it was launched from (`<cache>/instance.json`), not their own flags'. Two slots
  from one checkout conflict, so give each agent a worktree (`worktree add <name>`).
- **The kit's files.** Parallel edits overwrite each other, so the kit is changed only under the
  kit lock (`kit lock` … `kit push`).
- **OAuth copies diverge between slots.** A new slot copies slot 0's login once, then refreshes its
  own. If Nexus rotates refresh tokens, a stale slot needs `login-import --slot <n> --force`.
- **CPU.** Timings taken while another slot builds or runs Vortex measure the other agent.

## Tooling on Windows

### Account-free lifecycle tests must prevent automatic login import

`bootstrap` seeds a new cache from slot 0's OAuth cache. After the operator logs in, a fresh
test profile can unexpectedly be signed in. Core fixtures write a `null` OAuth tombstone in
their disposable cache before bootstrapping; this prevents import without touching the login.

### Fractional display scaling rounds window sizes

At 125% scaling, a requested 1280-DIP window can report 1281. Real-app resize assertions allow
two DIPs of rounding on both axes and always restore the original size, even after failure.
Read the DOM dimensions independently; a tool's requested size is not proof it resized.

### Concurrent Electron resolution can overwrite a running binary

Electron 44's module downloads a missing executable during `require("electron")`. Two setup
commands can both download and one then fails replacing a DLL the other's app has loaded.
`electronRuntime.ts` serializes resolution with a process lease beside the Electron package,
including when different slots resolve the same binary, and releases it after failures.

### No `pnpm`, or only Node 20, on the agent's PATH

A fresh shell can have Node 20 and no `pnpm`; `corepack pnpm` fails signature verification, and
pnpm 11 (Vortex's) needs Node ≥ 22.13 (`node:sqlite`). Run the kit as
`npx -y pnpm@9.15.0 run ai -- …`. For Vortex, `npm install node@22 --prefix J:\tools\node22` on a
roomy drive, install `pnpm@11.10.0` globally into that prefix, prepend
`J:\tools\node22\node_modules\node\bin;J:\tools\node22` to `PATH`, and set `VORTEX_AI_PNPM` to
`J:\tools\node22\pnpm.cmd`. `source`, `worktree add` and `build` then skip `pnpm dlx`, which can
fail with ENOENT in `pnpm-cache\dlx` on a nearly full C:. A hand-run build must restore
`etc/vortex.api.md` and `etc/Dependency Report.md` itself; only the kit's `build` does.

### Windows on ARM: Vortex's native modules need x64 Node and a compiler

On an ARM64 machine, Vortex tests fail with `Cannot find module './build/Release/winapi'` and
`pnpm install` fails in `loot` or `font-scanner`. The native modules install with
`prebuild-install -a x64`, and `winapi-bindings`, `loot` and `bsatk` (pinned Nexus-Mods commits)
have no published prebuilds ("No prebuilt binaries found"), so node-gyp compiles them;
`font-scanner` always does. ARM64 Node can't load an x64 addon either way. Run Vortex x64 under
emulation: unzip nodejs.org's `win-x64` build of `devEngines`' exact version (pnpm then uses it
instead of downloading its own), put it first on `PATH` and run `corepack enable pnpm` in it
(`src/main`'s postinstall runs a bare `pnpm`). Then install the toolchain from Vortex's
`docs/install-instructions/windows.md`: VS 2022 Build Tools (C++ workload, v143 x64/x86, ATL,
MFC, Windows 11 SDK), Python with `setuptools`, CMake, .NET 9. ARM64 builds of Python, CMake
and .NET are fine. Electron then downloads as x64; `eval --expr "process.arch"` should say `x64`.

### With corepack, `lease run` from a checkout picks the checkout's pnpm

`pnpm --dir <kit> run ai -- lease run -- pnpm run verify`, started in a Vortex checkout, fails
with "This project is configured to use 9.15.0 of pnpm": corepack chooses pnpm by the directory
it starts in, so the kit runs under Vortex's pnpm 11. Started in the kit instead, the command runs
in the kit, since pnpm overwrites `INIT_CWD` (`callerCwd` in `leaseCommand.ts`). Run the kit's CLI
directly from the checkout: `node <kit>/node_modules/tsx/dist/cli.mjs <kit>/harness/src/cli.ts
lease run --owner <you> --checkout <dir> -- pnpm run verify`.

### Windows on ARM: "You installed esbuild for another platform" means the wrong Node

On an ARM64 machine set up as above, every `pnpm run ai` fails with that esbuild error, or with
`pnpm` not found: a new shell has the ARM64 Node first on `PATH`, while the kit's `node_modules`
was installed by the x64 one. Nothing needs reinstalling. Put the x64 Node directory first on
`PATH` for the session (`$env:PATH = "C:\dev\tools\node-v24.20.0-win-x64;$env:PATH"`, or
wherever it was unzipped); its `pnpm` shim comes with it.

### Under x64 emulation, `pnpm run verify` runs out of memory unless nx runs fewer tasks

On Windows on ARM, Vortex's `verify` fails with a dozen typecheck, build and lint tasks dying of
"JavaScript heap out of memory" (exit 134): nx's default parallelism runs more emulated Node
processes than memory allows. With `$env:NX_PARALLEL = "2"` the same tree passes. Under that
load, BG3's `divineCore end-to-end` can still time out (`DivineTimedOut`, an external .NET
process); run it alone from `extensions/games/game-baldursgate3` before calling it a regression.

### A zero-filled `.zip` download ends in an "Archive damaged" dialog

With **Settings → Download → Install automatically** on (the default), a finished download is
installed, and a file that isn't really an archive puts up "Archive damaged" (Cancel, Delete,
Continue), which Escape does not close. It hides the spine and fails later clicks with a locator
timeout. `start-download` takes `redownload` and `{ allowInstall: false }` after the callback;
`slow-download` and `download-churn` pass them. Clear one left over with
`clickInsideDialog(mcp, "Archive damaged", "Cancel")`.

### Under x64 emulation, a cold `up` can fail twice before it works

On Windows on ARM, the first `up` of a new cache can fail with "Vortex did not exit cleanly"
though Vortex's log says "clean application end": the bootstrap's quit takes longer than
`stopInstance` waits. The retry can then fail with "Port … is occupied", held only by `TIME_WAIT`
sockets from that quit. A third `up` works; other times the first one does. Retry rather than
clearing leases or killing processes.

### PowerShell's UTF-8 writes start with a BOM

PowerShell 5.1's `Set-Content`/`Out-File -Encoding utf8` write a byte-order mark: `git commit -F`
keeps it in the subject, and `JSON.parse` fails with "Unexpected token", so a `--compare` baseline
or `--args-file` looks corrupt. Write with `[IO.File]::WriteAllText($path, $text)`. The kit reads
JSON through `readJsonFile` (`harness/src/jsonFile.ts`), which strips it; new readers should too.

### Other shell traps

- Silent `oxlint` looks the same as no `oxlint`: `pnpm exec oxlint <files>` prints nothing when
  clean. In a Vortex checkout `pnpm nx run @vortex/renderer:lint` prints a result; use that.
- A here-string piped into `git commit -F -` fails with "did not match any file(s)". Use a file.
- `git show <sha>:<path> | Set-Content` re-encodes the file (Vitest may report "no tests"). Use
  `git restore --source=<sha> --worktree -- <path>`.
- `@(@("a", "b"))` flattens to `@("a", "b")`, so a one-pair find/replace list corrupts files.
  Write `@(,@("a", "b"))` or use Python, and lint after bulk edits.
- `pnpm exec oxfmt $files` fails with "Expected at least one target file"; splat with `@files`.
- The agent sandbox refuses `Remove-Item Env:NODE_ENV`; use `$env:NODE_ENV=$null`, or better
  let `pnpm run ai -- build --production` set it for the build only.
- Windows PowerShell 5.1's `Get-Content -Raw` reads a UTF-8 file as ANSI, so a read-modify-write
  of a PR body turns 🤖, "→" and "–" into `Ã°Å¸`-style mojibake, and GitHub keeps it. Edit bodies
  with Node (`fs.readFileSync(f, "utf8")`) or `-Encoding UTF8`, then grep the result for `Ã`.
  `Set-Content -Encoding utf8` also adds a BOM, which breaks `package.json` for pnpm.
- If a sandbox deletion guard refuses a command, verify the resolved absolute target stays
  within the authorized directory, then use a narrowly scoped native command (`Remove-Item
-LiteralPath` for filesystem deletion). If the authorized action still needs host access,
  request approved escalation; changing shells does not resolve the permission boundary.
- `[IO.File]::ReadAllText` and other .NET calls resolve relative paths against the process's
  directory, not PowerShell's location: pass absolute paths.
- The kit's ffmpeg (Playwright's build) can't decode PNG or WebP, so it can't assemble contact
  sheets; System.Drawing in PowerShell can.
- PowerShell 5.1's `ConvertFrom-Json` on `gh … --json` output can fold an array into one object.
  Filter with `gh`'s own `--jq` instead.
- Node one-liners through `bash -c`/heredocs lose backslashes: `"\r?\n"` in a regex, or
  `J:\tools\...`, come out as raw control characters. Put anything with escapes in a script file.
- `pnpm run ai:test:zoom | tail -15` can hang after the test exits: a process it started keeps
  the pipe open, and `tail` prints only at end of input, so the result is lost. Redirect to a
  file (`> log 2>&1`) and read it.
- A `doodlebot script` that ends with `await handle.close()` on an `attachToRenderer` handle can
  stay alive after writing its results. End it with `setTimeout(() => process.exit(0), 3000)`
  before `void handle.close()`.
- `gh pr edit --body-file body.md --attach ./clip.webm` (and `gh pr create` with the same flags)
  rewrote `![alt](./shot.png)` in place, but left a bare `./clip.webm` line as it was and appended
  the video's URL after the doodlebot footer, in `--attach` order. Move each URL onto its line and
  edit the body again, so the footer stays last.
- `doodlebot script` passes flags it doesn't use itself, such as `--sandbox`, on to the script,
  which may take them for its own arguments (a label of `--sandbox`). Give the script its
  arguments first, or read them by name.
- On Windows `python3` can be the Microsoft Store alias while `python` is the installed one.

### tsx: a scratch script can't import the kit by path, and `page.evaluate` loses `__name`

tsx treats a `.ts` file without an ESM `package.json` above it as CommonJS, so top-level `await`
fails: name it `.mts`. A Windows path in an import (`C:\dev\…`) parses as scheme `c:`; use
`file:///C:/dev/…`. Bare names such as `fflate` don't resolve from outside the repo.
`pnpm run ai -- script <file.mts>` runs it with the kit's tsx and puts `harness/src/kit.ts`'s URL
in `VORTEX_AI_KIT`. And tsx hard-codes esbuild's `keepNames`, so a named inner function becomes
`__name(fn, "name")` and `page.evaluate(fn)` throws "`__name` is not defined"; `attachToRenderer`
defines it in the page (`NAME_SHIM`, `cdp.ts`), and kit modules send source text.

### `gh pr edit` fails on old gh with a Projects (classic) error

gh 2.31 queries the removed `projectCards`, so `gh pr edit` fails with "Projects (classic) is
being deprecated". Use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F "body=@<file>"`, or the
kit's portable gh (`harness/.artifacts/gh-portable/bin/gh.exe`). Its `gh pr edit --attach` uploads
`.webm` as inline video; pass the bare path (no `#alt text`) from the files' directory. Check the
body afterwards: a bare `./file.webm` line may be left as it was, with the URL appended at the end
("Other shell traps").
