---
name: vortex-dev
description: Fix a bug in Vortex, add a feature, or reproduce and test an application change. Covers source setup, the one-instance lifecycle, scoped verification and production submission evidence. Features and refactors start with the vortex-elephant skill. Use for Vortex application behavior; use the kit workflow for doodlebot itself.
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

## Features and refactors start with a design

A feature or refactor starts with the [vortex-elephant](../vortex-elephant/SKILL.md) skill:
an EGM design for target `vortex` at `harness/.artifacts/designs/<topic>.md`, its
confirmation round, and a person's approval of the exact text, before any implementation
code. Bug fixes, documentation and test-only changes need no design unless the user supplies
or asks for one. The approved design's acceptance criteria, contracts and file boundary then
govern implementation and readiness (schema 3). See
[the design section](../../../harness/WORKFLOWS.md#designing-a-change-before-coding-egm).

## Prepare the source checkout

When source provisioning is authorized:

```powershell
pnpm run ai:source -- --no-build
git -C .vortex-src fetch upstream
git -C .vortex-src switch -c fix-123 upstream/master
pnpm run ai:source
```

`source --no-build` prepares the managed fork at `.vortex-src` without installing or building.
It does not search the filesystem. Run again without `--no-build` on the branch, `source`
installs its dependencies and builds it with the checkout's pinned toolchain. Later
rebuilds use `pnpm run ai -- build --checkout .vortex-src`, which builds but never installs:
after a change to the checkout's dependencies, run `pnpm run ai:source` again. Work on a branch of `.vortex-src`, or in a checkout the user
names, passed as `--dev-dir <path>` (and `--checkout <path>` to `build`, `evidence`,
`pr-preflight` and `design scope`). Read-only specialists read the identified checkout and
start no Vortex.

## Develop and exercise the change

Only one harness Vortex runs at a time; launchers refuse while one is recorded in
`harness/.cache/instance.json`.

```powershell
pnpm run ai -- up --dev-dir .vortex-src --sandbox
pnpm run ai -- down
pnpm run ai -- build --checkout .vortex-src
pnpm run ai -- up --dev-dir .vortex-src --sandbox
```

Keep the same checkout and fixture flags on every command. Run `down` before changing the
checkout or rebuilding output; `build` refuses with "A harness Vortex is running from
<checkout> (pid N); run `pnpm run ai -- down` before building it." Use Vortex's documented
scoped non-writing checks while it is live. Its own development/HMR workflow has separate
lifecycle rules; do not overwrite a live dev renderer with a production verify/build.

| Change                          | Supported iteration                                                            |
| ------------------------------- | ------------------------------------------------------------------------------ |
| Vortex renderer or main process | `down`, checkout build, `up`; follow current Vortex development guidance       |
| Release-parity verification     | `build --production`, then `up --production`                                   |
| Doodlebot extension             | One `pnpm run ai:watch` against the running app, under kit write authorization |

The doodlebot watcher observes doodlebot source only. It performs finite build/copy/reload
cycles and confirms a new renderer lifetime; other commands can run between cycles. Do not
run it during tests: a reload can invalidate UI refs mid-action. `pnpm run dev` is the same
watcher, so do not run both, and do not run `build-extension` alongside it. It does not
rebuild Vortex.

For bugs, reproduce the original behavior and add an assertion that detects the claimed fix.
For features, take the acceptance criteria from the approved design and exercise behavior,
wiring and relevant UI states. For refactors, establish invariants and affected consumers.
Before handoff, `pnpm run ai -- design scope <design> --checkout <checkout> --base <sha>`
must report `IN SCOPE`. Use the
[workflow state matrix](../../../harness/WORKFLOWS.md#width-height-and-state-matrix) where relevant;
test width and height independently. Drive through the UI skill and observe the result
independently; a tool's success return alone is insufficient.

If an authorized task needs a missing kit capability, develop the reusable improvement in this
repository, test the affected contract and update its canonical instructions. Verified kit
lessons may be committed and pushed to `main` after `pnpm run ci` passes. Keep unverified
lessons in task reports until the cause and scope are checked and reviewed.

## Select verification by the affected contract

Vortex's scoped unit tests run from the owning project directory:

```powershell
Set-Location <checkout>/src/renderer
pnpm exec vitest run <test-path>
```

The root `test` script runs the whole nx graph. Full `pnpm run verify` is the final Vortex
submission gate; stop the app using that checkout first. Preserve failures and explain whether
they are regressions, known baseline failures or external blockers. Do not call a blocked gate
passed. E2E runs only when requested under Vortex's instructions.

Applicable `pr-preflight` discovers callers, changed-state readers and reducer dispatchers,
and can test selected reverts. Pass an explicit checkout; its revert check refuses while a
Vortex runs from that checkout, so run `down` first. Its discovery is
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

## Independent QA and operational details

Use one accountable agent per logical issue, selective read-only specialists and fresh
independent QA. Work through independent issues one at a time. Only one worker edits the
checkout or drives the app at a time; read-only readers use the identified source and saved
snapshots. Give every worker a full scope/evidence/cleanup brief.

Independent QA runs after the author has run `pnpm run ai -- down`, in a fresh context, on
the head under review. It starts with `up --fresh` (plus the task's target and fixture flags)
so it does not inherit the author's profile state. To move the checkout to a newer head,
follow [A reviewer runs only the head it reviews](../../../harness/WORKFLOWS.md#a-reviewer-runs-only-the-head-it-reviews).

Sandbox runs do not seed an API key; use account-free fixtures unless the task needs Nexus.
The account owner completes interactive login; private authorized caches can be reused.
Never put tokens into reports. `build --production` sets production mode for that build and
restores generated reports after the tracked child exits. A hard interruption requires
inspection before recovery.

Search the relevant [known pitfalls](../../../KNOWLEDGE.md), then check them against the
current source and observed data. A familiar symptom is not proof of its historical cause.
