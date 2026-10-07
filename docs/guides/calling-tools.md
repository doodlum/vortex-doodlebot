# Call tools and read results

Use tools to inspect profiles, find stalled downloads or read app state without copying
everything from the UI. First open the installed sandbox from
[your first session](../getting-started/first-session.md). The examples below use that running
session, with its owner and target environment still set in PowerShell.

## Discover before calling

```powershell
pnpm run ai -- tools --json
pnpm run ai -- call automation_status
pnpm run ai -- call list_profiles
pnpm run ai -- call nexus_auth_status
```

`automation_status` reports the renderer lifetime, app paths and React build, so you can
confirm which app you are connected to. `nexus_auth_status` reports whether credentials
exist; it keeps their values private and does not test whether a server accepts them.

## Supply structured arguments

An arguments file avoids PowerShell's nested JSON quoting. Create `query.json`:

```json
{ "selector": "activeGameId" }
```

Then call:

```powershell
pnpm run ai -- call vortex_query --args-file query.json
```

Use [the MCP reference](../reference/mcp-tools.md) for each tool's types, optional fields and
limits. Keep credentials out of argument files. Inline
`--args` is also supported when your shell quoting preserves the JSON exactly.

## Choose the right tool

| Task                         | Start with                                                      | What to check                                                                   |
| ---------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Discover available APIs      | `vortex_describe`, `scan_extension_actions`                     | Read the verified argument hints to understand how to call each API             |
| Read state                   | `vortex_query`                                                  | Choose a selector or a state path; limit response size                          |
| Inspect profiles and mods    | `list_profiles`, `list_mods`                                    | Game/profile IDs and active context                                             |
| Inspect a collection         | `collection_status`, `collection_install_state`                 | Vortex's completion status, including stages a mod count cannot reveal          |
| Find plugin problems         | `list_load_order`, `get_plugin_details`, `find_missing_masters` | Dependencies and the selected game                                              |
| Diagnose files and conflicts | The diagnostic tools in the reference                           | Candidate findings need investigation before deleting files or choosing winners |
| Inspect stalled downloads    | `list_downloads`, `find_stale_downloads`                        | Actual progress and service/installer state                                     |
| Handle app feedback          | `list_notifications`, `list_dialogs`, `list_runtime_errors`     | Which errors the scenario expects and whether startup or the renderer failed    |
| Drive visible controls       | `ui_snapshot`, `ui_click`, `ui_fill`, `ui_press_key`            | Current references and independently observed effects                           |
| Measure renderer work        | `perf_trace_start`, `perf_trace_stop`, `perf_trace_status`      | Workload, React mode and profiling overhead                                     |

## Writes and expected context

The harness supplies a bearer token that enables tools which change app state. A direct
client needs the same token. Once a token is configured, every request requires it. It
grants broad access rather than separate permissions for individual tools.

For a write to an observed profile or game, pass `expectedActiveProfileId` and/or
`expectedActiveGameId` where the tool supports them. A mismatch fails rather than modifying
a newly active profile. Re-read active context after a switch and before consequential writes.

`vortex_dispatch` can invoke an action creator, extension API, event or API method. Read
`vortex_describe` first: argument order is positional and some events require a
`"__CALLBACK__"` sentinel. Persistent listener registrations return listener IDs;
`poll_listener` retrieves them. Avoid guessing undocumented action arguments.

## Results, errors and limits

The TypeScript client's `call<T>` parses structured text as JSON and returns plain text for
tools that emit a status sentence. `callRaw` preserves the MCP envelope; a tool error throws
`McpError`. The type parameter describes the result you expect, but does not validate it at
runtime. Check the returned shape and verify the effect through the UI or filesystem when
the outcome matters.

Confidential state is redacted even with a write token. Large raw state dumps can exceed
response limits; use a scoped query or inventory helper. Some diagnostics have external
effects: `check_nexus_mod_updates` contacts Nexus and consumes quota.

For repeatable multi-step work, move from terminal calls to [a script](scripting.md) or
[a real-app test](../testing/integration.md).
