# Prototype an idea

This page shows how to try out a Vortex idea quickly with `/doodlebot:prototype`: the agent
changes the code on a throwaway branch, rebuilds, shows you screenshots and asks what to change,
round after round, until you have seen enough to design it.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md), and have a Vortex checkout; see
  [Work on Vortex source](source-development.md).
- In the Claude desktop app, start a **new worktree session** of your checkout on a new branch
  `proto/<idea>`, or on the upstream default branch. The prototype never switches the branch of
  the checkout you work in. In another agent, make a worktree yourself
  (`git -C <checkout> worktree add <dir> upstream/master`) and open the agent there.
- The worktree must be clean. Each worktree needs its own install and build, which takes
  minutes and several GB; the agent runs `/doodlebot:source` for it.

A prototype is never shipped. Nothing in it is reviewed or approved, and `/doodlebot:pr` refuses
a `proto/*` branch.

## Prototype

1. Run:

   ```text
   /doodlebot:prototype <idea>
   ```

   `<idea>` is a short name, such as `mod-count-in-toolbar`; describe the idea in the same
   message.

2. The agent checks the session: a worktree, a clean tree, and a new `proto/<idea>` branch or
   the upstream default, from which it cuts `proto/<idea>`. Anything else is refused, with the
   reason.
3. Each round, the agent:
   1. changes Vortex's code for the idea;
   2. rebuilds the worktree;
   3. starts a test Vortex on that build, goes to where the idea shows, and takes screenshots at
      several window sizes;
   4. shows you the screenshots and what changed, and asks what to change next.
4. Say when it is enough. The agent asks before committing the prototype on `proto/<idea>`; the
   commit stays local and is never pushed.

## What you get

- A summary at `<workspace>/harness/.artifacts/prototypes/<idea>/summary.md`: the idea, what was
  tried in each round, what worked and what did not, open questions, the branch and commit, and
  links to each round's run report and screenshots. Every worktree can read it.
- The lines that start the design, for you to type:

  ```text
  /egm:egm-brainstorm <the idea>
  EGM artifact directory: .doodlebot/egm
  Start from <workspace>/harness/.artifacts/prototypes/<idea>/summary.md
  ```

After the design is approved, the feature starts as `feat/<topic>` from upstream, and the
prototype's changes are ported there; see [Design a feature with EGM](design-a-feature.md).

## What's next

- [Design a feature with EGM](design-a-feature.md).
- [Use cases](use-cases.md) puts this beside every other task (U13).
