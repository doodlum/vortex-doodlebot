---
name: vortex-ui-test
description: Write or debug a Playwright test for Vortex's UI in this repo, driving the app through the MCP ui_* tools and asserting via Playwright. Use when adding a regression test for a UI behaviour, testing responsive layout at multiple widths, or when an existing spec in harness/src/tests is failing.
---

# Writing a Vortex UI test

Specs live in `harness/src/tests/`. Run them with `pnpm run ai:test`. Read
`harness/AGENT-WORKFLOW.md` and use `harness/KNOWLEDGE-ROUTES.md` for the relevant
manual, test guidance and confirmed pitfalls. Before
changing Vortex, follow its own `AGENTS.md`, docs index, and relevant frontend,
testing and design-system documentation. Extend the harness when a requested
test needs a capability that is missing; verify the workflow after adding it.

## The shape of a test

When upstream E2E is requested and source mutation is authorized, run the failing spec with
`pnpm run ai -- vortex-e2e --owner <worker> --checkout <dir> --spec src/tests/<spec>.spec.ts`:
CI's hidden-window mode (`CI=1`, `VORTEX_E2E_HEADED` unset), under the E2E and checkout
operation guards, with the fixture's startup race patched for the run only. Stop any app
using that checkout first. If source is read-only, report this runner's mutation requirement
instead of temporarily patching it. Keep the failing report before
editing and rerun that same command afterward (`--compare <report>`). Our visible
harness app alone does not reproduce CI's painting behavior. See `KNOWLEDGE.md`
for the hidden-window animation issue and keep login/report-secret failures
separate from feature assertions. Use real pointer and keyboard input to check
`:focus-visible`; synthetic clicks cannot establish the browser's input modality.
Start with `pnpm run ai -- pr-checks <pr>`: it expands failed GitHub jobs and
separates test failures from report encryption/upload failures.

Drive through **MCP**, assert through **Playwright**. That separation is the
whole point: asserting an MCP tool's effect with the same MCP tools would pass
even if both sides were wrong together.

```ts
import { expect, test } from "./fixtures";
import { clickByName } from "../uiDriver";

test("a click through MCP changes what Playwright sees", async ({ mcp, vortexWindow }) => {
  await clickByName(mcp, { role: "button", name: "Settings" });
  await expect(vortexWindow.getByRole("heading", { name: /settings/i }).first()).toBeVisible();
});
```

## Fixtures

The kit's core fixtures are worker-scoped: they share an app within a worker and restore
state between assertions. Tests needing a pristine lifecycle use their own cache and ports.
This does not describe Vortex's separate upstream E2E fixture lifecycle.

| Fixture        | What it is                                                  |
| -------------- | ----------------------------------------------------------- |
| `config`       | Resolved `HarnessConfig`                                    |
| `mcp`          | MCP client; ready only after the extension registered       |
| `vortexWindow` | Playwright `Page` for the renderer — the independent oracle |
| `vortexApp`    | `ElectronApplication`                                       |
| `managedGame`  | The configured game, managed and active                     |

## Rules

- **Never assert on a `ref` across snapshots.** They are generation-scoped.
- **Prefer `findNodes` over hardcoded selectors.** Vortex's class names are
  largely generated; labels move between versions (`Manage` → `Add game`).
- **Create deterministic preconditions.** A disabled-click test supplies a
  disabled fixture; a game test uses the sandbox game. Do not silently skip
  acceptance criteria. Report unavoidable external blockers separately.
- **Test width and height independently**, then exercise relevant loading,
  empty, populated, error, modal, filter and selection states. Structural layout
  scans are advisory; independently inspect screenshots and asserted behavior.
- **Use distinct ports and cache roots** when a test starts another instance.
- **Assert a direction, not an exact number,** for anything the OS clamps. A
  window resize below the minimum is clamped, so assert "moved towards" rather
  than equality.
- **Point at a disposable game directory** before running anything that deploys —
  see [harness/AGENTS.md](../../../harness/AGENTS.md).
- For wheel shortcuts use harness `realWheel()` over CDP, with `control: true`
  for Ctrl+wheel. It releases Control in a finally block. `ui_scroll` does not
  exercise native wheel or browser zoom behavior. The opt-in `ai:test:zoom`
  script checks applied scaling and UI behavior, including every rendered frame
  during rapid zoom changes. Run it with `--signed-out` for an isolated anonymous
  profile. For an automated WebM demonstration, start `kit.recording.startRecording` and
  perform the UI actions inside one guarded `doodlebot script` invocation, then stop recording
  in `finally`. Standalone `record` holds the operation throughout and can capture human input;
  a second independent CLI command is correctly refused during it.

## Panel-system regression

Use `pnpm run ai:test:panels` against a running Bethesda sandbox to verify the
right-hand split view. Match `VORTEX_AI_OWNER` to the instance owner. The test
restores Home and per-sidebar game workspaces and the window size. The sidebar
page's modern header has the Dock right toggle (`[data-split-view-toggle]`): it
keeps one icon, changes `aria-pressed` and its highlight when open, and animates
both directions with the sidebar's width timing. The opened right-hand page has
no split toggle. Its parent toggle says **Close {page name}**. Legacy pages have
no temporary panel header.

Use `clickByName(mcp, query, { selector, index? })` for panel-local controls so
large tables in other panels cannot exhaust the snapshot node budget. The
headerless chooser uses sidebar-row choices and excludes pages already open.
On Home, compare choices with the Home sidebar; game-only pages must not appear.
Drag the divider to each edge, then reopen to verify the removed partner is
forgotten. Narrow the window until two 440px panes no longer fit; the partner
should animate away and the toggle should fade out, then fade in unpressed
when widened. Arrow keys change the ratio and double click restores 50/50. At
an intermediate window width, press Arrow repeatedly; both panes must remain
at least 440px wide until an explicit edge collapse. With Plugins in a narrow
pane, scroll its legacy sticky toolbar to confirm the trailing actions remain
reachable. Sample the opening frames:
a CSS transition duration alone does not prove a visible
animation. Sidebar navigation loads that page's own per-game workspace without
changing the layout attached to the previously selected sidebar page. Returning
to it restores its split and partner, including after a restart.

## Extension-level unit tests

Pure DOM logic belongs in `src/uiAutomation.test.ts` under jsdom, not in a
Playwright spec. jsdom has **no layout engine**, so stub geometry explicitly
(`getBoundingClientRect`, `getClientRects`) rather than pretending it lays
anything out — there is an `installLayoutShim` helper in that file.

Every visibility bug in [KNOWLEDGE.md](../../../KNOWLEDGE.md) has a regression
test there. Add to them rather than starting a new pattern.
