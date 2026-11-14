# Design with EGM

This page explains why features and refactors start with an approved design, how EGM and
doodlebot's runtime reviewer check it, and where the design lives while the work goes on.

## Before you begin

Read [How doodlebot works](how-it-works.md). To run the procedure, see
[Design a feature with EGM](../guides/design-a-feature.md).

## When a design is needed

| Change                             | Design                                        |
| ---------------------------------- | --------------------------------------------- |
| A feature                          | Required, approved before any code is written |
| A refactor                         | Required, approved before any code is written |
| A bug fix                          | None, unless you supply one or ask for one    |
| Documentation or test-only changes | None, unless you supply one or ask for one    |

## EGM does the design, doodlebot adds one reviewer

Design work uses Google's [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model)
plugin (EGM), unchanged. Doodlebot has no design command of its own. EGM uses two kinds of
agent:

- The **Elephant** is the agent session you are talking to. It keeps the whole context of the
  task, asks you questions and writes the design. It writes no code until you approve.
- A **Goldfish** is a reviewer started without the conversation. It sees only the design and the
  files it is given. Anything the design leaves unsaid is missing to the Goldfish, which is the
  point: whoever implements the design later will not have the conversation either.

You start each EGM step yourself: EGM's commands can only be typed by a person, so the agent
gives you the line to paste. You design a Vortex change in your Vortex session, which reads
Vortex's own instructions, not doodlebot's, so the line carries what EGM needs from doodlebot:
`EGM artifact directory: .doodlebot/egm` on a line of its own, where EGM keeps its briefs,
drafts and reports. `.doodlebot/` is kept out of every commit, and nothing about EGM is written
into Vortex.

EGM is installed separately in each coding agent. `doodlebot check` uses Codex's plugin
inventory in a Codex session and Claude's user settings in a Claude Desktop local Code
session. A disabled plugin is not ready; an unavailable Codex inventory is advisory, not
proof of a missing installation. See the [desktop agent contract](desktop-agents.md).

## The runtime review

After EGM's own staged review, you run EGM's review loop with doodlebot's Goldfish,
`vortex-runtime-goldfish`. It reviews against doodlebot's Vortex change standard and asks one
question of every acceptance criterion: can it be proved on a real Vortex? A criterion passes
the review when the design names:

- the doodlebot command or test that proves it;
- the content it needs (a sandbox, a game copy, a collection, a login);
- the build it runs on (a release, or your branch);
- a negative control: the same check with the behaviour removed, which must fail.

The runtime reviewer runs on Sonnet in Claude Code, read-only and without your project's
instructions. EGM's own reviewers run on your session's model. How well reviewers are kept
apart from the conversation depends on your coding agent; see
[What EGM can guarantee in each agent](../get-started/install.md#what-egm-can-guarantee-in-each-agent).

## You decide

You take part at four points:

1. You answer the agent's questions about the idea.
2. You approve each section of the draft.
3. You decide findings the agent disagrees with.
4. You approve the final text, by setting its Status to Approved or telling the agent to.

The agent never approves a design for you, and never writes an approval you have not given. A
design revised after approval needs a new approval.

## Designs travel with the code

Doodlebot follows EGM's own model. A Vortex design is a project file,
`docs/designs/<topic>.md`, which EGM's draft step saves in your checkout. Once you approve it,
the agent asks to commit it as `docs(design): <topic>` on your work branch, so it goes into the
pull request with the code and reviewers see why the change is shaped the way it is. Only EGM's
scratch files (briefs and review reports) stay out of commits, in `.doodlebot/egm`.

The pull request's description quotes the design's Overview and acceptance criteria and names
the design file it carries.

Doodlebot's own designs are in the doodlebot repository's `designs/` folder, listed in
`designs/SITEMAP.md`. This version of doodlebot implements `designs/companion-simplified.md`
and `designs/vortex-checkout.md`: doodlebot runs in your Vortex checkout or a worktree of it,
and `/doodlebot:prototype` tries an idea before it is designed.

## Prototype first, if you like

`/doodlebot:prototype <idea>` changes Vortex's code on a `proto/<idea>` branch, builds it and
shows you screenshots, round after round, until you say it is enough. It approves nothing and is
never shipped: `/doodlebot:pr` refuses a `proto/*` branch. It ends with a summary and the
`/egm:egm-brainstorm` lines that start the design from what the prototype taught.

## What's next

- [Design a feature with EGM](../guides/design-a-feature.md).
- [Evidence and the QA catalogue](evidence.md).
