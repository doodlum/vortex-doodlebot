# Design-first, single-instance doodlebot

- **Author:** egm-overhaul (agent), for doodlum
- **Status:** Approved
- **Approved:** doodlum; content 748beff57bc65a1c1ddebf1655548fcba41c9e55ff5c7c3fc6e6b7ff2e67be32; chat 2026-11-09, answer "Approve, continue" to the approval question after confirmation round 11
- **Target:** doodlebot
- **Date:** 2026-11-09
- **Base:** `04444c1fe3a5f3e71c2eda4dba90232a77513912` (`main`)

---

## Overview

doodlebot (this repository, "the kit") launches, drives and checks an
unmodified [Vortex](https://github.com/Nexus-Mods/Vortex) mod manager for AI
agents and for people writing TypeScript tests. This design makes two changes
the owner asked for.

1. **Design first.** Features and refactors start with a design written and
   reviewed with Google's
   [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model)
   plugin (EGM, release `v0.1.1`, Apache-2.0). An **Elephant** is the
   long-lived agent session that holds the task's context, interviews the
   human and drafts a Markdown design without writing code. A **Goldfish** is
   a subagent started without conversation history that reviews the design
   using a persona (a reviewer prompt) and a document standard (a rubric).
   The human resolves trade-offs and approves the exact text. EGM stops there:
   its architecture calls the implementation file boundary "a convention, and
   nothing enforces it". doodlebot continues: it checks the design, enforces
   its file boundary, and binds the approved text to the final evidence.
2. **One doodlebot at a time.** The owner decided that running several
   doodlebot instances or agents at once is not wanted. Everything that exists
   only for that is removed: named owners, instance leases, checkout locks,
   operation guards, slots, the kit lock and the worktree command. One
   instance at a time is a convention, with a few cheap refusals where running
   two would damage data.

### Terms used here

- **Instance**: the one harness-launched Vortex, with its profile under the
  cache folder (default `harness/.cache`) and its MCP and CDP ports (default
  3701 and 9222).
- **Instance record**: the single file `harness/.cache/instance.json` (always
  this path, whatever `--cache-dir` says), written by every doodlebot launcher
  when it starts Vortex: `{pid, startedAt, cacheDir, userDataDir, mcpPort,
sourceDir?}`. Today each cache has its own `instance.json` and
  `instance.pid`, written only by `up`; this design replaces them.
- **Independent QA**: a second agent, started fresh, that reproduces and
  checks a change. It is a Goldfish for runtime behavior. With one instance,
  it runs after the author has run `down`, and starts with `up --fresh` so it
  does not inherit the author's profile state.
- **Receipt**: the JSON record `doodlebot evidence run` writes for a command:
  what ran, where, its output, and the checkout identity before and after.
- **Checkout identity**: `{checkout, headSha, baseSha, changesSha256,
changedFiles, dirty}` from `captureCheckoutIdentity(checkout, base)` in
  `harness/src/evidence.ts`. `changedFiles` lists every file that differs from
  `base`, committed or not, plus untracked files git does not ignore, as
  repository-relative forward-slash paths.
- **Core suite**: `pnpm run ai:test:core`, the Playwright contract run against a
  released Vortex with a disposable game and no account.

### EGM commands

| Command                | What it does                                                                                                                                | Human involvement          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `/egm:egm-brainstorm`  | Interviews the human, runs a 7-lens Goldfish swarm, writes `concepts_brief.md`                                                              | Interview answers          |
| `/egm:egm-draft`       | Turns a brief into `design_draft.md` section by section                                                                                     | Approves each section      |
| `/egm:egm-review`      | Five stages: zoom out, comprehension, critic, zoom out, implementation readiness; the "consolidated report" mode runs them without stopping | Optional between stages    |
| `/egm:egm-review-loop` | Runs named reviewers (built-in shortnames or file paths) against named standards, repeatedly                                                | Decides contested findings |
| `/egm:egm-resolve`     | Classifies findings as fix or contest and applies approved edits                                                                            | Approves edits             |

EGM's built-in reviewer `implementation_readiness` lives in the plugin at
`agents/implementation_readiness.md` with the standard
`resources/document_standards/implementation-readiness-standard.md`.

### Readiness today (schema 2)

`doodlebot readiness --manifest <file>` (`harness/src/readiness.ts`) checks a
JSON manifest written at handoff. It holds `task` (`id`, `kind`: bug, feature,
docs, tests or refactor; `target`: vortex or doodlebot; `author`), `subject`
(the change's checkout identity), `risk.contracts` (`runtime`, `ui`,
`persistent-data`, `public-api`, `performance`), `authorization`,
`acceptance` (`{id, criterion}` list) and `evidence`. Each evidence entry has
a `role` (`review`, `kit-ci`, `scoped-tests`, `control`, `app-qa`, `kit-core`
and others), `status`, `subject`, `inspectedBy`, `criteria` (acceptance ids
it covers) and `artifacts` (`{path, sha256}` references whose hashes must
still match). `requiredEvidence` derives mandatory roles from kind, target
and contracts; `runtime` on a doodlebot change requires `kit-core`.
`evaluateReadiness` rejects an entry whose `subject` differs from the current
one, rejects missing roles, and requires every acceptance id to be covered by
passing evidence. A ready result grants no permission to publish or merge.

## The Problem

1. **Intent is reconstructed after the fact.** Acceptance criteria first appear
   in the manifest, written by the agent that did the work.
2. **Reviews start too late.** Independent QA reviews a finished diff.
3. **Scope creep is invisible.** Nothing compares the diff with an agreed list
   of files.
4. **EGM alone cannot close the loop.** It reviews documents; it cannot tell
   whether a Vortex verification plan can run, or whether a diff stayed inside
   the approved files.
5. **People have no setup guide** for EGM in their coding agent.
6. **Multi-instance machinery the owner does not want.** About 2,000 lines in
   eight modules (`lease.ts`, `leaseCommand.ts`, `operations.ts`,
   `checkoutOperation.ts`, `liveOperation.ts`, `kitLock.ts`, `slots.ts`,
   `worktree.ts`) and their tests, threaded through 33 files. Every live
   command needs `--owner`, every workflow document explains slots and locks,
   and the core fixture can start a second Vortex beside an existing one.

## Goals

- Features and refactors start with an EGM design whose exact text a human
  approves after a Goldfish confirmation round.
- doodlebot provides an Elephant procedure (`vortex-elephant`), a Vortex change
  standard and a Vortex runtime Goldfish usable from EGM's review loop.
- `doodlebot design new|check|scope` creates, validates and enforces designs.
- Readiness schema 3 binds features and refactors to the approved text, its
  acceptance criteria and its file boundary.
- Human pages explain installing EGM per coding agent and approving designs.
- Only one doodlebot instance runs; owners, leases, guards, slots, the kit lock
  and worktrees are gone, and `down`, `script`, the build refusal and the
  benchmark settings refusal keep working.

## Non-Goals

- Vendoring EGM.
- Designs for bug fixes, docs or test-only changes, unless supplied.
- Proving who reviewed or approved. Hashes detect changed text only.
- Detecting a person's own (non-harness) Vortex or a running game.
- Supporting two doodlebot instances, or migrating leftover lease, slot or
  worktree folders automatically.
- Accepting schema-2 readiness manifests or v4 vortex-e2e reports.

## Open Questions

None.

## Acceptance Criteria

- `egm-plugin`: `.claude/settings.json` contains the `egm` marketplace pinned to `v0.1.1` and enables `egm@egm`; `harness/src/egmResources.test.ts` asserts the file. Whether Claude Code then loads it is observed by a person, not claimed here.
- `design-cli`: `design new`, `design check` (with and without `--ready`) and `design scope` behave as specified, including refusals and exit codes; `harness/src/designCommand.test.ts` asserts each against a synthetic repository, and the CLI dispatches to `designCommand`.
- `readiness-design`: Schema-3 readiness enforces rules 1 to 6 below; `harness/src/readiness.test.ts` covers each.
- `goldfish-resources`: The standard (listing every required section from `requiredSections`), runtime persona, read-only Claude adapter with the persona's name, and `vortex-elephant` skill exist with the specified frontmatter, and root `AGENTS.md` points every agent at the skill; `egmResources.test.ts` asserts them.
- `setup-docs`: `docs/guides/agent-plugins.md` contains, per surface, the install steps, pin, isolation and supported steps, including `v0.1.1`, both Codex commands, Claude Code 2.1.271 and EGM issue 237; `egmResources.test.ts` asserts these strings.
- `single-instance`: No file outside the allow-list contains an identifier from the removed list in item 10; `harness/src/singleInstance.test.ts` scans every tracked or untracked non-ignored file that exists.
- `single-instance-runtime`: The instance record, its reused-pid check, `down` clearing a dead record and following the record to another cache, the refusals with their exact messages, `runInteractive`'s exit codes and `resetGameSettings`'s refusal behave as specified in unit tests; the core suite on released Vortex 2.8.0 has the same outcome as on the base commit; and a live source-build instance makes `build` refuse with the `building it` message.
- `docs-paired`: `pnpm run ci` passes, and the independent `review` evidence confirms the human and agent documents give the same lifecycle steps, folders, approval format and rules.

## Affected Contracts

- `runtime`: instance launch, shutdown, profile records, the extension watcher and checkout builds change.
- `persistent-data`: the OAuth credential copy (`credentials.ts`) and `benchmark-setup.json` lose their cross-process locks, and legacy record files are deleted. Invariants kept and unit-tested: credentials copy in, refuse write-back when the canonical cache changed, and write back atomically (`credentials.test.ts`); `benchmark-setup.json` is written atomically (`setup.test.ts`); legacy files are deleted only as specified under "Legacy files" (`instance.test.ts`).
- `public-api`: CLI commands and flags, the script API (`kit.ts`), the readiness manifest and the vortex-e2e report format change.

## Critical User Journeys (CUJs)

### CUJ 1: A Vortex feature

- **Given**: A user asks for a Vortex feature and authorizes source changes.
- **When**: The agent follows `vortex-elephant`: brief, draft, EGM review,
  confirmation round, human approval, implementation on a branch of
  `.vortex-src`, `design scope`, `down`, then QA from `up --fresh`.
- **Then**: Readiness accepts only the approved design with its
  pre-implementation review.

### CUJ 2: A kit change outside its approved files

- **Given**: An approved design under `designs/` listing three files.
- **When**: The implementer edits a fourth.
- **Then**: `design scope` names it and exits 1; readiness reports
  `design: <file> outside the approved boundary`. Either the edit is reverted,
  or the design is amended: that voids its approval, an amendment
  confirmation round (below) runs on a clean checkout, and the human approves
  the new digest.

### CUJ 3: A one-step bug fix

- **Given**: A reproduced bug with an obvious cause.
- **When**: The agent fixes it without a design.
- **Then**: Readiness requires the existing bug evidence and no design.

### CUJ 4: A person sets up EGM

- **Given**: A clone of doodlebot and one of Claude Code, Codex CLI, or the
  Codex or ChatGPT desktop app.
- **When**: They follow `docs/guides/agent-plugins.md`.
- **Then**: Claude Code loads the pinned plugin after the folder trust prompt;
  Codex CLI users run two commands; desktop users install the published
  listing and learn which steps are supported there.

### CUJ 5: One instance

- **Given**: `pnpm run ai -- up --installed --sandbox` is running.
- **When**: The agent runs `pnpm run ai:test:core`.
- **Then**: The suite refuses with "A harness Vortex is running (pid N, cache
  <cacheDir>); run `pnpm run ai -- down` before the core suite." After `down`,
  it runs. No command asks for an owner, slot or lock.

## Technical Plan (Architecture)

### Part A: design first

```text
 agent (Elephant): vortex-elephant ─► egm-brainstorm ─► egm-draft ─► copy to design path
                                                                         │
 design path: designs/<topic>.md (doodlebot) │ harness/.artifacts/designs/<topic>.md (vortex)
                                                                         ▼
 egm-review (consolidated) ─► egm-resolve ─► oxfmt ─► design check ─► digest D
                                                                         ▼
 confirmation round on an unimplemented checkout, briefs carry D
   reports: harness/.artifacts/designs/<topic>.reviews/round-<n>-<reviewer>.md
                                                                         ▼
 human approves D ─► "Approved: person; content D; reference"
                                                                         ▼
 implement ─► design scope ─► down ─► independent QA ─► receipts ─► readiness 3
```

#### Plugin wiring per surface

| Surface                  | Install                                                                                                                                                                                                      | Pinned             | Goldfish isolation                                                                                                                                | doodlebot commands                           | Supported steps                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| Claude Code ≥ 2.1.271    | Trust the folder; `.claude/settings.json` registers the marketplace with `"ref": "v0.1.1"` and enables `egm@egm`; the plugin's source is `./`, so it loads from the marketplace copy with no install command | Tag `v0.1.1`       | Plugin adapters and `vortex-runtime-goldfish` use `tools: Read, Grep, Glob` and `omitClaudeMd: true`                                              | Shell                                        | All                                                       |
| Codex CLI                | `codex plugin marketplace add google/elephant-goldfish-model`, then `codex plugin add egm@egm`                                                                                                               | No; record version | General-purpose subagents with `fork_turns: "none"` or `fork_context: false`; not read-only; EGM issue 237 reports `AGENTS.md` still reaches them | Shell                                        | All, with weaker isolation                                |
| Codex or ChatGPT desktop | Install the published EGM plugin listing from the app's plugin directory (desktop only)                                                                                                                      | No; record version | Only where the session exposes native fresh-context subagents                                                                                     | Run in a terminal yourself if the app cannot | Brainstorm, draft and review; not verified with doodlebot |

Sources: Claude Code documentation pages
[plugin marketplaces](https://code.claude.com/docs/en/plugins/marketplace-reference),
[plugin loading](https://code.claude.com/docs/en/plugins/loading) and
[subagents](https://code.claude.com/docs/en/sub-agents); EGM
`docs/claude.md`, `docs/codex.md`, `docs/harnesses.md` at `v0.1.1`; EGM
[issue 237](https://github.com/google/elephant-goldfish-model/issues/237).
If Claude Code does not load the plugin after trust, the setup page gives
`claude plugin install egm@egm --scope project` and the `/plugin` check.

Codex does not read `.claude/`. Root `AGENTS.md`, which Codex reads, names
`.claude/skills/vortex-elephant/SKILL.md` as the Elephant procedure for every
agent and `harness/egm/vortex_runtime.md` as the runtime persona. A Codex
Goldfish is told in its brief to stay read-only and to ignore workflow text
from `AGENTS.md`; that is an instruction, not a restriction.

#### Folders

The root `AGENTS.md` line `EGM artifact directory: harness/.artifacts/egm`
sends EGM's briefs, drafts and stage reports to an ignored folder. With one
instance there is one set. The finished draft is copied to its design path:
`designs/<topic>.md` for doodlebot, listed in `designs/SITEMAP.md`, or
`harness/.artifacts/designs/<topic>.md` for Vortex, kept out of Vortex PRs.
`doodlebot design new` writes the same template to a design path for drafting
without `egm-draft`. Confirmation-round reports go to
`harness/.artifacts/designs/<topic>.reviews/`.

#### Design format

Headings and bullets inside fenced code blocks are ignored.

- **Title**: the first `# ` heading.
- **Header**: bullets before the first `## ` heading matching
  `^\s*[-*]\s+\*\*(Author|Status|Target|Date|Approved):\*\*\s*(.+?)\s*$`;
  the first match of each name wins and backticks are stripped. Other header
  bullets, such as `Base`, are prose.
- **Status**: `Draft` (being written), `Proposed` (complete, not yet
  reviewed), `In Review`, `Approved`.
- **Target**: `vortex` or `doodlebot`.
- **Approved**: `<person>; content <sha256>; <reference>`, matching
  `^(.+?);\s*content\s+([a-f0-9]{64});\s*(.+)$`. Present if and only if
  Status is `Approved`. The reference is a PR review link, a chat or message
  link, or, for a design committed to doodlebot only, `edited by <person>
<date>` when that person wrote the line (checkable through git history).
  When the approval was given in a conversation no reviewer can open, the
  reference quotes the person's words with the date; that approval cannot be
  verified by anyone else, which is an accepted risk.
- **Sections**: `sections` holds every level-2 heading name and every level-3
  heading name. A `## X` section runs to the next level 1-2 heading; a
  `### X` section to the next level 1-3 heading. Required level-2 sections:
  Overview, The Problem, Goals, Non-Goals, Open Questions, Acceptance
  Criteria, Affected Contracts, Technical Plan (Architecture), Alternatives
  Considered, Detailed Implementation Plan. Required level-3: Verification
  Plan.
- **Continuation**: any non-blank line after a bullet that is not a bullet,
  heading or fence, regardless of indentation, continues it until a blank
  line. Inline code spans may cross a line break; the break becomes a space.
- **Acceptance**: bullets ``- `id`: criterion`` in Acceptance Criteria with
  ids matching `[a-z0-9][a-z0-9-]*`; text after the colon, continuation
  joined with single spaces, is the criterion.
- **Contracts**: in Affected Contracts, a bullet whose first token is a
  backticked name from `runtime`, `ui`, `persistent-data`, `public-api`,
  `performance` declares it; a bullet starting `None` declares none and its
  backticks are ignored.
- **Boundary**: every backticked span on each bullet of
  `### Target Scope & File Boundary` (with continuation), plus the path in each
  ``#### N. `path` (Create|Modify|Delete)`` heading inside the Detailed
  Implementation Plan, N being digits with an optional lower-case letter. A
  `#### N.` heading there that does not match is reported. Paths are relative
  to the root of the repository being changed.
- **Open questions**: bullets in Open Questions, ignoring one whose text
  without punctuation is `none` in any case; a paragraph `None.` is not a
  bullet.
- **Undecided marker**: the regex `\bTBD\b` matching outside fenced blocks
  and inline code.

#### Content digest and approval

`designContentSha256` removes a leading BOM, converts CRLF to LF, deletes the
header block's `Status`, `Date` and `Approved` bullet lines (each header
bullet must be a single line), and hashes the rest
with SHA-256. Body edits change it; approval does not. The `Approved` digest
must equal the current digest, so a body edit after approval voids it. oxfmt
formats Markdown in `pnpm run ci`, so the agent runs `pnpm exec oxfmt
<design>` before every `design check` whose digest it records.

#### Human checkpoints

The human answers the brainstorm interview, approves draft sections, decides
contested findings and approves the final digest. An agent may skip the first
two only when the human said so in the task; it may never write an `Approved`
line the human has not given. Agents run `egm-review` in consolidated mode.

#### Confirmation round

EGM's stages edit the document, so they cannot be bound to the final text. A
confirmation round follows the last edit:

1. Format the design; run `design check --ready --json`; it must report no
   issues. `--ready` applies the approval-time checks (open questions, the
   undecided marker) whatever the Status, except those about the `Approved`
   line. Take `contentSha256` as D.
2. Record `doodlebot evidence identity --checkout <subject> --base <base>`,
   where the subject is the kit for doodlebot and `.vortex-src` (or the
   `--dev-dir` checkout) for Vortex, and the base is a fixed commit SHA: the
   same base the readiness manifest's subject will use, because a later base
   would hide committed implementation. Its `changedFiles` may contain only the
   design and `designs/SITEMAP.md`.
   **Amendment after implementation began**: the subject has implementation
   changes, so the round runs on a clean detached checkout of the review head
   instead: `git -C <subject> worktree add --detach <temp folder> <commit>`,
   copy the amended design (and `designs/SITEMAP.md`) into it for a doodlebot
   design, record its identity, review, then
   `git -C <subject> worktree remove <temp folder>`. `<commit>` is the
   subject's base, or any commit containing no implementation of this design.
3. Start two fresh reviewers on the whole design: EGM's
   `implementation_readiness` with its standard, and
   `vortex-runtime-goldfish` with `harness/egm/vortex-change-standard.md`.
   Each brief contains D, the absolute subject checkout root, and for Vortex
   targets that checkout's `AGENTS.md` and `docs/README.md`; it asks the
   reviewer to begin with `Reviewed content sha256: D`.
4. Save each report as `round-<n>-<reviewer>.md`, where `<reviewer>` is
   `implementation_readiness` or `vortex-runtime-goldfish`, with three lines
   prepended by the agent: `Harness: <agent and version>`, `EGM: <version>`
   and `Checkout: <headSha> <changesSha256>` from step 2. The reviewer's
   `Reviewed content sha256: D` line follows them.
5. The round is clean when no Blocker or Major finding remains uncontested.
   The agent may contest a finding with a written reason in
   `contested.md` in the same folder; the human sees it at approval. Any other
   Blocker or Major means editing and a new round. After three rounds the
   human decides whether to approve with the open findings listed in
   `contested.md`.
6. The agent records a `design-review` evidence entry: `subject` from step 2,
   `artifacts` the last round's reports and `contested.md` if present,
   `reviewedDesignSha256` D, `inspectedBy` `goldfish:<reviewer>,<reviewer>`,
   `criteria` empty.

#### Readiness 3

- Manifest and report `schemaVersion` 3. `evaluateReadiness` throws
  `ConfigError` before parsing when the value is not 3:
  `readiness manifest schemaVersion <v> is not supported; this doodlebot reads
schema 3`, with `<v>` from `JSON.stringify(value?.schemaVersion)`.
- `design: artifactSchema.optional()`.
- Role `design-review`; evidence field `reviewedDesignSha256`, required on
  that role (`design-review: reviewedDesignSha256 is required`) and rejected
  elsewhere (`<role>: reviewedDesignSha256 belongs only to design-review`).
- `requiredEvidence` adds `design-review` when the kind is feature or
  refactor, or a design is supplied.
- Without a design: a feature or refactor gets
  `design: an approved design is required for feature and refactor tasks`; a
  `design-review` entry gets `design-review: no design in the manifest`.

With `manifest.design`, after its hash check, the UTF-8 text is parsed and:

1. Each `checkDesign` issue is reported as `design: <issue>`; Status other
   than Approved adds `design: not approved`.
2. `design: target <t> differs from task target <u>`.
3. `design: acceptance <id> missing from manifest`,
   `design: acceptance <id> not in the approved design`, and
   `design: acceptance <id> text differs from the approved design` (texts
   compared with whitespace collapsed and trimmed).
4. `design: contract <c> missing from risk.contracts`.
5. `design: <file> outside the approved boundary` for each changed file
   outside the boundary. The design file, made relative to the subject
   checkout with forward slashes, is exempt when it lies inside it.
6. For `design-review` the current-diff rule is skipped and these apply:
   `design-review: reviewer must differ from the author`;
   `design-review: criteria must be empty; a design review proves no acceptance criterion`;
   `design-review: reviewed digest differs from the approved design`;
   `design-review: needs round-<n>-implementation_readiness.md and round-<n>-vortex-runtime-goldfish.md from one round`
   (artifacts whose basename matches `^round-(\d+)-(.+)\.md$`; both reviewer
   names with one common `n` must be present);
   `design-review: report <path> does not record the reviewed digest`
   (no line equal, after trimming, to `Reviewed content sha256: <reviewedDesignSha256>`);
   `design-review: report <path> names another checkout` (its `Checkout:`
   line differs from the entry subject's `headSha changesSha256`);
   `design-review: reviewed checkout used another base` (the entry subject's
   `baseSha` differs from the manifest subject's);
   `design-review: reviewed checkout had implementation changes: <files>`
   (changed files other than `designs/SITEMAP.md` and the design path computed
   for rule 5);
   `design-review: reviewed head is not an ancestor of the subject head`
   (`git -C <manifest subject checkout> merge-base --is-ancestor <reviewHead>
<subjectHead>` exit 1); `design-review: cannot check ancestry: <message>`
   (other exits). All rule-6 problems of one entry are reported as one issue,
   joined with `; design-review: `.

Readiness checks that the reviews are bound to the text and predate the
implementation's commits or diff; it does not read their findings. The
independent `review` entry judges the round's outcome, `contested.md` and the
approval reference.

#### Boundary breadth

`checkDesign` reports `broad boundary entry <e>` for an entry ending in `/` or
containing `**`, unless its bullet contains the word `generated`. Regenerated
references are listed by exact path.

### Part B: one instance

#### What is deleted

Modules `lease.ts`, `leaseCommand.ts`, `operations.ts`,
`checkoutOperation.ts`, `liveOperation.ts`, `kitLock.ts`, `slots.ts`,
`worktree.ts`; their tests; `harness/src/tests/leaseGlobalSetup.ts`,
`harness/src/tests/parallel-sessions.e2e.ts`;
`docs/guides/parallel-sessions.md`; the historical
`harness/reviews/workflow-plan.md`. CLI commands `kit`, `lease`, `slots`,
`worktree`; flags `--owner`, `--slot`, `--worktree`, `--wait`, `--ttl`,
`--pid`, `--purpose`, `--checkout-only`; variables `VORTEX_AI_OWNER`,
`VORTEX_AI_SLOT`, `VORTEX_AI_LEASE_DIR`; scripts `ai:lease`,
`ai:test:parallel-sessions`; per-cache `instance.pid` and
`<cache>/instance.json` files; every `owner`, `context`, `leaseEnv`,
`persistentResources` and `OperationOptions` parameter; the hot-reload
`waiting` event; the Electron install lock; the benchmark `.benchmark-lock`
file and setup-file lease; `claimInstanceLease` from `kit.ts`.

#### What survives and where

- `normalizedPath` moves unchanged to `harness/src/paths.ts`.
- `processAlive(pid)` moves to new `harness/src/processes.ts` (EPERM counts as
  alive) and replaces `instance.ts`'s private `isAlive`.
- `processes.ts` also exports `processImageName(pid: number): string |
undefined`, running `tasklist /FI "PID eq <pid>" /FO CSV /NH` on Windows
  (the first field of an output line that starts with `"` and names that pid,
  lower-cased; the localized `INFO:` line for no match gives undefined) and
  reading `/proc/<pid>/comm` elsewhere; undefined when not found.
- New leaf module `harness/src/runningVortex.ts` (imports only `node:fs`,
  `node:path`, `./paths`, `./processes`, `./errors`):
  - `export const INSTANCE_RECORD = path.join(DEFAULT_CACHE_DIR, "instance.json")`:
    one fixed path, so every command finds the one instance whatever cache it
    uses.
  - `export interface InstanceRecord { pid: number; startedAt: string; cacheDir: string; userDataDir: string; mcpPort: number; sourceDir?: string }`
  - `export function writeInstanceRecord(record: InstanceRecord): void`
    writes it (creating the folder) and throws on failure.
  - `export function readInstanceRecord(): InstanceRecord | undefined`
    ignores unknown fields; undefined when absent or invalid. Valid means
    `pid` and `mcpPort` are integers, `startedAt` (from
    `new Date().toISOString()`), `cacheDir` and `userDataDir` are strings, and
    `sourceDir` is a string when present.
  - `export function clearInstanceRecord(pid?: number): void` deletes the
    record, only when its pid equals `pid` if given.
  - `export function runningVortex(): InstanceRecord | undefined` returns the
    record when `processAlive(pid)` and `processImageName(pid)` is
    `vortex.exe`, `electron.exe`, `vortex` or `electron`; a record failing
    either test is stale and is cleared before returning undefined.
  - `export function assertNoHarnessVortex(action: string): void` throws
    ``ConfigError("A harness Vortex is running (pid <pid>, cache <cacheDir>); run `pnpm run ai -- down` before <action>.")``.
  - `export function assertNoVortexRunningFrom(checkout: string, action: string): void`
    throws
    ``ConfigError("A harness Vortex is running from <checkout> (pid <pid>); run `pnpm run ai -- down` before <action>.")``
    when the running record's `sourceDir` equals `checkout` under
    `normalizedPath`.
- Launchers refuse first, then write the record right after spawn and before
  readiness; a write failure stops the launched child and fails the launch.
  `launchVortex` in `instance.ts` (used by `up`, `setup`, `bootstrap`, benchmark
  sessions and `benchmarks/setup-cli.mts`) refuses with action
  `starting Vortex` and writes the record, including `sourceDir` for a source
  build. Callers that launch through it (`createSession` with
  `a benchmark session`, `setup-cli.mts` with `benchmark setup`) refuse with
  their own action first and do not write the record themselves. `up` and
  `bootstrap` reach `launchVortex`'s refusal after stopping their own cache's
  leftover and preparing the cache; on the default ports a second cache's
  `up` meets the existing port check ("Port 3701 belongs to a different
  Vortex profile") first, and no data of the running instance is changed in
  either case (a cold or `--fresh` bootstrap may already have reset its own
  cache).
  `zoom.e2e.ts --signed-out` also refuses with its own action
  (`the signed-out zoom check`, default ports) and launches through
  `bootstrap`, so it does not write the record itself. The one launch outside
  `launchVortex`, the core fixture in `harness/src/tests/fixtures.ts`, refuses
  with `the core suite` before launching, writes the record (with `sourceDir`
  for a source build) immediately after `electron.launch` resolves (closing
  the app if the write fails), and clears it after confirmed exit through
  `closeFixtureApp(app, cleanup, isAlive = processAlive)`, which calls
  `clearInstanceRecord(child.pid)`.
- The core Playwright config (`harness/playwright.config.ts`) has two projects
  so the suite never needs two instances: `lifecycle`
  (`testMatch: "**/bootstrap-lifecycle.spec.ts"`, which launches and stops its
  own instances) and `contract` (`testIgnore: ["**/oauth-restore.spec.ts",
"**/bootstrap-lifecycle.spec.ts"]` over the config's `**/*.spec.ts`, the
  specs sharing the worker fixture's Vortex), which depends on `lifecycle`. The dependency is deliberate: it guarantees the
  order. Its cost is all-or-nothing: when the lifecycle test fails, Playwright
  does not run the 20 contract tests, and a record the failed stop left
  behind would make the contract fixture refuse anyway. A failed lifecycle
  test is therefore a failed core run. `harness/oauth.playwright.config.ts`
  sets `projects: undefined` so it runs only `oauth-restore.spec.ts`. Running
  one contract spec also runs the lifecycle test unless `--no-deps` is passed.
- `instance.ts`: `stopInstance(child, mcp, options)` calls
  `clearInstanceRecord(child.pid)` after a confirmed exit. `stopStaleInside`
  reads the record through `runningVortex()` (so a dead or reused pid is
  cleared first, on `up` as well as `down`) and uses it when its `cacheDir`
  equals the config's (under `normalizedPath`), keeps the MCP profile check,
  `vortex_quit` and the
  30-second wait, and clears the record after a confirmed exit.
  `ensureExtensionBuilt` stays in `instance.ts`.
- **`down` follows the record.** New `export async function stopRunningInstance(config: HarnessConfig): Promise<boolean>`
  in `instance.ts`, called by the CLI's `down`: it calls `runningVortex()`
  (clearing a stale record); when a live record exists it stops that instance
  with `stopStaleInstance({ ...config, cacheDir: record.cacheDir, mcpPort: record.mcpPort })`,
  so an instance started with a non-default `--port` is reached too, and when
  the record's `cacheDir` differs from the config's (compared under
  `normalizedPath`) it first writes
  `Stopping the harness Vortex of cache <cacheDir> (MCP port <mcpPort>).` to
  stdout; with no live record it calls `stopStaleInstance(config)`. The MCP profile
  check still refuses to quit a Vortex whose profile is outside that cache.
  Only `down` follows the record; `up` and `bootstrap` never stop another
  cache's instance.
- **Legacy files.** `removeLegacyInstanceFiles(config)`, called by
  `stopStaleInside` and `launchVortex`, deletes `<cacheDir>/instance.pid` and,
  only when that path is not `INSTANCE_RECORD`, `<cacheDir>/instance.json`. An
  old-format file at `INSTANCE_RECORD` is unreadable to `readInstanceRecord`;
  `runningVortex()` deletes any unreadable or invalid record file.
- **CLI flags.** `cliArgs.ts` adds `ready` to `BOOLEAN_FLAGS` (so
  `design check <file> --ready --json` parses) and removes the deleted flags;
  `cliArgs.test.ts` covers `design check x.md --ready --json`.
- **Other messages.** `resetGameSettings` keeps one precondition, thrown as
  `Game settings reset needs dedicatedWindowsAccount:true`. The vortex-e2e
  report note `a harness Vortex (pid <pid>) was running during the run;
timings may be affected` is built from `runningVortex()`; the run is still
  allowed.
- **Removed `instance.ts` exports**: `claimInstanceLease`,
  `instanceLeaseResources`, `attachedLeaseResources`, `runningInstance`
  (use `runningVortex()`), `recordLaunchedPid`, `forgetLaunchedPid`.
  `registerLaunchedProcess(child, { onProcessSpawn })` stays: when the observer
  throws, it kills the child, waits up to 5 s for its exit and rethrows.
  `installMcpExtension(userDataDir, source?)` loses its options. Operation
  child tracking (`trackOperationChild`) and `ChildRegistrationError` are
  removed with no replacement; the registration-failure cases in
  `sourceBuild.test.ts` and `processRunner.test.ts` are deleted.
- **Testable refusals.** Each `assertNoHarnessVortex` call site has a named
  unit test with its exact message: `starting Vortex` in `instance.test.ts`
  (`launchVortex` with a live record refuses before spawning); `a benchmark
session` in `harness/benchmarks/sessionCleanup.test.ts` (`createSession`
  refuses before launching); `benchmark setup` through a new exported
  `assertBenchmarkSetupCanLaunch()` in `benchmarks/setup.ts`, called at the
  start of `setup-cli.mts`'s `signIn()` (its only path that launches Vortex;
  `--status`, `--status --verify` and the local-test path never launch) and
  tested in `benchmarks/setup.test.ts`; `the core suite`
  in `runningVortex.test.ts` (the message the global setup and fixture use).
- **Unit-test isolation.** Every unit test that writes or depends on the
  instance record mocks `./paths` (temporary `DEFAULT_CACHE_DIR`, created in
  `vi.hoisted` because `INSTANCE_RECORD` is computed at module load) and
  `./processes` (`processImageName` returns a Vortex image), each mock
  spreading `importOriginal()` and overriding only that export; other tests
  only read the real record, so verification steps 1 to 3 run with no
  harness Vortex running (after `pnpm run ai -- down`).
- `stopStaleInside` clears the record only for a pid it read from a record
  of its own cache; it never touches another cache's record
  (`instance.test.ts`: stopping cache B leaves cache A's live record).
- `hotReload.ts`'s `assertStandaloneWatch`, its `cli.ts` call and its test
  cases are deleted.
- `runInteractive` uses the same spawn and kill-tree pattern as
  `runEvidenceProcess` (`detached` on POSIX for the group kill, `taskkill /T`
  on Windows), with `stdio: "inherit"`.
- `config.ts` owns `DEFAULT_MCP_PORT = 3701` and `DEFAULT_CDP_PORT = 9222`;
  `--cache-dir`, `--port`, `--cdp-port` and their variables still override.
- `bootstrap.ts`'s `seedSlotLogin` is renamed `seedLoginFromDefaultCache`
  (its progress message becomes `copied the saved login from <cache>`),
  unchanged otherwise.
- `processRunner.ts` gains `callerCwd()` (moved from `leaseCommand.ts` with
  its tests) and
  `export function runInteractive(executable: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<number>`,
  used by `script`: `spawn` with `stdio: "inherit"` and `shell: false`; it
  creates and disposes `abortOnSignals()` itself and kills the child tree on
  abort; it resolves 130 after an abort, `128 + os.constants.signals[signal]`
  when the child died from a signal, otherwise the child's exit code (1 when
  null). `script` passes `cwd: callerCwd()` and `commandEnv(callerCwd())` plus
  the existing kit variables. `runEvidenceProcess` loses its `context`, `leaseEnv`,
  `persistentResources` options and the variables they injected.
- Checkout refusals call `assertNoVortexRunningFrom(<checkout>, <action>)`
  with actions `building it` (`build`, and `source.ts`'s `buildVortexSource`
  unless `installOnly`), `installing it` (`buildVortexSource` with
  `installOnly`), `recording evidence in it` (`evidence run`),
  `reverting it` (`pr-preflight`'s revert check) and `patching it`
  (`vortex-e2e`).
- `assertNoHarnessVortex` actions: `starting Vortex` (`launchVortex`),
  `the core suite` (the core fixture and new
  `harness/src/tests/singleInstanceGlobalSetup.ts`, set as Playwright's
  `globalSetup` in both configs), `a benchmark session`, `benchmark setup`,
  `the signed-out zoom check`.
- `resetGameSettings` gains `isRunning?: () => boolean` on its options object
  and loses `owner` and the lease; the benchmark session passes "any spawned
  pid is alive, or `runningVortex()` is set", and the default is
  `() => runningVortex() !== undefined`. It refuses with
  `Cannot reset game settings while Vortex is running`.
- `hotReload.ts` runs build, copy and reload cycles directly; `HotReloadEvent`
  loses `waiting`, `WatchOptions` loses `retryMs`, `context` and `leaseEnv`;
  it still checks `automation_status.userDataDir` against the live profile
  every cycle.
- `instance.ts`'s `ensureExtensionBuilt` becomes freshness check, build,
  `requireFreshExtension`, without a guard and without the `needed` callback;
  `extensionBuild.ts`'s `buildExtension` loses `owner`, `context` and
  `leaseEnv`. Running the watcher and `build-extension` together is
  unsupported.
- `electronRuntime.ts` resolves and installs Electron without the install
  lock; `credentials.ts` drops the `.benchmark-lock` reservation and keeps
  its copy-in, changed-cache refusal and atomic write-back; `benchmarks/setup.ts`
  drops the lease around reading and writing `benchmark-setup.json`, keeping
  its atomic write; `e2e.ts` drops its owner option.
- The vortex-e2e report becomes schema 5 without `owner`.
- `readiness.ts`'s `inferredContracts` runtime pattern drops the deleted
  modules and adds `runningVortex` and `processes`.
- `.gitignore` keeps `.vortex-worktrees/` and `harness/.gitignore` keeps
  `.slots/`, both commented "obsolete; delete leftovers", so old folders do
  not dirty the kit.
- Vortex source work happens on a branch of `.vortex-src` or in a checkout
  given with `--dev-dir`.
- Root `AGENTS.md` keeps its kit-lessons exception without the lock:
  verified kit lessons may be committed and pushed to `main` after
  `pnpm run ci`.

## Alternatives Considered

### Alternative A: Vendor EGM's skills

- **Pros**: Offline; editable prompts.
- **Cons**: Forks a maintained project with packaging for seven agents.
- **Reason for Rejection**: Updates would need manual merges of seven
  packages; a tag pin gives Claude Code users a fixed release without that
  cost, and Codex users record their version.

### Alternative B: Adopt EGM as guidance only

- **Pros**: No schema change; no new command.
- **Cons**: Problems 1 and 3 stay open: nothing ties the evidence to approved
  text or files.
- **Reason for Rejection**: It leaves the two problems that motivate the
  design unsolved.

### Alternative C: Bind approval only through git history

- **Pros**: Commit order is strong evidence.
- **Cons**: Vortex designs are not committed anywhere.
- **Reason for Rejection**: Cannot cover Vortex designs; rule 6 uses ancestry
  where history exists, and the digest covers both.

### Alternative D: Enforce the boundary in `pr-preflight`

- **Pros**: One command for Vortex branches.
- **Cons**: It covers Vortex only.
- **Reason for Rejection**: Kit changes would stay unchecked; `design scope`
  covers both targets, and `outsideBoundary` is exported for a later
  `pr-preflight` check.

### Alternative E: Keep the guards without owners

- **Pros**: Keeps protection against two commands at once.
- **Cons**: Keeps most of the 2,000 lines and the operation-context plumbing
  through 33 files, to protect against concurrency a single-instance kit does
  not have.
- **Reason for Rejection**: With one instance, the remaining data-damage cases
  (rebuilding a running checkout, a second launch, a settings reset) are
  covered by the record-based refusals at a fraction of the code.

---

## Non-Functional Requirements

- **Security & Privacy**: Designs and reports carry no credentials. Enabling a
  plugin runs third-party prompts; the Claude Code pin limits that to one tag.
  A moved tag is not detected; the setup page tells people to check that
  `/plugin` shows version 0.1.1.
- **Cost**: This design's own review used four reviewers, then five reviewers
  with 42 verifiers, then a confirmation round; the required minimum per
  feature is one EGM review and one two-reviewer confirmation round.
- **Rollout & Rollback**: Old manifests and v4 reports fail with a version
  message. Leftover `~/.vortex-ai/leases`, `harness/.slots` and
  `.vortex-worktrees` folders are inert; the docs say how to remove them.
  Reverting this change restores everything.

## Risks and Mitigations

- **Two commands at once**: nothing serializes them. Mitigation: convention,
  `assertPortAvailable` at launch, and the refusals above.
- **A launch outside doodlebot's launchers** (a raw Playwright or Electron
  start) writes no record and is invisible to the refusals. Mitigation: every
  kit launcher writes the record; documented.
- **PID reuse after a crash**: the record's pid must belong to a live
  `Vortex.exe` or `electron.exe`; otherwise the record is cleared. A reused
  pid that happens to be another Electron app still looks alive; `down`
  waits 30 s, reports it and never signals it, and deleting
  `harness/.cache/instance.json` is the documented recovery.
- **Core lifecycle baseline**: `harness/TESTING.md` records released 2.8.0
  failing the lifecycle test once ("Vortex did not exit cleanly"). Mitigation:
  the core suite runs on the base commit first; the change must not add
  failures.
- **Watcher during a test**: a reload can invalidate UI refs mid-action.
  Mitigation: documented; do not run the watcher during tests.
- **Mislabelled kind** skips the design requirement. Mitigation: the
  independent review judges applicability.
- **An agent fabricates approval**. Mitigation: links and committed designs
  are checkable and the independent review checks them; a quoted approval from
  an unreachable conversation is an accepted residual risk.
- **QA inherits the author's profile**. Mitigation: QA starts with
  `up --fresh`.
- **EGM human gates block unattended agents**. Mitigation: the human
  checkpoint rules above.
- **Codex reviewers are neither read-only nor instruction-isolated**.
  Mitigation: briefs say so; reports name the harness and version.
- **Edits before review**: four resource files and `.claude/settings.json`
  were written before this design's first review round, and revisions 1 to 4
  were reviewed before the confirmation-round format existed. Mitigation: this
  amended revision is confirmed by a round on a clean detached checkout of the
  base, as the amendment procedure allows; the early edits stay disclosed here
  and in `contested.md`.
- **Renamed executables**: a Vortex started from an executable not named
  `Vortex.exe` or `electron.exe` counts as stale and is not protected.
  Mitigation: documented.
- **Script API break**: scripts outside this repository that called
  `claimInstanceLease` from `kit.ts` fail. Mitigation: delete the call; the
  human script reference says so.

---

### Additional Resources

- [Introducing the Elephant-Goldfish Model plugin](https://opensource.googleblog.com/2026/10/introducing-elephant-goldfish-model-plugin.html),
  Google Open Source Blog, 2026-10-22.
- EGM `v0.1.1`: `docs/designs/architecture.md`, `docs/claude.md`,
  `docs/codex.md`, `docs/harnesses.md`, `skills/egm-review/SKILL.md`,
  `skills/egm-review-loop/SKILL.md`. Rounds 1 and 2 used personas from `main`
  at `5382b17`.

### Future Improvements

- **Drift check**: `design check` over `designs/` in `pnpm run ci`.
- **doodlebot as a plugin**: package the skills, the runtime Goldfish and setup
  commands for OAuth and game snapshots; a separate design.

---

## Detailed Implementation Plan

Order of work: (1) Part B removals and survivors, with their tests; (2)
`design.ts`, `designCommand.ts` and tests; (3) readiness 3; (4) EGM resources;
(5) documents and regenerated references; (6) checks. Phases 1 to 4 each end
with `pnpm run typecheck` and `pnpm exec vitest run` passing, except
`singleInstance.test.ts` and `egmResources.test.ts`, which pass from phase 5.
`docs:check` pairs sources with documents across the whole change, so only the
final state must pass `pnpm run ci`.

### Target Scope & File Boundary

- `designs/egm-workflow.md`
- `designs/SITEMAP.md`
- `.gitignore`
- `harness/.gitignore`
- `package.json`
- `vitest.config.ts`
- `.github/workflows/ci.yml`
- `harness/playwright.config.ts`
- `harness/oauth.playwright.config.ts`
- `harness/readiness.example.json`
- `harness/reviews/workflow-plan.md`
- `harness/src/lease.ts`
- `harness/src/lease.test.ts`
- `harness/src/leaseCommand.ts`
- `harness/src/leaseCommand.test.ts`
- `harness/src/operations.ts`
- `harness/src/operations.test.ts`
- `harness/src/checkoutOperation.ts`
- `harness/src/liveOperation.ts`
- `harness/src/kitLock.ts`
- `harness/src/kitLock.test.ts`
- `harness/src/slots.ts`
- `harness/src/slots.test.ts`
- `harness/src/worktree.ts`
- `harness/src/worktree.test.ts`
- `harness/src/worktreeProcess.test.ts`
- `harness/src/paths.ts`
- `harness/src/processes.ts`
- `harness/src/runningVortex.ts`
- `harness/src/runningVortex.test.ts`
- `harness/src/singleInstance.test.ts`
- `harness/src/config.ts`
- `harness/src/config.test.ts`
- `harness/src/cli.ts`
- `harness/src/cliArgs.ts`
- `harness/src/cliArgs.test.ts`
- `harness/src/kit.ts`
- `harness/src/instance.ts`
- `harness/src/instance.test.ts`
- `harness/src/bootstrap.ts`
- `harness/src/bootstrap.test.ts`
- `harness/src/runningProfile.ts`
- `harness/src/runningProfile.test.ts`
- `harness/src/electronRuntime.ts`
- `harness/src/electronRuntime.test.ts`
- `harness/src/e2e.ts`
- `harness/src/evidence.ts`
- `harness/src/evidence.test.ts`
- `harness/src/processRunner.ts`
- `harness/src/processRunner.test.ts`
- `harness/src/prPreflight.ts`
- `harness/src/prPreflight.test.ts`
- `harness/src/vortexBuild.ts`
- `harness/src/vortexBuild.test.ts`
- `harness/src/vortexE2e.ts`
- `harness/src/vortexE2e.test.ts`
- `harness/src/source.ts`
- `harness/src/source.test.ts`
- `harness/src/sourceBuild.test.ts`
- `harness/src/extensionBuild.ts`
- `harness/src/extensionBuild.test.ts`
- `harness/src/extensionGeneration.ts`
- `harness/src/extensionGeneration.test.ts`
- `harness/src/hotReload.ts`
- `harness/src/hotReload.test.ts`
- `harness/src/fixtureCleanup.test.ts`
- `harness/src/tests/fixtures.ts`
- `harness/src/tests/fixtureCleanup.ts`
- `harness/src/tests/leaseGlobalSetup.ts`
- `harness/src/tests/singleInstanceGlobalSetup.ts`
- `harness/src/tests/parallel-sessions.e2e.ts`
- `harness/src/tests/bethesda.e2e.ts`
- `harness/src/tests/collection-download-retry.e2e.ts`
- `harness/src/tests/collection-scale.e2e.ts`
- `harness/src/tests/download-churn.e2e.ts`
- `harness/src/tests/large-library.e2e.ts`
- `harness/src/tests/mods-scroll.e2e.ts`
- `harness/src/tests/panels.e2e.ts`
- `harness/src/tests/plugins-mod-link.e2e.ts`
- `harness/src/tests/plugins-page.e2e.ts`
- `harness/src/tests/zoom.e2e.ts`
- `harness/benchmarks/session.ts`
- `harness/benchmarks/sessionCleanup.test.ts`
- `harness/benchmarks/gameSettings.ts`
- `harness/benchmarks/gameFixtures.test.ts`
- `harness/benchmarks/credentials.ts`
- `harness/benchmarks/credentials.test.ts`
- `benchmarks/setup.ts`
- `benchmarks/setup.test.ts`
- `benchmarks/setup-cli.mts`
- `harness/src/design.ts`
- `harness/src/design.test.ts`
- `harness/src/designCommand.ts`
- `harness/src/designCommand.test.ts`
- `harness/src/egmResources.test.ts`
- `harness/src/readiness.ts`
- `harness/src/readiness.test.ts`
- `harness/egm/vortex-change-standard.md`
- `harness/egm/vortex_runtime.md`
- `.claude/settings.json`
- `.claude/agents/vortex-runtime-goldfish.md`
- `.claude/skills/vortex-elephant/SKILL.md`
- `.claude/skills/vortex-dev/SKILL.md`
- `.claude/skills/drive-vortex/SKILL.md`
- `.claude/skills/vortex-ui-test/SKILL.md`
- `scripts/docs.cjs`
- `scripts/documentation-map.json`
- `mkdocs.yml`
- `AGENTS.md`
- `ARCHITECTURE.md`
- `KNOWLEDGE.md`
- `README.md`
- `harness/AGENT-WORKFLOW.md`
- `harness/AGENTS.md`
- `harness/WORKFLOWS.md`
- `harness/KNOWLEDGE-ROUTES.md`
- `harness/TESTING.md`
- `harness/PULL-REQUESTS.md`
- `harness/reference/cli.md`
- `harness/reference/package-scripts.md`
- `harness/reference/script-api.md`
- `docs/guides/agent-plugins.md`
- `docs/guides/design-review.md`
- `docs/guides/parallel-sessions.md`
- `docs/guides/source-development.md`
- `docs/reference/cli.md`
- `docs/reference/configuration.md`
- `docs/reference/sessions.md`
- `docs/reference/collections.md`
- `docs/reference/package-scripts.md`
- `docs/reference/index.md`
- `docs/troubleshooting.md`
- `docs/testing/unit.md`
- `docs/testing/running.md`
- `docs/maintaining-documentation.md`
- `docs/index.md`

### Target Files to Create/Modify

#### 1. `harness/src/design.ts` (Create)

- **Type / Scope**: Pure TypeScript; no I/O.
- **Proposed Changes**:
  - `export const designStatuses = ["Draft", "Proposed", "In Review", "Approved"] as const;`
  - `export const contractNames = ["runtime", "ui", "persistent-data", "public-api", "performance"] as const;`
  - `export interface DesignDocument { title?: string; author?: string; status?: string; target?: string; approvedLine?: string; approval?: { by: string; contentSha256: string; reference: string }; acceptance: { id: string; criterion: string }[]; contracts: string[]; noContracts: boolean; boundary: { entry: string; generated: boolean }[]; unparsedBoundaryHeadings: string[]; sections: string[]; openQuestions: string[]; tbd: boolean; contentSha256: string }`
  - `export function parseDesign(markdown: string): DesignDocument`, `export function designContentSha256(markdown: string): string`, per the Design format.
  - `export const requiredSections` lists the required level-2 names in the Design format order, then `Verification Plan`.
  - `export function checkDesign(design: DesignDocument, options: { ready?: boolean } = {}): string[]` with these issues in this order: `missing title`; `missing status`; `unknown status <s>`; `missing target`; `unknown target <t>`; `missing section <name>` per section; `no acceptance criteria`; `duplicate acceptance id <id>`; `unknown contract <c>`; `no affected contracts declared`; `empty file boundary`; `broad boundary entry <e>`; `unparsed boundary heading <text>`; `Approved line on an unapproved design`; when Approved: `approved without an Approved line`, `malformed Approved line`, `approval digest <a> does not match content <d>`; and when Approved or `ready`: `open questions remain`, `TBD remains`. The "approval issues" are the three Approved-line issues.
  - `export function inBoundary(file: string, boundary: string[]): boolean`: `\` becomes `/` and a leading `./` is removed on both sides; an entry ending `/` matches files below it; otherwise the entry is a case-sensitive glob where `**` matches any characters including `/`, `*` any characters except `/`, and every other character is literal; `dir/**` does not match `dir`.
  - `export function outsideBoundary(changed: string[], boundary: string[], designFile?: string): string[]` in input order.
  - `export function relativeInside(root: string, file: string): string | undefined` returns the forward-slash path of `file` under `root` (both resolved with `path.resolve`), or undefined when outside. Callers pass real paths (`fs.realpathSync.native`) for both, since the checkout identity's root is a real path; an 8.3 short name or junction on one side would otherwise hide the design file.
  - `export function designTemplate(title: string, target: "vortex" | "doodlebot", date: string): string` returns `# <title>`, the header bullets Author `<name>` (that literal placeholder), Status `Draft`, Target and Date, `---`, then exactly these headings: `## Overview`, `## The Problem`, `## Goals`, `## Non-Goals`, `## Open Questions` (with `None.`), `## Acceptance Criteria`, `## Affected Contracts`, `## Critical User Journeys (CUJs)`, `## Technical Plan (Architecture)`, `## Alternatives Considered`, `## Non-Functional Requirements`, `## Detailed Implementation Plan`, `### Target Scope & File Boundary`, `### Target Files to Create/Modify`, `### Verification Plan`; and, for `doodlebot`, the boundary bullet `` - `designs/SITEMAP.md` ``. For `("T","vortex","2026-01-01")`, `checkDesign(parseDesign(...))` equals `["no acceptance criteria", "no affected contracts declared", "empty file boundary"]`; for `doodlebot` it equals the first two.

#### 2. `harness/src/design.test.ts` (Create)

- Template issue lists for both targets; header first-match and prose and fenced mentions ignored; every `checkDesign` issue; approval parsing and digest match; digest unchanged by Status, Date, Approved, CRLF and BOM, changed by a body edit; continuation without indentation and code spans across lines; `None` contracts with backticks; open questions `None`, `none.`; boundary bullets with two paths; unparsed and lettered `####` headings; breadth and `generated`; `inBoundary` cases: exact, `dir/`, `*` not crossing `/`, `**`, `dir/**` versus `dir`, literal `.`, `?`, `[`, case, `./`; `outsideBoundary` design exemption; `relativeInside` inside and outside; and `checkDesign(parseDesign(read("designs/egm-workflow.md")))` equals `[]`.

#### 3. `harness/src/designCommand.ts` (Create)

- **Type / Scope**: CLI logic with file and git I/O, returning `{ code: number; stdout: string }` and throwing `ConfigError` for usage errors.
- **Proposed Changes**: `export function designCommand(positional: string[], flags: Record<string, string | boolean>, today: () => string): { code: number; stdout: string }`:
  - `new <file> --title <t> --target vortex|doodlebot`: errors `design new needs --title.`, `design new needs --target vortex or doodlebot.`, `<file> already exists.`; creates parent folders; writes `designTemplate`; stdout `Wrote <file>`; code 0.
  - `check <file> [--ready] [--json]`: `--ready` passes `{ready: true}` to `checkDesign`; JSON `{file, contentSha256, issues, design}`; text `OK <file>` or `ISSUES <file>` followed by one issue per line, then `content sha256: <d>`; code 1 when issues exist.
  - `scope <file> --checkout <dir> --base <ref> [--json]`: errors `design scope needs --checkout and --base.`; identity from `captureCheckoutIdentity`; design file through `relativeInside`; `approved` is Status Approved with no approval issue; JSON `{file, checkout, base, approved, changedFiles, boundary, outside}`; text lists `outside: <file>` lines or `IN SCOPE`, plus `warning: design is not approved` when not approved; code 1 when `outside` is non-empty.
  - A missing file argument: `ConfigError("design <subcommand> needs a design file.")`; `check` or `scope` on a missing file: `ConfigError("<file> does not exist.")`.
  - Other subcommands: `ConfigError("Use design new, check or scope.")`.

#### 4. `harness/src/designCommand.test.ts` (Create)

- A temporary git repository with a committed base, an approved design listing one file, one changed file inside and one outside; asserts `new` writing and refusing, both `check` outputs and codes, `check --ready` reporting an open question on an In Review design, `scope` refusing without `--base`, naming the outside file with code 1, `IN SCOPE` with code 0 after reverting it, and the unapproved warning.

#### 4a. `harness/src/cli.ts` (Modify)

- **Proposed Changes**: next to the `readiness` block and before configuration loading: `if (command === "design") { const result = designCommand(positional, flags, () => new Date().toLocaleDateString("sv-SE")); log(result.stdout); return result.code; }`. HELP gains, between the instance-lifecycle section and "Driving a running instance", a section:

  ```text
  Design-first work (EGM)
    design new <file> --title <t> --target vortex|doodlebot
                           Write the design template; refuses an existing file
    design check <file> [--ready] [--json]
                           Validate structure and approval; print the content digest
    design scope <file> --checkout <dir> --base <ref> [--json]
                           List changed files outside the approved boundary; exit 1 if any
  ```

  The `readiness --manifest` line says schema version 3. Every removed command, flag and HELP line goes; `watch` loses "Needs an existing owned app".

#### 5. `harness/src/egmResources.test.ts` (Create)

- Splits frontmatter between the first two `---` lines and reads `key: value` lines as exact strings. Asserts: `.claude/settings.json` deep-equals `{extraKnownMarketplaces: {egm: {source: {source: "github", repo: "google/elephant-goldfish-model", ref: "v0.1.1"}}}, enabledPlugins: {"egm@egm": true}}`; the adapter has `name: vortex-runtime-goldfish`, `tools: Read, Grep, Glob`, `model: inherit`, `omitClaudeMd: true` and names `harness/egm/vortex_runtime.md`; the persona's `name` equals it; the standard exists and contains every `requiredSections` name; the skill has `name: vortex-elephant`; root `AGENTS.md` contains `EGM artifact directory: harness/.artifacts/egm` and the skill and persona paths; `docs/guides/agent-plugins.md` contains `v0.1.1`, `codex plugin marketplace add google/elephant-goldfish-model`, `codex plugin add egm@egm`, `2.1.271` and `issues/237`.

#### 6. `harness/src/readiness.ts` (Modify)

- Readiness 3 as specified, importing from `./design`; ancestry via `execFileSync("git", ["-C", subject.checkout, "merge-base", "--is-ancestor", reviewHead, subjectHead])`; contract enum from `contractNames`; the `inferredContracts` pattern updated.

#### 7. `harness/src/readiness.test.ts` (Modify)

- Fixture schema 3; helper writing an approved design, two digest reports and a pre-implementation identity; feature tests at lines 172-194 and 370-430 supply them. Cases: each rule-1 to rule-6 message, both no-design messages, the two `reviewedDesignSha256` placement messages, a bug held to a supplied design, a bug without one, design-review criteria not counted, the schema-2 `ConfigError`, a rebased subject whose head descends from the review head.

#### 8. `harness/src/runningVortex.ts` (Create)

- As specified in Part B.

#### 8a. `harness/src/runningVortex.test.ts` (Create)

- `INSTANCE_RECORD` is read from `DEFAULT_CACHE_DIR`; tests mock `./paths` so `DEFAULT_CACHE_DIR` is a temporary folder. Cases: absent record, invalid JSON, dead pid cleared, live pid (`process.pid`) with the image check stubbed to `node.exe` (stale, cleared) and to `electron.exe` (running), unknown fields tolerated, `writeInstanceRecord` throwing on an unwritable path, `clearInstanceRecord` with matching and other pid, `assertNoVortexRunningFrom` matching and not matching a checkout, and both exact messages.

#### 9. `harness/src/processes.ts` (Create)

- `export function processAlive(pid: number): boolean` moved from `lease.ts`, and `processImageName` as specified.

#### 10. `harness/src/singleInstance.test.ts` (Create)

- Lists files with `git ls-files -z --cached --others --exclude-standard`, keeps those that exist on disk, skips binary extensions (`.png`, `.ttf`, `.zip`, `.7z`), reads UTF-8 and matches plain substrings. It fails on any file outside the allow-list containing: `lease.ts`, `leaseCommand`, `operations.ts`, `checkoutOperation`, `liveOperation`, `kitLock`, `slots.ts`, `worktree.ts`, `requireNamedOwner`, `resolveOwner`, `withOperation`, `withLiveOperation`, `withCheckoutOperation`, `OperationOptions`, `CONTEXT_ENV`, `acquireLease`, `claimInstanceLease`, `slotPaths`, `VORTEX_AI_OWNER`, `VORTEX_AI_SLOT`, `VORTEX_AI_LEASE_DIR`, `--owner`, `--slot`, `--worktree`, `--checkout-only`, `ai:lease`, `ai:test:parallel-sessions`, `kit lock`, `instance lease`, `.vortex-worktrees/<`. The allow-list is this design, this test, `.gitignore`, `harness/.gitignore` and `docs/troubleshooting.md` (obsolete-folder note). It also asserts the listing contains `harness/src/instance.ts` and `harness/AGENTS.md`, so an empty or wrong listing fails.

#### 11. `harness/src/config.test.ts` (Create)

- Default cache, artifacts and ports; `loadConfig` overrides and the `VORTEX_AI_CACHE_DIR`, `VORTEX_AI_ARTIFACT_DIR`, `VORTEX_MCP_PORT` and `VORTEX_AI_CDP_PORT` variables override them (the `--cache-dir`, `--port` and `--cdp-port` flags become those overrides in `cli.ts`'s `configFrom`).

#### Other Part B edits (Modify or Delete)

- Delete the files listed under "What is deleted".
- Edit every other Part B file in the boundary to remove owners, slots, leases, guards, contexts and worktree support and to call the survivors as "What survives and where" specifies. Per file:

| File                                                                                                                                    | Removed                                                                                    | Replacement / test change                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instance.ts`, `instance.test.ts`                                                                                                       | lease resources, `claimInstanceLease`, `recordLaunchedPid`, `isAlive`, `withLiveOperation` | instance record as specified; `stopRunningInstance` added and called by the CLI's `down`; tests: record written at spawn, cleared after exit, launch fails on write error, legacy files deleted, failed spawn observer still kills the child, `stopRunningInstance` stops another cache's recorded instance using its cache and port and prints the message |
| `bootstrap.ts`, `bootstrap.test.ts`                                                                                                     | `withLiveOperation`, owner                                                                 | direct calls; `seedLoginFromDefaultCache`; test drops the `./liveOperation` mock                                                                                                                                                                                                                                                                            |
| `config.ts`, `paths.ts`                                                                                                                 | slot selection, owner                                                                      | default ports and directories; `normalizedPath` in `paths.ts`                                                                                                                                                                                                                                                                                               |
| `runningProfile.ts`, its test                                                                                                           | `normalizedPath` import from lease, owner fixtures                                         | import from `./paths`                                                                                                                                                                                                                                                                                                                                       |
| `electronRuntime.ts`, its test                                                                                                          | install lock                                                                               | direct install; lock test deleted                                                                                                                                                                                                                                                                                                                           |
| `processRunner.ts`, its test                                                                                                            | context, lease env, persistent resources                                                   | `callerCwd`, `runInteractive`; tests: child code, 130 after abort, 128 + signal, `INIT_CWD` cwd                                                                                                                                                                                                                                                             |
| `evidence.ts`, `vortexBuild.ts`, `source.ts`, `prPreflight.ts`, `vortexE2e.ts` and tests                                                | checkout operations, owner, leases                                                         | `assertNoVortexRunningFrom`; tests write a record with `process.pid` in a mocked default cache and assert the refusal; vortex-e2e schema 5                                                                                                                                                                                                                  |
| `extensionBuild.ts`, `extensionGeneration.ts`, `hotReload.ts` and tests                                                                 | guards, owner, `waiting` event                                                             | direct cycles; tests drop guard and waiting cases, keep debounce, profile and swap cases                                                                                                                                                                                                                                                                    |
| `e2e.ts`, `kit.ts`, `cliArgs.ts`, `cliArgs.test.ts`                                                                                     | owner, `claimInstanceLease`, removed flags                                                 | evidence passthrough tests keep, without `--owner`                                                                                                                                                                                                                                                                                                          |
| `tests/fixtures.ts`, `tests/fixtureCleanup.ts`, `fixtureCleanup.test.ts`                                                                | lease identities, `withLiveOperation`, `CONTEXT_ENV`                                       | `assertNoHarnessVortex`, `writeInstanceRecord` at launch, `clearInstanceRecord` after confirmed exit; `processAlive` from `./processes`                                                                                                                                                                                                                     |
| `tests/*.e2e.ts` (ten scripts)                                                                                                          | `claimInstanceLease` call                                                                  | none; `zoom.e2e.ts --signed-out` calls `assertNoHarnessVortex` and uses the default ports                                                                                                                                                                                                                                                                   |
| `harness/benchmarks/session.ts`, `gameSettings.ts`, `credentials.ts` and tests; `benchmarks/setup.ts`, `setup-cli.mts`, `setup.test.ts` | game-settings lease, `.benchmark-lock`, setup lease, owner, slot 0                         | `assertNoHarnessVortex`, instance record, `isRunning`; tests assert the reset refusal with an injected `isRunning`                                                                                                                                                                                                                                          |
| `vitest.config.ts`, `ci.yml`                                                                                                            | `VORTEX_AI_OWNER`, `VORTEX_AI_LEASE_DIR`, `VORTEX_AI_OPERATION_CONTEXT`                    | none                                                                                                                                                                                                                                                                                                                                                        |
| `readiness.example.json`                                                                                                                | `schemaVersion: 2`                                                                         | `schemaVersion: 3`                                                                                                                                                                                                                                                                                                                                          |

#### EGM resources (Create)

- `harness/egm/vortex-change-standard.md`: Core Principle; Machine-checked format matching the Design format, naming every entry of `requiredSections` (asserted by `egmResources.test.ts`); Requirements: target and revision, reproduction of the user's own scenario, fixture and prerequisites, authorization, stock-Vortex compatibility, verification mapped to readiness roles, controls, UI matrix, performance runs, formatting before review.
- `harness/egm/vortex_runtime.md`: frontmatter `name: vortex-runtime-goldfish`, `description`, `license: GPL-3.0-only`; Core Mandates; Role; BRAINSTORM and REVIEW instructions; audit vectors (unprovable criterion, substitute evidence, hidden prerequisite, contract mismatch, boundary gap); the `Reviewed content sha256` first line; output format.
- `.claude/agents/vortex-runtime-goldfish.md`: frontmatter `name`, `description`, `tools: Read, Grep, Glob`, `model: inherit`, `omitClaudeMd: true`; body tells it to read the persona and standard, stay read-only and report an incomplete review when a file cannot be read.
- `.claude/skills/vortex-elephant/SKILL.md`: frontmatter `name: vortex-elephant`, `description`; steps in order: scope; reading (`harness/AGENT-WORKFLOW.md`, `harness/KNOWLEDGE-ROUTES.md`, `ARCHITECTURE.md`, relevant `KNOWLEDGE.md`, and for Vortex its `AGENTS.md` and `docs/README.md`); brainstorm; draft; copy to the design path; consolidated review; resolve; format and check; confirmation round with the exact reviewer arguments for `/egm:egm-review-loop`; human approval; implementation; `design scope`; `down`; independent QA; readiness. Includes the Codex equivalents.
- `.claude/settings.json`: the JSON in item 5.
- `designs/SITEMAP.md`: `# Designs`, one sentence, then a bullet per design with link, status and target.

#### Documentation (Modify, Create or Delete)

- `scripts/documentation-map.json`: remove `docs/guides/parallel-sessions.md` from every group and the deleted modules from source patterns; add group "Design-first workflow" with sources `^harness/src/design(Command)?\.ts$`, `^harness/egm/`, `^\.claude/(settings\.json|agents/|skills/vortex-elephant/)`, `^designs/SITEMAP\.md$`, human `docs/guides/design-review.md` and `docs/guides/agent-plugins.md`, AI `harness/AGENT-WORKFLOW.md` and `harness/AGENTS.md`; add `harness/src/(runningVortex|processes)` to the "Lifecycle and authentication" sources.
- `scripts/docs.cjs`: the instance-module note says "Nothing from this module is re-exported by the scratch-script kit; its symbols require a direct repository import."
- `mkdocs.yml`: remove nothing (parallel sessions was not in the nav); add Guides entries "Set up design review in your coding agent: guides/agent-plugins.md" and "Review and approve a design: guides/design-review.md".
- Agent documents: `AGENTS.md` (table, artifact line, lifecycle paragraph, skill and persona paths for every agent, publication exception without the lock, no worktrees); `harness/AGENT-WORKFLOW.md` (new "Design first" section; resource rules become one-instance rules; QA after `down`); `harness/AGENTS.md` (remove "Parallel sessions" and "The instance lease" sections but move the benchmark-preparation paragraph to "Run and reset"; `design` commands; readiness 3 with a feature manifest snippet; variable table; skills list adds `vortex-elephant`); `harness/WORKFLOWS.md` (remove "Several agents at once" except QA, demo and head-switch procedures rewritten for one checkout; add "Designing a change before coding (EGM)"; rename `## Implementing a feature from a design` to `## Implementing a supplied visual design`); `harness/KNOWLEDGE-ROUTES.md`; `harness/TESTING.md`; `harness/PULL-REQUESTS.md` (link the approved design; no slots); `KNOWLEDGE.md` (lease entries rewritten for the instance record); `ARCHITECTURE.md` (one instance); the four skills.
- Human documents: create `docs/guides/agent-plugins.md` (the per-surface table, steps, checks, headless read permissions `Read(//c/Users/<you>/.claude/plugins/cache/egm/egm/*/agents/**)` and the same for `docs`, `resources`, `skills`; no links to agent instruction files) and `docs/guides/design-review.md` (roles, what a design contains, reading reports, approving with the `Approved` line and digest, what `design scope` and readiness enforce); delete `docs/guides/parallel-sessions.md`; edit `docs/guides/source-development.md`, `docs/reference/configuration.md`, `docs/reference/sessions.md`, `docs/reference/collections.md`, `docs/reference/index.md`, `docs/troubleshooting.md` (one instance; leftover folders), `docs/testing/unit.md`, `docs/testing/running.md`, `docs/maintaining-documentation.md`, `docs/index.md`, `README.md`.
- Regenerated by `pnpm run docs:generate`: `docs/reference/cli.md`, `docs/reference/package-scripts.md`, `docs/reference/collections.md` contract blocks, `harness/reference/cli.md`, `harness/reference/package-scripts.md`, `harness/reference/script-api.md`.

### Verification Plan

Task kind `feature`, target `doodlebot`, contracts `runtime`,
`persistent-data` and `public-api`. `B` is
`04444c1fe3a5f3e71c2eda4dba90232a77513912`; `A` is
`harness/.artifacts/egm-overhaul`; `X` is the released Vortex 2.8.0 at the
absolute path `C:/dev/doodlebot/harness/.artifacts/vortex-release/Vortex.exe`.
Prerequisites for every app run: X exists,
`(Get-Item X).VersionInfo.ProductVersion` starts with `2.8.0`, and
`harness/.artifacts/vortex-release/package.json` contains
`"type": "commonjs"` (X lies inside the `harness` ESM package scope; without
the marker the bundled plugins fail to load, as `KNOWLEDGE.md` records under
"Install paths that fail silently"). No `Vortex.exe` other than X, and no
`electron.exe` whose path lies under `.vortex-src`, is running; if one is, the
owner closes it themselves before the step, which otherwise is reported
blocked.
The agent never runs a Vortex installer on the owner's machine, because an
installer can uninstall or downgrade the owner's own Vortex; if X is missing,
the app steps are reported blocked, and a person can provide X from CI's
pinned installer
(`https://github.com/Nexus-Mods/Vortex/releases/download/v2.8.0/vortex-setup-2.8.0.exe`,
SHA-256 `4a433bcd5b7d8a735af74d6c23081bfdce659ce70feeba384d43eb3a60028bb2`)
by extracting its app archive with 7-Zip or installing it on a separate
machine, since the same uninstall risk applies to a person running it, and
creating the `package.json` marker above.
Every app run except step 6 (the source build) sets `VORTEX_AI_EXE=X` and
`VORTEX_AI_INSTALLED=1`, and records X's hashes with `evidence runtime`, so
the baseline and change runs are shown to use the same bytes. Every `--out`
and report path is new. `E` abbreviates
`pnpm run ai -- evidence run --checkout . --base B`. A test's identity is its
spec file and title path, ignoring the Playwright project name.

1. **Scoped tests** (`scoped-tests`; criteria `egm-plugin`, `design-cli`,
   `readiness-design`, `goldfish-resources`, `setup-docs`, `single-instance`,
   `single-instance-runtime`): `E --out A/scoped.json --test-format vitest
--test-report A/scoped-tests.json -- pnpm exec vitest run <files>
--reporter=json --outputFile A/scoped-tests.json`, where `<files>` is
   `harness/src/design.test.ts harness/src/designCommand.test.ts
harness/src/egmResources.test.ts harness/src/readiness.test.ts
harness/src/runningVortex.test.ts harness/src/singleInstance.test.ts
harness/src/config.test.ts harness/src/instance.test.ts
harness/src/processRunner.test.ts harness/src/vortexBuild.test.ts
harness/src/evidence.test.ts harness/src/hotReload.test.ts
harness/benchmarks/gameFixtures.test.ts
harness/benchmarks/sessionCleanup.test.ts benchmarks/setup.test.ts`.
2. **Wiring control** (`control` kind `wiring`; `design-cli`): command
   receipt A/scoped.json; assessment `E --out A/wiring.json -- pnpm run ai --
design check designs/egm-workflow.md --ready --json`, exit 0 with
   `issues: []`, which shows the CLI parses `--ready` and reaches
   `designCommand`.
3. **Kit gate** (`kit-ci`; criteria `docs-paired` and
   `single-instance-runtime`, covering every unit test file in the
   repository, including the refusal tests in `source.test.ts`,
   `prPreflight.test.ts`, `vortexE2e.test.ts`, `credentials.test.ts` and
   `setup.test.ts`): `E --out A/ci.json -- pnpm run ci`.
4. **Core suite** (`kit-core`; `single-instance-runtime`). Baseline first, in
   a clean clone of `B` at `<scratch>/base`, where `<scratch>` is a folder
   outside the kit (prerequisite: network access or a warm pnpm store;
   otherwise step 4 is blocked): `pnpm install --frozen-lockfile`,
   `pnpm run build`, then with `$env:VORTEX_AI_OWNER = 'baseline'`,
   `VORTEX_AI_LEASE_DIR` set to a new empty folder under `<scratch>` (so the
   base kit's leases never touch the owner's leftover lease store),
   `VORTEX_AI_SLOT` unset, X set as
   above and `PLAYWRIGHT_JSON_OUTPUT_FILE` set to
   `<scratch>/core-base-tests.json`, in the clone: `pnpm --silent run ai --
evidence runtime --kind installed --label 2.8.0 --mode production X <X
folder>/resources/app.asar dist/index.js > <scratch>/runtime-base.json` and
   `pnpm run ai -- evidence run --owner baseline --checkout . --base B --out
<scratch>/core-base.json --runtime
<scratch>/runtime-base.json --test-format playwright --test-report
<scratch>/core-base-tests.json -- pnpm run ai:test:core --reporter=json`.
   That receipt is a `review` artifact, not readiness evidence, because its
   kit differs. Change run: `pnpm run ai -- down`, then `pnpm --silent run ai
-- evidence runtime --kind installed --label 2.8.0 --mode production X <X
folder>/resources/app.asar dist/index.js > A/runtime.json` and `E --out
A/core.json --runtime A/runtime.json --test-format playwright --test-report
A/core-tests.json -- pnpm run ai:test:core --reporter=json` with
   `PLAYWRIGHT_JSON_OUTPUT_FILE` set to that report. The `kit-core` artifact
   must be the first complete, unfiltered change-side run on the final subject
   identity (a code fix made after a run requires a new run), with zero
   failures and zero skips; anything else is a failed `kit-core`, with every
   receipt kept, and later runs on the same identity are diagnosis only. The
   lifecycle test is compared on its own: its outcome and error text on each
   side decide whether a lifecycle failure is pre-existing (seen on the base)
   or a regression; contract tests not run because of it are not counted as
   separate regressions. Same outcome
   means the same test identities pass on both sides. If a test fails on
   either side, the whole suite (never a filtered or `--no-deps` run) is rerun
   twice more on that side as `review` artifacts; a failure appearing only on
   the change side, or a changed error, is a regression. Contract tests not run
   because the lifecycle test failed count as failed.
   Steps 5 and 6 are account-free: before each `up`, a `pnpm exec tsx`
   one-liner runs with exactly the environment that `up` will use (step 5:
   the temporary `VORTEX_AI_CACHE_DIR`, `VORTEX_AI_INSTALLED=1`,
   `VORTEX_AI_EXE=X`; step 6: the temporary `VORTEX_AI_CACHE_DIR`,
   `VORTEX_AI_DEV_DIR=<absolute .vortex-src>`, `VORTEX_AI_INSTALLED` and
   `VORTEX_AI_EXE` unset), writes `null` to `authCacheFile(loadConfig())` (the
   logout tombstone the core fixtures use) and prints that path and
   `loadConfig().target.kind`. The step stops before `up` unless the target
   kind is the one the step launches (`installed`, then `dev`) and the file
   holds `null`, so `seedLoginFromDefaultCache` cannot copy the owner's login.
   While Vortex runs, `pnpm run ai -- auth-status` must report
   `oauthPresent: false`. After each step's `down`, its temporary cache is
   deleted. Scripts, logs and outputs go under `A` (ignored) or directory D,
   which is outside the kit, so the subject identity never changes; D has no
   `package.json`, and scripts are given by absolute path. Every path
   comparison in steps 5 and 6 (temporary folder, `cacheDir`, `userDataDir`,
   the `down` message) is made after `fs.realpathSync.native` on both sides,
   because Windows temporary paths may use 8.3 short names.

5. **Live installed check** (`review` artifact; `single-instance-runtime`),
   with `VORTEX_AI_CACHE_DIR` set to a new temporary folder (standing in for
   `up --fresh`) for every command: `up --installed --sandbox` started with
   `Start-Process` and a log; read `harness/.cache/instance.json` and check it
   against independent observations: `(Get-Process -Id <pid>).Path` is X and
   `cacheDir` is the temporary folder; `pnpm run ai:test:core` exits 1 with the
   CUJ 5 message; `pnpm run ai:test:zoom -- --signed-out` exits 1 with the
   `assertNoHarnessVortex` message whose action is
   `the signed-out zoom check`; from a directory D other than the kit root,
   `pnpm --dir <kit> run ai -- script <file>`, where the script prints
   `process.cwd()` and `automation_status.userDataDir`, exits 0, prints D and
   a `userDataDir` under the temporary folder; then, with
   `VORTEX_AI_CACHE_DIR` unset,
   `pnpm run ai -- down` prints `Stopping the harness Vortex of cache <temp>
(MCP port 3701).` and `Vortex exited cleanly.`; the record is absent and the
   pid gone afterward.
6. **Live source-build check** (`review` artifact; `single-instance-runtime`).
   Prerequisite: `.vortex-src` exists with its dependencies installed (it does
   at review time; `pnpm run ai:source` would clone the owner's fork over the
   network otherwise). Every command of this step runs with
   `VORTEX_AI_CACHE_DIR` set to a new temporary folder, so the default cache's
   working profile is never replaced. `pnpm run ai -- build --checkout
.vortex-src`; `up --dev-dir .vortex-src --sandbox` started with
   `Start-Process`; the record's `cacheDir` is the temporary folder, its
   `sourceDir` equals the absolute `.vortex-src` path under `normalizedPath`
   and its pid's image is `electron.exe`; `pnpm run ai -- build --checkout
.vortex-src` exits 1 with the `assertNoVortexRunningFrom` message whose
   action is `building it`, and the SHA-256 of the checkout's build output
   (`src/main/build` and `src/renderer/lib`, hashed file by file) is the same
   before and after the refused command, and `automation_status` still answers
   with the same `userDataDir`; then `down`. If the prerequisite is missing or
   the build fails, the step is reported as blocked with the reason and
   output.
7. **Independent review** (`review`; `setup-docs`, `docs-paired`,
   `single-instance-runtime`): a fresh-context reviewer per lens (lifecycle,
   checkout and CLI, design and readiness, documentation, completeness), each
   finding checked by a skeptic, then a fresh re-review of the fixes. The
   documentation lens compares `docs/guides/design-review.md` and
   `docs/guides/agent-plugins.md` with `harness/AGENTS.md`,
   `harness/AGENT-WORKFLOW.md`, `harness/WORKFLOWS.md` and the
   `vortex-elephant` skill for the same lifecycle steps, folders, approval
   format and readiness rules. Artifacts: the review JSON, the re-review, the
   live logs of steps 5 and 6, the step 8 output and the baseline receipt. If
   step 5 or 6 is blocked, the `review` entry is `blocked` with that reason,
   so readiness cannot pass over the unproven live claim.
8. **Scope and selections**: `pnpm run ai -- design scope
designs/egm-workflow.md --checkout . --base B --json` reports `outside: []`
   and exits 0; `pnpm exec playwright test --config
harness/oauth.playwright.config.ts --list` lists only `oauth-restore.spec.ts`;
   `--config harness/playwright.config.ts --list` lists the 21 core tests in
   projects `lifecycle` and `contract` (both `review` artifacts).
9. **Not run**, as a scope choice: nine of the ten opt-in `tests/*.e2e.ts`
   scripts (the edit removes one import and call from each; `zoom.e2e.ts`'s
   signed-out refusal is checked in step 5), the benchmark session and
   `setup-cli.mts`. Some need the Bethesda sandbox or a Nexus account; the
   sandbox-only ones (`download-churn`, `large-library`, `mods-scroll`,
   `collection-scale`) are performance checks whose single-instance edits are
   covered by typecheck and unit tests. `ai:test:oauth` (its config gains
   `projects: undefined` and the single-instance global setup) needs the
   owner's cached sandbox login from `save-login --sandbox` and is not run.
   Claude Code loading the plugin and Codex installing it need a person to
   accept the folder trust prompt or install the plugin;
   `docs/guides/agent-plugins.md` gives the check.
10. **Readiness on this change**: `readiness --manifest A/manifest.json
--json` with the `design-review` entry from the confirmation round on this
    revision. It is expected to be evidence-complete; any issue it reports is
    a real finding.

Authorization: the owner asked for this overhaul and these removals in chat on
2026-11-09. Approving this design also authorizes its verification steps:
edits and unit checks; launching disposable released Vortex 2.8.0 instances
for the core suite and step 5; building `.vortex-src` and launching it with
`--sandbox` for step 6 (build output only, no source edits; the build replaces
the checkout's existing development build output). The owner has asked that
no test Vortex run beside their own Vortex: before any app step, if a
`Vortex.exe` other than X is running, the owner closes it themselves and the
step waits; otherwise the step is reported blocked. The agent never closes,
kills or restarts the owner's Vortex. Commit and push are not authorized. A
step whose authorization or prerequisite is missing is reported as blocked
with the reason.

---

_Drafted with EGM_
