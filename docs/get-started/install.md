# Install the plugin

This page shows how to add the doodlebot marketplace to Claude Code or Codex, install the
doodlebot plugin, and install EGM for design review.

## Before you begin

- Check the [requirements](requirements.md).
- Know which coding agent you use. Follow the section for it: Claude Code in a terminal, Codex
  CLI, the [Claude desktop app](#claude-desktop-app) or the [Codex app](#codex-app).

## Claude Code

You need Claude Code 2.1.271 or later. Earlier versions do not keep plugin reviewers away from
the project instructions. To check your version, run `claude --version`.

1. In Claude Code, add the marketplace:

   ```text
   /plugin marketplace add doodlum/vortex-doodlebot
   ```

2. Install the plugin:

   ```text
   /plugin install doodlebot@doodlebot
   ```

3. Run `/plugin` and check that `doodlebot` is listed as enabled.
4. Run `/agents` and check that `doodlebot:vortex-driver` and
   `doodlebot:vortex-runtime-goldfish` each appear once.

The expected result: typing `/doodlebot:` in the prompt lists the doodlebot commands.

## Codex

1. In a terminal, add the marketplace:

   ```powershell
   codex plugin marketplace add doodlum/vortex-doodlebot
   ```

2. Install the plugin:

   ```powershell
   codex plugin add doodlebot@doodlebot
   ```

3. Start Codex and open the skill picker. Check that the doodlebot skills are listed, with the
   doodlebot icon. Each description starts with "Doodlebot:", so you can tell them apart from
   skills of other plugins with the same name, such as `setup` or `status`.

In Codex, run a command by choosing its skill from the picker, or by asking for it by name, for
example "use the doodlebot setup skill". Codex plugins ship no agents: where Claude Code hands a
run to `vortex-driver`, Codex runs the same procedure in your session, and design reviewers run
as general-purpose subagents on GPT-6.1 Terra, given the reviewer's instructions. In Claude Code
the reviewers run on Sonnet.

## Install EGM for design review

Designing features needs Google's [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model)
plugin (EGM), release `v0.1.1`. EGM runs inside your coding agent, not inside doodlebot. You can
skip this section if you will not design features. The
[EGM announcement](https://opensource.googleblog.com/2026/10/introducing-elephant-goldfish-model-plugin.html)
describes the model.

### EGM in Claude Code

1. Add the EGM marketplace and install the plugin **at user scope** (the default, or pick "user"
   when `/plugin` asks), so it is there in every Vortex checkout and worktree you open Claude in.
   The doodlebot workspace's `.claude/settings.json` enables EGM for that folder only, which a
   Vortex session never reads; `doodlebot check` reports EGM as missing until it is installed at
   user scope:

   ```text
   /plugin marketplace add google/elephant-goldfish-model
   /plugin install egm@egm
   ```

   From a terminal the same is `claude plugin install egm@egm --scope user`.

2. Run `/plugin` and check that `egm` version `0.1.1` is enabled. Check the version number, not
   only the name.

3. If `/plugin` shows a version newer than `0.1.1`, pin the release: uninstall `egm`, remove the
   `egm` marketplace, add it again at the release tag and install it again:

   ```text
   /plugin uninstall egm@egm
   /plugin marketplace remove egm
   /plugin marketplace add https://github.com/google/elephant-goldfish-model.git#v0.1.1
   /plugin install egm@egm
   ```

   If your Claude Code does not accept a ref there, keep the newer version, note its number, and
   bear in mind that doodlebot was checked with `0.1.1` only.

A headless run (`claude -p`) cannot answer permission prompts. EGM's reviewers read their
instructions from the plugin's folder in your user profile, so allow those reads in advance. Add
these rules to `permissions.allow` in your own Claude Code settings, replacing `<you>` with your
Windows user name:

```json
{
  "permissions": {
    "allow": [
      "Read(//c/Users/<you>/.claude/plugins/cache/egm/egm/*/agents/**)",
      "Read(//c/Users/<you>/.claude/plugins/cache/egm/egm/*/docs/**)",
      "Read(//c/Users/<you>/.claude/plugins/cache/egm/egm/*/resources/**)",
      "Read(//c/Users/<you>/.claude/plugins/cache/egm/egm/*/skills/**)"
    ]
  }
}
```

The `//c/` prefix is the absolute path `C:\`.

### EGM in Codex

1. Install the plugin:

   ```powershell
   codex plugin marketplace add google/elephant-goldfish-model
   codex plugin add egm@egm
   ```

2. Note the version Codex reports. These commands are not pinned to a release; they install the
   current version. The agent records the EGM version at the top of every review report, so you
   can compare it with what you installed.

3. If the version is newer than `0.1.1`, remove the `egm` marketplace and add it again at the
   release tag with `codex plugin marketplace add google/elephant-goldfish-model --ref v0.1.1`.
   If your Codex does not accept `--ref`, keep the newer version, note its number, and bear in
   mind that doodlebot was checked with `0.1.1` only.

### What EGM can guarantee in each agent

| Coding agent                 | EGM pinned to `v0.1.1`             | Reviewer isolation                                                                                  |
| ---------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| Claude Code 2.1.271 or later | Check `/plugin` shows `0.1.1`      | Reviewers can only read files and do not receive the project instructions                           |
| Codex                        | No; note the version you installed | Reviewers start without the conversation, but can write files and may still see the project's rules |

Codex reviewers start with `fork_turns: "none"` (or `fork_context: false` in some Codex
versions), so they do not receive the conversation. They are still general-purpose agents, not
limited to reading files. They are told to stay read-only and to ignore the project's workflow
rules, but that is an instruction, not a restriction. EGM
[issue 237](https://github.com/google/elephant-goldfish-model/issues/237) reports that the
repository's agent instructions still reach them.

## Claude desktop app

Doodlebot works in the Code tab of the Claude desktop app, in local sessions. Plugins are not
available in cloud or WSL sessions. The desktop app, the terminal and VS Code read the same
settings files, so a plugin installed at user scope in one of them is available in all three.

1. In a terminal, add both marketplaces:

   ```powershell
   claude plugin marketplace add doodlum/vortex-doodlebot
   claude plugin marketplace add google/elephant-goldfish-model#v0.1.1
   ```

   The Claude Code documentation does not say whether the desktop app's plugin browser can add
   a marketplace itself, so add them from the terminal.

2. Install doodlebot and EGM **at user scope**, in either of two ways:
   - In the terminal:

     ```powershell
     claude plugin install doodlebot@doodlebot --scope user
     claude plugin install egm@egm --scope user
     ```

   - In the desktop app: click **+** next to the prompt, then **Add plugins** (or **Plugins** →
     **Browse plugins**). Install `doodlebot` and `egm`, and choose **User** as the scope.

3. Start a new local session in any folder. Type `/` (or click **+** → **Slash commands**) and
   check that the `/doodlebot:` commands are listed. `/doodlebot:setup` works as it does in the
   terminal.

Install at user scope, not project or local scope. A Vortex checkout never reads the doodlebot
workspace's project settings, so `doodlebot check` reports EGM installed only for a project as
missing. The `/plugin` command belongs to the terminal; the desktop app has its plugin manager
instead.

Sources: [Claude Code desktop](https://code.claude.com/docs/en/desktop) and
[Discover plugins](https://code.claude.com/docs/en/discover-plugins).

## Codex app

The Codex app runs on Windows (from the Microsoft Store, or
`winget install --id 9PLM9XGG6VKS -s msstore`) and uses PowerShell by default.

1. In a terminal, add both marketplaces and install the plugins with the Codex CLI:

   ```powershell
   codex plugin marketplace add doodlum/vortex-doodlebot
   codex plugin add doodlebot@doodlebot
   codex plugin marketplace add google/elephant-goldfish-model --ref v0.1.1
   codex plugin add egm@egm
   ```

2. In the app, open the **Plugins** tab and check that `doodlebot` and `egm` are there. The Codex
   documentation does not say whether marketplaces added with the CLI appear in the app's
   Plugins tab. If they do not, install them from that tab.
3. Start a new chat: new installs appear in a new chat. Type `@` to pick the plugin or a skill,
   or mention a skill with `$`, for example `$setup`.

In the Codex CLI, `/plugins` lists the plugins. The Codex IDE extension does not support plugins.
As in the Codex CLI, the plugin ships no agents: the app runs the driver's procedure in your
session, and design reviewers run as general-purpose subagents.

Sources: [Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli),
[Codex plugins](https://learn.chatgpt.com/docs/plugins) and
[Codex on Windows](https://learn.chatgpt.com/docs/windows/windows-app).

## Verify the desktop execution path

Plugin installation, hook trust and runtime access are separate checks. Follow the
[desktop agent contract](../concepts/desktop-agents.md) before the first run. The same runtime
and isolated test profile are used by either coding agent; their plugin stores and permissions
are separate.

## What a Vortex session knows

The plugin carries one hook that runs when a session starts. When you open the session in a
Vortex checkout or one of its worktrees, it gives the agent a short note:

- doodlebot is set up, and where its workspace is;
- a Vortex change isn't finished when it compiles and its unit tests pass, so the agent offers to
  show it working with `/doodlebot:try` or `/doodlebot:qa`;
- acceptance criteria are written as things a running Vortex shows, with links to what doodlebot
  can observe.

In any other folder the hook says nothing. It only reads, and writes nothing into your checkout.
It finds the workspace through `~/.doodlebot/workspace.json`, which `doodlebot link` writes during
[setup](set-up.md). Before setup, the note says to run `/doodlebot:setup`. A workspace linked by
an older doodlebot has a working `doodlebot` command but no record; `/doodlebot:setup` or
`/doodlebot:setup --update` writes it.

- **Claude Code and the Claude desktop app** load plugin hooks when they start. Restart after
  you install or update the plugin.
- **Codex** runs a plugin's hook only after you trust it, in `/hooks` or the app's
  Settings → Hooks, and asks again after an update that changes it.

`/doodlebot:setup --check` reports the note on its "Vortex session note" row.

## What's next

[Set up doodlebot](set-up.md).
