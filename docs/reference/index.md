# Reference

Look up an option or method while writing a test. If you are starting from scratch, follow [the first test](../getting-started/first-session.md).

| Area                                  | What to look up                                                |
| ------------------------------------- | -------------------------------------------------------------- |
| [TypeScript API](script-api.md)       | Choose the right API for a task                                |
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
