---
name: pr
description: "Doodlebot: Ship a verified Vortex change as a pull request from the session's branch: preflight with the revert check, push the branch only to your fork, ask whether the PR goes to your fork or to Nexus-Mods/Vortex, open it as a draft with the design's link at its approved commit and the doodlebot footer, and read CI when it is red; use for 'ship it' after a fix or feature."
argument-hint: "[PR number, once it exists] [ready]"
---

# Ship a Vortex pull request

This command opens the PR from the branch the session is on, so the Claude desktop app can show
it in the session's Changes card. It prepares everything first and publishes only when the person says so: a
draft unless they say otherwise. It never pushes anywhere but the person's own fork, never
ships a `proto/*` prototype branch, and never opens a PR before the person's real scenario
passed on the change.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - Follow [Command preflight](${CLAUDE_PLUGIN_ROOT}/resources/command-preflight.md) to establish
     an absolute command route. It covers lookup or execution failures before deciding setup is missing.
   - Use the verified absolute shim, or verified Node and entry point, for later commands.
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:setup --update`, then continue.
3. Run `doodlebot source --where`. It prints the session's checkout, `<checkout>` below. If it
   refuses, the session is not in a Vortex checkout: tell the person to open the coding agent in the
   checkout or worktree that holds the change, and stop.
4. Read `<workspace>/harness/PULL-REQUESTS.md` (titles, description template, the doodlebot
   footer, review lessons) and the checkout's `CONTRIBUTING.md`.
5. **Tested first.** A fix needs `/doodlebot:fix`'s before and after run reports (the person's
   own scenario on the base and on the fix) and its revert control. A feature needs its
   approved design (the person set its Status to Approved, or told you to; the walk is
   `${CLAUDE_PLUGIN_ROOT}/resources/egm.md`) and a `/doodlebot:qa --design <file>` report. If
   anything is missing, say what and stop.

## Steps

1. **The branch.** `<branch>` is the session's branch:
   `git -C <checkout> symbolic-ref --short HEAD`.
   - **A detached HEAD** (a Codex app worktree starts on one): `push-branch` refuses it. Say so
     and stop: the person cuts a branch first. To keep commits made on the detached HEAD, the
     branch starts at the current commit: `git -C <checkout> switch -c <name>`, or the Codex
     app's **Create branch here**. `doodlebot source --branch <name>` starts from upstream
     instead, and fits only when nothing was committed yet.
   - **A `proto/*` branch is refused** (and `push-branch` and the preflight refuse it too). A
     prototype is never shipped: say so, and that a feature
     starts as `feat/<topic>` from upstream after an approved design, with the prototype's diff
     ported (`${CLAUDE_PLUGIN_ROOT}/resources/egm.md`, "After approval"). Stop.
   - It is not `master` or the upstream default, and its changes are committed: preflight reads
     the committed head. `<topic>` names the work (the branch name without `fix-` or `feat/`).
   - With a design, it is committed on this branch as `docs/designs/<topic>.md` (EGM's place for
     an approved design) and travels in the pull request.
2. **Stop the test Vortex** if this session runs one from that checkout: `doodlebot down`.
3. **Preflight**, with the revert check:
   `doodlebot pr-preflight --checkout <checkout> --test <test> --revert <file>`.
   Leave `--base` out: the default, the merge-base with upstream's default branch, is the right
   base. It prints PASS, WARN, FAIL or SKIP per check and exits 1 on a FAIL or INCONCLUSIVE.
   - **Branch** FAILs on a `proto/*` branch.
   - Read every WARN list (callers outside the diff, readers of changed state, reducer
     dispatchers) and say in the description how each was checked.
   - A size WARN means the change may need splitting or maintainer agreement first.
   - An INCONCLUSIVE revert check needs its failing assertion read.
4. **Description**, from the template in `<workspace>/harness/PULL-REQUESTS.md`: a Conventional
   Commit title of at most 72 characters, every required section, the head sha, what was run
   and its results (never "Not run"), the reported scenario before and after (from the run
   reports), and the doodlebot footer at the end. With a design, add:
   - the design's Overview and acceptance criteria, verbatim;
   - "Design approved by <owner> on <date>: `docs/designs/<topic>.md`", naming the file in this
     pull request. Never claim an approval the person has not given, and never describe a
     revision they have not approved.

   Save it as `<workspace>/harness/.artifacts/pr/<topic>.md` and show it to the person.

5. **Publish, only when asked.** On the person's go-ahead:
   1. **Push the session's branch:** `doodlebot push-branch --checkout <checkout>`. It pushes
      `<branch>` to `origin` (with `-u`) only after `gh` shows `origin` is the person's own fork
      of `Nexus-Mods/Vortex` (or the `VORTEX_AI_VORTEX_REPO` fork they can push to). It refuses
      an absent `origin`, `Nexus-Mods/Vortex` itself, someone else's fork, an `origin` whose push
      URL (`pushurl` or `pushInsteadOf`) is not that fork, a `proto/*` branch and the
      default branch. Without a fork, offer
      `gh repo fork Nexus-Mods/Vortex --remote` and run it only when the person agrees. Never
      push by hand to any remote.
   2. **Ask where the PR goes:** "Open the pull request in your fork (<fork>), or against
      Nexus-Mods/Vortex?" A PR inside the fork reviews the change before it goes upstream.
   3. **Open it from the session's branch**, as a draft unless the person says otherwise:
      `gh pr create --repo <fork or Nexus-Mods/Vortex> --base <upstream default> --head <fork owner>:<branch> --draft --title <title> --body-file <description>`
      (without `--draft` only when they say so).
      - `<upstream default>` is **Nexus-Mods/Vortex's default branch name**, normally `master`:
        `git -C <checkout> symbolic-ref --short refs/remotes/upstream/HEAD` without the
        `upstream/` prefix. Use it in both cases, a PR in the fork and one against
        Nexus-Mods/Vortex. Never use the fork's own default branch: a fork's default can be
        another branch entirely (doodlum/Vortex's is `linux`), and a PR against it would carry
        that branch's work.
   4. **On Claude desktop, bind it.** The app shows an opened PR in the session details panel's
      Changes card, with its CI status; its ⋮ menu has **Auto-fix** and **Merge when ready**.
      The app needs `gh` installed and signed in. When the app's PR tools are available and the
      Changes card did not pick the PR up, bind it to this session with them (`bind_pr`, given
      the PR's URL). A PR into the fork binds, because the fork is `origin`; whether one into
      Nexus-Mods/Vortex binds is not established: report what happened.
   5. **In the Codex app**, the push and the PR are this skill's, as above (`push-branch`, then
      `gh pr create`); whether the app opens PRs itself is not documented. Its review pane shows
      the PR's description, comments and checks, and **Fix** in Checks attaches a failing check
      to a chat. Auto-fix, monitoring and binding a PR to a task are not documented: tell the
      person to follow CI with step 6.
   6. Check the published description:
      `doodlebot pr-preflight --checkout <checkout> --skip-revert --pr <number> --repo <owner/name>`.
6. **CI.** `doodlebot pr-checks <number> --repo <owner/name>` reports the head's checks, with
   failed jobs expanded to their failed steps; it exits nonzero while any is pending or failed.
   When CI is red, say why: a test failure (read it, reproduce it locally, offer a fix on the
   branch and a new `doodlebot push-branch --checkout <checkout>`), an upload or infrastructure
   failure, or a known base failure.

## Finish

Tell the person the preflight result, the description's path or the PR link, where the PR was
opened and whether the app bound it, the CI status and anything still to do (maintainer
agreement, a pending check). End with a **Learned** section
(`${CLAUDE_PLUGIN_ROOT}/resources/knowledge.md`): lessons, kit gaps recorded with
`doodlebot gap add`, or "nothing". Never patch the doodlebot workspace mid-task.
