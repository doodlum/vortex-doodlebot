# Doodlebot

Doodlebot is an agent companion for [Vortex](https://github.com/Nexus-Mods/Vortex), the Nexus
Mods mod manager. You install it as plugins in Claude Code or Codex and use it from the agent
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
/plugin install vortex@doodlebot
/plugin install benchmark@doodlebot
```

In Codex:

```powershell
codex plugin marketplace add doodlum/vortex-doodlebot
codex plugin add doodlebot@doodlebot
codex plugin add vortex@doodlebot
codex plugin add benchmark@doodlebot
```

Then run `/doodlebot:setup` in your agent. It installs the doodlebot workspace and command, and
prepares a sandbox test profile.

**[Read the documentation](https://doodlum.github.io/vortex-doodlebot/)** for setup, your first
session, and guides to each command.

Licensed under GPL-3.0-only. Based on [vortex-mcp](https://github.com/alandtse/vortex-mcp) by
Alan Tse.
