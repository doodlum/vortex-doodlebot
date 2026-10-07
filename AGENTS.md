# Agent instructions

This repo is **doodlebot**, an agentic development and testing tool for Vortex. It holds the
tools, the harness, the docs and the hard-won knowledge. Nothing here requires a patched or
self-built Vortex.

## What's here

| Path                          | What it is                                                                 |
| ----------------------------- | -------------------------------------------------------------------------- |
| `src/`                        | The Vortex extension: an MCP server exposing Vortex's state **and** its UI |
| `harness/`                    | The `doodlebot` CLI and Playwright suite: launch, cache, drive, verify     |
| `harness/AGENTS.md`           | **The operating manual.** Start here to use any of this                    |
| `harness/WORKFLOWS.md`        | Bug fixes, features, designs, state matrices, several agents at once       |
| `harness/PULL-REQUESTS.md`    | Vortex PR titles, description template, agent briefs, review lessons       |
| `harness/AGENT-WORKFLOW.md`   | Canonical task routing, delegation, ownership, evidence and handoff policy |
| `harness/KNOWLEDGE-ROUTES.md` | Shared knowledge index and specialist reading paths                        |
| `KNOWLEDGE.md`                | Confirmed diagnostic traps; search the relevant area                       |
| `ARCHITECTURE.md`             | Why the extension reflects Vortex's API instead of wrapping it             |
| `.claude/skills/`             | Skills: developing Vortex, driving its UI, writing UI tests                |
| `.vortex-src/`                | The Vortex clone this kit manages (gitignored, created by `ai:source`)     |
| `.vortex-worktrees/`          | One worktree of it per piece of work (gitignored, `worktree add <name>`)   |

## Getting to a driveable Vortex

```powershell
$env:VORTEX_AI_OWNER = 'operator'
pnpm install
pnpm run build                                # build the extension
pnpm run ai -- setup --installed --sandbox    # no game or account required
pnpm run ai -- tools --json                   # live tool schemas
```

To work on Vortex's own code: `pnpm run ai:source` finds **your** GitHub fork, clones it into
`.vortex-src` and builds it. Then `pnpm run ai -- worktree add <name>` makes a worktree of it for
each piece of work. The kit never searches the filesystem for a Vortex checkout.

Collections need a Nexus login, once per machine: `pnpm run ai -- setup --installed --oauth`.
The account owner completes the browser login; the kit caches and refreshes it. See
`harness/AGENTS.md`.

## Verification

- `pnpm run ci` is the gate: types (extension and harness), lint, format check, unit tests,
  build. It needs no Vortex.
- `pnpm run ai:test` runs the Playwright suite against a real Vortex, with a disposable test
  game and no account. It is outside `ci` because it needs Electron.
- Say which one you ran. Passing unit tests alone is not evidence that a Vortex workflow works.
- oxfmt and oxlint own formatting and lint. Don't hand-fix them.

## Improve verified workflows

When asked to perform or test something in Vortex:

1. Read `harness/AGENT-WORKFLOW.md` and use `harness/KNOWLEDGE-ROUTES.md` for the relevant
   manual, skill and specialist sources. Search `KNOWLEDGE.md` for the symptom; verify its
   explanation against the current source. Read `ARCHITECTURE.md` when locating a capability. When changing
   Vortex, also follow its own `AGENTS.md`, `CLAUDE.md` and `docs/README.md`: this kit
   supplements Vortex's rules and doesn't replace them.
2. Inspect the live tool schemas, state and UI before acting. Use existing capabilities first.
3. If authorized work needs a missing capability, implement the reusable extension tool,
   harness orchestration or setup support here, preserving stock Vortex compatibility.
4. Verify the affected contract, add meaningful regression coverage and update its canonical
   documentation. Keep unverified lessons in task reports. Promote a reusable lesson only
   after checking its cause and scope; material behavior/policy changes need independent review.
   Useful work need not generate a new global rule on every request.
5. Keep missing automation apart from external constraints. Login, captcha, unavailable
   services and missing software can't be claimed away: report them with the exact setup step.

A task is complete only when its result is verified, or a concrete external blocker is reported.

## Working on this repo

- **One accountable owner per issue.** Follow [the canonical agent workflow](harness/AGENT-WORKFLOW.md).
  Parallel live workers have distinct owners, Vortex worktrees and slots. Independent QA starts
  in a fresh context. Kit changes have one writer under the kit lock: lock, sync, edit, CI,
  commit, push, unlock. Publication follows the user's authorization and the kit exception.
  Named owners and explicit nested execution contexts are required; copying an owner name
  does not authorize overlapping operations. No backward compatibility with obsolete callers
  or evidence formats is required.
- **The extension must keep working against a stock, released Vortex.** Anything that needs the
  main process goes in the harness over CDP, never into a patch to Vortex.
- **Two test layers.** Pure DOM logic goes in `src/uiAutomation.test.ts` under jsdom; anything
  that needs a real app goes in `harness/src/tests/`.
- **Promote verified lessons** using AGENT-WORKFLOW.md. Keep knowledge entries short:
  symptom, confirmed cause, remedy, applicable scope and source/test evidence.
- Extension changes hot-reload through finite guarded cycles: run `pnpm run ai:watch` (or
  `pnpm run dev`) against your already-running owned instance. One watcher is sufficient.

## Committing

Conventional Commits. Don't commit, push or open a PR unless asked, except for kit lessons you apply
under the kit lock (`kit push`). Every Vortex PR description
ends with the doodlebot footer (`harness/PULL-REQUESTS.md`).
