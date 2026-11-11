# Work on Vortex source

This page shows how to work in your own Vortex checkout: open Claude in it, prepare it with
`/doodlebot:source`, work on a branch of it, and run your build in the test Vortex.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md).
- Have Vortex's own build prerequisites. The first build takes longer than doodlebot's setup.
- A GitHub fork of Vortex is needed only to push your work. Without one, you can still build,
  try and test Vortex.
- Make sure no test Vortex is running (`doodlebot down` stops one your session started).

You do not need Vortex source to drive a released Vortex, add a regression test for doodlebot's
suite, or measure a release.

## Open Claude in your checkout

Doodlebot works in the Vortex checkout your Claude session is opened in, or in a worktree of it.
That is the session's checkout: commands that build or change Vortex use it, and `doodlebot up`
runs its build. Doodlebot's own workspace stays where setup put it.

If you have no checkout yet, ask for one in a folder of your choosing (never inside the doodlebot
workspace); the agent runs `doodlebot source --clone <dir>`. Then open Claude in that folder.

Outside a checkout, commands that need Vortex's source refuse with:

```text
Open Claude in a Vortex checkout or worktree (or clone one with `doodlebot source --clone <dir>`).
```

## Prepare the checkout

1. In a Claude session opened in your checkout, run:

   ```text
   /doodlebot:source
   ```

2. The agent runs `doodlebot source`. It checks the remotes: `upstream` must be
   Nexus-Mods/Vortex, and if it points anywhere else, `source` stops and changes nothing.
3. If `upstream` is missing, or doodlebot's `.doodlebot/` folder is not yet kept out of Git, the
   agent asks you once: "May I add Nexus-Mods/Vortex as `upstream`, and add `.doodlebot/` to this
   checkout's shared `info/exclude`?" On a yes it runs `doodlebot source --add-upstream
--exclude`. The exclude file is shared by every worktree of the checkout, so nothing
   doodlebot writes in any of them reaches a commit.
4. `source` installs Vortex's dependencies with its pinned pnpm and builds the checkout. The
   build puts back the `etc/` files it rewrites, so `git status` stays clean.

5. The agent makes a branch for your work, for example
   `doodlebot source --branch fix-download-panel`.

The expected result: a built checkout on a new branch.

To work in a different checkout than the session's, name it; the agent passes it to every
command with `--dev-dir <path>`.

## Working with your fork and worktrees

### Fork or no fork

- The Nexus Mods repository is always the remote `upstream`.
- If you have a fork of Vortex on GitHub, `source` clones it as `origin`.
- If you have no fork, `source` clones Nexus-Mods/Vortex alone. Building, trying and testing
  work the same. To push a fix later, make a fork: `gh repo fork Nexus-Mods/Vortex --remote`
  adds it as `origin`. `/doodlebot:pr` offers this when it is needed.
- If your fork has another name, set `VORTEX_AI_VORTEX_REPO=<owner>/<repo>`.

### Branches start from upstream

Every work branch starts from upstream's main branch, never from your fork's own main branch,
which may hold other work. `doodlebot source --branch <name>` fetches upstream and creates the
branch there.

### Doodlebot pushes only to your fork

Before any push, doodlebot checks with GitHub that `origin` is your own fork of Vortex. It
refuses to push to Nexus-Mods/Vortex itself or to someone else's fork, even if you are allowed
to push there. An organisation's fork is accepted only when you set it in
`VORTEX_AI_VORTEX_REPO` and can push to it. Doodlebot pushes two kinds of branch there: the
branch your session is on, which a pull request is opened from (`doodlebot push-branch`), and a
design's sibling branch `designs/<topic>` (`doodlebot design-branch`).

### Several branches at once

You can keep several branches built side by side, each in its own worktree, and use one Claude
session per branch:

1. Make a worktree: `git -C <checkout> worktree add <dir> <branch>`, or start a worktree session
   in the Claude desktop app.
2. Open Claude in that worktree and run `/doodlebot:source`: each worktree needs its own install
   and build.
3. Commands in that session use the worktree; no flag is needed.

Each worktree is a full Vortex build of several GB. Editing, building and unit tests run in
parallel. Only one test Vortex runs at a time on the machine, so starting one while another
session's runs is refused. Wait for the other session to finish; never stop its Vortex.

## Run your build

- `/doodlebot:try <scenario> on my source build` starts the session's build with
  `doodlebot up --sandbox`.
- `doodlebot build` records what it built in the checkout's Git folder (never in your working
  tree). If the checkout changed since, `doodlebot up` refuses and names a changed file; rebuild,
  or pass `--stale-ok` to run the old build on purpose.
- A source build runs in development mode, with React's slower development build. For timings
  that reflect users, the agent builds with `doodlebot build --checkout <dir> --production` and
  starts with `--production`. It then confirms that Vortex reports production mode.
- Keep source-build checks apart from released-build checks: development instrumentation and
  React's mode change timings.

## One running Vortex per checkout

While the test Vortex runs from a checkout, commands that would change or record that checkout
refuse:

```text
A harness Vortex is running from C:\dev\Vortex (pid 1234); run `doodlebot down` before building it.
```

Stop that test Vortex with `doodlebot down` if your session started it, then repeat the command.
Stop it before you switch the checkout to another branch as well.

## An old managed clone

Earlier versions of doodlebot kept a Vortex clone inside the workspace. Nothing uses it now:
doodlebot works in the Vortex checkout your session is in. `doodlebot check` lists it as
`old managed clone (no longer used)` with its size; `doodlebot clean --yes` deletes it after you
agree. Push any branch you want to keep first.

## Features and refactors start with a design

Before you write code for a new feature or a refactor, write and approve a design with EGM ([Design a feature with EGM](design-a-feature.md)).
A bug fix needs no design; use [`/doodlebot:fix`](fix-a-bug.md).

When someone else checks your change, stop your test Vortex first. They start with
`/doodlebot:qa`, which begins from `doodlebot up --fresh` with the same target, so they do not
inherit your profile.

## What's next

- [Fix a Vortex bug](fix-a-bug.md).
- [Measure and compare performance](benchmark.md) between a release and your branch.
