# Add a regression test

This page shows where the tests that prove a Vortex change go, and how doodlebot proves that a
test fails without the change. The rule: **a test that proves a Vortex change belongs in that
change's Vortex pull request**, so it travels with the code and runs in Vortex's own CI.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md) and [get the Vortex source](source-development.md).
- Know the behavior the test should hold: what the user does and what must be true afterward.

## Write the test with the fix

`/doodlebot:fix` writes the regression test as part of the fix, and feature work does the same
after an approved design. Both follow one procedure (the plugin's `resources/testing.md`):

1. **Pick the layer.**

   | What the test needs                                                     | Where it goes                                                 |
   | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
   | A function, reducer, selector or component without the whole app        | A Vortex unit test next to the code, run with Vortex's vitest |
   | The real app: windows, dialogs, installs, deploys                       | A spec in Vortex's own e2e suite (`packages/e2e`)             |
   | Behaviour Vortex's e2e suite cannot reach (collections, scale, plugins) | A QA catalogue entry, proposed to you                         |

2. **Write it to fail without the change**: it asserts the behavior you reported or the design's
   criterion, with deterministic preconditions.
3. **Prove it (the revert control).** With your permission for a local commit on the work
   branch, the agent runs
   `doodlebot pr-preflight --checkout <checkout> --base upstream/master --test <test> --revert <file>`:
   the branch passes, and the run with the fix reverted fails on the intended assertion.
4. **Run it the way Vortex runs it**, then Vortex's own gate.
5. **Show it on a real Vortex**: the agent repeats your scenario on the fixed build with
   `/doodlebot:try`'s procedure.

## Make the test useful

- A test for a bug fix fails on the unchanged build and passes on the fix. The agent checks
  both.
- The test waits for a real state or visible result, not a fixed delay.
- A test that changes shared state restores it, so the next test starts from a valid state.

## Kinds of check

| Kind            | Command                                                     | Agent during the run   | Result               |
| --------------- | ----------------------------------------------------------- | ---------------------- | -------------------- |
| Regression test | Written by `/doodlebot:fix`, in the Vortex pull request     | None                   | Vortex's test report |
| Driven run      | `/doodlebot:try`, `/doodlebot:investigate`, `/doodlebot:qa` | `vortex-driver`        | Run or QA report     |
| Benchmark       | `/doodlebot:measure`                                        | Orchestrates only      | Benchmark report     |
| Design review   | EGM's `/egm:egm-review-loop` with doodlebot's reviewer      | EGM and the Goldfishes | Approved design      |

A regression test runs without an agent once it is written, so it is the cheapest way to keep a
behavior from breaking again.

## doodlebot's own tests

doodlebot's core suite (`doodlebot test core`) checks doodlebot against a real Vortex. Its specs
live in `<workspace>/harness/src/tests/` and are doodlebot work, not part of a Vortex pull
request. A spec added there leaves the workspace with a local change, so
`/doodlebot:setup --update` refuses until you commit it to a doodlebot branch or remove it. The
suite starts its own Vortex and refuses while another runs.

To run a suite or check on an official release, add `--release <version>`, for example
`doodlebot test core --release 2.8.0`. The release must be registered first with
`doodlebot release get <version>`; `/doodlebot:qa --release <version>` does both.

## What's next

- [Open a pull request](pull-requests.md) for the Vortex change, with its own Vortex test.
- [Try things in Vortex](try-vortex.md) for behavior that is hard to assert.
