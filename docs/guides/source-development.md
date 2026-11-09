# Work on Vortex source

You do not need Vortex source to use Doodlebot, write a test, or benchmark a released installer. Start with [the TypeScript test guide](../getting-started/first-session.md) for those tasks.

If you are changing Vortex itself, Doodlebot can manage a clone of your Vortex fork under `.vortex-src/`. `pnpm run ai:source` obtains and builds that clone. Source development has additional Vortex build prerequisites and a longer first setup.

Make each source change on its own branch of `.vortex-src`, for example `git -C .vortex-src switch -c fix-download-panel upstream/master`. To work in a different checkout, pass it to every command with `--dev-dir <path>`. Keep source-build tests separate from released-installer comparisons: development instrumentation and React mode can change timings.

Only one Doodlebot Vortex runs at a time. While it runs from a checkout, `build`, `evidence run` and other commands that change or record that checkout refuse with a message like this:

```text
A harness Vortex is running from C:\dev\doodlebot\.vortex-src (pid 1234); run `pnpm run ai -- down` before building it.
```

Run `pnpm run ai -- down`, wait for it to report a clean exit, then repeat the command. Before you switch `.vortex-src` to another branch, run `down` as well.

## Features and refactors start with a design

Before you write code for a new feature or a refactor, write a design and have it reviewed and approved. [Review and approve a design](design-review.md) explains what a design contains, how the reviews work, and how to approve it. After approval, `pnpm run ai -- design scope <design> --checkout .vortex-src --base <sha>` lists any changed file outside the files the design approved, and exits 1 when there is one. A bug fix with an obvious cause does not need a design.

## Test the reported scenario

Test a fix the way the bug was reported before you open a pull request for it, even a draft. If a user reported a problem with their collection, mod or steps, use that collection, mod or those steps. First reproduce the problem on the unchanged build, then confirm it is gone on yours. Unit tests, a hand-built fixture or reading the uploaded data can help you find the cause. They are not the test. If you can't run the reported scenario, for example because you lack access or the step would upload something real, don't open a pull request. Report what is missing instead.

When someone else checks your change, run `pnpm run ai -- down` first. They start with `pnpm run ai -- up --fresh` and the same target flags, so they do not inherit the state of your profile.

## Source apps and the benchmark API

The benchmark API deliberately targets released Vortex. Use the lower-level harness when you need a source app. [App sessions](../reference/sessions.md#attach-to-an-existing-app) explains manual session management, and the [CLI reference](../reference/cli.md) lists target options.
