---
name: vortex-dev
description: Fix a bug in Vortex, add a feature, or reproduce and test an application change. Covers source setup, owned worktrees, scoped verification and production submission evidence. Use for Vortex application behavior; use the kit workflow for doodlebot itself.
---

# Working on Vortex

Establish the user's target and scope first. Permission to change doodlebot does not authorize
Vortex source edits. A read-only source constraint also excludes temporary fixture patches,
revert controls and builds that rewrite that checkout. Continue authorized independent work
and report a concrete missing permission or prerequisite when it blocks the requested outcome.

Read [the agent workflow](../../../harness/AGENT-WORKFLOW.md) and use
[knowledge routes](../../../harness/KNOWLEDGE-ROUTES.md) for relevant specialist sources.
For Vortex changes, read its own `AGENTS.md`, applicable nested instructions, `CLAUDE.md`
when present, `CONTRIBUTING.md` and `docs/README.md`. Its instructions govern a submission.
UI work also needs the relevant frontend/testing guidance and supplied design.

## Prepare an owned checkout

When source provisioning is authorized:

```powershell
$env:VORTEX_AI_OWNER = 'fix-123'
pnpm run ai:source -- --no-build
pnpm run ai -- worktree add fix-123 --owner fix-123
```

`source --no-build` prepares the managed fork at `.vortex-src` without installing or building.
It does not search the filesystem. `worktree add` creates the worker checkout and, by default,
installs/builds it with its pinned toolchain. Reuse a suitable owned worktree where possible.
Keep short names on Windows. Read-only specialists do not need extra checkouts or app slots.

## Develop and exercise the change

```powershell
pnpm run ai -- up --owner fix-123 --worktree fix-123 --slot auto --sandbox
pnpm run ai -- down --owner fix-123 --worktree fix-123 --slot auto
pnpm run ai -- build --owner fix-123 --checkout <worktree-path>
pnpm run ai -- up --owner fix-123 --worktree fix-123 --slot auto --sandbox
```

Keep the same owner, checkout, slot and fixture flags. Stop the app before changing its
checkout or rebuilding output. Use Vortex's documented scoped non-writing checks while it
is live. Its own development/HMR workflow has separate lifecycle rules; do not overwrite
a live dev renderer with a production verify/build.

| Change                          | Supported iteration                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Vortex renderer or main process | Stop, guarded checkout build, restart; follow current Vortex development guidance                                  |
| Release-parity verification     | Guarded `build --production`, then `up --production`                                                               |
| Doodlebot extension             | One `pnpm run ai:watch -- --owner <owner> --slot auto` against an owned running app, under kit write authorization |

The doodlebot watcher observes doodlebot source only. It performs finite build/copy/reload
cycles and confirms a new renderer lifetime; other commands can run between cycles.
`pnpm run dev` is the same watcher, so do not run both. It does not rebuild Vortex.

For bugs, reproduce the original behavior and add an assertion that detects the claimed fix.
For features, define acceptance criteria and exercise behavior, wiring and relevant UI states.
For refactors, establish invariants and affected consumers. Use the
[workflow state matrix](../../../harness/WORKFLOWS.md#width-height-and-state-matrix) where relevant;
test width and height independently. Drive through the UI skill and observe the result
independently; a tool's success return alone is insufficient.

If an authorized task needs a missing kit capability, develop the reusable improvement under
the kit lock, test the affected contract and update its canonical instructions. Keep unverified
lessons in task reports until the cause and scope are checked and reviewed.

## Select verification by the affected contract

Vortex's scoped unit tests run from the owning project directory:

```powershell
Set-Location <worktree>/src/renderer
pnpm exec vitest run <test-path>
```

The root `test` script runs the whole nx graph. Full `pnpm run verify` is the final Vortex
submission gate; stop the app using that checkout first. Preserve failures and explain whether
they are regressions, known baseline failures or external blockers. Do not call a blocked gate
passed. E2E runs only when requested under Vortex's instructions.

Applicable `pr-preflight` discovers callers, changed-state readers and reducer dispatchers,
and can test selected reverts. Pass a named owner and explicit checkout. Its discovery is
heuristic; inspect indirect consumers and disposition warnings. A reverted test failure is
inconclusive until its intended assertion is inspected. `--revert-hunk <file>:<line>` can
isolate wiring in a file that also contains the new implementation. Use an appropriate
feature/refactor control rather than forcing every task into a bug-revert test.

For an existing PR, `pr-checks <pr>` reports exact-head checks and failed workflow steps;
a test failure and artifact post-processing failure are different evidence. Branch QA does
not require opening a PR first.

## Production submission and human responsibility

Follow [the submission gates](../../../harness/WORKFLOWS.md#before-a-vortex-pull-request-is-ready)
and [the PR/reviewer brief](../../../harness/PULL-REQUESTS.md). Run scoped checks and independent
QA before expensive final gates. UI/performance checks follow actual affected behavior;
performance evidence needs comparable production runs and spread. Requested E2E needs a
comparable baseline and complete outcome accounting.

The human author must understand the final diff and its risks. Respect current contribution
size/blast-radius guidance and obtain maintainer agreement for the work it reserves for
discussion. Never run local signed packaging or infer merge/release authority from a green
readiness report. Keep kit revision, Vortex source revision and runtime identity distinct.

Branch from the appropriate current Vortex base, not directly on `master`; `origin` is the
fork and `upstream` is Nexus-Mods/Vortex. Commit, push and PR publication follow the user's
actual authorization. Propagate existing permission accurately instead of asking again.

## Multiple tasks and operational details

Use one accountable owner per logical issue, selective specialists and fresh independent QA.
Parallel live workers need distinct owners/checkouts/slots; read-only readers can use the same
identified source and saved snapshots. Give every worker a full scope/evidence/cleanup brief.
Kit changes have one writer: lock, sync, edit, CI, commit, push, unlock. Renew the exact kit
acquisition before expiry.

Sandbox runs do not seed an API key; use account-free fixtures unless the task needs Nexus.
The account owner completes interactive login; private authorized caches can be reused.
Never put tokens into reports. `build --production` sets production mode for that build and
restores generated reports after the tracked child exits. A hard interruption requires
inspection before recovery.

Search the relevant [known pitfalls](../../../KNOWLEDGE.md), then check them against the
current source and observed data. A familiar symptom is not proof of its historical cause.
