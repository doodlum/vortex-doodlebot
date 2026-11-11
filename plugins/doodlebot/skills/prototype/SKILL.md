---
name: prototype
description: "Doodlebot: Prototype a Vortex idea on a new proto/<idea> branch in a worktree session: change the code, rebuild, look at it in a test Vortex with screenshots, ask what to change, and repeat; ends with a summary and the line that starts the EGM design. A prototype is never shipped; use for 'prototype this idea' or 'show me what X would look like'."
argument-hint: "<idea>"
---

# Prototype an idea

A prototype is the quickest way to see an idea working in Vortex before anyone designs it: the
agent changes Vortex's code on a throwaway `proto/<idea>` branch, rebuilds, runs it in a test
Vortex, shows the person screenshots and asks what to change, round after round. Nothing is
reviewed or approved, and **a prototype is never shipped**: `/doodlebot:pr` and the preflight
refuse `proto/*` branches. It ends with a summary and the exact line that starts the EGM design,
after which a feature starts as `feat/<topic>` from upstream with the prototype's diff ported.

`<idea>` is a short kebab-case name for the idea (`mod-count-in-toolbar`).

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:setup --update`, then continue.
3. Run `doodlebot source --where`. It prints the session's checkout, `<checkout>` below. If it
   refuses, the session is not in a Vortex checkout: say so, with its advice, and stop.
4. Read the checkout's `AGENTS.md`, `CLAUDE.md` when present and `docs/README.md`, and
   `${CLAUDE_PLUGIN_ROOT}/skills/try/SKILL.md`: the loop below runs its sections "Choose the
   build and content", "Start and stop", "Commands that block" and "The report procedure".

## Start

The prototype never changes the branch of the person's own checkout.

1. **A worktree session first.** `git -C <checkout> rev-parse --git-dir` and
   `git -C <checkout> rev-parse --git-common-dir` print the same folder in the main checkout
   and different folders in a worktree.
   - **Claude desktop, in the main checkout:** ask the person to start a new worktree session of
     this checkout on a new branch `proto/<idea>` (or on the upstream default branch), and to run
     `/doodlebot:prototype <idea>` there. Stop.
   - **Another agent, in the main checkout:** say that prototyping here would switch this
     checkout to `proto/<idea>`, and offer a worktree instead:
     `git -C <checkout> worktree add <dir> upstream/master`, then open the agent in `<dir>`.
     Continue here only when the person says so.
2. **A clean tree.** `git -C <checkout> status --porcelain` must print nothing. If it prints
   anything, refuse: the tree has someone's work in it. Say what it printed and stop.
3. **The branch.** `git -C <checkout> symbolic-ref --short HEAD` names it (nothing in a detached
   HEAD). `upstream/<default>` is `upstream/master` unless
   `git -C <checkout> symbolic-ref --short refs/remotes/upstream/HEAD` names another.
   - **A new `proto/<idea>` branch,** with no commits beyond upstream
     (`git -C <checkout> rev-list --count upstream/master..HEAD` prints `0`): continue.
   - **The upstream default** (the branch `master`, or a detached HEAD at upstream's default,
     as a desktop worktree session opened on an upstream base has): cut the branch with
     `doodlebot source --no-build --branch proto/<idea>`. Only ever from the upstream default.
   - **Anything else** (a `feat/*` or `fix-*` branch, a `proto/*` branch with commits, another
     idea's branch): refuse. A prototype starts on a new `proto/*` branch or on the upstream
     default; ask the person to start a new worktree session. Stop.
4. **Prepared.** Run `/doodlebot:source`'s procedure (`${CLAUDE_PLUGIN_ROOT}/skills/source/SKILL.md`)
   when the checkout is not installed and built: it takes minutes and several GB per worktree.

## The loop

Repeat until the person says it is enough. `<n>` counts the rounds from 1.

1. **Change** Vortex's code for the idea, following the checkout's own rules. Keep the change as
   small as shows the idea; it is a sketch, not the feature.
2. **Build.** Stop this session's test Vortex first (`doodlebot down`), then
   `doodlebot build --checkout <checkout>` in the background with its log in
   `<workspace>/harness/.artifacts/runs/<UTC time>-build.log` ("Commands that block").
   A failed build is shown to the person with its first error; fix it and build again.
3. **Run it**, `try`-style, on that build: the report procedure with `--dev-dir <checkout>`,
   content chosen by `doodlebot inventory --need <need> --json`, in the run folder
   `<workspace>/harness/.artifacts/runs/<UTC time>-prototype-<idea>-<n>/`. Start with
   `doodlebot up --dev-dir <checkout> <game flags>` in the background, drive to where the idea
   shows, and take screenshots at the sizes `${CLAUDE_PLUGIN_ROOT}/resources/testing.md` gives:
   `doodlebot responsive --screenshots --viewports "1024x720,1280x720,1280x1000,1920x1080"`,
   plus `doodlebot screenshot --label <step>` at each moment worth showing. Copy them into the
   run folder, then `doodlebot down`. Write the run report there.
4. **Show and ask.** Show the person the screenshots and what changed
   (`git -C <checkout> diff --stat`), say what worked and what did not, and ask what to change
   next, or whether it is enough.

## Finish

1. **Commit, if the person agrees.** Ask: "May I commit the prototype on `proto/<idea>`? It stays
   local and is never pushed." On a yes, `git -C <checkout> add -A` and
   `git -C <checkout> commit -m "proto: <idea>"`. Otherwise leave it uncommitted and say so.
2. **The summary**, `<workspace>/harness/.artifacts/prototypes/<idea>/summary.md`, shared by
   every worktree, so the later `feat/*` session can read it. Link the run reports; don't copy
   them. Use the summary template below.
3. **The brainstorm line.** Give the person the lines that start the design, from
   `${CLAUDE_PLUGIN_ROOT}/resources/egm.md` (the second line is the fallback folder there when
   `.doodlebot/` is not excluded):

   ```text
   /egm:egm-brainstorm <the idea>
   EGM artifact directory: .doodlebot/egm
   Start from <workspace>/harness/.artifacts/prototypes/<idea>/summary.md
   ```

   The person types it; an agent cannot start an EGM command.

4. **Never shipped.** Say it: the prototype is never shipped, and `/doodlebot:pr` refuses
   `proto/*`. After the design is approved, a feature starts as `feat/<topic>` from upstream and
   the prototype's diff is ported there.

End with a **Learned** section (`${CLAUDE_PLUGIN_ROOT}/resources/knowledge.md`): lessons, kit
gaps recorded with `doodlebot gap add`, or "nothing". Never patch the doodlebot workspace
mid-task: a missing capability is a kit gap, offered as doodlebot work afterwards.

### Summary template

```markdown
# Prototype: <idea>

## Idea

<the idea in the person's words>

## Tried

- Round <n>: <what changed>, [run report](<path to the round's report.md>)

## What worked

## What did not

## Open questions

## Branch and commit

`proto/<idea>` in <checkout>, at <commit> (or "uncommitted"), from upstream/<default> at
<base commit>. Never shipped.

## Learned

<lessons, kit gaps with their ids, or "nothing">
```
