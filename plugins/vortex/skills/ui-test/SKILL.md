---
name: ui-test
description: "Vortex: Write or debug a Playwright regression test for Vortex's UI in the doodlebot workspace and run it with doodlebot test core; use to lock in a UI behavior or fix a failing spec."
argument-hint: "<UI behavior to test, or the failing spec>"
---

# Write a Vortex UI test

Specs live in `<workspace>/harness/src/tests/`. Each drives Vortex through the MCP `ui_*`
tools and asserts through Playwright, a separate oracle: asserting an MCP tool's effect
with the same tools would pass even if both were wrong together.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:update`, then continue.
3. `<shim>` is the absolute path of the `doodlebot` command: on Windows the first line
   ending in `.cmd` that `where.exe doodlebot` prints; elsewhere `command -v doodlebot`.
4. Read `<workspace>/harness/AGENT-WORKFLOW.md`, `<workspace>/harness/TESTING.md` and the
   test guidance `<workspace>/harness/KNOWLEDGE-ROUTES.md` names. Before changing Vortex,
   follow its own `AGENTS.md`, docs index, and frontend and testing guidance.

## Steps

1. **Pick the layer.** Pure DOM logic goes in `<workspace>/src/uiAutomation.test.ts` under
   jsdom (no layout engine: stub `getBoundingClientRect` and `getClientRects`, see its
   `installLayoutShim`). Anything that needs the real app goes in a spec under
   `<workspace>/harness/src/tests/`. Every visibility bug in `<workspace>/KNOWLEDGE.md` has a
   regression test in `uiAutomation.test.ts`: add to those rather than starting a new
   pattern.
2. **Write the spec** in the shape below, with deterministic preconditions (a disabled-click
   test supplies a disabled fixture; a game test uses the sandbox game).
3. **Stop the test Vortex.** The core suite launches its own Vortex and refuses while one
   runs ("... before the core suite."): run `doodlebot down` first.
4. **Run it** in the background with a log, as `${CLAUDE_PLUGIN_ROOT}/skills/drive/SKILL.md`
   describes under "Commands that block": `doodlebot test core` for the whole suite, or
   `doodlebot test core harness/src/tests/<spec>.spec.ts` for one spec while iterating
   (arguments after the suite pass to Playwright, relative to the workspace). Wait for the
   process to exit and read the log.
5. **Prove it can fail.** For a regression test, show it fails without the fix (on the base
   build, or by reverting the fix) before calling it a regression test.
6. **Run the whole suite** once more with `doodlebot test core`, and report its pass, fail
   and skip counts. Say which suite ran; a filtered run is not the core suite.

```ts
import { expect, test } from "./fixtures";
import { clickByName } from "../uiDriver";

test("a click through MCP changes what Playwright sees", async ({ mcp, vortexWindow }) => {
  await clickByName(mcp, { role: "button", name: "Settings" });
  await expect(vortexWindow.getByRole("heading", { name: /settings/i }).first()).toBeVisible();
});
```

## Fixtures

The core fixtures are worker-scoped: they share an app within a worker and restore state
between assertions. The fixture launches Vortex in a temporary cache on free ports, writes
the machine-wide instance record at launch and clears it after a confirmed exit.

| Fixture        | What it is                                                 |
| -------------- | ---------------------------------------------------------- |
| `config`       | Resolved `HarnessConfig`                                   |
| `mcp`          | MCP client; ready only after the extension registered      |
| `vortexWindow` | Playwright `Page` for the renderer, the independent oracle |
| `vortexApp`    | `ElectronApplication`                                      |
| `managedGame`  | The configured game, managed and active                    |

## Rules

- **Never assert on a `ref` across snapshots.** They are generation-scoped.
- **Prefer `findNodes` over hard-coded selectors.** Vortex's class names are mostly
  generated, and labels move between versions (`Manage` became `Add game`).
- **Do not silently skip acceptance criteria.** Report unavoidable external blockers
  separately.
- **Test width and height independently**, then the relevant loading, empty, populated,
  error, modal, filter and selection states. Layout scans are advisory; inspect screenshots
  and asserted behavior yourself.
- **A script that launches its own Vortex** calls `assertNoHarnessVortex("<action>")` from
  `<workspace>/harness/src/runningVortex.ts` before launching, writes the instance record
  right after spawn and clears it after a confirmed exit.
- **Assert a direction, not an exact number,** for anything the OS clamps (window sizes).
- **Point at a disposable game folder** before anything that deploys.
- **Wheel input:** use the harness's `realWheel()` over CDP (`control: true` for
  Ctrl+wheel); `ui_scroll` does not exercise native wheel or zoom.
- **Focus:** use real pointer and keyboard input to check `:focus-visible`; synthetic
  clicks cannot set the input modality.
- **Recording:** for an automated WebM, start `kit.recording.startRecording` and do the UI
  actions inside one `doodlebot script <file.mts>`, stopping the recording in `finally`.

## Opt-in checks

These run outside the core suite, through `doodlebot test <suite>` (run `doodlebot test --list`
for all of them):

- `doodlebot test zoom` needs a source build with zoom; `doodlebot test zoom --signed-out`
  starts its own anonymous profile, so `doodlebot down` first.
- `doodlebot test panels` checks the right-hand split view against a running Bethesda
  sandbox source build (`doodlebot up --dev-dir <checkout> --bethesda-sandbox`), with the
  same cache and ports as that `up`. The toggle is `[data-split-view-toggle]`
  (`aria-pressed`), the chooser `[data-panel-chooser="panel"]`; both panes stay at least
  440 px wide.

## Vortex's own E2E suite

Only when asked and when source mutation is authorized: run the failing spec with
`doodlebot vortex-e2e --checkout <checkout> --spec src/tests/<spec>.spec.ts`. It runs in
CI's hidden-window mode with the fixture's startup race patched for the run only, and
refuses while a test Vortex runs from that checkout. Keep the failing report, then rerun
the same command with `--compare <report>` after the change. For a PR's failing checks,
start with `doodlebot pr-checks <pr>`, which separates test failures from upload failures.

## Finish

Tell the person the spec's path, what it asserts, the proof it fails without the fix, and
the core suite's counts.
