# Doodlebot

Doodlebot is a development and testing toolkit for [Vortex](https://github.com/Nexus-Mods/Vortex), the Nexus Mods mod manager. It lets developers and AI agents inspect a running Vortex, operate its UI, and verify what happened through app state, visible results and deployed files.

It combines two parts:

- **A Vortex extension** exposes app state and UI actions through the Model Context Protocol (MCP), so an agent or script can query mods and profiles, call Vortex operations, and interact with the rendered interface.
- **A command-line harness** launches one isolated Vortex instance at a time, prepares test games and reusable snapshots, drives the app with Playwright, and collects test and performance evidence. It can also manage a Vortex source clone for development.

The extension and harness work with a stock, released Vortex installation; no patched or self-built Vortex is required. You can write and run TypeScript tests without an LLM.

## What you can do

- Reproduce UI bugs and check fixes against a real Vortex app.
- Test mod installation, enabling, deployment and the resulting files.
- Install pinned Nexus collections and reuse cached snapshots for repeatable runs.
- Benchmark collection workflows and large mod tables, saving results to compare between releases.
- Give an AI agent tools to investigate Vortex and verify its changes in an isolated development session.

Local tests use a disposable game and need no Nexus account or installed game. Real collection workflows have additional login, game and data prerequisites described in the guides.

## Get started

You need Windows, a released Vortex installation, Git, Node.js **20.19 or newer**, and **pnpm 9.15.0**. Run UI tests on a visible desktop.

```powershell
git clone https://github.com/doodlum/vortex-doodlebot.git
cd vortex-doodlebot
pnpm install
pnpm run setup
```

Choose **Local test** to generate `my-first-test.mts`, then run it with `pnpm exec tsx my-first-test.mts`. It opens Vortex with a disposable game, checks that the Mods search filters three rows, and closes the app.

**[Read the documentation](https://doodlum.github.io/vortex-doodlebot/)** for [your first test](docs/getting-started/first-session.md), [collection setup](docs/getting-started/setup.md), [benchmarks](docs/testing/benchmarks.md), and [Vortex source development](docs/guides/source-development.md). New features and refactors start with a design that an AI agent drafts and reviews with Google's Elephant-Goldfish Model plugin and that you approve: see [review and approve a design](https://doodlum.github.io/vortex-doodlebot/guides/design-review/) and [set up design review in your coding agent](https://doodlum.github.io/vortex-doodlebot/guides/agent-plugins/). AI agents start with the operating manual in `harness/AGENTS.md`.

Licensed under GPL-3.0-only. Based on [vortex-mcp](https://github.com/alandtse/vortex-mcp) by Alan Tse.
