---
name: pr
description: "Doodlebot: Ship a verified Vortex change as a pull request: preflight with the revert check, build pr/<topic> without the design commits, write the description with the design summary and the doodlebot footer, push only to your fork, and read CI when it is red; use for 'ship it' after a fix or feature."
argument-hint: "<topic> [checkout] [PR number, once it exists] [ready]"
---

# Ship a Vortex pull request

This command prepares the PR and, when the person says so, publishes it: a draft unless they
say otherwise. It never pushes anywhere but the person's own fork, and never opens a PR before
the person's real scenario passed on the change.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:setup --update`, then continue.
3. Read `<workspace>/harness/PULL-REQUESTS.md` (titles, description template, the doodlebot
   footer, review lessons) and the Vortex checkout's `CONTRIBUTING.md`.
4. **Tested first.** A fix needs `/doodlebot:fix`'s before and after run reports (the person's
   own scenario on the base and on the fix) and its revert control. A feature needs its
   approved design (the person set its Status to Approved, or told you to) and a
   `/doodlebot:qa --design <file>` report. If anything is missing, say what and stop.

## Steps

1. **Checkout.** `<checkout>` is the branch's checkout (default `<workspace>/.vortex-src`). The
   branch is not `master`, and its changes are committed: preflight reads the committed head.
   `<topic>` names the work (the branch's name without `fix-` or `feat/`).
2. **Stop the test Vortex** if this session runs one from that checkout: `doodlebot down`.
3. **The PR branch.** `doodlebot pr-branch <topic> --checkout <checkout>` builds `pr/<topic>` in
   a temporary worktree from the merge-base with upstream, cherry-picking every commit except
   the `docs(design): <topic>` ones. It refuses a non-design commit that touches the Vortex
   docs/designs folder (split that commit first) and a cherry-pick conflict (report it). The
   checkout's own files never change.
   - **The design tag.** With a design, add `--design-commit <sha>`: the `docs(design)` commit
     whose text the person approved (its Status says Approved, or they told you so). That
     commit is tagged `design/<topic>`. Never name an unapproved revision: when the design
     changed after its approval, ask for the new approval first, or leave `--design-commit` out
     and the tag stays on the earlier approval.
   - A later approved revision moves `design/<topic>` and keeps the earlier one as
     `design/<topic>-v<n>`; `pr-branch` prints both.
4. **Preflight** on the PR branch:
   `doodlebot pr-preflight --checkout <checkout> --head pr/<topic> --base upstream/master --skip-revert`
   for the static checks, then the revert check on the work branch, which needs it checked out:
   `doodlebot pr-preflight --checkout <checkout> --base upstream/master --test <test> --revert <file>`.
   It prints PASS, WARN, FAIL or SKIP per check and exits 1 on a FAIL or INCONCLUSIVE.
   - **Design kept out** FAILs when a docs/designs file from this branch's `docs(design)`
     commits is in the diff or any commit of `pr/<topic>`.
   - Read every WARN list (callers outside the diff, readers of changed state, reducer
     dispatchers) and say in the description how each was checked.
   - A size WARN means the change may need splitting or maintainer agreement first.
   - An INCONCLUSIVE revert check needs its failing assertion read.
5. **Description**, from the template in `<workspace>/harness/PULL-REQUESTS.md`: a Conventional
   Commit title of at most 72 characters, every required section, the head sha, what was run
   and its results (never "Not run"), the reported scenario before and after (from the run
   reports), and the doodlebot footer at the end. With a design, add:
   - the design's Overview and acceptance criteria, verbatim;
   - "Design approved by <owner> on <date>; design at
     <fork>/blob/design/<topic>/docs/designs/<topic>.md".

   Save it as `<workspace>/harness/.artifacts/pr/<topic>.md` and show it to the person.

6. **Publish, only when asked.** On the person's go-ahead:
   `doodlebot pr-branch <topic> --checkout <checkout> --push` (with the same
   `--design-commit`). It pushes `pr/<topic>` and the `design/<topic>` tag (and a
   `design/<topic>-v<n>` it just made) to `origin` only after `gh` shows `origin` is the person's own fork of
   `Nexus-Mods/Vortex` (or the `VORTEX_AI_VORTEX_REPO` fork they can push to). It refuses an
   absent `origin`, `Nexus-Mods/Vortex` itself, someone else's fork, and an `origin` whose push
   URL (`pushurl` or `pushInsteadOf`) is not that fork. Without a fork, offer
   `gh repo fork Nexus-Mods/Vortex --remote` and run it only when the person agrees. Never push
   by hand to any other remote. Then open the PR against `Nexus-Mods/Vortex` from
   `<fork owner>:pr/<topic>` with `gh pr create --draft --body-file <description>` (without
   `--draft` only when they say so), and check the published description with
   `doodlebot pr-preflight --checkout <checkout> --head pr/<topic> --skip-revert --pr <number>`.
7. **CI.** `doodlebot pr-checks <number>` reports the head's checks, with failed jobs expanded to
   their failed steps; it exits nonzero while any is pending or failed. When CI is red, say why:
   a test failure (read it, reproduce it locally, offer a fix on the work branch and a new
   `pr-branch --push`), an upload or infrastructure failure, or a known base failure.

## Finish

Tell the person the preflight result, the description's path or the PR link, the CI status and
anything still to do (maintainer agreement, a pending check). End with a **Learned** section
(`${CLAUDE_PLUGIN_ROOT}/resources/knowledge.md`): lessons, kit gaps recorded with
`doodlebot gap add`, or "nothing". Never patch the doodlebot workspace mid-task.
