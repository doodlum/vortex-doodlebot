# vortex-doodlebot

An agentic development and testing tool for [Vortex](https://www.nexusmods.com/about/vortex/),
the Nexus Mods mod manager. AI agents use it to reproduce Vortex bugs, change Vortex's code,
and verify the result in the real app, then prepare or publish a pull request within the
user's authorization.

It has two halves:

- **An MCP server inside Vortex** (`src/`, a Vortex extension). Agents read Vortex's live state
  (profiles, mods, load order, downloads, dialogs), dispatch its actions and drive its UI:
  accessibility snapshots, clicks, typing, scrolling, window sizes. It reflects Vortex's own API
  rather than wrapping it, and works against a stock, released Vortex.
- **A harness** (`harness/`, the `doodlebot` CLI, `pnpm run ai -- <command>`). It clones and
  builds your Vortex fork, launches isolated Vortex instances on sandboxed games, caches
  profiles and logins, takes screenshots and recordings, runs Playwright and performance
  checks, and checks a Vortex PR before review.

Several doodlebots can work at once, each on its own issue in its own Vortex worktree and
instance slot, each looking after itself. Changes to the kit itself go through a global kit lock.
Follow [the canonical agent workflow](harness/AGENT-WORKFLOW.md) for routing, delegation,
independent QA, strict readiness and cleanup. Supported live operations require named owners.

Based on [vortex-mcp](https://github.com/alandtse/vortex-mcp) by Alan Tse. License:
[GPL-3.0-only](LICENSE.md).

## Quick start

Windows, Node 22+, and this repo's pinned pnpm (9.15.0).

```powershell
$env:VORTEX_AI_OWNER = 'operator'
pnpm install
pnpm run build                                   # the extension
pnpm run ai -- setup --installed --sandbox       # installed Vortex, disposable game, no account
pnpm run ai -- tools --json                      # live tool schemas
pnpm run ai -- snapshot                          # what is on screen
pnpm run ai:test                                 # the Playwright suite against a real Vortex
```

To work on Vortex itself:

```powershell
pnpm run ai:source -- --owner source-setup --no-build # prepares the managed base; workers use worktrees
pnpm run ai -- worktree add fix-123 --owner fix-123 # a worktree for one worker
pnpm run ai -- up --worktree fix-123 --slot auto --owner fix-123 --bethesda-sandbox
```

Collections need a Nexus login, done once per machine:
`pnpm run ai -- setup --installed --oauth`.

## Where to read next

| File                                                       | For                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------- |
| [AGENTS.md](AGENTS.md)                                     | Agents: how to work in this repo                        |
| [harness/AGENTS.md](harness/AGENTS.md)                     | The operating manual: every command, lease and slot     |
| [harness/WORKFLOWS.md](harness/WORKFLOWS.md)               | Bug fixes, features, designs, several agents at once    |
| [harness/AGENT-WORKFLOW.md](harness/AGENT-WORKFLOW.md)     | Task routing, worker briefs, ownership and readiness    |
| [harness/TESTING.md](harness/TESTING.md)                   | Required test gates, compatibility and opt-in scenarios |
| [harness/PULL-REQUESTS.md](harness/PULL-REQUESTS.md)       | Vortex PR titles, descriptions, briefs and review       |
| [harness/KNOWLEDGE-ROUTES.md](harness/KNOWLEDGE-ROUTES.md) | Specialist reading paths and verified knowledge sharing |
| [KNOWLEDGE.md](KNOWLEDGE.md)                               | Confirmed diagnostic traps                              |
| [ARCHITECTURE.md](ARCHITECTURE.md)                         | Why the extension reflects Vortex's API                 |
| `.claude/skills/`                                          | Skills: developing Vortex, driving its UI, UI tests     |

## Connecting an MCP client

`up` prints the endpoint and token. Any Streamable HTTP client works:

```sh
claude mcp add --transport http vortex http://127.0.0.1:3701/mcp -H "Authorization: Bearer <token>"
```

For a stdio-only client, bridge with `mcp-remote`. Use `pnpm run ai -- setup --installed
--sandbox --owner <you>` to provision an owned isolated instance, then `pnpm run ai -- up`
with the same owner, target and cache/slot flags to reopen it. See the operating manual.

## Safety

- The server binds to `127.0.0.1` and rejects any `Host`/`Origin` that isn't loopback, which
  stops DNS-rebinding pages.
- Writes fail closed. Without `VORTEX_MCP_TOKEN` only read tools exist. With it, every request
  needs `Authorization: Bearer <token>`, and a holder has full write access, including
  `vortex_dispatch` over every Vortex action. Treat the token as a local secret, and never bind
  the server to another address.
- `state.confidential` (Vortex's stored API key and OAuth credentials) is redacted from every
  response, with or without a token.
- `switch_profile`, `set_mods_enabled`, `launch_game` and `vortex_dispatch` accept
  `expectedActiveProfileId`/`expectedActiveGameId`, and refuse to act when the active
  profile or game has changed.
- The harness drives disposable sandboxes and isolated profiles. It never writes the operator's
  Vortex profile or a real game unless told to with an explicit, disposable path.

## Development

`pnpm run ci` is the gate: types, lint (oxlint), format (oxfmt), unit tests and the build. It
needs no Vortex. Commits follow Conventional Commits.

GPL-3.0-only, matching Vortex and `@nexusmods/vortex-api`.
