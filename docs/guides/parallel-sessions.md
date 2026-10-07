# Run independent sessions

Give each task its own session when two tasks need to drive Vortex at once. Clients sharing
one renderer can change each other's UI state and invalidate each other's snapshot references.

## Owners and slots

```powershell
# Session A:
pnpm run ai -- up --installed --sandbox --owner issue-a --slot auto
# Session B, in another terminal:
pnpm run ai -- up --installed --sandbox --owner issue-b --slot auto
```

Repeat each owner/slot on every command, including `down`. An auto slot remains associated
with that owner. Slot 0 uses `harness/.cache`, MCP 3701 and CDP 9222. Slot n uses
`harness/.slots/n` and ports `3701 + 10n` / `9222 + 10n`, unless you override them.

```powershell
pnpm run ai -- slots --json
pnpm run ai -- lease status --json
```

Slots separate app profiles and endpoints, not credentials or all external effects. New
slots can inherit saved OAuth. Use separate source worktrees for independently driven source
tasks and confirm user-folder isolation where a game writes outside its install directory.

## Reservations and operation guards

A lease keeps an app/cache or checkout reserved between commands. An operation guard prevents
conflicting supported commands from running together, including commands with the same owner.
Keep independent operations sequential. Intended child operations can use an explicitly
nested context; copying that context into another worker bypasses the intended coordination.

`lease acquire`, `lease release` and `lease run` support longer procedures; normal launch
commands acquire ownership implicitly and retain it until shutdown. Read the [CLI reference](../reference/cli.md)
before forced recovery. Check known child processes before releasing or expiring ownership.

## Changing Doodlebot itself

Reserve the kit before changing its extension, harness or documentation. One person or
assistant writes at a time; other readers can still inspect the source:

```powershell
pnpm run ai -- kit lock --owner docs-update
pnpm run ai -- kit sync --owner docs-update
# Make the scoped change and update both documentation audiences.
pnpm run ci
# Commit only within your authorized scope.
pnpm run ai -- kit push --owner docs-update
pnpm run ai -- kit unlock --owner docs-update --acquisition '<original-acquisition-id>'
```

Keep the acquisition ID printed by lock and renew that reservation before it expires.
Only push when publication is part of your task. If push rebases to a new HEAD, rerun checks
before publication. Unlock refuses uncommitted changes or a running operation. Keep the work
and hand it over with its reservation details if you cannot finish; do not delete it to unlock.
