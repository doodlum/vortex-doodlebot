# Write scratch scripts

A scratch script lets you combine tool calls, inspect their results and capture the UI while
exploring a problem. `script` runs a `.mts` file with Doodlebot's TypeScript runtime and
instance lease. It supplies the kit import URL in `VORTEX_AI_KIT`, so scripts outside the
repository can import the helpers without Windows path or dependency-resolution problems.

## First script

Save `inspect.mts` in your own task directory:

```typescript title="Runnable inspection script"
const kit = await import(process.env.VORTEX_AI_KIT!);
const config = kit.loadConfig();
const mcp = kit.clientFor(config);
await mcp.waitUntilReady();
const status = await mcp.call("automation_status");
const profiles = await mcp.call("list_profiles");
console.log(JSON.stringify({ status, profiles }, null, 2));
```

After starting your sandbox:

```powershell
pnpm run ai -- script 'C:\tasks\inspect.mts' --installed --sandbox --owner operator
```

Run the example against an app you have already started, then call `down` when your session
is finished. The MCP client uses individual HTTP requests and needs no close call.
Kit flags such as owner, slot, worktree and ports remain harness flags even
after the script name. Put the script's own arguments after `--` to avoid collisions.

## Add renderer observations

```typescript
const handle = await kit.attachToRenderer(config);
try {
  console.log(await handle.page.title());
  const image = await kit.captureScreenshot(config, { label: "script-observation" });
  console.log(image);
} finally {
  await handle.close();
}
```

Closing the CDP connection does not stop the app. Attachment selects the Vortex renderer
instead of an arbitrary splash or pop-out page. It also supplies the function-name shim
needed by TypeScript-compiled `page.evaluate` functions.

## Available helpers

The [helper reference](../reference/script-api.md) covers the public kit and module declarations:
configuration; MCP; renderer capture/input; JSON and ZIP helpers; UI; local mods; deployment;
Bethesda/offline collection fixtures; slow downloads; large libraries/table probes; CPU
profiling; recording; and Vortex log analysis. Some underlying module types or functions
shown in the reference are not re-exported by the scratch kit; the source link identifies
the direct repository import when needed.

Use a named owner and disposable fixture, and check the active game/profile before writes.
Keep clients and browser handles within the procedure that uses them. Wait for app exit
before cleaning up known temporary files, and retain the evidence from failed runs.

## Turn a useful script into maintained automation

Move reusable behavior into a harness module with a meaningful test and update its human
guide and AI contract in the same change. Put stable checks in the unit or real-app test
layer, and measurements in an explicit benchmark with fixture parameters and a comparison
method. See [unit tests](../testing/unit.md), [integration tests](../testing/integration.md)
and [benchmarks](../testing/benchmarks.md).
