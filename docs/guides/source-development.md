# Work on Vortex source

You do not need Vortex source to use Doodlebot, write a test, or benchmark a released installer. Start with [the TypeScript test guide](../getting-started/first-session.md) for those tasks.

If you are changing Vortex itself, Doodlebot can manage a clone of your Vortex fork under `.vortex-src/`. `pnpm run ai:source` obtains and builds that clone. Source development has additional Vortex build prerequisites and a longer first setup.

Create a worktree for a source change with `pnpm run ai -- worktree add <name>`. Keep source-build tests separate from released-installer comparisons: development instrumentation and React mode can change timings.

The benchmark API deliberately targets released Vortex. Use the lower-level harness when you need a source app. [App sessions](../reference/sessions.md#attach-to-an-existing-app) explains manual session management, and the [CLI reference](../reference/cli.md) lists target options.
