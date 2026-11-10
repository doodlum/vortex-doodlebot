# Writing the tests that prove a change

`/doodlebot:fix` and feature work (an approved EGM design, implemented on a Vortex branch) use
this procedure. The rule: **tests that prove a Vortex change belong in that change's Vortex pull
request**, so they travel with the code and run in Vortex's own CI. Doodlebot's checks and
driven runs show the change working on a real Vortex; they do not replace a test in the PR.

## 1. Pick the layer

| What the test needs                                                     | Where it goes                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| A function, reducer, selector or component without the whole app        | A Vortex unit test next to the code, run with Vortex's vitest |
| The real app: windows, dialogs, installs, deploys                       | A spec in Vortex's own e2e suite (its `packages/e2e` folder)  |
| Behaviour Vortex's e2e suite cannot reach (collections, scale, plugins) | A QA catalogue entry, proposed to the owner (below)           |
| doodlebot's own extension or harness (doodlebot work, not Vortex work)  | doodlebot's tests, through a doodlebot change                 |

Before writing, read the Vortex checkout's `AGENTS.md`, `CLAUDE.md` when present,
`CONTRIBUTING.md`, its docs index and its testing guidance, and look at a neighbouring test of
the same kind: follow its helpers and naming.

## 2. Write it to fail without the change

- Assert the behaviour the person reported or the design's criterion states, not an
  implementation detail.
- Make preconditions deterministic: build the state in the test (a disabled fixture for a
  disabled-click test; a disposable game folder for anything that deploys).
- One behaviour per test, named after it.

## 3. Prove it fails without the change (the revert control)

A regression test that passes on the base proves nothing.

- Commit the fix and its test on the work branch first, with the person's permission for a
  local commit (never a push): the control reads the committed `HEAD`.
- Stop the test Vortex if it runs from that checkout (`doodlebot down`).
- Run the control:

  ```powershell
  doodlebot pr-preflight --checkout <checkout> --base upstream/master --test <test path> --revert <changed file>
  ```

  `--revert-hunk <file>:<line>` reverts only one hunk (a call site in a file that also defines
  the new code). The branch must pass and the reverted run must fail. A reverted failure is
  INCONCLUSIVE until you read the failing assertion and confirm it is the intended one, not a
  compile error.

- Without permission to commit, report the control as not run.

## 4. Run it the way Vortex runs it

- Unit tests: from the test's project folder in the checkout, for example
  `pnpm exec vitest run <test path>`.
- E2E specs: with Vortex's own scripts in the checkout, after `doodlebot down`.
- Then the Vortex gate the contribution guide names (for example `pnpm run verify`). Keep every
  failure, and say whether it is a regression, a known base failure or an external blocker;
  never call a blocked gate passed.

## 5. Show it on a real Vortex too

Repeat the person's own scenario on the fixed build with `/doodlebot:try`'s report procedure
(`--dev-dir <checkout>`), observing the result independently of the tool that acted.

**UI changes: sizes and states.** Resize both dimensions: a list that works at a narrow width
can still hide its footer in a short window. Run the same width at different heights and the
same height at different widths, and record the real window and renderer sizes, since the OS
may clamp a request. `doodlebot responsive --screenshots --viewports "1024x720,1280x720,1280x1000,1920x1080"`
sweeps sizes; run it in each state that applies, with its own `--label`:

| State                             | What to verify                                               |
| --------------------------------- | ------------------------------------------------------------ |
| Empty list / first run            | Setup guidance and primary action remain visible             |
| Populated or virtualized list     | Filtering, scrolling, selection, row actions                 |
| Thousands of mods                 | `doodlebot test large-library`, `doodlebot test mods-scroll` |
| Long names or localized text      | Wrapping, truncation, accessible names                       |
| Selection / expanded details      | Actions stay reachable; focus remains useful                 |
| Modal / stacked modal / installer | Dialog scope, scrollable body, footer actions                |
| Loading / disabled / failure      | Progress, retry, cancellation, useful errors                 |
| Signed out / signed in            | The right setup affordances, without logging out             |

Set up states through documented actions and events (`vortex_dispatch`) and check the
resulting state; never edit Vortex's database or depend on the person's own mods. Layout scan
findings are candidates, not proof: confirm each visually.

**A supplied visual design** is an input to the EGM design, not a replacement for it. Turn it
into explicit acceptance criteria (hierarchy, spacing, typography, control behavior, empty and
error states, keyboard access, overflow, resizing), build on Vortex's components and its
`docs/frontend.md` and design-system guidance, and compare screenshots at the design's
reference size and its neighbours by eye: structural checks cannot judge typography, icons,
color or fidelity.

## Rules

- **Never assert on a doodlebot `ref` across snapshots.** They are generation-scoped.
- **Assert a direction, not an exact number,** for anything the OS clamps (window sizes).
- **Do not silently skip a criterion.** Report an unavoidable external blocker separately.
- **Wheel and focus:** a native wheel needs real input (`realWheel()` in the harness);
  `:focus-visible` needs real pointer and keyboard input.

## A test Vortex's e2e suite cannot hold

When the behaviour needs content or scale Vortex's own suite lacks (a collection, thousands of
mods, the Plugins page), propose a QA catalogue entry in the report's Learned section: `area`,
`guards` (globs relative to the Vortex root), `why`, `run` (a check from `doodlebot test --list`,
or a scenario for the driver), `pass` (or `"measured"`), `needs`, `cost`, `account`, `network`.
`doodlebot qa list --touching <files>` shows what the catalogue already guards. An entry is
added only when the owner agrees.

## doodlebot's own tests

For doodlebot work (U10), pure DOM logic goes in `<workspace>/src/uiAutomation.test.ts` under
jsdom, and anything that needs the real app in a spec under `<workspace>/harness/src/tests/`,
run with `doodlebot test core` after `doodlebot down`. Such a test makes the workspace dirty,
so `/doodlebot:setup --update` refuses until it is committed to a doodlebot branch or removed.
