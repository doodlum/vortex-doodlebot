# Doodlebot

<img src="plugins/doodlebot/assets/icon.png" alt="" width="96" align="right">

Doodlebot is an agent companion for [Vortex](https://github.com/Nexus-Mods/Vortex), the Nexus
Mods mod manager. You install it as a plugin in Claude Code or Codex and use it from the agent
window: the agent starts an isolated test copy of Vortex, drives it, and reports what happened.
Use it to check Vortex flows, fix Vortex bugs, design features with Google's
[Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) plugin, and measure
or compare Vortex performance. It works with a stock, released Vortex.

## Install

You need Windows, Git, Node.js 20.19 or later, pnpm 9.15.0, a released Vortex, and Claude Code
2.1.271 or later or Codex.

In Claude Code:

```text
/plugin marketplace add doodlum/vortex-doodlebot
/plugin install doodlebot@doodlebot
```

In Codex:

```powershell
codex plugin marketplace add doodlum/vortex-doodlebot
codex plugin add doodlebot@doodlebot
```

Doodlebot also works in the Claude desktop app's Code tab and in the Codex app: see
[Claude desktop app](docs/get-started/install.md#claude-desktop-app) and
[Codex app](docs/get-started/install.md#codex-app).

Then run `/doodlebot:setup` in your agent. It installs the doodlebot workspace and command, and
prepares a sandbox test profile.

## Commands

| You ask                                      | Command                  |
| -------------------------------------------- | ------------------------ |
| "Set up doodlebot" / "What can I test here?" | `/doodlebot:setup`       |
| "Get me the Vortex source"                   | `/doodlebot:source`      |
| "Try X in Vortex" / "Does X work?"           | `/doodlebot:try`         |
| "Prototype this idea"                        | `/doodlebot:prototype`   |
| "Find out why this is broken"                | `/doodlebot:investigate` |
| "Fix it"                                     | `/doodlebot:fix`         |
| "Review / QA this PR" / "Check the release"  | `/doodlebot:qa`          |
| "Is it faster?"                              | `/doodlebot:measure`     |
| "Ship it"                                    | `/doodlebot:pr`          |

Features start with a design in EGM (`/egm:*`, which you type yourself), then
`/doodlebot:qa --design <file>`. In Codex the commands are skills with the same names.

**[Read the documentation](https://doodlum.github.io/vortex-doodlebot/)** for setup, your first
session, and guides to each command.

Licensed under GPL-3.0-only. Based on [vortex-mcp](https://github.com/alandtse/vortex-mcp) by
Alan Tse.
