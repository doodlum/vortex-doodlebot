# Sessions

For experimental native Linux sessions, the [VM guide](../guides/linux-vm.md) describes SSH
deployment and display setup. `VORTEX_AI_OZONE_PLATFORM=wayland` or `x11` adds a Linux-only
Electron backend flag before launch. It neither creates a display nor disables sandboxing;
the usual isolated profile and clean shutdown checks still apply inside the guest.

When a known game has no explicit install path, the harness searches Steam manifests.
Linux lookup includes the XDG/default data directory, legacy aliases, Snap and Flatpak
clients, plus additional libraries in each client's `libraryfolders.vdf`. It deduplicates
client aliases and requires a supported executable file alongside the app manifest.
Linux Stardew accepts `StardewValley` or `Stardew Valley` for a native install and
`Stardew Valley.exe` for Proton; Windows accepts the Windows filename. Directories named
like executables are refused. An invalid explicit `--game-path` never falls back to another
installation. See the [VM game setup procedure](../guides/linux-vm.md#run-and-verify).
Manual paths receive Steam identity only when that physical directory matches the known
game's installed Steam manifest, including secondary libraries. A copied game or standalone
Wine prefix is registered without a store; its user-folder lookup must not require Proton.
An existing store remains unchanged when setup only repairs the executable at the same path.
For a known Windows installation on Linux, setup records its executable override and
repairs a missing override in a cached profile when that file exists. Explicit executable
overrides and the existing discovery timestamp are preserved when only repairing the filename.
Native-only installs receive no Windows override. Path validation is separate from observing
the actual native or Proton game process and window.

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

If the app exits before its private paths are verified, session startup fails with the exit code or signal and the retained `vortex-stdio.log` location. Follow [startup troubleshooting](../troubleshooting.md#vortex-exits-during-startup) before retrying.

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

Real sessions copy the selected game fixture, but game support can also write Documents/AppData. Use a QA-only account or test machine. [Setup](../getting-started/setup.md) explains the acknowledgement.

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

Choose one owner and use the same instance settings throughout:

```powershell
$env:VORTEX_AI_OWNER = 'interactive-test'
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

The script runner supplies the connection settings. The final `down` command closes Vortex. A new setup restores its prepared profile and discards the previous session's changes. Advanced target/slot settings are in [configuration](configuration.md) and [CLI commands](cli.md).
