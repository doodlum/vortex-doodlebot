# Work on Vortex source

This page shows how to prepare a Vortex source clone with `/doodlebot:source`, work on a branch
of it, and run your build in the test Vortex.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md).
- Have Vortex's own build prerequisites. The first build takes longer than doodlebot's setup.
- A GitHub fork of Vortex is needed only to push your work. Without one, you can still build,
  try and test Vortex.
- Stop any running test Vortex with `/doodlebot:stop`.

You do not need Vortex source to drive a released Vortex, add a regression test for doodlebot's
suite, or measure a release.

## Prepare the source clone

1. Run:

   ```text
   /doodlebot:source
   ```

2. The agent runs `doodlebot source`, which clones Vortex into `<workspace>/.vortex-src` and
   builds it.

3. The agent makes a branch for your work, for example
   `doodlebot source --branch fix-download-panel`.

The expected result: a built clone in `<workspace>/.vortex-src`, on a new branch.

To work in a different checkout instead, name it; the agent passes it to every command with
`--dev-dir <path>`.

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
`VORTEX_AI_VORTEX_REPO` and can push to it.

### Several branches at once

You can keep several branches built side by side, each in its own worktree, and use one Claude
session per branch:

1. `git -C <workspace>/.vortex-src worktree add ../vortex-<branch> <branch>`
2. `doodlebot build --checkout <dir>` in that worktree.
3. In that session, the agent adds `--dev-dir <dir>` to every command.

Each worktree is a full Vortex build of several GB. Editing, building and unit tests run in
parallel. Only one test Vortex runs at a time on the machine, so starting one while another
session's runs is refused. Wait for the other session to finish; never stop its Vortex.

## Run your build

- `/doodlebot:start with my source build and the sandbox game` starts the build with
  `doodlebot up --dev-dir <workspace>/.vortex-src --sandbox`.
- A source build runs in development mode, with React's slower development build. For timings
  that reflect users, the agent builds with `doodlebot build --checkout <dir> --production` and
  starts with `--production`. It then confirms that Vortex reports production mode.
- Keep source-build checks apart from released-build checks: development instrumentation and
  React's mode change timings.

## One running Vortex per checkout

While the test Vortex runs from a checkout, commands that would change or record that checkout
refuse:

```text
A harness Vortex is running from C:\Users\you\doodlebot\.vortex-src (pid 1234); run `doodlebot down` before building it.
```

Run `/doodlebot:stop`, then repeat the command. Stop it before you switch `.vortex-src` to
another branch as well.

## Features and refactors start with a design

Before you write code for a new feature or a refactor, run [`/doodlebot:design`](design-a-feature.md).
A bug fix needs no design; use [`/doodlebot:fix`](fix-a-bug.md).

When someone else checks your change, stop your test Vortex first. They start with
`/doodlebot:qa`, which begins from `doodlebot up --fresh` with the same target, so they do not
inherit your profile.

## What's next

- [Fix a Vortex bug](fix-a-bug.md).
- [Measure and compare performance](benchmark.md) between a release and your branch.
