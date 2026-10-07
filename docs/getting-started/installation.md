# Install Doodlebot

Start here to reproduce bugs or test local mod installation with released Vortex. The
first session uses a fake game and needs no Nexus login.

## Requirements

| Requirement            | Why it is needed                                               |
| ---------------------- | -------------------------------------------------------------- |
| Windows                | Vortex and the supported Electron workflows run here           |
| Vortex                 | Install the released app before the account-free quick start   |
| Node ≥ 20.19           | CLI, build and test runtime; CI uses Node 22                   |
| pnpm 9.15.0            | The package manager pinned by `package.json`                   |
| Git                    | Clone the toolkit; source work also uses forks and worktrees   |
| An interactive desktop | Visible app and screenshot checks; headless results can differ |

Download Vortex from its [official page](https://www.nexusmods.com/about/vortex/).
Install Node from [nodejs.org](https://nodejs.org/), then install the pinned pnpm version
using the installation method supported by your Node distribution. For example, with npm:

```powershell
npm install --global pnpm@9.15.0
git clone https://github.com/doodlum/vortex-doodlebot.git
cd vortex-doodlebot
pnpm install --frozen-lockfile
$env:VORTEX_AI_OWNER = 'operator'
pnpm run build
```

`pnpm run build` builds Doodlebot's extension, not Vortex. Dependencies and the extension
output live in this checkout. You do not need a Vortex fork, an LLM or a Nexus account yet.

## Select the installed app explicitly

```powershell
$env:VORTEX_AI_INSTALLED = '1'
# Set this only for a nonstandard installation:
# $env:VORTEX_AI_EXE = 'C:\Apps\Vortex\Vortex.exe'
pnpm run ai -- doctor --installed --sandbox
```

Doctor checks the prerequisites and tells you how to fix missing ones. An existing managed
`.vortex-src` checkout takes precedence unless you select installed Vortex explicitly.
Keep that selection set throughout the quick start so every command uses the same app.

## Optional software

- An MCP-capable LLM client for [assistant workflows](../llms/connecting.md).
- FFmpeg for [video recording](../guides/capture.md); screenshots do not need it.
- GitHub CLI and fork access for [Vortex source development](../guides/source-development.md).
- Nexus OAuth and Premium for unattended [live collection downloads](authentication.md).
- Python for building or editing this documentation site; app automation does not need it.

Next: [open your first session](first-session.md).
