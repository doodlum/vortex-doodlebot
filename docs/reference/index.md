# Reference

Look up an option or method while writing a test. If you are starting from scratch, follow [the first test](../getting-started/first-session.md).

| Area                                  | What to look up                                                |
| ------------------------------------- | -------------------------------------------------------------- |
| [Sessions](sessions.md)               | App lifetime, local fixtures, Playwright access and assertions |
| [Benchmark runner](runner.md)         | Cases, repeats, selection and reports                          |
| [Tables](tables.md)                   | Common actions and their required starting state               |
| [Collection setup](collections.md)    | Game discovery, snapshots and pinned configurations            |
| [Options and results](results.md)     | Run conditions, timeouts and measurements                      |
| [CLI commands](cli.md)                | Lower-level app operations and flags                           |
| [App tools](mcp-tools.md)             | Direct tool names and input schemas                            |
| [Configuration](configuration.md)     | Environment overrides and alternate Vortex installations       |
| [Package scripts](package-scripts.md) | Repository checks and development commands                     |

Ordinary tests import `./harness/benchmarks/index`. The supplied proposal catalog lives in `./benchmarks/`; its saved collection choices come from `./benchmarks/setup`.

For lower-level UI scripts, `waitForNode` polls role/name matches in a fresh snapshot,
optionally within a selector. Its timeout includes waiting for another UI transaction;
an expired waiter cannot take a late snapshot and invalidate that transaction's references.
Each issued snapshot request is capped by the remaining wait and five seconds. See
[running checks](../testing/running.md) for the local deadline and transaction regressions.

`ui.dialogButtons` inspects a named dialog's available buttons; `ui.clickInsideDialog`
selects an enabled matching button in that dialog. Both enumerate matching modal roots
past nested or hidden wrappers. See [collection dialogs](../guides/mod-workflows.md#collections)
for the workflow and [unit checks](../testing/unit.md) for the isolated regression command.
