# Develop Doodlebot

Doodlebot's extension lives in `src/`. The app launcher, fixtures, TypeScript helpers, and real-app tests live in `harness/`. The public benchmark helpers live in `harness/benchmarks/`.

## Make and check a change

Install dependencies, edit the code, and run:

```powershell
pnpm run ci
```

This checks TypeScript, lint, formatting, documentation, the proposal catalog, unit tests, and the extension build. It does not launch Vortex.

If formatting or lint fails, use the repository's tools:

```powershell
pnpm run format
pnpm run lint:fix
```

For a change to app behavior, also run an appropriate [real-app test](testing/integration.md). For a benchmark helper, verify both its arithmetic and the actual action/consequence against Vortex.

## Choose a test layer

Pure logic and DOM helpers use [Vitest](testing/unit.md). Vortex integration uses [Playwright fixtures](testing/integration.md). Performance comparisons use [benchmark cases](testing/adding-benchmarks.md).

Prefer an assertion that can catch the reported failure. A deploy test should check files; a UI action should check its resulting rows or state; a startup measurement should launch a new process.

## Update the user guide

When inputs, prerequisites, commands, or guarantees change, update the guide showing people how to use them. Generated references complement those procedures. [Documentation development](maintaining-documentation.md) explains generation, preview, and the site build.

Keep pull requests focused on the behavior changed and the checks performed. Use Conventional Commit messages when committing.

Working on Vortex itself is optional and has a separate [source-development path](guides/source-development.md). Normal Doodlebot tests use the released app.
