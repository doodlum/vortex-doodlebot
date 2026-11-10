# Design a feature

This page shows how to have the agent write and review a design for a Vortex or doodlebot
feature with `/vortex:design`, and how you approve it before any code is written.

## Before you begin

- [Install EGM](../get-started/install.md#install-egm-for-design-review), release `v0.1.1`.
- [Set up doodlebot](../get-started/set-up.md).
- Have the feature request or the refactor you want. Bug fixes, documentation and test-only
  changes need no design; use [Fix a Vortex bug](fix-a-bug.md) instead.

[Design first](../concepts/design-first.md) explains why features start this way.

## Write and review the design

1. Run:

   ```text
   /vortex:design <the feature request>
   ```

2. Answer the agent's questions about the idea. The agent, the **Elephant**, keeps the context
   of the task and writes a brief with EGM.

3. Approve each section of the draft as the agent presents it.

4. The agent runs EGM's review stages and fixes what they find. Then, after the last edit, it
   runs a final **confirmation round**: two **Goldfish** reviewers, started without the
   conversation, read the finished text before any implementation exists:

   - `implementation_readiness`, from EGM, checks that someone could build the design without
     asking questions;
   - `vortex-runtime-goldfish`, from the `vortex` plugin, checks that every acceptance criterion
     can be proved on a real Vortex: which app, which test game or collection, which command,
     and what will be observed.

5. Decide any findings the agent disagrees with. It lists them, with its reasons, in
   `contested.md`.

6. Approve the final text (below).

The agent skips steps 2 and 3 only when you told it to in the task. It never approves a design
for you.

## Where the files go

| Files                                                   | Folder                                                                           |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| EGM's briefs, drafts and stage reports                  | `<workspace>/harness/.artifacts/egm`                                             |
| A finished design for a change to Vortex                | `<workspace>/harness/.artifacts/designs/<topic>.md`                              |
| A finished design for a change to doodlebot             | `designs/<topic>.md` in the doodlebot repository, listed in `designs/SITEMAP.md` |
| Reports from the confirmation round, and `contested.md` | `<workspace>/harness/.artifacts/designs/<topic>.reviews/`                        |

Everything under `harness/.artifacts` stays on your machine and is ignored by Git. Vortex designs
are not added to Vortex pull requests; the pull request links the approved copy instead.

## What a design contains

A design is a Markdown file. Its header is a list of bullets under the title:

```markdown
# Show download speed in the status bar

- **Author:** coding agent, for <your name>
- **Status:** In Review
- **Target:** vortex
- **Date:** 2026-11-09
```

`Status` is `Draft`, `Proposed`, `In Review` or `Approved`. `Target` is `vortex` or `doodlebot`.

Read these sections most closely:

| Section                         | What to check                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview, The Problem and Goals | The design solves the problem you have, and Non-Goals excludes what you do not want                                                                    |
| Open Questions                  | Empty, or `None.` An approved design can have no open questions and no `TBD`                                                                           |
| Acceptance Criteria             | Each bullet is `` `id`: criterion ``. Each is something a test or observation could show to be false. The final evidence must cover every one          |
| Affected Contracts              | Which kinds of behavior can change: `runtime`, `ui`, `persistent-data`, `public-api`, `performance`, or `None`. These decide which checks are required |
| Target Scope & File Boundary    | Every file the change may create, modify or delete, by exact path, including tests and documentation                                                   |
| Verification Plan               | For each acceptance criterion, the command or test that proves it, on which Vortex, with which test game or collection                                 |

## Read the review reports

The confirmation-round reports are named `round-<n>-implementation_readiness.md` and
`round-<n>-vortex-runtime-goldfish.md`. Each starts with lines like these:

```text
Harness: Claude Code 2.1.271
EGM: 0.1.1
Checkout: 3b1f… 9c0a…
Reviewed content sha256: d48335f6…
```

`Harness` and `EGM` name the coding agent and plugin versions that ran the review. `Checkout`
identifies the source the reviewers saw. `Reviewed content sha256` is the digest of the text
they reviewed; it must be the digest you approve.

Each finding has a severity. **Blocker** and **Major** findings must be fixed or answered;
**Nit** findings are optional. A round is clean when no Blocker or Major finding is left
unanswered. Otherwise the agent edits the design and runs another round. After three rounds, the
agent stops and asks whether to approve with the remaining findings listed in `contested.md`.
Read `contested.md` before you approve: accepting the design means accepting those reasons.

## Approve the design

1. Ask the agent for the design's path, its content digest and `contested.md`. The agent prints
   the digest with `doodlebot design check <file>`, which ends with `content sha256: <digest>`.
2. Read the design and the reports.
3. Tell the agent you approve, or that it should change something. The agent never writes an
   approval you have not given.

When you approve, the header changes to:

```markdown
- **Status:** Approved
- **Approved:** <person>; content <digest>; <reference>
```

- `<person>` is who approved.
- `<digest>` is the 64-character `content sha256` you approved.
- `<reference>` lets someone else confirm the approval: a link to a pull request review or a
  chat message, or your words quoted with the date.

The digest covers the whole file except the `Status`, `Date` and `Approved` lines. Each of those
lines stays on a single line: if an editor wraps it, the wrapped part counts as body text. **Any
later edit to the body voids the approval**; `design check` then reports
`approval digest <a> does not match content <d>`. An amended design needs a new confirmation
round and a new approval.

## What happens after approval

1. The agent implements the design.
2. It runs `doodlebot design scope <file> --checkout <dir> --base <sha>`, which prints
   `IN SCOPE` or `outside: <file>` for each changed file the design does not list. A file outside
   the boundary is either reverted, or the design is amended and approved again.
3. It stops its test Vortex with `doodlebot down`.
4. A fresh session checks the change with `/vortex:qa`, starting from `doodlebot up --fresh`.
   Its `vortex-driver` starts checking only once that `up` has exited and its log shows
   `Vortex is up in`; a first start launches Vortex up to three times, so an answering Vortex
   alone does not mean the start has finished.
5. The agent records its evidence and runs `doodlebot readiness`; see
   [Evidence and readiness](../concepts/evidence.md).

## What's next

- [Open a pull request](pull-requests.md).
- [Design first](../concepts/design-first.md).
