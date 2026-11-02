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

## Inspect resolved folders

Call `automation_status` to inspect the running version, renderer lifetime, harness profile
(`userDataDir`) and Vortex's resolved `paths.home`, `paths.appData`, `paths.documents` and
`paths.localAppData`. A folder is `null` if Vortex cannot report it. These paths come from
Vortex's path API; environment variables alone may differ, particularly inside Flatpak.

Before managing a real game copy, check that the relevant resolved folders belong to your
disposable setup. Compare physical paths with the platform's case rules, including symlink
targets. This observation does not establish startup isolation or cover every game's files:
a Windows game running through Proton also needs a protected prefix and its user folders.
See [session isolation](../reference/sessions.md) for the supported harness lifecycle.

## Inspect a store installation

Use `game_store_entry` to ask Vortex which installation a store ID identifies:

```json
{ "appId": "489830", "storeId": "steam" }
```

Here `489830` is Steam's Skyrim Special Edition ID; Vortex calls that game `skyrimse`.
The result includes `appid`, `gameStoreId`, `name` and `gamePath`. On a Linux Vortex that
reports Proton metadata, it also includes `usesProton`, `compatDataPath` and `protonPath`;
unavailable fields are null. Native `usesProton: false` remains false. Account identifiers
and unrelated store metadata are omitted.

The lookup does not activate or launch a game. An unavailable API, store or catalog is a
tool error; refresh Games or finish the normal store setup before retrying. Compare the
reported installation and prefix with the intended physical directories before management.
Returned paths alone do not establish that files or user-folder symlink targets are isolated.

## Launch a configured game

Prepare a real game first, using the [Linux VM procedure](linux-vm.md#run-and-verify) when
appropriate. Call `launch_game` with its Vortex game ID and guard the active game:

```json
{ "gameId": "stardewvalley", "expectedActiveGameId": "stardewvalley" }
```

The tool selects the primary tool or the discovered game executable. It returns when Vortex
reports a process spawn or successful command completion, so your next command can run while
the game remains open. A returned start is not evidence of a playable game: check a newly
observed process and window separately. Deployment prompts may need an answer before launch.
Later execution failures are logged by the app. The game ID accompanies the command so
Linux Proton tools use the associated game's runtime and prefix; stock Windows Vortex
continues using its normal executable launch API.

After a primary tool starts, doodlebot looks for the game's process before falling back to
its own executable. Linux checks truncated Wine names against full arguments and native
programs with renamed main threads against their executable path. This check can recognize
an existing process too; verify a new process separately when you need proof of this launch.
