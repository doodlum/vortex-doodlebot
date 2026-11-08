# Work on Vortex source

You do not need Vortex source to use Doodlebot, write a test, or benchmark a released installer. Start with [the TypeScript test guide](../getting-started/first-session.md) for those tasks.

If you are changing Vortex itself, Doodlebot can manage a clone of your Vortex fork under `.vortex-src/`. `pnpm run ai:source` obtains and builds that clone. Source development has additional Vortex build prerequisites and a longer first setup.

Create a worktree for a source change with `pnpm run ai -- worktree add <name>`. Keep source-build tests separate from released-installer comparisons: development instrumentation and React mode can change timings.

Test a fix the way the bug was reported before you open a pull request for it, even a draft. If a user reported a problem with their collection, mod or steps, use that collection, mod or those steps. First reproduce the problem on the unchanged build, then confirm it is gone on yours. Unit tests, a hand-built fixture or reading the uploaded data can help you find the cause. They are not the test. If you can't run the reported scenario, for example because you lack access or the step would upload something real, don't open a pull request. Report what is missing instead.

The benchmark API deliberately targets released Vortex. Use the lower-level harness when you need a source app. [App sessions](../reference/sessions.md#attach-to-an-existing-app) explains manual session management, and the [CLI reference](../reference/cli.md) lists target options.
