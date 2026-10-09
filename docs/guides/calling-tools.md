# Call Vortex tools

Use `vortex.call()` when your test needs app state or a Vortex operation. Save this script at the repository root and run it with `pnpm exec tsx inspect-mods.mts`.

```typescript title="inspect-mods.mts"
import { withVortex } from "./harness/benchmarks/index";

await withVortex({}, async (vortex) => {
  const mods = await vortex.call("list_mods");
  console.log(mods);
});
```

`call(name, arguments)` parses the tool's JSON response. Some tools return a plain string. If Vortex returns a tool error, the client throws; catch it only when your script has a useful recovery or a clearer failure message.

## Find the input you need

Inside your callback, inspect a tool's live schema with the lower-level client:

```typescript
const tools = await clientFor(vortex.config).listTools();
console.log(tools.find((tool) => tool.name === "set_mods_enabled"));
```

Import `clientFor` from `./harness/src/kit`. `listTools()` returns the running extension's names, descriptions, and input schemas. The [MCP reference](../reference/mcp-tools.md) is a searchable appendix.

## Query a specific piece of state

```typescript
const gameId = await vortex.call<string | null>("vortex_query", {
  selector: "activeGameId",
});
```

A TypeScript type annotation describes what your code expects; it does not validate the response. Add assertions when a test depends on the value. Check an operation's rendered UI or resulting files as well as the app's reported state.

For common tasks, [UI helpers](ui-automation.md) and [mod helpers](mod-workflows.md) reduce the amount of tool-specific code you need to write.
