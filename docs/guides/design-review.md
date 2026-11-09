# Review and approve a design

When a coding agent adds a feature or refactors code in Vortex or Doodlebot, it first writes a design and has it reviewed. You approve the exact text before any code is written. Afterward, Doodlebot checks that the change stayed inside what you approved. This page is for the person who approves.

The agent uses Google's [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) plugin (EGM) for the writing and reviewing. [Set up design review in your coding agent](agent-plugins.md) explains how to install it. The [EGM announcement](https://opensource.googleblog.com/2026/10/introducing-elephant-goldfish-model-plugin.html) describes the model.

Bug fixes do not need a design, and neither do documentation or test-only changes. The agent reproduces the bug, fixes it and shows the evidence. If you supply a design for one anyway, Doodlebot holds the change to it.

## The Elephant and the Goldfish

- The **Elephant** is the agent session you are talking to. It keeps the whole context of the task, asks you questions and writes the design. It does not write code until you approve.
- A **Goldfish** is a reviewer started without the conversation. It sees only the design and the files it is given. Anything the design leaves unsaid is missing to the Goldfish, which is the point: the person or agent who implements the design later will not have the conversation either.

You take part at four points:

1. You answer the agent's questions about the idea.
2. You approve each section of the draft.
3. You decide findings the agent disagrees with.
4. You approve the final text.

The agent skips the first two only when you told it to in the task. It never approves a design for you.

## What a design contains

A design is a Markdown file. For a Doodlebot change it is `designs/<topic>.md` in the repository. For a Vortex change it is `harness/.artifacts/designs/<topic>.md` on your machine and is not added to the Vortex pull request. [This repository's first design](https://github.com/doodlum/vortex-doodlebot/blob/main/designs/egm-workflow.md) is a complete example.

The header is a list of bullets under the title:

```markdown
# Show download speed in the status bar

- **Author:** coding agent, for <your name>
- **Status:** In Review
- **Target:** vortex
- **Date:** 2026-11-09
```

`Status` is `Draft`, `Proposed`, `In Review` or `Approved`. `Target` is `vortex` or `doodlebot`. An approved design also has an `Approved` line, described below.

The parts you should read most closely:

| Section                         | What to check                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview, The Problem and Goals | The design solves the problem you have, and Non-Goals excludes what you do not want                                                                    |
| Open Questions                  | Empty, or `None.` An approved design can have no open questions and no `TBD`                                                                           |
| Acceptance Criteria             | Each bullet is `` `id`: criterion ``. Each is something a test or observation could show to be false. The final evidence must cover every one          |
| Affected Contracts              | Which kinds of behavior can change: `runtime`, `ui`, `persistent-data`, `public-api`, `performance`, or `None`. These decide which checks are required |
| Target Scope & File Boundary    | Every file the change may create, modify or delete, by exact path, including tests and documentation                                                   |
| Verification Plan               | For each acceptance criterion, the command or test that proves it, on which Vortex, with which test game or collection                                 |

A boundary entry that ends in `/` or contains `**` covers many files. `design check` reports it as too broad unless its bullet says the files are generated.

## Read the review reports

The agent first runs EGM's own review stages and fixes what they find. After the last edit, it runs a final **confirmation round**: two Goldfish reviewers read the finished text before any implementation exists.

- `implementation_readiness`, from EGM, checks that someone could build the design without asking questions.
- `vortex-runtime-goldfish`, from Doodlebot, checks that every acceptance criterion can be proved on a real Vortex: which app, which test game or collection, which command, and what will be observed.

Their reports are in `harness/.artifacts/designs/<topic>.reviews/`, named `round-<n>-implementation_readiness.md` and `round-<n>-vortex-runtime-goldfish.md`. Each starts with lines like these:

```text
Harness: Claude Code 2.1.271
EGM: 0.1.1
Checkout: 3b1f… 9c0a…
Reviewed content sha256: d48335f6…
```

`Harness` and `EGM` name the coding agent and plugin versions that ran the review. `Checkout` identifies the source the reviewers saw, before implementation started. `Reviewed content sha256` is the digest of the text they reviewed; it must be the digest you approve.

Each finding has a severity. **Blocker** and **Major** findings must be fixed or answered; **Nit** findings are optional. A round is clean when no Blocker or Major finding is left unanswered. Otherwise the agent edits the design and runs another round.

The agent may disagree with a finding. It writes the finding and its reason in `contested.md` in the same folder. Read that file before you approve: accepting the design means accepting those reasons. If you disagree, tell the agent to change the design. After three rounds, the agent stops and asks you whether to approve with the remaining findings listed in `contested.md`.

## Approve the design

The agent shows you the design path, its content digest and `contested.md` if there is one. You can print the digest yourself:

```powershell
pnpm run ai -- design check <file>
```

It prints `OK <file>` or `ISSUES <file>` followed by one problem per line, and ends with `content sha256: <digest>`. Add `--ready` to also apply the checks for approval, such as no open questions and no `TBD`, to a design that is not yet marked approved.

To approve, tell the agent, or edit the header yourself. Either way, the header changes to:

```markdown
- **Status:** Approved
- **Approved:** <person>; content <digest>; <reference>
```

- `<person>` is who approved.
- `<digest>` is the 64-character `content sha256` you approved.
- `<reference>` lets someone else confirm the approval: a link to a pull request review or a chat message, `edited by <person> <date>` when you wrote the line yourself in a committed Doodlebot design, or your words quoted with the date. A quote from a conversation nobody else can open cannot be confirmed by anyone else.

Keep each header line, especially the long `Approved` line, on a single line: if your editor wraps it, the wrapped part counts as body text and the approval no longer matches. The digest covers the whole file except the `Status`, `Date` and `Approved` lines. Adding the approval does not change it, but **any later edit to the body voids the approval**: `design check` then reports `approval digest <a> does not match content <d>`. An amended design needs a new confirmation round and a new approval of the new digest.

## What happens after approval

The agent implements the design and checks that it stayed inside the file list:

```powershell
pnpm run ai -- design scope <file> --checkout <dir> --base <sha>
```

`--checkout` is the repository being changed and `--base` the commit the change started from. It prints `IN SCOPE`, or `outside: <file>` for each changed file the design does not list and exits with code 1. It adds `warning: design is not approved` when the approval is missing or no longer matches. When a file is outside, either the edit is undone or the design is amended and approved again.

Doodlebot runs one Vortex at a time. Before independent checking, the agent stops its Vortex with `pnpm run ai -- down`. A fresh agent then starts its own with `up --fresh`, so it does not inherit the author's profile, and checks the change.

At handoff, the agent records its evidence in a readiness manifest and runs `pnpm run ai -- readiness --manifest <file>`. For a feature or a refactor, readiness fails unless:

- the design is approved and its digest matches its text;
- its target matches the task's target;
- the manifest's acceptance criteria have the same ids and text as the design's, and passing evidence covers each one;
- every contract the design names is declared in the manifest;
- every changed file is inside the design's file list;
- both confirmation-round reports from one round record the approved digest, were made by a reviewer other than the author, and saw a checkout with no implementation changes that the final change builds on.

Readiness checks that the reviews belong to the approved text and came before the implementation. It does not judge what the reviewers found; the independent reviewer checks the round's outcome, `contested.md` and your approval reference. A ready result is not permission to merge or publish.
