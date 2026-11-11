---
name: fix
description: "Doodlebot: Fix a Vortex bug end to end: from an issue report (or investigating first), branch, fix, add the regression test to the Vortex branch, prove it with a revert control and the reproduction on the fix, then offer the PR; use for 'fix it'."
argument-hint: "<issue report path, bug report, issue link or symptom>"
---

# Fix a Vortex bug

End to end: an issue report, a branch in the Vortex checkout, the fix, a regression test **in
the Vortex branch** (a Vortex unit or e2e test that goes in the PR), the revert control, the
person's reproduction on the fix, and then the offer of `/doodlebot:pr`. A bug fix needs no
design unless the person asks for one; features and refactors start with EGM, whose `/egm:*`
commands only the person can type (they have `disable-model-invocation: true`). Follow
`${CLAUDE_PLUGIN_ROOT}/resources/egm.md`: it gives the walk for a Vortex session and the
filled-in lines to hand the person, from `/egm:egm-brainstorm` to the runtime review.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:setup --update`, then continue.
3. **Scope.** Permission to change doodlebot does not authorize Vortex source edits, and a
   read-only constraint also excludes temporary patches, revert controls and builds that
   rewrite the checkout. Report a missing permission when it blocks the fix.
4. In the Vortex checkout read its `AGENTS.md`, nested instructions, `CLAUDE.md` when present,
   `CONTRIBUTING.md` and `docs/README.md`: they govern the submission. "Working in a Vortex
   checkout" in `<workspace>/harness/AGENTS.md` maps tasks to Vortex's own guides.

Commands that launch Vortex or run long run in the background with a log, as
`${CLAUDE_PLUGIN_ROOT}/skills/try/SKILL.md` describes under "Commands that block". Only one
test Vortex runs at a time; stop this session's with `doodlebot down` before building or
changing the checkout, and never stop one another session started. It is this session's only
by setup's ownership rule (`${CLAUDE_PLUGIN_ROOT}/skills/setup/SKILL.md`, "A running test
Vortex"): the instance record's `sourceDir` (or `exe`) is the build this session launched and its
`startedAt` is after this session's own launch.

## Steps

1. **The issue report.** Take the one the person gives (a `/doodlebot:investigate` report).
   Without one, run `/doodlebot:investigate`'s procedure first
   (`${CLAUDE_PLUGIN_ROOT}/skills/investigate/SKILL.md`). Continue only when it says
   **reproduced**, with a cause; otherwise report it and stop: a fix for an unreproduced bug is
   a guess.
2. **Source and branch.** The session's Vortex checkout, `<checkout>` (`doodlebot source --where`),
   or one the person names with `--dev-dir <checkout>`.
   Outside a checkout, ask the person to open Claude in one (or clone one with
   `doodlebot source --clone <dir>`) and stop. First `git -C <checkout> status --porcelain`
   must print nothing: cutting a branch carries uncommitted changes onto it, so with output,
   say what it printed and ask the person to commit or stash it, and stop. Then cut the branch
   from upstream: `doodlebot source --no-build --branch fix-<topic>`. Never work on `master`.
   When it refuses because the checkout has no `upstream` remote, run step 3 ("Look") of
   `${CLAUDE_PLUGIN_ROOT}/resources/checkout.md` (one question to the person), then cut again.
   - A desktop worktree session starts on a branch the app named (`claude/...`), which the cut
     leaves behind, unused. Say so. When that branch has no commits of its own
     (`git -C <checkout> rev-list --count upstream/<default>..HEAD` prints `0`, with `<default>`
     from `git -C <checkout> symbolic-ref --short refs/remotes/upstream/HEAD` without its
     `upstream/` prefix), offer instead to
     rename it, `git -C <checkout> branch -m fix-<topic>`, after `git -C <checkout> fetch
upstream` and only when it already sits at `upstream/<default>`; run it only on the
     person's yes.
   - A Codex app worktree starts on a detached HEAD: the cut makes the branch there and leaves
     nothing behind.
3. **The control run (before).** When the session's checkout is not ready
   (`doodlebot check --json`'s `this checkout` row is not `ready`, or it was never installed),
   run "Prepare this checkout" (`${CLAUDE_PLUGIN_ROOT}/resources/checkout.md`) first: it asks
   the person one question when remotes or the exclude are missing, then installs and builds.
   Otherwise build the branch's base with `doodlebot build --checkout <checkout>`. Then repeat the reproduction with `/doodlebot:try`'s
   report procedure on `--dev-dir <checkout>`, with the same content as the issue report. This
   is the "before" run report. It must show the symptom on the source build too; if it does
   not, the bug is version-specific: say so and stop.
4. **Fix.** Change the source on the branch, following Vortex's guidance. Rebuild with
   `doodlebot build --checkout <checkout>` (after a dependency change, `doodlebot source`
   again). For release-like timing, `--production` on both `build` and `up`.
5. **Regression test**, by `${CLAUDE_PLUGIN_ROOT}/resources/testing.md`: a Vortex unit test
   next to the code or a spec in Vortex's e2e suite, in the same branch. Tests that prove a
   Vortex change belong in its PR, not in doodlebot.
6. **Revert control.** Ask whether you may make a local commit on `fix-<topic>`
   (`git -C <checkout> commit`, never a push): the control reads the committed `HEAD`. Then
   `doodlebot pr-preflight --checkout <checkout> --base upstream/master --test <test> --revert <file>`.
   The branch must pass and the reverted run fail on the intended assertion (an INCONCLUSIVE
   failure needs its assertion read). Without the permission, report the control as not run.
7. **The reproduction on the fix (after).** Start the fixed build and repeat the person's exact
   scenario with `/doodlebot:try`'s report procedure (`--dev-dir <checkout>`, same content),
   observing the result independently: UI, deployed files, state, `doodlebot log --level warn`.
   For UI fixes check widths and heights separately. This is the "after" run report.
8. **Gates.** The scoped tests, then Vortex's own gate (for example `pnpm run verify`) with the
   test Vortex stopped. Keep failures and say whether each is a regression, a known base
   failure or an external blocker. Never call a blocked gate passed.
9. **Catalogue.** If `doodlebot qa list --touching <changed files>` reports files no entry
   guards and the behaviour is something Vortex's e2e suite cannot hold, propose an entry.

## The fix report

Write `<workspace>/harness/.artifacts/runs/<UTC time>-fix-<slug>/report.md` with:

- **Outcome:** fixed, with the before and after observations; or why not.
- **Tested against:** the build (branch and head, base) and the content, and why.
- **Cause:** file and line (from the issue report, confirmed or corrected).
- **Change:** the files, and the branch `fix-<topic>`.
- **Regression test:** its path in the Vortex branch, what it asserts, and the revert control's
  result (fails without the fix, passes with it), or "not run" and why.
- **Before and after:** the two run reports' paths.
- **Gates:** each with its result.
- **Not checked.**
- **Learned:** lessons recorded, noted or removed (`doodlebot knowledge add ... --vortex <version>`),
  kit gaps (`doodlebot gap add`), catalogue entries proposed, or "nothing"
  (`${CLAUDE_PLUGIN_ROOT}/resources/knowledge.md`).

## Finish

Tell the person the cause, the change, the test and its control, the before and after results,
the gates, and the report's path. Then offer `/doodlebot:pr`. Apart from the local commit made
with their permission, never commit, push or open a PR unless they ask, and never open one
before their own scenario passed on the fix. Never patch the doodlebot workspace mid-task: a
missing capability is a kit gap, offered as doodlebot work afterwards.
