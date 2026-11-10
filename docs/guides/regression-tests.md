# Add a regression test

This page shows how to have the agent write a Playwright test for a Vortex behavior and run it
against a real Vortex, with `/doodlebot:ui-test`.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md).
- Know the behavior the test should hold: what the user does and what must be true afterward.
- Stop any running test Vortex with `/doodlebot:stop`, and close your own Vortex. The test suite
  starts its own Vortex and refuses while another Vortex runs.

## Write and run the test

1. Run:

   ```text
   /doodlebot:ui-test <the behavior to test>
   ```

   For example: `/doodlebot:ui-test the Mods page search filters the list to matching mods`.

2. The agent writes a spec in `<workspace>/harness/src/tests/`. The suite's fixtures give each
   test an isolated Vortex with a disposable sandbox game and no account:

   | Fixture        | What it is                                       |
   | -------------- | ------------------------------------------------ |
   | `mcp`          | The client for doodlebot's Vortex tools          |
   | `vortexWindow` | Playwright's page for the rendered Vortex window |
   | `managedGame`  | The active game's ID and its test path           |
   | `config`       | Paths and connection settings for the run        |

   The test performs the action through the tools or the window, and checks its consequence in
   the window, Vortex's state or the deployed files. A deploy test reads a deployed file rather
   than only asking Vortex whether a mod is installed.

3. The agent runs the suite with `doodlebot test core`, adding the spec's file name to run only
   that file while it iterates. The suite always runs its lifecycle test first.

4. When the test passes, the agent runs the whole suite once more without a filter.

The expected result: a new spec file and a passing Playwright run. The suite writes an HTML
report to `<workspace>/harness/playwright-report` and keeps traces of failures.

## Make the test useful

- A test for a bug fix fails on the unchanged build and passes on the fix. The agent checks
  both.
- The test waits for a real state or visible result, not a fixed delay.
- A test that changes shared state restores it, so the next test starts from a valid state.
- Tests that need a Nexus account, a real game or network downloads stay out of the core suite.

## Four kinds of check

| Kind            | Command                                    | Agent during the run   | Result            |
| --------------- | ------------------------------------------ | ---------------------- | ----------------- |
| Regression test | `/doodlebot:ui-test`                       | None                   | Playwright report |
| Driven run      | `/doodlebot:drive`, `/doodlebot:qa`        | `vortex-driver`        | Run report        |
| Benchmark       | `/doodlebot:measure`, `/doodlebot:compare` | Orchestrates only      | Benchmark report  |
| Design review   | `/doodlebot:design`                        | EGM and the Goldfishes | Approved design   |

A regression test runs without an agent once it is written, so it is the cheapest way to keep a
behavior from breaking again.

## Where the test lives

The test is a file in your doodlebot workspace, not part of a Vortex pull request. It leaves the
workspace with a local change, so `/doodlebot:update` refuses until you commit the test to a
doodlebot branch or remove it.

To guard a fix in Vortex itself, ask for a Vortex unit test in the Vortex checkout (as
[Fix a Vortex bug](fix-a-bug.md) does) or a spec in Vortex's own `packages/e2e` suite. Those
travel with the Vortex change in its pull request.

## What's next

- [Open a pull request](pull-requests.md) for the Vortex change, with its own Vortex test.
- [Drive Vortex and get a report](drive-vortex.md) for behavior that is hard to assert.
