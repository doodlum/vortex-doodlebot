# Contribute

This page shows how to work on doodlebot itself: use your checkout as the workspace, run the
checks, add tests and keep this documentation current.

## Before you begin

- Meet the [requirements](get-started/requirements.md).
- Clone `https://github.com/doodlum/vortex-doodlebot.git`.

## Use your checkout as the workspace

1. Start Claude Code in your checkout and trust the folder. The repository's project settings
   (`.claude/settings.json`) register the `doodlebot` marketplace from this folder and the EGM
   marketplace pinned to `v0.1.1`, and enable `egm@egm` and `doodlebot@doodlebot`. You use the
   plugin you are editing.
2. Run `/doodlebot:setup` and name your checkout as the folder. Setup installs dependencies,
   builds the extension and links the shim to your checkout.
3. After you edit a plugin, run `/plugin marketplace update doodlebot` so Claude Code reloads it.

If the plugin does not appear after you trust the folder, run `/plugin marketplace add ./` from
the checkout once.

## Where the code is

| Path                 | What it is                                                          |
| -------------------- | ------------------------------------------------------------------- |
| `plugins/doodlebot/` | The plugin: its skills, agents, resources and icon                  |
| `bin/`               | The `doodlebot` entry point and the updater                         |
| `src/`               | The Vortex extension: the MCP server exposing Vortex's state and UI |
| `harness/src/`       | The CLI, launcher, fixtures and helpers                             |
| `harness/src/tests/` | Playwright tests and performance checks against a real Vortex       |
| `docs/`              | This site                                                           |
| `designs/`           | Approved doodlebot designs, listed in `designs/SITEMAP.md`          |

The extension must keep working against a stock, released Vortex. Anything that needs Vortex's
main process belongs in the harness, never in a patch to Vortex.

Features and refactors of doodlebot start with an approved design, like Vortex changes; see
[Design a feature with EGM](guides/design-a-feature.md). Doodlebot designs are committed in
`designs/<topic>.md`.

## Run the checks

1. Run the repository gate in a terminal in your checkout:

   ```powershell
   pnpm run ci
   ```

   It checks types, lint, formatting, documentation, the QA catalogue (`doodlebot qa check`),
   unit tests and the extension build. It does not launch Vortex. Among the unit tests, `harness/src/plugins.test.ts` holds the plugin
   to its design: the manifests and icon, every skill's frontmatter, every plugin resource a
   skill names, both agents running on Sonnet, exactly the eight commands with a Learned section
   in each report, and no text naming a removed command. Tests that would reach GitHub (sharing,
   pushing) use a stand-in for `gh`; none of them publishes anything.

2. If formatting or lint fails, fix it with the repository's tools rather than by hand:

   ```powershell
   pnpm run format
   pnpm run lint:fix
   ```

   GitHub runs the same gate on every pull request. That's all GitHub runs: it never starts
   Vortex.

3. For a change to how doodlebot drives Vortex, also have the agent run the Playwright suite on
   a released Vortex, with `doodlebot test core --release 2.8.0` (after
   `doodlebot release get 2.8.0`). It starts its own Vortex with a disposable test game and no
   account, so stop any running test Vortex first. CI doesn't run this suite, so it's yours to
   run before a release.

Say which checks you ran. Passing unit tests alone do not show that a Vortex flow works.

While you edit the extension, `pnpm run dev` rebuilds it and reloads it in the running test
Vortex after each settled edit. Run one watcher at a time, and not during a test: a reload
invalidates UI refs mid-action.

## Write a unit test

Use Vitest for logic that does not need Vortex: parsing, statistics, input validation and pure
DOM helpers. Put harness tests next to the code in `harness/src/*.test.ts`, and DOM logic in
`src/uiAutomation.test.ts`, which runs under jsdom. A rule about the command line itself, such
as `install` refusing an unquoted path with a space, belongs in `harness/src/cliArgs.test.ts`.
A rule about Git state runs on real temporary repositories: `harness/src/source.test.ts` checks
that `doodlebot source --exclude` keeps `.doodlebot/` and the Claude desktop app's
`.claude/worktrees/` out of `git add -A`, and `harness/src/prPreflight.test.ts` checks that a
design committed on a work branch passes the preflight while a `proto/*` branch fails it. The plugin's
SessionStart hook is a plain script; `harness/src/sessionNote.test.ts` runs it as Claude Code does,
with the hook input on stdin, in temporary Vortex and non-Vortex repositories.

```powershell
pnpm exec vitest run harness/src/perfSummary.test.ts
pnpm run test
```

A simulated DOM can check a selector or a transformation, but cannot prove that a current Vortex
screen has the expected control. Use a real-app test for that.

## Write a real-app test

Playwright specs live in `harness/src/tests/` and use the suite's fixtures: `mcp` (the tool
client), `vortexWindow` (the rendered window), `managedGame` (the test game's ID and path) and
`config`. Use the tool client for the action and the window, state or deployed files for its
consequence. [Add a regression test](guides/regression-tests.md) shows how the agent writes and
runs one.

Every test and check must run on a released Vortex as well as a source build. Testing that only a
source build can run is not kept.

## Maintain the documentation

The site is built with MkDocs Material. Pages live in `docs/`, and the navigation is in
`mkdocs.yml`; every page must be in the navigation.

1. Install the pinned site tools once, with Python available:

   ```powershell
   python -m pip install -r requirements-docs.txt
   ```

2. Regenerate and check:

   ```powershell
   pnpm run docs:generate
   pnpm run docs:check
   pnpm run docs:test
   pnpm run docs:build
   ```

   `docs:generate` refreshes the generated references: [Commands](reference/commands.md) from
   the plugin skills, the [doodlebot CLI](reference/cli.md) (the commands `cli.ts` dispatches,
   plus those the launcher handles itself, such as `update`) and the
   [MCP tools](reference/mcp-tools.md) and the [QA catalogue](reference/qa-catalog.md), from
   `harness/qa/catalog.json`. `docs:check` catches stale references and missing paired
   updates. `docs:test` tests the checks. `docs:build` runs a strict MkDocs build into `site/`.
   To use another Python, set `DOODLEBOT_DOCS_PYTHON` to its path.

3. Preview with `pnpm run docs:serve` and open the address it prints.

`scripts/documentation-map.json` pairs source paths with the site pages and the agent manuals
that describe them. When a change touches a group's source, `docs:check` expects one of that
group's pages and one of its manuals to change as well. For example, a change to the knowledge,
gap or sharing code pairs with [What doodlebot learns](concepts/knowledge.md). The site documents setup and commands
for people; the manuals document internals for agents.

Write each page as a task: what it is for, "Before you begin", numbered steps with the exact
commands, the expected result, and "What's next".

## Commit and pull requests

Use Conventional Commits. Keep pull requests focused on the behavior changed and the checks
performed.

## What's next

- [How doodlebot works](concepts/how-it-works.md).
- [Credits](credits.md).
