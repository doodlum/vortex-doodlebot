# Write a real-app test

Use the Playwright fixtures when you want an automated assertion against Vortex. They provide an isolated app, a disposable managed game, a tool client, and the rendered window.

Create a spec in `harness/src/tests/`:

```typescript title="harness/src/tests/my-mods.spec.ts"
import { expect, test } from "./fixtures";

test("Mods page opens for the managed test game", async ({ mcp, managedGame, vortexWindow }) => {
  const gameId = await mcp.call<string | null>("vortex_query", {
    selector: "activeGameId",
  });
  expect(gameId).toBe(managedGame.gameId);

  await vortexWindow.getByRole("button", { name: "Mods", exact: true }).click();
  await expect(vortexWindow.getByRole("heading", { name: "Mods", exact: true })).toBeVisible();
});
```

Run the spec with `pnpm run ai:test -- my-mods.spec.ts` after installing the prerequisites in [running checks](running.md).

This checks navigation without installing any mods. An empty Mods page has no table. For a table test, create a local fixture first, as in [your first test](../getting-started/first-session.md).

## What the fixtures provide

- `mcp`: the Vortex tool client.
- `vortexWindow`: Playwright's page for visible UI checks.
- `managedGame`: the active game ID and test path.
- `config`: paths and connection settings for that test run.

Use the tool client for the operation and the rendered UI or files for its consequence. For example, a deploy test should read a deployed file, rather than only ask Vortex whether a mod is installed.

Fixtures are shared within a worker to avoid starting the app for every assertion. Restore state changed by your test so the next test has a valid starting point. Use `try`/`finally` for cleanup.

## Make the test actionable

Name the scenario and expected behavior. Wait for a meaningful state or UI result; avoid arbitrary delays. Keep real downloads and engine-specific fixtures separate from account-free local tests.

A missing account or unavailable game should be reported as a prerequisite failure. For structured performance repeats and blocked coverage, use [the benchmark runner](benchmarks.md).
