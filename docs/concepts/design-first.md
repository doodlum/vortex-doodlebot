# Design first

This page explains why features and refactors start with an approved design, how EGM's
Elephant and Goldfish review it, and how the approval is tied to the code that follows.

## Before you begin

Read [How doodlebot works](how-it-works.md). To run the procedure, see
[Design a feature](../guides/design-a-feature.md).

## When a design is needed

| Change                             | Design                                        |
| ---------------------------------- | --------------------------------------------- |
| A feature                          | Required, approved before any code is written |
| A refactor                         | Required, approved before any code is written |
| A bug fix                          | None, unless you supply one or ask for one    |
| Documentation or test-only changes | None, unless you supply one or ask for one    |

When you supply a design for a change that does not need one, doodlebot still holds the change
to it.

## The Elephant and the Goldfish

Design work uses Google's [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model)
plugin (EGM). EGM uses two kinds of agent:

- The **Elephant** is the agent session you are talking to. It keeps the whole context of the
  task, asks you questions and writes the design. It writes no code until you approve.
- A **Goldfish** is a reviewer started without the conversation. It sees only the design and the
  files it is given. Anything the design leaves unsaid is missing to the Goldfish, which is the
  point: whoever implements the design later will not have the conversation either.

Doodlebot adds one Goldfish of its own, `vortex-runtime-goldfish`, from the doodlebot plugin. It
reviews against doodlebot's Vortex change standard and checks that every acceptance criterion can
be proved on a real Vortex.

Every Goldfish runs on a fast, lower-cost model: Sonnet in Claude Code, GPT-6.1 Terra in Codex.
Each review report names the model that wrote it.

How well reviewers are kept apart from the conversation depends on your coding agent; see
[What EGM can guarantee in each agent](../get-started/install.md#what-egm-can-guarantee-in-each-agent).

## You decide

You take part at four points:

1. You answer the agent's questions about the idea.
2. You approve each section of the draft.
3. You decide findings the agent disagrees with.
4. You approve the final text.

The agent never approves a design for you, and never writes an approval you have not given.

## How the approval binds the change

- **The digest.** `doodlebot design check` computes a SHA-256 digest of the design's text,
  leaving out the `Status`, `Date` and `Approved` lines. Your approval names that digest, so any
  later edit to the body voids it.
- **The confirmation round.** The final two Goldfish reviews record the digest they read and the
  checkout they saw, before any implementation existed.
- **The file boundary.** The design lists every file the change may touch.
  `doodlebot design scope` reports any changed file outside that list.
- **Readiness.** At handoff, `doodlebot readiness` fails a feature or refactor unless the design
  is approved, its digest matches, its acceptance criteria match the evidence, and every changed
  file is inside the boundary. See [Evidence and the QA catalogue](evidence.md).

## What's next

- [Design a feature](../guides/design-a-feature.md).
- [Evidence and the QA catalogue](evidence.md).
