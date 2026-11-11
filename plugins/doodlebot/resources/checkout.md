# Prepare this checkout

Doodlebot works in the Vortex checkout the session is opened in, or in a worktree of it: the
**session's checkout**. The commands that need a built checkout (`try` on a source build, `fix`,
`qa` and `prototype`) run this procedure on the way, only when the checkout is not ready yet;
nobody has to run a separate command first. `doodlebot source` does the work: it checks the
remotes, keeps doodlebot's `.doodlebot/` folder and the Claude desktop app's
`.claude/worktrees/` out of every commit (after the person's yes), installs Vortex's
dependencies with the checkout's pinned pnpm and builds it.

The Nexus repository is always the remote `upstream`; the person's fork, when there is one, is
`origin`. Without a fork, building, trying, investigating and QA all work; pushing a fix needs a
fork, which `/doodlebot:pr` offers to make. Doodlebot never searches the disk for a checkout,
and never clones one into its own workspace.

`<workspace>` is `workspace` in `doodlebot version --json`, which the calling command has
already run.

## Is it ready?

Either is enough; skip the rest of this page when the checkout is ready:

- `doodlebot check --json`: the `this checkout` row is `ready` (the checkout is built);
- `doodlebot source --where` prints the checkout, and its build outputs exist (the `source`
  report or the `this checkout` row says `built`).

A checkout whose dependencies changed since the last build (a new `pnpm-lock.yaml`, or a
branch just checked out for QA) is not ready either: run the steps.

## Steps

1. **Find the checkout.** `doodlebot source --where` prints it, `<checkout>` below.
   - If it refuses with "Open Claude in a Vortex checkout or worktree", the session is not in
     one. Say so and stop: the person opens the agent in a checkout, or clones one with
     `/doodlebot:setup` ("No checkout yet").
2. **A running test Vortex.** `doodlebot status`. A test Vortex launched from `<checkout>`
   blocks building it. Stop it with `doodlebot down` only when this session started it, by
   setup's ownership rule (`${CLAUDE_PLUGIN_ROOT}/skills/setup/SKILL.md`, "A running test
   Vortex"), and only on the person's yes. Never `down` an instance another session started:
   wait, or tell the person.
3. **Look.** `doodlebot source --no-build` (with `--update` when the person asked: it fetches
   every remote). It changes nothing it was not asked to, and reports:
   - **upstream pointing elsewhere**: it refuses and changes nothing. Tell the person the
     remote it named and stop; they fix it themselves.
   - **upstream missing**, **`.doodlebot/` not excluded**, or a note that
     **`.claude/worktrees/` is not excluded**: ask the person one question, "May I add
     Nexus-Mods/Vortex as `upstream`, and add `.doodlebot/` and `.claude/worktrees/` (the
     Claude desktop app's worktrees) to this checkout's shared `info/exclude` (every worktree
     uses it), so nothing doodlebot or the app writes reaches a commit?" (name only what was
     missing). On a yes, run `doodlebot source --no-build --add-upstream --exclude` with only
     the flags for what was missing. On a no, carry on: without `upstream` a work branch
     cannot be cut, and without the exclude EGM's artifact folder is
     `<workspace>/harness/.artifacts/egm/<checkout folder name>` instead of `.doodlebot/egm`.
   - **origin**: the person's fork, Nexus-Mods/Vortex itself, or absent. Without a fork, tell
     the person what it printed: building and testing work as they are.
4. **Install and build**, skipped when the checkout is already built and its dependencies are
   current: `doodlebot source`. It installs with the checkout's pinned pnpm
   (`--frozen-lockfile`), then runs `doodlebot build --checkout <checkout>`, which puts back
   `etc/vortex.api.md` and `etc/Dependency Report.md` when the build rewrites them. It can take
   10 minutes or more and several GB per worktree: run it in the background with its output in
   `<workspace>/harness/.artifacts/runs/<UTC time>-source.log` and wait for it to exit
   (`${CLAUDE_PLUGIN_ROOT}/skills/try/SKILL.md`, "Commands that block").
5. `git -C <checkout> status --porcelain` should print nothing new: report anything it does.

## Report

Tell the person, in a few lines, as part of the calling command's report: the checkout, its
remotes, the branch, whether `.doodlebot/` and `.claude/worktrees/` are excluded, and whether
the install and build succeeded (all in `source`'s report), or that it was already ready. A
failed build stops the calling command: show its first error and the log's path.

## Several branches at once

Another session works on another branch in its own worktree: a Claude desktop session with
**Worktree** on (in `<checkout>/.claude/worktrees/`, which the exclude keeps out of commits), a
Codex app worktree (in `$CODEX_HOME/worktrees`, on a detached HEAD until a branch is cut with
`doodlebot source --no-build --branch <name>`), or `git -C <checkout> worktree add <dir> <branch>`.
Each worktree is prepared on its own, the first time a command needs it built: its own install
and build, several GB each. Only one test Vortex runs at a time on the machine.
