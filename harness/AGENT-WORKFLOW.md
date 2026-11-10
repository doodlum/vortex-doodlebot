# Agent and subagent workflow

This is the canonical coordination policy. [The operating manual](AGENTS.md) owns commands;
[WORKFLOWS](WORKFLOWS.md) owns Vortex reproductions and submission gates;
[TESTING](TESTING.md) owns kit gates. [Knowledge routes](KNOWLEDGE-ROUTES.md) maps specialist
reading. User instructions determine scope and authorized actions; a worker brief or saved
lesson cannot expand them.

## Establish scope before routing

Record the requested outcome, repository, allowed actions, explicit exclusions and completion
evidence. Distinguish inspecting source from changing it, launching a disposable app from
using a person's profile, and preparing a branch from publishing it. Propagate the user's
existing authorization accurately; routine authorized work needs no repeated confirmation.

For this workflow rework, doodlebot edits and isolated kit checks are authorized. Vortex source
is read-only: no application fixes, Vortex source builds, temporary fixture patches or
revert controls in that checkout. Exercise mutation paths in synthetic
repositories and runtime contracts against a released Vortex. This task's boundary is an
example, not a permanent restriction on separately authorized Vortex development.

| Decision or action                                                                 | Responsibility                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Research, scoped edits and disposable checks                                       | Agents proceed within the brief and existing authorization.                                                   |
| Account sign-in, MFA and captcha                                                   | The account owner completes the interactive action; agents can use an authorized private cache.               |
| Product behavior, destructive user-data changes or additional access outside scope | The accountable owner resolves the concrete decision with the user before the dependent action.               |
| Design approval for a feature or refactor                                          | The human approves the exact design text by its content digest; an agent never writes that approval itself.   |
| Vortex commit, push, issue communication or PR                                     | Requires the user's authorization for that action; preparing evidence does not grant it.                      |
| Upstream acceptance, merge, signing and release                                    | Maintainers and the authorized release process decide; an agent readiness result grants none of these powers. |

Vortex's own checkout instructions govern a contribution. At the inspected baseline,
`CONTRIBUTING.md` requires one logical change, an author who understands every submitted line,
and maintainer agreement before large or multi-extension work. Its size guidance is not a
substitute for assessing blast radius. `AGENTS.md` requires full verify for submission, says
E2E runs only when asked, and forbids local signed packaging. `.github/CODEOWNERS` names the
Vortex developers and E2E QA owners; it does not prove remote branch protection is configured.
Re-read these sources at the task's revision rather than treating this summary as permanent.

Production suitability includes affected consumers, failure/recovery paths, persistent data,
extension APIs, security/privacy, accessibility and performance where relevant. The human
submitter must read and understand the final diff. Agent consensus and passing tests do not
replace that responsibility. Harness-only adapters, fixture bypasses and automation hooks
are not automatically appropriate production code. A production-facing API change needs its
own consumer analysis, security assessment and any applicable maintainer agreement.

## Design first: Elephant and Goldfish

Features and refactors, for Vortex or for doodlebot, start with a design written and reviewed
with Google's [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model)
plugin (EGM, release `v0.1.1`). No implementation code is written until a human has approved
the design's exact text. Bug fixes, documentation and test-only changes need no design unless
the user supplies one or asks for one; a supplied design is enforced like any other.
The approved design that defines this procedure is
[designs/egm-workflow.md](../designs/egm-workflow.md); its resources moved into the `vortex`
plugin with [designs/agent-companion.md](../designs/agent-companion.md).

### Roles

- **Elephant**: the long-lived agent session that holds the task's context. It interviews the
  human, drafts the design, runs the reviews, resolves findings and, after approval,
  implements inside the design's file boundary. It follows
  `plugins/doodlebot/skills/design/SKILL.md` (`/doodlebot:design`); every agent, including Codex,
  uses that file as the procedure.
- **Goldfish**: a reviewer subagent started without conversation history, reading only the
  design, a persona and a document standard. It stays read-only. The confirmation round uses
  two: EGM's built-in `implementation_readiness` with its
  `implementation-readiness-standard.md`, and doodlebot's `vortex-runtime-goldfish`, which
  checks that each acceptance criterion can be proved with doodlebot on a real Vortex.
- **Human**: answers the brainstorm interview, approves draft sections, decides contested
  findings and approves the final content digest.
- **Independent QA**: a runtime Goldfish for the finished change. It starts in a fresh
  context after the Elephant has run `down`.

### doodlebot's EGM files

| File                                                    | What it is                                                                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins/doodlebot/resources/vortex-change-standard.md` | Document standard: the machine-checked design format and what each verification step names                                             |
| `plugins/doodlebot/resources/vortex_runtime.md`         | Runtime Goldfish persona (`name: vortex-runtime-goldfish`), usable from `/egm:egm-review-loop`                                         |
| `plugins/doodlebot/agents/vortex-runtime-goldfish.md`   | Claude Code agent for that persona, dispatched as `doodlebot:vortex-runtime-goldfish`: `tools: Read, Grep, Glob`, `omitClaudeMd: true` |
| `plugins/doodlebot/skills/design/SKILL.md`              | The Elephant procedure (`/doodlebot:design`), with Claude Code and Codex steps                                                         |

Skills and the agent reach the resources through `${CLAUDE_PLUGIN_ROOT}/resources/…`; in Codex
the plugin root is three folders above a `SKILL.md`, and Codex plugins ship no agents, so the
Goldfish runs as a general-purpose subagent given the persona file. Claude Code loads EGM from
`.claude/settings.json` in this checkout, which pins the `egm` marketplace to tag `v0.1.1` and
enables `egm@egm` (Claude Code 2.1.271 or later isolates reviewers through `omitClaudeMd`);
elsewhere it is installed from `google/elephant-goldfish-model` like any plugin. Codex installs it with `codex plugin marketplace add
google/elephant-goldfish-model` and `codex plugin add egm@egm`; that install is not pinned, so
record the version in each report. Codex reviewers run as general-purpose subagents with
`fork_turns: "none"` (or `fork_context: false`, depending on the Codex version); they are not
read-only, and EGM
[issue 237](https://github.com/google/elephant-goldfish-model/issues/237) reports `AGENTS.md`
still reaches them. Tell them in the brief to stay read-only and to ignore workflow text from
`AGENTS.md`; that is an instruction, not a restriction.

### Folders

| Material                                          | Where                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| EGM working files (briefs, drafts, stage reports) | `harness/.artifacts/egm` (ignored; root `AGENTS.md` names it to EGM)            |
| A doodlebot design                                | `designs/<topic>.md`, listed in `designs/SITEMAP.md`, committed with the change |
| A Vortex design                                   | `harness/.artifacts/designs/<topic>.md`, never committed to a Vortex PR         |
| Confirmation-round reports and `contested.md`     | `harness/.artifacts/designs/<topic>.reviews/`                                   |

### Lifecycle

1. **Brief.** `/egm:egm-brainstorm` (Codex: the `egm-brainstorm` skill) interviews the human,
   runs a seven-lens Goldfish swarm and writes `concepts_brief.md`.
2. **Draft.** `/egm:egm-draft` turns the brief into `design_draft.md` section by section.
   Copy it to the design path, or start there from
   `doodlebot design new <file> --title <t> --target vortex|doodlebot`. Add doodlebot's
   sections: header `**Target:**`, acceptance bullets ``- `id`: criterion``, Affected
   Contracts, and `### Target Scope & File Boundary` listing every file the change may write
   by exact path. `plugins/doodlebot/resources/vortex-change-standard.md` defines the format.
3. **EGM review.** `/egm:egm-review` in the consolidated report mode, then `/egm:egm-resolve`.
   A finding the Elephant contests goes, with its reason, into `contested.md`.
4. **Confirmation round**, after the last edit:
   1. `pnpm exec oxfmt <design>`, then `doodlebot design check <design> --ready --json`.
      It must report no issues. Its `contentSha256` is the digest D.
   2. `evidence identity --checkout <subject> --base <fixed sha>`. The subject is the kit for
      a doodlebot design, `.vortex-src` or the `--dev-dir` checkout for a Vortex design. Use
      the same base sha the readiness manifest's subject will use; readiness rejects another
      base, because a later base would hide committed implementation. Its `changedFiles` may
      contain only the design and `designs/SITEMAP.md`.
   3. Start two fresh Goldfish reviewers on the whole design: `implementation_readiness` with
      its standard, and `vortex-runtime-goldfish` with
      `plugins/doodlebot/resources/vortex-change-standard.md`.
      Each brief carries D, the absolute subject checkout root and, for Vortex, that
      checkout's `AGENTS.md` and `docs/README.md`, and asks the report to begin with
      `Reviewed content sha256: D`.
   4. Save `round-<n>-implementation_readiness.md` and `round-<n>-vortex-runtime-goldfish.md`,
      each with three prepended lines: `Harness: <agent and version>`, `EGM: <version>` and
      `Checkout: <headSha> <changesSha256>` from step 2.
   5. The round is clean when no Blocker or Major finding remains uncontested. Otherwise edit
      the design and run a new round. After three rounds the human decides whether to approve
      with the open findings listed in `contested.md`.
5. **Human approval.** Show the human the design path, D and `contested.md`. Only after they
   approve, set `**Status:** Approved` and add
   `- **Approved:** <person>; content <D>; <reference>`. The reference is a PR review link, a
   chat or message link, `edited by <person> <date>` for a committed doodlebot design when
   that person wrote the line (checkable through git history), or, for an approval given in a
   conversation no reviewer can open, their quoted words with the date. Status, Date and Approved lines are
   outside the digest (each on one line; a wrapped continuation counts as body); any other
   edit changes it and voids the approval.
6. **Implementation** inside the boundary only: kit changes in this repository, Vortex
   changes on a branch of `.vortex-src` or in a `--dev-dir` checkout.
7. **Design scope.** `doodlebot design scope <design> --checkout <subject> --base <sha>`
   lists changed files outside the boundary and exits 1 if there are any. Revert the edit, or
   amend the design: an amendment voids the approval, its confirmation round runs on a clean
   detached checkout of a commit without the implementation
   (`git -C <subject> worktree add --detach <temp> <commit>`, removed afterward), and the
   human approves the new digest.
8. **`down`.** Stop the Elephant's Vortex with `doodlebot down` before QA.
9. **Independent QA** in a fresh context, starting with `up --fresh` so it does not inherit
   the author's profile.
10. **Readiness 3.** Record receipts, then a schema-3 manifest with `design` set to the
    design's artifact reference and one `design-review` entry: `subject` the identity from
    step 4.2, `artifacts` the last round's two reports and `contested.md` if present,
    `reviewedDesignSha256` D, `inspectedBy` `goldfish:implementation_readiness,vortex-runtime-goldfish`,
    `criteria` empty. The manifest's acceptance ids and texts and its contracts must match the
    design. Readiness rejects files outside the boundary and reviews of a checkout that
    already had implementation changes.

### Human checkpoints

The human answers the brainstorm interview, approves each draft section, decides contested
findings and approves the final digest. An agent may skip the first two only when the human
said so in the task. It never writes an `Approved` line the human has not given. Agents run
`egm-review` in consolidated mode so it does not stop between stages.

## Route the task

| Task                                | Arrangement                                                                         | Design                                                          | Completion evidence                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Research or planning                | One issue owner; independent readers for distinct questions when useful             | None                                                            | Source-grounded findings, alternatives and uncertainties                      |
| Setup, login, shared provisioning   | One operator before other live work                                                 | None                                                            | Doctor, isolated launch and requested setup checks                            |
| Bug fix, documentation or test-only | One author; selective specialists                                                   | None unless supplied or requested                               | Scoped checks, applicable control and independent review                      |
| Feature or refactor                 | One Elephant author; fresh Goldfish reviewers for the design                        | Approved design required before implementation                  | `design-review` evidence, `design scope`, scoped checks, control, review      |
| Independent Vortex issues           | One at a time, each in a fresh context on its own branch of `.vortex-src`           | Per the issue's kind                                            | Separate reproduction, implementation and evidence                            |
| Kit changes                         | One writer; read-only reviewers                                                     | `designs/<topic>.md` for features and refactors                 | Kit CI; released-app core for runtime contracts                               |
| UI/design                           | One author while decisions evolve; QA after criteria settle                         | An EGM design when it adds a feature; supplied visuals as input | Relevant state/size matrix and visible evidence                               |
| Independent QA                      | Fresh context and identified revision; after the author's `down`, from `up --fresh` | Reads the approved design and its boundary                      | Independent reproduction, boundary checks and findings                        |
| Performance                         | Alternating base/head runs on an idle machine (`/doodlebot:compare`)                | Per the change's kind                                           | Production mode, comparable fixtures, at least three runs per side and spread |

One accountable owner integrates each issue, resolves findings, checks evidence and cleans up.
Use the smallest arrangement that adds useful independent evidence. There is no fixed agent
hierarchy or global scheduler. Do not split coupled changes among concurrent writers.
Read-only readers and Goldfish design reviewers need no app. Only one doodlebot Vortex runs at
a time, so only one worker drives it. Readers that inspect UI use saved snapshots; taking a new
snapshot invalidates the renderer's existing references. Reuse suitable fixtures.

## Brief a worker

Send the complete brief; do not assume conversation history is inherited.

```text
Role and question: author / independent QA / specialist / research / Goldfish reviewer
Issue and neutral reproduction:
Design: approved design path and content digest D, or none (bug, docs, test-only):
Acceptance criteria (the design's ids and texts when there is one):
Allowed actions and their authorization; explicit exclusions:
Repository and relevant instruction/knowledge entry points:
Revision: base SHA and head SHA, or identified local diff
Checkout (kit, a branch of .vortex-src or a --dev-dir checkout); cache and endpoints, if used:
Affected contracts; required checks and justified inapplicability:
Evidence/report destination:
Running Vortex and who runs `down`; other processes and cleanup responsibility:
```

Independent QA starts with `fork_turns="none"` or an equivalent fresh context. Give it the
neutral issue, criteria, approved design, constraints and primary sources before the author's
proposed cause. Label author evidence as claims, while preserving relevant prior failures and
constraints. QA does not edit production code or publish. It starts after the author has run
`down` and begins with `up --fresh`, so it does not inherit the author's profile state. A
branch review does not require an existing PR. A local-diff review records content identity;
final submission gates must identify the actual final commit.

Stop a review when its design or reviewed content changes. Production changes need renewed QA
of the final change and affected interactions. Test-only changes need scoped checks and their
applicable control. Reuse evidence only after establishing revision, selection, fixture,
runtime and credential equivalence; never relabel an old run as rerun.

## Own resources: one instance at a time

Only one doodlebot Vortex runs at a time on the machine, driven by one agent. That is a
convention, backed by a few refusals for the cases where a second command would damage data. No
command asks who you are.

- Every doodlebot launcher (`up`, `setup`, `bootstrap`, the core suite's fixture)
  writes the instance record `~/.doodlebot/instance.json` right after it
  starts Vortex: pid, start time, cache folder, profile folder, MCP port and, for a source
  build, the checkout. The path is per user, whatever workspace or `--cache-dir` is used, so
  the rule spans every workspace on the machine. The record is cleared after a confirmed exit.
  A record whose pid is dead or is not a Vortex or Electron process is stale and is cleared
  when read. The older `harness/.cache/instance.json` is deleted when found unless it names a
  running Vortex, which refuses the launch ("A harness Vortex from an older doodlebot is
  running (pid N); stop it before starting Vortex.").
- A launcher refuses while the record names another running Vortex, including one started from
  another workspace or cache: "A harness Vortex is running (pid N, cache C); run
  `doodlebot down` before <action>." `up` and `bootstrap` first stop their own cache's
  leftover Vortex; another cache's is never touched. `doodlebot update` refuses the same way.
- Commands that rewrite or record a checkout (`build`, source install and build,
  `evidence run`, `pr-preflight`'s revert check) refuse while Vortex runs
  from it: "A harness Vortex is running from <checkout> (pid N); run `doodlebot down`
  before <action>."
- `down` waits for a clean exit and clears the record. An instance that does not exit is
  reported and left intact, never killed. When a reused pid keeps a dead record looking alive,
  delete `~/.doodlebot/instance.json` after checking that no harness Vortex is running.
- `script` runs in the caller's directory against the running instance.
- A Vortex started outside the kit's launchers (raw Playwright or Electron) writes no record
  and is invisible to these refusals. Do not start one beside a harness instance.
- Stop the app before rewriting its checkout output. Do not run the extension watcher during
  tests or beside `build-extension`; a reload can invalidate UI refs mid-action.
- An interrupted agent does not imply its subprocesses stopped. Check with `down` or the
  instance record before handing off.

Vortex source work happens on a branch of `.vortex-src` or in a checkout given with
`--dev-dir`. Independent QA runs after the author's `down`, starting with `up --fresh` in a
fresh context.

Publication follows the user's authorization. The repository's narrow kit-lessons exception
allows a verified kit lesson to be committed and pushed to `main` after `pnpm run ci` passes.
For a no-commit task, preserve the identified diff and hand it to the accountable owner; do
not discard it to satisfy a procedure. Keep one kit writer: other workers return findings and
candidate lessons. If a push rebases to a different head, verify that head before publishing
it.

The refusals cover supported harness paths. Raw MCP/CDP, manual filesystem/Git writes,
external builders and unknown shell descendants are not checked. Report uncertain recovery
explicitly.

## Verify and hand off

Documentation is a completion requirement for a behavior or workflow change. The site
documents setup and commands for people; the manuals document internals for agents. Update the
mapped `/docs` page and the manual together, regenerate references with
`pnpm run docs:generate`, and run `pnpm run docs:check`. Site pages are task-based setup and
usage instructions that use the plugin commands; they do not publish agent instructions or
redirect readers to AGENTS files. Keep commands, prerequisites and expected results current.
`scripts/documentation-map.json` supplies the pairing; reviewers still establish semantic
accuracy and coverage. The README introduces the companion, its install commands and the site.

Select checks by target, task and affected contracts, then have QA inspect applicability
against the actual diff. Documentation-only labels cannot waive changed executable behavior.
Kit changes run CI; affected runtime contracts also run the account-free released-app core.
Vortex submissions run its full verify on the final commit; E2E is additional and only runs
when requested. UI and performance evidence apply to the affected behavior, with reasons for
inapplicable checks. Missing permission or prerequisites produce a concrete blocker.

Bug fixes need the intended failing assertion without the fix. Import, compilation, setup,
timeout and unrelated failures are inconclusive. Features need absent-behavior or wiring
evidence; equivalence refactors need invariant/consumer coverage; documentation needs factual,
link and command checks. A test should exercise the real constraint and relevant failure path.
Features and refactors also need `design scope` to report no file outside the approved
boundary.

Run scoped checks first, independent QA next, resolve findings, then expensive final gates.
A successful command exit alone is insufficient. Account for missing tests, all-skipped runs,
selection/configuration differences, passed-to-skipped outcomes, flaky reruns and changed
failure causes. Preserve the first outcome of diagnostic reruns.

Use `evidence identity`, `evidence runtime` and `evidence run` to record concrete local
identities and execution, then `readiness --manifest <file>` to check it. Readiness uses
schema 3: a feature or refactor, or any task with a supplied design, needs `design` and a
`design-review` entry bound to the approved digest (see the lifecycle above). See the
operating manual for commands. Keep kit, Vortex source and built runtime identities
separate. Readiness means evidence complete for handoff. Hashes detect drift; they do not
authenticate reviewers or approvers, or prove that an assertion, risk assessment or build
claim is true. Exploration and blocked evidence cannot declare final readiness.

```text
Verdict: verified / changes required / externally blocked
Reviewed revision and baseline:
Design -> path, approved digest, design-review reports, design scope result, or none:
Acceptance criterion -> independent evidence and result:
Checks -> passed / failed / inconclusive / not applicable / blocked, with reasons:
Control -> task-appropriate test and why its outcome establishes the claim:
E2E -> selection, regressions, existing failures, omissions and dispositions, if requested:
Performance -> runtime, fixture, runs, spread and machine conditions, when applicable:
Findings -> severity, file:line, confirmation and disposition:
Uncertainty and concrete unblock step:
Cleanup -> `down` result, instance record cleared, other stopped/retained processes:
Candidate lessons -> evidence, scope, proposed canonical home, or none:
```

Save authorized reports to task artifacts and link the next brief to them. Honor chat-only
or no-write requests. Never save credentials or unnecessary private user data. Completion
requires evidence for the requested outcome or an honest, concrete external blocker.

## Improve from verified lessons

1. Capture a candidate in the task report: symptom, revisions, conditions, first failure,
   observed evidence, suspected/confirmed cause and proposed reusable improvement.
2. Check the mechanism in code and, where authorized, reproduce it and test a relevant boundary
   or counterexample. Qualify platform, release and fixture limits. Reject unsupported
   generalizations; a task-specific fact need not become a global rule.
3. Choose one canonical home through the knowledge index. Prefer fixing missing automation
   and adding a meaningful failure regression. Keep incident history, measurements and
   unresolved hypotheses in task artifacts.
4. Make the smallest complete authorized change and run `pnpm run ci` and other applicable
   checks. Material behavior or policy changes receive fresh independent review of cause,
   coverage, scope and practical cost before publication; a change that adds a feature or
   refactors code goes through the design-first lifecycle.
5. Correct or revert disproved changes, update dependent links and retire obsolete workarounds.
   Keep useful preventive tests even after an incident stops recurring. Git history provides
   the audit trail; no transcript-ingestion service or separate knowledge database is needed.

Automation captures provenance, checks consistency and runs tests. Agents diagnose and review.
Humans set authority, approve designs and remain responsible for upstream submissions and
product decisions. Improvement cannot silently expand permissions, weaken acceptance criteria,
widen an approved boundary, bypass the running-Vortex refusals or turn a blocked check into a
pass. An incorrect test or obsolete gate can be changed within scope, with the original outcome
retained and the correction explained and independently reviewed.

Judge improvements on comparable later tasks: fewer recurring failures, earlier detection,
less duplicate investigation and fewer private workarounds. Also inspect false refusals,
contradictory guidance, excessive reading and slower routine work. Do not reward producing
more lessons or obtaining greener results by omitting coverage.
