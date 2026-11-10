# Evidence and the QA catalogue

This page explains what evidence the agent keeps for a change, and how the QA catalogue decides
which checks a change needs.

## Before you begin

Read [How doodlebot works](how-it-works.md).

## What counts as evidence

A claim about a change is backed by something you or a reviewer can open:

| Evidence          | Written by                                                                    | Shows                                                                        |
| ----------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Run report        | `/doodlebot:try`, `/doodlebot:investigate`, `/doodlebot:fix`, `/doodlebot:qa` | What a driven scenario did, which dialogs were answered, errors and warnings |
| Benchmark report  | `/doodlebot:measure`                                                          | Timings per build, their spread and the verdict                              |
| Playwright report | `doodlebot test core`                                                         | Which regression tests passed                                                |
| Command receipt   | `doodlebot evidence run`                                                      | A command, its exit code and output, and the source before and after it      |
| Preflight report  | `doodlebot pr-preflight`                                                      | Callers, readers and the revert check for a Vortex branch                    |
| Screenshots       | `doodlebot screenshot`, copied into run reports                               | What the window showed                                                       |

Reports and evidence go under `<workspace>/harness/.artifacts`, which Git ignores. Every run
writes new files; existing evidence is never overwritten. A failed run's evidence is kept as
failed evidence.

Evidence folders hold reports, logs, JSON and screenshots, not large binaries. A file over 100 MB
stays where it is, and the report gives its path instead.
`doodlebot clean` removes old binaries and keeps each report; see
[Use real games and baselines](../guides/games-and-baselines.md).

Passing unit tests alone do not show that a Vortex flow works. A driven run, a regression test
or a benchmark against a real Vortex does.

## Identity

The agent records which source and which Vortex the evidence came from:

- `doodlebot evidence identity` records the checkout, its base and its changed files.
- `doodlebot evidence runtime` records the Vortex executable and build files by their hashes.

Evidence for one revision does not count for a later one. When the code changes, the affected
checks run again.

## The QA catalogue

Vortex has its own end-to-end tests. The QA catalogue lists the checks they do not cover, such
as large collections, the Plugins page and Missing Masters. Each entry names:

- the Vortex files it guards;
- the check that runs it;
- what passing means;
- what it needs, such as the sandbox, the fake Fallout 4 or a Nexus login.

When a change touches files an entry guards, QA runs that entry. To see which entries a change
selects:

```powershell
doodlebot qa list --touching src/renderer/src/extensions/collections/index.ts
```

The output also lists the entries not selected, with the reason, and the touched files that no
entry guards. Those files are tested by hand, and the agent proposes a new entry for them.
An entry that logs out of your Nexus account is selected only with `--allow-logout`, which the
agent adds only after you agree.

With `--json`, each selected entry also says what it would run against on this machine (the
sandbox, a game copy, a collection, the login) and why, or, for a need nothing meets, the
command that meets it. It also gives the results the entry can still report. The agent reads
this instead of choosing by itself.

Each result is one of:

| Result                         | Meaning                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------- |
| Pass                           | The check ran and met its pass criterion                                        |
| Passed with workaround: &lt;x> | It passed only after a step the scenario did not ask for; the report names it   |
| Fail                           | The check ran and did not                                                       |
| Measured                       | The check only measures; it reports numbers, never a pass or a fail             |
| Not tested                     | Nothing here met its needs (the report gives the next step), or no numbers came |

The catalogue is checked in, and `doodlebot qa check` validates it in every CI run. Results are
not checked in: each run writes `harness/.artifacts/qa/<Vortex version>/<entry>/<time>/report.md`.
The [QA catalogue reference](../reference/qa-catalog.md) lists every entry.

## What's next

- [Run report](../reference/run-report.md) and [Benchmark report](../reference/benchmark-report.md).
- [Open a pull request](../guides/pull-requests.md).
