# Agent instructions

This repo is **doodlebot**, an agentic development and testing tool for Vortex. It holds the
tools, the harness, the docs and the hard-won knowledge. Nothing here requires a patched or
self-built Vortex.

## What's here

| Path                          | What it is                                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/`                        | The Vortex extension: an MCP server exposing Vortex's state **and** its UI                                           |
| `harness/`                    | The `doodlebot` CLI and Playwright suite: launch, cache, drive, verify                                               |
| `harness/AGENTS.md`           | **The operating manual.** Start here to use any of this                                                              |
| `harness/WORKFLOWS.md`        | Bug fixes, design-first features, visual designs, state matrices, independent QA                                     |
| `harness/PULL-REQUESTS.md`    | Vortex PR titles, description template, agent briefs, review lessons                                                 |
| `harness/AGENT-WORKFLOW.md`   | Canonical task routing, design-first rule, delegation, evidence and handoff policy                                   |
| `harness/KNOWLEDGE-ROUTES.md` | Shared knowledge index and specialist reading paths                                                                  |
| `harness/egm/`                | EGM resources: the Vortex change standard and the runtime Goldfish persona                                           |
| `designs/`                    | Approved doodlebot designs, indexed in `designs/SITEMAP.md`                                                          |
| `KNOWLEDGE.md`                | Confirmed diagnostic traps; search the relevant area                                                                 |
| `ARCHITECTURE.md`             | Why the extension reflects Vortex's API instead of wrapping it; the one-instance model                               |
| `.claude/skills/`             | Skills: designing a change (`vortex-elephant`), developing Vortex, driving its UI, UI tests                          |
| `.claude/agents/`             | Claude Code subagent adapters: `vortex-runtime-goldfish`                                                             |
| `.claude/settings.json`       | Registers the EGM plugin marketplace, pinned to `v0.1.1`, and enables `egm@egm`                                      |
| `.vortex-src/`                | The Vortex clone this kit manages (gitignored, created by `ai:source`); Vortex source work happens on a branch of it |

## Getting to a driveable Vortex

```powershell
pnpm install
pnpm run build                                # build the extension
pnpm run ai -- setup --installed --sandbox    # no game or account required
pnpm run ai -- tools --json                   # live tool schemas
pnpm run ai -- down                           # stop it before another launch, suite or handoff
```

Only one doodlebot Vortex runs at a time. Every kit launcher (`up`, `setup`, `bootstrap`, the
core suite's fixture, benchmark sessions and setup, `ai:test:zoom -- --signed-out`) writes the
instance record `harness/.cache/instance.json` (always this path, whatever `--cache-dir` says)
and refuses while a live one exists:
"A harness Vortex is running (pid N, cache C); run `pnpm run ai -- down` before <action>."
`down` waits for a clean exit and then clears the record; a record whose pid is dead or no
longer belongs to Vortex or Electron is cleared as stale.

To work on Vortex's own code: `pnpm run ai:source` finds **your** GitHub fork, clones it into
`.vortex-src` and builds it. Make a branch of `.vortex-src` for each piece of work, or pass a
checkout of your own with `--dev-dir <dir>`. The kit never searches the filesystem for a Vortex
checkout. Building, installing, patching, reverting or recording evidence in the checkout a
running harness Vortex was launched from refuses with
"A harness Vortex is running from <checkout> (pid N); run `pnpm run ai -- down` before <action>."

Collections need a Nexus login, once per machine: `pnpm run ai -- setup --installed --oauth`.
The account owner completes the browser login; the kit caches and refreshes it. See
`harness/AGENTS.md`.

## Design first (EGM)

Features and refactors start with an approved design, written and reviewed with Google's
Elephant-Goldfish Model plugin (EGM, `v0.1.1`). Bug fixes, docs and test-only changes need none
unless the user supplies or asks for one.

- Every agent, whether Claude Code, Codex or another, follows
  `.claude/skills/vortex-elephant/SKILL.md` as the Elephant procedure: brief, draft, EGM review,
  confirmation round, human approval, implementation, `design scope`, `down`, independent QA,
  readiness.
- The runtime Goldfish persona is `harness/egm/vortex_runtime.md`, reviewing against
  `harness/egm/vortex-change-standard.md`. Its Claude Code adapter is
  `.claude/agents/vortex-runtime-goldfish.md`.
- Designs live at `designs/<topic>.md` for doodlebot (listed in `designs/SITEMAP.md`) and
  `harness/.artifacts/designs/<topic>.md` for Vortex; confirmation-round reports go to
  `harness/.artifacts/designs/<topic>.reviews/`.
- `pnpm run ai -- design new|check|scope` creates, validates and enforces a design's file
  boundary. Readiness manifests use schema 3 and bind features and refactors to the approved
  text.
- Never write an `Approved` line the human has not given.
- A Goldfish reviewer started from this repository ignores this file's workflow instructions,
  stays read-only and follows its brief.

EGM artifact directory: harness/.artifacts/egm

## Verification

- `pnpm run ci` is the gate: types (extension and harness), lint, format check, paired
  documentation checks/controls, unit tests and build. It needs no Vortex. The human site
  also runs `pnpm run docs:build` with pinned Python packages for publication.
- `pnpm run ai:test` runs the Playwright suite against a real Vortex, with a disposable test
  game and no account. It is outside `ci` because it needs Electron. It refuses while a harness
  Vortex is running; run `pnpm run ai -- down` first.
- Say which one you ran. Passing unit tests alone is not evidence that a Vortex workflow works.
- oxfmt and oxlint own formatting and lint. Don't hand-fix them.

## Improve verified workflows

When asked to perform or test something in Vortex:

1. Read `harness/AGENT-WORKFLOW.md` and use `harness/KNOWLEDGE-ROUTES.md` for the relevant
   manual, skill and specialist sources. Search `KNOWLEDGE.md` for the symptom; verify its
   explanation against the current source. Read `ARCHITECTURE.md` when locating a capability. When changing
   Vortex, also follow its own `AGENTS.md`, `CLAUDE.md` and `docs/README.md`: this kit
   supplements Vortex's rules and doesn't replace them. For a feature or refactor, start with
   the design (above).
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

- **Maintain both documentation audiences in the same change.** `README.md` and `docs/` are
  human-focused; this file and the harness instruction/specialist files remain machine-facing
  outside the published site. Update the mapped human guide and AI companion for changed
  commands, tools, prerequisites, fixtures and guarantees. Run `pnpm run docs:generate` for
  paired source-derived references and `pnpm run docs:check` to catch drift. Use
  `scripts/documentation-map.json` for topic ownership. A generated contract or trivial prose
  edit cannot substitute for an accurate human procedure; review both audiences against source.
  A new test or benchmark needs human run instructions, prerequisites and an explanation of
  what the result proves. See `docs/maintaining-documentation.md` for build/preview/deployment.

- **One accountable owner per issue.** One agent is accountable for each issue and follows
  [the canonical agent workflow](harness/AGENT-WORKFLOW.md). Only one doodlebot Vortex runs at a
  time, and nothing serializes two harness commands, so do not drive, rebuild or test the
  instance from two sessions at once. Run `pnpm run ai -- down` before handing over. Independent
  QA runs after the author's `down`, in a fresh context, and starts with `up --fresh` so it does
  not inherit the author's profile state. Publication follows the user's authorization and the
  kit-lesson exception (below). No backward compatibility with obsolete callers or evidence
  formats is required.
- **The extension must keep working against a stock, released Vortex.** Anything that needs the
  main process goes in the harness over CDP, never into a patch to Vortex.
- **Two test layers.** Pure DOM logic goes in `src/uiAutomation.test.ts` under jsdom; anything
  that needs a real app goes in `harness/src/tests/`.
- **Promote verified lessons** using AGENT-WORKFLOW.md. Keep knowledge entries short:
  symptom, confirmed cause, remedy, applicable scope and source/test evidence.
- Extension changes hot-reload through finite build, copy and reload cycles: run
  `pnpm run ai:watch` (or `pnpm run dev`) against your already-running instance. One watcher is
  sufficient; don't run it together with `build-extension`, or during a test, since a reload
  invalidates UI refs mid-action.

## Committing

Conventional Commits. Don't commit, push or open a PR unless asked, except for verified kit
lessons: those may be committed and pushed to `main` after `pnpm run ci` passes. Every Vortex
PR description ends with the doodlebot footer (`harness/PULL-REQUESTS.md`).

## Human benchmark documentation

For the human benchmark work, write README and docs from the supplied proposal and verified
implementation, without using AI manuals as authoring sources. Test usability by giving a
fresh implementer only a frozen copy of the human pages; do not give it implementation code
or machine instructions. Compile and run its output separately, retain failures, then fix
setup or human explanations and repeat. TypeScript examples are the main path; banners and
logo assets are removed. The human benchmark proposal and run guides explain undecided real
data, budgets and hardware prerequisites. Generated contracts still derive from source.
