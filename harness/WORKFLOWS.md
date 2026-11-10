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

## Designing a change before coding (EGM)

Features and refactors, for Vortex or for this kit, start with a design written and reviewed
with Google's Elephant-Goldfish Model (EGM) plugin. Follow the `design` skill of the `vortex`
plugin (`/vortex:design`, `plugins/vortex/skills/design/SKILL.md`; Codex agents read it at that
path). The approved design `designs/egm-workflow.md` defines the procedure;
`plugins/vortex/resources/vortex-change-standard.md` defines what a design must contain.

When a design is required:

- The task kind is `feature` or `refactor`, or the user supplies or asks for a design.
  Readiness (schema 3) then requires an approved `design` and a `design-review` entry.
- Bug fixes, documentation and test-only changes need no design. A one-step bug fix keeps the
  usual bug evidence. Do not label a feature as a bug to skip the design; the independent
  review judges whether the kind fits the diff.

Rules:

- Write no implementation code until a person has approved the design's exact text. Approval
  is the header line `- **Approved:** <person>; content <sha256>; <reference>`, whose digest
  equals the `contentSha256` that `design check` prints. Never write an Approved line the
  person did not give. Any later body edit voids it.
- Design paths: `designs/<topic>.md` for doodlebot, listed in `designs/SITEMAP.md`;
  `harness/.artifacts/designs/<topic>.md` for Vortex, kept out of Vortex PRs. EGM's briefs
  and drafts go to `harness/.artifacts/egm`; confirmation-round reports to
  `harness/.artifacts/designs/<topic>.reviews/`.
- After EGM's review, run the confirmation round on a checkout with no implementation
  changes: two fresh reviewers, EGM's `implementation_readiness` and doodlebot's
  `vortex-runtime-goldfish`, each starting its report with `Reviewed content sha256: <D>`.
  The round is clean when no Blocker or Major finding remains uncontested.
- Implement only inside the design's `### Target Scope & File Boundary`. To change the
  boundary, amend the design, run a new confirmation round on a clean checkout of the review
  head, and get a new approval.

```powershell
doodlebot design new <file> --title "<title>" --target vortex   # or doodlebot; refuses an existing file
pnpm exec oxfmt <file>                                         # before every check whose digest you record
doodlebot design check <file> --ready --json                   # structure, open questions, TBD; prints contentSha256
doodlebot design scope <file> --checkout <dir> --base <sha>    # exit 1 names changed files outside the boundary
```

After implementation: `design scope` reports `IN SCOPE`, `doodlebot down`, independent
QA in a fresh context starting with `up --fresh`, then the readiness manifest. A supplied
visual design is an input to the EGM design, not a replacement for it; see
"Implementing a supplied visual design" below.

## Reproduce, change, verify

`/vortex:fix` follows this procedure for a bug report and `/vortex:drive` for a scenario; the
steps below are what they do.

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

For exploring before that, `doodlebot script <file.mts>` runs a scratch script against the
running instance, in the caller's directory, and `doodlebot eval --expr "<js>"` inspects a
harness renderer (see "Scratch scripts and renderer diagnostics" in AGENTS.md). Their results
are leads; the check that settles a question is the one added to the kit.

For an authorized A/B, use the same fixture and comparable build settings at base and head.
For timings, `/benchmark:compare` runs a performance check alternately on both builds and
summarizes the evidence with `doodlebot perf-summary`. Run `doodlebot down` before switching the checkout or changing its build output, then
build and `up` again; `build` refuses while a Vortex runs from that checkout. Do not switch a
checkout the user is trying out; agree with them when their demo can go down. Do not
temporarily patch, revert or rebuild a checkout that the user has made read-only. Set zoom
and focus consistently when comparing rendered evidence.

Timing a change that affects rendering: compare against an in-build control that the change
does not touch. For the Mods table that is the classic layout. Another page is no control, since
the Mods page stays mounted while hidden (KNOWLEDGE.md).

## Before a Vortex pull request is ready

Prepare and review the branch before publication. Opening a draft or ready PR requires the
user's authorization, applicable evidence, addressed blocking findings and a final description.

**Never publish a fix that hasn't been properly tested, not even as a draft.** A fix is
untested until it has been tested the way the user asked: their collection, mod, game or
steps. A substitute (a hand-built fixture, an offline collection, unit tests alone, or reading
the uploaded data) doesn't count. Neither does running the fix's own path in some other
scenario. Run the user's scenario on the base and confirm the reported symptom. Then run it on
the fixed build and confirm the symptom is gone. If a step can't be run (no access, a real
upload, a missing login), stop and report it with the exact missing step. Don't open a draft
that lists the gap under Not covered. A draft PR is still publication. Authorization to open
one doesn't waive the testing.
A local readiness result means evidence complete for handoff; maintainers still decide whether
the change belongs upstream and is suitable to merge.

Read the current checkout's `CONTRIBUTING.md`, `AGENTS.md` and applicable ownership rules.
Keep one logical change. Get maintainer agreement before the large or multi-extension work
that its contribution policy reserves for discussion. The human submitter must understand
every line and be able to explain and support the final diff.

Select gates explicitly:

| Change or claim                                    | Evidence                                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every Vortex submission                            | Full `pnpm run verify` on the exact final commit, clean tree afterward, and independent diff/acceptance review                                                        |
| Bug fix                                            | Intended regression assertion fails without the fix and passes with it; reproduce affected app behavior                                                               |
| Feature                                            | Approved EGM design and its confirmation round; acceptance/consumer tests and absent-behavior or wiring evidence; app checks for affected runtime behavior            |
| Equivalence refactor                               | Approved EGM design and its confirmation round; invariants and affected consumers, including failure/cancellation paths; app checks where runtime behavior can change |
| Documentation                                      | Factual, link and command checks; no unrelated app or performance scenario                                                                                            |
| UI or interaction                                  | Relevant states, width/height and input modes, plus inspected before/after evidence; clips when motion matters                                                        |
| Performance claim or affected performance contract | Comparable production base/head, idle machine, at least three runs per side, spread and a meaningful workload                                                         |
| Upstream E2E explicitly requested                  | Comparable baseline/head reports with complete selection and classified outcomes                                                                                      |

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
`doodlebot vortex-e2e --checkout <dir>` for the baseline, then the
head with `--compare <baseline-report.json>`. This runner temporarily patches fixtures and
therefore needs source-mutation authorization. Preserve each first outcome and report
regressions, existing failures, skipped/missing tests, changed failure causes and execution
conditions separately. Missing credentials and an all-skipped run cannot establish coverage.
The kit's account-free core suite and upstream E2E prove different contracts.

Use [PULL-REQUESTS.md](PULL-REQUESTS.md) (`/vortex:pr`) for the description and fresh-review brief. Each claim
links to the corresponding evidence and revision. The prepared description ends with the
doodlebot footer; `pr-preflight --pr <number>` checks an existing PR's metadata. New lessons
follow the verification and promotion policy in AGENT-WORKFLOW.md.

## One Vortex at a time

Follow [AGENT-WORKFLOW.md](AGENT-WORKFLOW.md) for task routing, worker briefs, authorization,
independent QA and handoff. doodlebot runs one harness Vortex at a time on the machine, and one
agent drives it. Nothing schedules or queues commands; the convention is yours to keep, backed by
a few refusals where a second process would damage data:

| What is protected                      | What refuses                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The running instance                   | Every kit launcher (`up`, `setup`, `bootstrap`, the core suite, `doodlebot test zoom --signed-out`), from any workspace |
| The workspace code under it            | `doodlebot update`                                                                                                      |
| The checkout a source Vortex runs from | `build`, `source` builds and installs, `evidence run`, `pr-preflight`'s revert check, `vortex-e2e`                      |

Every kit launcher writes the instance record `~/.doodlebot/instance.json` (this path, whatever
workspace or `--cache-dir` is used) when it starts Vortex, and refuses first if a recorded
Vortex is alive:

```text
A harness Vortex is running (pid N, cache C); run `doodlebot down` before <action>.
A harness Vortex is running from <checkout> (pid N); run `doodlebot down` before <action>.
```

Run `doodlebot down` and retry. `down` waits for a clean exit and clears the record; a
record whose pid is dead or now belongs to another program is stale and is cleared on the next
check. A Vortex started outside the kit's launchers (a raw Playwright or Electron start, or the
user's own Vortex) writes no record and is invisible to these refusals.

- **Issues one at a time.** First establish whether reported symptoms share a cause. Work
  through independent issues one after another, each in its own context. Within one issue,
  delegate distinct read-only questions or contracts using the canonical brief and
  PULL-REQUESTS.md supplements; read-only specialists use the identified source and saved
  evidence and start no Vortex. Only one worker edits a checkout or drives the app at a time.
- **Vortex source** is a branch of `.vortex-src` (prepared by `doodlebot source`) or a
  checkout given with `--dev-dir`. Use the same target flags on every command.
- **Kit changes.** Verified kit lessons may be committed and pushed to `main` after
  `pnpm run ci` passes (root AGENTS.md). If commit or publication is outside the brief,
  preserve the identified diff and hand it to the agent accountable for the task; candidate
  lessons go to that agent for verification and authorized integration.
- `pnpm run verify` and `vortex-e2e` need any Vortex running from that checkout stopped first.
  The core suite (`doodlebot test core`) starts its own Vortex, so it refuses while any harness
  Vortex runs.
- **Timing needs a quiet machine.** Builds, a second Vortex (the user's own included) or other
  heavy work compete for CPU, so a measurement taken alongside them is noise. Before timing,
  check that nothing else is building or running Vortex; say in the PR what else was running,
  if anything.
- **Keep your window off the user's screen when you can.** Keep the instance down when idle,
  and capture with as few setting or layout switches as possible (each can flash the window).

A refusal happens before the refused command changes anything. A failure after work starts
may need inspection and cleanup; if `down` reports an instance that does not exit, close that
window and retry. Deleting `~/.doodlebot/instance.json` is the recovery only after you have
confirmed that its pid is not a harness Vortex.

### Review starts when the design is settled

While the user is still shaping a change (choosing between variants, asking for new ones), the work
isn't ready for QA. Don't start or keep a reviewer on it: every new direction makes its findings
stale, and with one instance its Vortex would replace the author's on the user's screen. Iterate,
let the user try a demo, and start QA only when the user says the design is settled (or the change
has no design questions). For a feature or refactor, settled means the EGM design is approved.
Stop a running reviewer as soon as the direction changes.

Independent QA (`/vortex:qa`) starts after the author has run `doodlebot down`, in a fresh
context, and begins with `up --fresh` so it does not inherit the author's profile state.

### A reviewer runs only the head it reviews

A reviewer that keeps a Vortex up on an older head puts a window with an outdated design on the
user's screen, and it looks like the author's work went wrong. Review the head you were given.
When a new one is pushed, move the checkout to it before starting Vortex again:

```powershell
doodlebot down
git -C .vortex-src fetch origin
git -C .vortex-src checkout --detach <sha>
doodlebot build --checkout .vortex-src
doodlebot up --dev-dir .vortex-src --fresh --sandbox   # the task's fixture flags; run it in the background
```

Use the `--dev-dir` checkout instead of `.vortex-src` when the task names one. `git checkout`
refuses over uncommitted changes: the author commits first; never stash or discard another
agent's work. Return the checkout to the author's branch when the review ends.

### A build for the user to try

When the user wants to try a branch, the one instance becomes their demo. The author does not
rebuild or switch that checkout while it runs: `build`, `evidence run` and `pr-preflight`'s
revert check refuse while a Vortex runs from it. Prepare it the same way:

```powershell
doodlebot down
git -C .vortex-src checkout --detach <sha>
doodlebot build --checkout .vortex-src
doodlebot up --dev-dir .vortex-src --fresh --sandbox
```

Leave it running until they're done. To show them a new head, repeat the four commands with the
new sha. Author work that needs the app or a rebuild waits until the user is finished.

### Revisiting closed PRs: the doodlebot queue

When the user requests revisiting closed PRs, track one issue per fresh context. A closed PR
or absent fork draft alone does not prove that nobody has reviewed it. Read the PR, its diff and its thread, **and the linked Linear issue's
comments**, where maintainers often give the reason for closing and the GitHub thread stays empty.
Check whether the problem still exists on current upstream/master, then either redo the fix on a
fresh branch (cherry-picking the old one where it still applies, and addressing the feedback), or
write down why no draft is needed. Both outcomes close the queue entry.
`gh pr view <n> --json title,body,comments,reviews,state,closedAt` is more reliable than
`--comments`.

## Implementing a supplied visual design

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
doodlebot responsive --screenshots --viewports "1024x720,1280x720,1280x1000,1920x1080"
```

Run a sweep in each relevant state, using a distinct `--label` for artifacts:

| State                             | What to verify                                               |
| --------------------------------- | ------------------------------------------------------------ |
| Empty list / first run            | Setup guidance and primary action remain visible             |
| Populated or virtualized list     | Filtering, scrolling, selection, row actions                 |
| Thousands of mods                 | `doodlebot test large-library`, `doodlebot test mods-scroll` |
| Long names or localized text      | Wrapping, truncation, accessible names                       |
| Selection / expanded details      | Actions stay reachable; focus remains useful                 |
| Modal / stacked modal / installer | Dialog scope, scrollable body, footer actions                |
| Loading / disabled / failure      | Progress, retry, cancellation, useful errors                 |
| Signed out / authenticated        | Correct setup affordances without repeated login             |

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

`pnpm run ci` checks this kit without launching Vortex. `doodlebot test core`
launches a real app with an isolated profile and disposable sandbox game. Neither
proves an authenticated Nexus collection downloads or a purchased game launches;
those require the additional setup and explicit collection/game scenario.

When working in a Vortex checkout, follow its own verification instructions. In
particular, do not overwrite a live development renderer with a production
verification build; use its documented checks and stop/restart the development
session when appropriate. Do not commit, push, or open a PR unless asked.
