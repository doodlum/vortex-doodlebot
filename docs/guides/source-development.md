# Work on Vortex source

This page shows how to prepare a Vortex source clone with `/doodlebot:source`, work on a branch
of it, and run your build in the test Vortex.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md).
- Have a GitHub fork of Vortex, and Vortex's own build prerequisites. The first build takes
  longer than doodlebot's setup.
- Stop any running test Vortex with `/doodlebot:stop`.

You do not need Vortex source to drive a released Vortex, add a regression test for doodlebot's
suite, or measure a release.

## Prepare the source clone

1. Run:

   ```text
   /doodlebot:source
   ```

2. The agent runs `doodlebot source`, which finds your GitHub fork, clones it into
   `<workspace>/.vortex-src` and builds it.

3. The agent makes a branch of `.vortex-src` for your work, for example
   `git -C <workspace>/.vortex-src switch -c fix-download-panel upstream/master`.

The expected result: a built clone in `<workspace>/.vortex-src`, on a new branch.

To work in a different checkout instead, name it; the agent passes it to every command with
`--dev-dir <path>`.

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
