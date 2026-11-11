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

1. **A worktree, not the main checkout.** `git -C <checkout> rev-parse --git-dir` and
   `git -C <checkout> rev-parse --git-common-dir` print the same folder in the main checkout
   and different folders in a worktree. In the main checkout, refuse: prototyping there would
   switch the person's own checkout to `proto/<idea>`.
   - **Claude desktop:** ask the person to start a new session of this checkout with
     **Worktree** turned on under the prompt, and run `/doodlebot:prototype <idea>` there. Stop.
   - **Codex app:** ask the person to start a new chat with **Worktree** selected under the
     composer, based on upstream's default branch when they can pick it, and run the prototype
     skill there. Its worktree starts on a detached HEAD; step 4 cuts the branch. Stop.
   - **Another agent:** offer a worktree, `git -C <checkout> worktree add <dir> upstream/<default>`
     (step 3 says how to find `<default>`), then open the agent in `<dir>`. Stop.
2. **A clean tree.** `git -C <checkout> status --porcelain` must print nothing. If it prints
   anything, refuse: the tree has someone's work in it. Say what it printed and stop.
3. **Upstream's default branch.** With no `upstream` remote (`git -C <checkout> remote` does
   not list it), run step 3 ("Look") of `${CLAUDE_PLUGIN_ROOT}/resources/checkout.md` first: one
   question to the person. `<default>` is upstream's default branch name:
   `git -C <checkout> symbolic-ref --short refs/remotes/upstream/HEAD` without the `upstream/`
   prefix (normally `master`). If that prints nothing, run
   `git -C <checkout> remote set-head upstream --auto` and read it again. Never hard-code
   `master`, and never use the fork's default branch (`origin`'s can be another branch).
4. **The branch.** In a clean worktree any current branch is fine: a desktop worktree session
   starts on a branch the app named (`claude/...`), a Codex app worktree on a detached HEAD, or
   anything else.
   - Already on `proto/<idea>` with no commits beyond upstream
     (`git -C <checkout> rev-list --count upstream/<default>..HEAD` prints `0`): continue.
   - Otherwise cut the branch: `doodlebot source --no-build --branch proto/<idea>`. It always
     cuts from `upstream/<default>`, whatever the worktree was on. It refuses an existing
     `proto/<idea>` branch: then ask the person for another `<idea>` name.
   - On a detached HEAD there is no branch to leave behind.
   - The branch the session started on (an app-made `claude/...` branch) stays behind, unused.
     Say so, and offer to delete it (`git -C <checkout> branch -D <it>`) only when it has no
     commits of its own; never delete it without the person's yes.
5. **Prepared.** When the worktree is not ready (`doodlebot check --json`'s `this checkout`
   row is not `ready`, or it was never installed), run "Prepare this checkout"
   (`${CLAUDE_PLUGIN_ROOT}/resources/checkout.md`): one question to the person when remotes or
   the exclude are missing, then install and build. It takes minutes and several GB per
   worktree.

## Before every `doodlebot down`

Stop only a test Vortex **this session started**, by setup's ownership rule
(`${CLAUDE_PLUGIN_ROOT}/skills/setup/SKILL.md`, "A running test Vortex"): read the instance
record `~/.doodlebot/instance.json`; it is this session's only when its `sourceDir` is
`<checkout>` and its `startedAt` is after this session's own `up`. When nothing is running,
`down` is harmless. Otherwise another session started it, even from this checkout: never stop
it. Wait for it to stop, or tell the person its pid, cache and build and ask them to stop it
from the session that started it, and stop this round.

## The loop

Repeat until the person says it is enough. `<n>` counts the rounds from 1.

1. **Change** Vortex's code for the idea, following the checkout's own rules. Keep the change as
   small as shows the idea; it is a sketch, not the feature.
2. **Build.** Stop this session's test Vortex first (`doodlebot down`, after the check in
   "Before every `doodlebot down`"), then
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
   run folder, then `doodlebot down` (after the same check). Write the run report there.
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

`proto/<idea>` in <checkout>, at <commit> (or "uncommitted"), from upstream/<default> (the
name step 3 found) at
<base commit>. Never shipped.

## Learned

<lessons, kit gaps with their ids, or "nothing">
```
