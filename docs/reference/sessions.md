# Sessions

Import from `./harness/benchmarks/index`. The callback's `vortex` argument is a `BenchmarkSession`; do not construct it yourself.

## withVortex

<!-- contract:benchmarks.session:withVortex -->

```typescript
export async function withVortex<T>(
  options: SessionOptions,
  run: (vortex: BenchmarkSession) => Promise<T>,
): Promise<T>;
```

<!-- /contract -->

Starts a released Vortex with a new profile, runs your callback, then closes the app. Returns your callback's value after successful cleanup. `{}` chooses anonymous generated data and a disposable test game. It needs no installed game or Nexus account.

```typescript
await withVortex({}, async (vortex) => {
  await vortex.seedMods(3);
  await vortex.table("mods").search("no-matching-mod");
});
```

Callback and cleanup errors fail the call. Failed workspaces are retained, with their path in the error. Successful sessions remove their temporary workspace; save screenshots and other files outside it. See [the first test](../getting-started/first-session.md).

Only one Doodlebot Vortex runs at a time. If one started with `pnpm run ai -- up` or `setup` is still running, the session refuses to start and tells you to run `pnpm run ai -- down` first.

The first start registers the private game path and closes Vortex to save it. A second start lets Vortex create its default profile and staging folder through its own game-startup handler. The session waits for that game to become active and checks that its path still matches the private copy before saving the reusable profile. This setup happens before benchmark timing. A failed setup or shutdown leaves no usable snapshot; if both fail, the error retains both causes.

## SessionOptions

<!-- contract:benchmarks.session:SessionOptions -->

```typescript
export interface SessionOptions {
  executable?: string;
  outputDir?: string;
  manifest?: RunManifest;
  dataset?: DatasetKind;
  /** Require a verified game snapshot and back up/reset supported per-user game settings before launch. */
  cleanStart?: true;
}
```

<!-- /contract -->

| Option       | Use                                                                                  |
| ------------ | ------------------------------------------------------------------------------------ |
| `executable` | Override the released Vortex executable if detection fails.                          |
| `dataset`    | `"synthetic"` by default. `"real"` requires a pinned collection and clean game copy. |
| `manifest`   | Run conditions, collection configuration, table controls and timeout.                |
| `outputDir`  | Where to save artifacts.                                                             |
| `cleanStart` | Verify a real snapshot and back up/reset supported per-user game settings.           |

Real sessions copy the selected game fixture, but game support can also write Documents/AppData. Use a QA-only account or test machine. [Setup](../getting-started/setup.md) explains the acknowledgement. Resetting game settings refuses while Vortex is running.

## page and gameId

`vortex.page` is the main window's Playwright `Page`. Use locators and waiting assertions as in [UI tests](../guides/ui-automation.md). `vortex.gameId` is the active test game's Vortex ID.

## seedMods

<!-- contract:benchmarks.session:BenchmarkSession.seedMods -->

```typescript
seedMods(count = this.manifest?.synthetic?.count ?? 150): Promise<string[]>;
```

<!-- /contract -->

Creates generated local mod files and installed records; returns their mod IDs. Mods start enabled. Use those IDs with `enable()` and `disable()`. This is synthetic data, not a Nexus download or real plugins.

## seedDownloads

<!-- contract:benchmarks.session:BenchmarkSession.seedDownloads -->

```typescript
seedDownloads(count = this.manifest?.synthetic?.count ?? 150): Promise<void>;
```

<!-- /contract -->

Creates local archives and finished download records; resolves without a return value. It does not measure internet downloads. Other statuses need a different fixture.

## openPage

<!-- contract:benchmarks.session:BenchmarkSession.openPage -->

```typescript
openPage(page: string): Promise<void>;
```

<!-- /contract -->

Opens a navigation page such as `"Mods"` or `"Downloads"`. Missing navigation fails. Opening a page is setup unless explicitly measured.

## table

<!-- contract:benchmarks.session:BenchmarkSession.table -->

```typescript
table(name: TableName): BenchmarkTable;
```

<!-- /contract -->

Returns a [table helper](tables.md). Mods and Downloads have default mappings. Plugins and Load Order need real data and definitions in `manifest.tables`.

## measure

<!-- contract:benchmarks.session:BenchmarkSession.measure -->

```typescript
measure<T>(name: string, action: () => Promise<T>): Promise<T>;
```

<!-- /contract -->

Times an async action, its checks and final paint; appends a measurement and returns the action's result. Keep preparation outside it. Repeated names get numbered suffixes. Table helpers already measure themselves: do not wrap them in another `measure()`.

## call

<!-- contract:benchmarks.session:BenchmarkSession.call -->

```typescript
call<T = unknown>(
    tool: string,
    args: Record<string, unknown> = {},
    timeoutMs = this.timeoutMs,
  ): Promise<T>;
```

<!-- /contract -->

Calls an [app tool](mcp-tools.md). Arguments default to an empty object; timeout defaults to the session timeout. The generic return type is a TypeScript annotation, not data validation. Tool failures throw. See [calling tools](../guides/calling-tools.md).

## assert and block

`vortex.assert(condition, message)` fails when the condition is false. Node and Playwright assertions also work. `vortex.block(reason)` throws `BenchmarkBlocked` for missing prerequisites; the runner records a blocked result.

`measurements`, `phases`, `warnings`, and `evidence` retain observations. [Options and results](results.md) explains them. Use the runner to write a report automatically.

## Attach to an existing app

Use this only when you want to keep Vortex open between scripts. Ordinary tests use `withVortex()` and need no connection setup.

Use the same target settings for every command:

```powershell
pnpm run ai -- setup --installed --sandbox
pnpm run ai -- script attached-app.mts --installed --sandbox
pnpm run ai -- down --installed --sandbox
```

Save the attachment script at the repository root:

```typescript title="attached-app.mts"
import { loadConfig, clientFor } from "./harness/src/kit";

const client = clientFor(loadConfig());
console.log(await client.call("vortex_query", { selector: "activeGameId" }));
```

The script runner supplies the connection settings and runs the script in the directory you started it from; a relative script path is read from that directory too. It returns the script's exit code. Scripts written for older Doodlebot versions that claimed the instance before connecting must remove that call: Doodlebot now runs one Vortex at a time and the claim no longer exists. The final `down` command closes Vortex and waits until it has exited cleanly. A new setup restores its prepared profile and discards the previous session's changes.

While this app is open, `withVortex()`, benchmark sessions and `pnpm run ai:test` refuse to start a second Vortex. Run `down` before you use them. Advanced target, cache and port settings are in [configuration](configuration.md) and [CLI commands](cli.md).
