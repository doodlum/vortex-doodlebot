# Developing and testing Vortex with AI

Use this kit for automated testing, reproducing and fixing bugs, implementing
features, comparing implementations to design documentation, and checking UI
behavior across window sizes and application states. Start with
[the agent workflow](AGENT-WORKFLOW.md) and [knowledge routes](KNOWLEDGE-ROUTES.md) for the
relevant operating manual, specialist sources, pitfalls and skills. Establish the user's
scope first; app development, publication and source mutation are distinct permissions.

## Vortex's own AI documentation is required reading

Before editing Vortex, read and follow the source checkout's `AGENTS.md` and
any applicable nested instructions. Read `CLAUDE.md` when present and follow its
references. Start at `docs/README.md` for the documentation index; do not assume
that this harness's notes supersede Vortex's current instructions.

The current source tree routes these tasks to:

| Task                              | Vortex reference, relative to its checkout                                   |
| --------------------------------- | ---------------------------------------------------------------------------- |
| Source layout and build setup     | `CONTRIBUTING.md`, `docs/repo-layout.md`                                     |
| React, UI, styling, accessibility | `docs/frontend.md`, `CODESTYLE.md`                                           |
| State changes and reducers        | `docs/state.md`                                                              |
| Regression and component tests    | `docs/testing.md`                                                            |
| Debugging and runtime diagnostics | `docs/DEBUGGING-GUIDE.md`                                                    |
| Design-system page work           | `docs/design-system/page-migration.md` and the supplied design specification |
| Collections and install flows     | `docs/mod-management/collections.md`                                         |
| Deployment and external changes   | `docs/mod-management/EXTERNAL-CHANGES.md`                                    |

Consult the checkout's index if paths move. Report missing design inputs or
contradictions explicitly; use the task's stated behavior as the acceptance
criteria. Do not silently replace a supplied design with a generic layout.

## Reproduce, change, verify

1. Identify the target: stock Vortex for an automation-tool issue; the source
   checkout for a Vortex application change. Record the version/commit, game,
   profile, current page, and relevant state.
2. Use the sandbox for local install/deploy/purge tests. Use an explicitly
   configured real game for game-specific behavior or game launch. Authentication
   is a setup concern; do not repeatedly ask for credentials while implementing.
3. Reproduce the symptom through MCP UI actions. Capture a before screenshot,
   a focused UI snapshot, relevant state, and renderer errors. Poll the specific
   outcome rather than sleeping for a guessed duration.
4. Add a regression assertion which fails for the original behavior. Put pure
   extension DOM tests in `src/uiAutomation.test.ts`, harness logic tests beside
   the implementation, Vortex code tests in the owning Vortex project, and real
   app workflows in `harness/src/tests/`.
5. Make the smallest complete change in the correct repository. Rebuild the
   relevant output. Renderer changes can be reloaded; main-process changes
   require a restart. Verify the new renderer lifetime before driving it.
6. Repeat the reproduction and assert the outcome independently: Playwright for
   rendered behavior, filesystem contents for deployment, a live game process
   for game launch. A tool returning success alone does not establish the result.
7. Run the repository's required checks and the relevant real-app tests. Record
   exactly which passed, failed, or were blocked, with artifact paths. Update the
   skill/manual when the workflow changed and add non-obvious findings to
   `KNOWLEDGE.md`.

If the kit cannot carry out a requested step, extend its reusable tools or
fixtures and cover that capability with tests. Do not leave a successful manual
experiment as the only way to reproduce a result. Preserve compatibility with
released Vortex; process control and CDP belong in the harness.

For exploring before that, `doodlebot script <file.mts>` runs a scratch script against the kit
under the instance lease, and `doodlebot eval --expr "<js>"` inspects a harness renderer (see
"Scratch scripts and renderer diagnostics" in AGENTS.md). Their results are leads; the check
that settles a question is the one added to the kit.

For an authorized A/B, use the same fixture and comparable build settings at base and head.
Stop the app before checkout switches or build output changes, then use guarded builds and
restart. Separate owned checkouts avoid switching a live user's demo. Do not temporarily
patch, revert or rebuild a checkout that the user has made read-only. Set zoom and focus
consistently when comparing rendered evidence.

Timing a change that affects rendering: compare against an in-build control that the change
does not touch. For the Mods table that is the classic layout. Another page is no control, since
the Mods page stays mounted while hidden (KNOWLEDGE.md).

## Before a Vortex pull request is ready

Prepare and review the branch before publication. Opening a draft or ready PR requires the
user's authorization, applicable evidence, addressed blocking findings and a final description.
A local readiness result means evidence complete for handoff; maintainers still decide whether
the change belongs upstream and is suitable to merge.

Read the current checkout's `CONTRIBUTING.md`, `AGENTS.md` and applicable ownership rules.
Keep one logical change. Get maintainer agreement before the large or multi-extension work
that its contribution policy reserves for discussion. The human submitter must understand
every line and be able to explain and support the final diff.

Select gates explicitly:

| Change or claim                                    | Evidence                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Every Vortex submission                            | Full `pnpm run verify` on the exact final commit, clean tree afterward, and independent diff/acceptance review        |
| Bug fix                                            | Intended regression assertion fails without the fix and passes with it; reproduce affected app behavior               |
| Feature                                            | Acceptance/consumer tests and absent-behavior or wiring evidence; app checks for affected runtime behavior            |
| Equivalence refactor                               | Invariants and affected consumers, including failure/cancellation paths; app checks where runtime behavior can change |
| Documentation                                      | Factual, link and command checks; no unrelated app or performance scenario                                            |
| UI or interaction                                  | Relevant states, width/height and input modes, plus inspected before/after evidence; clips when motion matters        |
| Performance claim or affected performance contract | Comparable production base/head, idle machine, at least three runs per side, spread and a meaningful workload         |
| Upstream E2E explicitly requested                  | Comparable baseline/head reports with complete selection and classified outcomes                                      |

Mark inapplicable checks with a reason grounded in the actual diff. A required gate blocked by
authorization, credentials, services or tooling remains blocked; do not disguise it as N/A.
For rendering, scrolling and input changes, inspect responsiveness risk. Where relevant,
measure frame gaps, long tasks and the affected real interactions; a UI fix that introduces
visible lag is incomplete. Report build mode and runtime evidence with measurements.

Run scoped checks and applicable `pr-preflight` first, then independent QA. Branch QA does
not require a PR. After findings are resolved, run expensive final gates. Stop an app using
the checkout before verify or any check that rewrites its output. Use the checkout's scoped
non-writing checks while it is live.

Vortex's own instructions say E2E runs only when asked. When requested, use
`pnpm run ai:vortex-e2e -- --owner <you> --checkout <dir>` for the baseline, then the
head with `--compare <baseline-report.json>`. This runner temporarily patches fixtures and
therefore needs source-mutation authorization. Preserve each first outcome and report
regressions, existing failures, skipped/missing tests, changed failure causes and execution
conditions separately. Missing credentials and an all-skipped run cannot establish coverage.
The kit's account-free core suite and upstream E2E prove different contracts.

Use [PULL-REQUESTS.md](PULL-REQUESTS.md) for the description and fresh-review brief. Each claim
links to the corresponding evidence and revision. The prepared description ends with the
doodlebot footer; `pr-preflight --pr <number>` checks an existing PR's metadata. New lessons
follow the verification and promotion policy in AGENT-WORKFLOW.md.

## Several agents at once: each looks after itself

Follow [AGENT-WORKFLOW.md](AGENT-WORKFLOW.md) for task routing, worker briefs, authorization,
independent QA and handoff. Each issue has an accountable owner; unrelated issues remain
independent. A parent can coordinate scoped workers within its issue. There is no global
scheduler. Named owner leases and full-duration operation guards protect supported commands:

| Shared thing                                   | Guard                                              |
| ---------------------------------------------- | -------------------------------------------------- |
| A Vortex instance (cache, ports)               | its slot's instance lease (`--slot auto`)          |
| A Vortex checkout                              | `checkout:<dir>`, held while a Vortex runs from it |
| This repo: KNOWLEDGE.md, skills, harness, docs | **the kit lock** (`kit lock` … `kit push`, below)  |
| Vortex's own E2E suite                         | the `vortex-e2e` lease                             |

First establish whether reported symptoms share a cause. Independent logical issues get
separate owners and contexts. Within one issue, delegate distinct questions or contracts using
the canonical brief and PULL-REQUESTS.md supplements. Only workers that edit or drive need
isolated checkout/app resources; read-only specialists use the identified source and saved evidence.

### Changing the kit: take the kit lock

Verified reusable improvements follow AGENT-WORKFLOW.md. The kit is one working tree and
one `main`, so only one session changes it at a time:

```powershell
pnpm run ai -- kit lock --owner <you> --wait 30   # waits while another session holds it
pnpm run ai -- kit sync --owner <you>             # switch to main, fast-forward to origin/main
# edit KNOWLEDGE.md, a skill, the harness or the docs; pnpm run ci; git commit
pnpm run ai -- kit push --owner <you>             # refuses publication if rebase changes checked HEAD
pnpm run ai -- kit unlock --owner <you> --acquisition <original-id>
```

- Take the lock **before the first edit**, not just to push: an edit in the shared working tree is
  visible to every other session at once. Keep the window short: note lessons as you work, then
  apply them together under one lock.
- `kit push` refuses without the lock, with uncommitted changes, or off `main`. The lock lapses after
  30 minutes unless conditionally renewed. `kit status --json` shows the acquisition identity;
  `kit renew --owner <you> --acquisition <id> --ttl 30` renews that exact live acquisition.
  Expiry/replacement stops further mutations; inspect edits and surviving subprocesses before
  recovery. Git operations heartbeat and recheck ownership before each subsequent command.
  If rebase changes the proposed head, push stops before publication; recheck the resulting
  revision and retry. It does not silently publish a different revision than the one checked.
- Do not unlock a dirty kit or edit it from a subagent without the writer baton under the lock.
  If commit/publication is outside the brief, preserve the identified diff and explicitly hand
  off the changes, acquisition/expiry and cleanup responsibility to the accountable owner;
  do not commit merely to satisfy the lock procedure. Candidate lessons go to that owner for
  verification and authorized integration.

### Running writers and app drivers in parallel

Several agents can drive Vortex at once, each on its own project, as long as none shares a checkout,
a cache or a port with another (harness/AGENTS.md, "Parallel sessions"):

```powershell
pnpm run ai -- worktree add fix-24290 --owner fix-24290 --base upstream/master
pnpm run ai -- up --owner fix-24290 --worktree fix-24290 --slot auto --bethesda-sandbox
pnpm run ai -- screenshot --owner fix-24290 --slot auto --label repro
pnpm run ai -- down --owner fix-24290 --slot auto
```

- **A worktree per concurrent Vortex writer/app driver** (`.vortex-worktrees/<name>`): its own
  branch, `node_modules` and build. Read-only specialists use the identified checkout.
  A Vortex running from it locks it (`checkout:<dir>`), so nobody rebuilds it underneath. Nobody
  works in `.vortex-src` itself; it is the managed base the worktrees come from.
- **A slot per app-driving worker** (`--slot auto` with its owner name, or `VORTEX_AI_SLOT=auto` and
  `VORTEX_AI_OWNER` in its environment): its own cache, artifacts, MCP and CDP ports and instance
  lease. The owner keeps the same slot, with its warm profile, across commands. `doodlebot slots`
  shows who has which.
- `pnpm run verify`, `vortex-e2e` and `ai:test` run in the agent's own worktree and slot. Two
  `vortex-e2e` runs never overlap: they share an operation guard. A refused root invocation
  can be retried after the other run ends; nested operations never wait while holding resources.
- **Timing needs a quiet machine.** Other instances compete for CPU, so a measurement taken while
  other sessions build or drive Vortex is noise. Before timing, check `doodlebot slots` and wait
  until no other instance is running; say in the PR what else was running, if anything.
- **Keep your windows off the user's screen when you can.** Keep your instance down when idle, and
  capture with as few setting or layout switches as possible (each can flash the window).
- Each worktree installs its own dependencies (a few minutes and a few GB), and Windows path
  limits still apply, so keep worktree names short. Remove a finished one with
  `worktree remove <name> --owner <owner>`; its branch stays.

A refusal before a guarded operation starts prevents its mutation. A failure after work starts
may require inspection and cleanup. Retry only after releasing partial holds; never release
another owner's lease or pass an operation UUID as the owner. Use `--wait` only on commands
that document it.

### Review starts when the design is settled

While the user is still shaping a change (choosing between variants, asking for new ones), the work
isn't ready for QA. Don't start or keep a reviewer on it: every new direction makes its findings
stale, and its Vortex is one more window on the user's screen. Iterate, let the user try a demo, and
start QA only when the user says the design is settled (or the change has no design questions).
Pause a running reviewer as soon as the direction changes.

### A reviewer runs only the head it reviews

A reviewer that keeps a Vortex up on an older head, while the author works on a newer one, puts a
window with an outdated design on the user's screen, and it looks like the author's work went wrong.
Review the head you were given. When a new one is pushed, `down`, move your worktree to it
(`worktree add <name> --ref origin/<branch>` makes a detached one), and only then `up` again.

### A build for the user to try gets its own worktree

When the user wants to try a branch, don't run their Vortex from the author's worktree. It locks the
checkout, so the author can't rebuild it, and `pr-preflight`'s revert check is refused. Make one for
them: `worktree add demo-<topic> --owner user-demo --ref origin/<branch>`, `up --owner user-demo --worktree
demo-<topic> --slot auto`. Leave it running until they're done. To show them a new head, `down`,
`git -C <demo worktree> checkout --detach <sha>`, rebuild, and `up` again.

### Revisiting closed PRs: the doodlebot queue

When the user requests revisiting closed PRs, track one issue per fresh context. A closed PR
or absent fork draft alone does not prove that nobody has reviewed it. Read the PR, its diff and its thread, **and the linked Linear issue's
comments**, where maintainers often give the reason for closing and the GitHub thread stays empty.
Check whether the problem still exists on current upstream/master, then either redo the fix on a
fresh branch (cherry-picking the old one where it still applies, and addressing the feedback), or
write down why no draft is needed. Both outcomes close the queue entry.
`gh pr view <n> --json title,body,comments,reviews,state,closedAt` is more reliable than
`--comments`.

## Implementing a feature from a design

Translate the supplied design into explicit acceptance criteria before changing
code: information hierarchy, spacing, typography, control behavior, empty/error
states, keyboard access, overflow rules, and resize behavior. Reference the
specific design page or section in the test or verification notes.

Build on Vortex's existing components and conventions from `docs/frontend.md`
and its design-system guidance. Capture the implementation at the design's
reference size and at neighboring sizes. Compare screenshots visually as well
as checking DOM/state behavior. Structural layout heuristics cannot verify
typography, icon choice, color, or fidelity to a reference image.

## Width, height, and state matrix

Resize both dimensions. A list that works at a narrow width may still hide its
footer in a short window. Run the same width at different heights to expose
vertical clipping; run the same height at different widths to expose wrapping.
Record the actual window and renderer sizes because the OS may clamp requests.

```powershell
pnpm run ai -- responsive --screenshots --viewports "1024x720,1280x720,1280x1000,1920x1080"
```

Run a sweep in each relevant state, using a distinct `--label` for artifacts:

| State                             | What to verify                                   |
| --------------------------------- | ------------------------------------------------ |
| Empty list / first run            | Setup guidance and primary action remain visible |
| Populated or virtualized list     | Filtering, scrolling, selection, row actions     |
| Thousands of mods                 | `ai:test:large-library`, `ai:test:mods-scroll`   |
| Long names or localized text      | Wrapping, truncation, accessible names           |
| Selection / expanded details      | Actions stay reachable; focus remains useful     |
| Modal / stacked modal / installer | Dialog scope, scrollable body, footer actions    |
| Loading / disabled / failure      | Progress, retry, cancellation, useful errors     |
| Signed out / authenticated        | Correct setup affordances without repeated login |

For repeatable state setup, use documented Redux actions/events via
`vortex_dispatch` and verify the resulting state. Use the UI when a private
dialog callback is only reachable through controls. Avoid editing Vortex's
database or depending on a production user's mods. Put recurring scenarios in
Playwright tests with explicit fixtures and cleanup.

Layout scan findings are candidates for review, not automatic proof of a bug.
An intentional scroll container or small icon can be flagged at every size;
an issue found only at one size still needs visual confirmation. Preserve the
original window size on success and failure.

## Verification boundaries

`pnpm run ci` checks this kit without launching Vortex. `pnpm run ai:test`
launches a real app with an isolated profile and disposable sandbox game. Neither
proves an authenticated Nexus collection downloads or a purchased game launches;
those require the additional setup and explicit collection/game scenario.

When working in a Vortex worktree, follow its own verification instructions. In
particular, do not overwrite a live development renderer with a production
verification build; use its documented checks and stop/restart the development
session when appropriate. Do not commit, push, or open a PR unless asked.
