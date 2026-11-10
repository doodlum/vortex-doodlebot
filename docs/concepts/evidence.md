# Evidence and readiness

This page explains what evidence the agent keeps for a change, and what a readiness check proves
and does not prove.

## Before you begin

Read [How doodlebot works](how-it-works.md).

## What counts as evidence

A claim about a change is backed by something you or a reviewer can open:

| Evidence          | Written by                                      | Shows                                                                        |
| ----------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| Run report        | `/vortex:drive`, `/vortex:qa`                   | What a driven scenario did, which dialogs were answered, errors and warnings |
| Benchmark report  | `/benchmark:measure`, `/benchmark:compare`      | Timings per build, their spread and the verdict                              |
| Playwright report | `doodlebot test core`                           | Which regression tests passed                                                |
| Command receipt   | `doodlebot evidence run`                        | A command, its exit code and output, and the source before and after it      |
| Preflight report  | `doodlebot pr-preflight`                        | Callers, readers and the revert check for a Vortex branch                    |
| Screenshots       | `doodlebot screenshot`, copied into run reports | What the window showed                                                       |

Reports and evidence go under `<workspace>/harness/.artifacts`, which Git ignores. Every run
writes new files; existing evidence is never overwritten. A failed run's evidence is kept as
failed evidence.

Passing unit tests alone do not show that a Vortex flow works. A driven run, a regression test
or a benchmark against a real Vortex does.

## Identity

The agent records which source and which Vortex the evidence came from:

- `doodlebot evidence identity` records the checkout, its base and its changed files.
- `doodlebot evidence runtime` records the Vortex executable and build files by their hashes.

Evidence for one revision does not count for a later one. When the code changes, the affected
checks run again.

## Readiness

At handoff, the agent lists the change's evidence in a readiness manifest and runs
`doodlebot readiness --manifest <file>`. Readiness checks that:

- every artifact exists and matches its recorded hash;
- the evidence belongs to the current revision and Vortex build;
- the required kinds of evidence for the change are present and passing, including a control
  that shows the tests detect the change;
- for a feature or refactor, the design is approved, its acceptance criteria are covered, and
  every changed file is inside its boundary;
- a core-suite receipt ran the whole suite: `node bin/doodlebot.cjs test core`, optionally
  followed by a JSON reporter (`--reporter=json`), and nothing else. A filter, such as a spec
  path or `--grep`, is refused, and so is a `--` after `test core`, because doodlebot passes it
  on to Playwright, which reads what follows as a filter.

A ready result means the evidence is complete. It is not permission to publish, merge or release,
and it does not judge whether the change is correct. An independent reviewer still inspects the
change and its evidence.

## What's next

- [Run report](../reference/run-report.md) and [Benchmark report](../reference/benchmark-report.md).
- [Open a pull request](../guides/pull-requests.md).
