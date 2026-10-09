# TypeScript API

Most tests need one import:

```typescript
import { withVortex } from "./harness/benchmarks/index";
```

`withVortex()` opens a disposable Vortex session and closes it after your callback. Inside the callback, use `vortex.page` for Playwright controls or the table and collection helpers for common workflows.

| I need to…                                         | Reference                          |
| -------------------------------------------------- | ---------------------------------- |
| Start a test, create local data, or call a tool    | [Sessions](sessions.md)            |
| Define cases, choose repeats, and run them         | [Benchmark runner](runner.md)      |
| Search, sort, scroll, or change table rows         | [Tables](tables.md)                |
| Prepare a game copy or install a pinned collection | [Collection setup](collections.md) |
| Configure a run or understand its measurements     | [Options and results](results.md)  |

For a runnable example, start with [your first test](../getting-started/first-session.md) or [adding a benchmark](../testing/adding-benchmarks.md). For several named tests with an HTML report, use the [Playwright fixtures](../testing/integration.md).

The signatures on these pages are checked against implementation. The explanations cover inputs, results and failures. You do not need to read source to use them.

Direct MCP calls and attaching to an already-running app are advanced options. See [app tools](mcp-tools.md), [CLI commands](cli.md), [configuration](configuration.md), and [scratch scripts](../guides/scripting.md).
