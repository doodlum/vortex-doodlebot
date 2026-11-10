# Install the plugins

This page shows how to add the doodlebot marketplace to Claude Code or Codex, install its three
plugins, and install EGM for design review.

## Before you begin

- Check the [requirements](requirements.md).
- Know which coding agent you use. Follow the section for it.

## Claude Code

You need Claude Code 2.1.271 or later. Earlier versions do not keep plugin reviewers away from
the project instructions. To check your version, run `claude --version`.

1. In Claude Code, add the marketplace:

   ```text
   /plugin marketplace add doodlum/vortex-doodlebot
   ```

2. Install the three plugins:

   ```text
   /plugin install doodlebot@doodlebot
   /plugin install vortex@doodlebot
   /plugin install benchmark@doodlebot
   ```

3. Run `/plugin` and check that `doodlebot`, `vortex` and `benchmark` are listed as enabled.
4. Run `/agents` and check that `vortex:vortex-driver` and `vortex:vortex-runtime-goldfish` each
   appear once.

The expected result: typing `/doodlebot:` in the prompt lists the doodlebot commands.

## Codex

1. In a terminal, add the marketplace:

   ```powershell
   codex plugin marketplace add doodlum/vortex-doodlebot
   ```

2. Install the three plugins:

   ```powershell
   codex plugin add doodlebot@doodlebot
   codex plugin add vortex@doodlebot
   codex plugin add benchmark@doodlebot
   ```

3. Start Codex and open the skill picker. Check that the doodlebot skills are listed. Each
   description starts with "Doodlebot:", "Vortex:" or "Benchmark:", so you can tell them apart
   from skills of other plugins with the same name, such as `setup` or `status`.

In Codex, run a command by choosing its skill from the picker, or by asking for it by name, for
example "use the doodlebot setup skill". Codex plugins ship no agents: where Claude Code hands a
run to `vortex-driver`, Codex runs the same procedure in your session, and design reviewers run
as general-purpose subagents given the reviewer's instructions.

## Install EGM for design review

`/vortex:design` needs Google's [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model)
plugin (EGM), release `v0.1.1`. EGM runs inside your coding agent, not inside doodlebot. You can
skip this section if you will not design features. The
[EGM announcement](https://opensource.googleblog.com/2026/10/introducing-elephant-goldfish-model-plugin.html)
describes the model.

### EGM in Claude Code

1. Add the EGM marketplace and install the plugin:

   ```text
   /plugin marketplace add google/elephant-goldfish-model
   /plugin install egm@egm
   ```

2. Run `/plugin` and check that `egm` version `0.1.1` is enabled. Check the version number, not
   only the name.

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

The ChatGPT and Codex desktop apps have not been checked with doodlebot. Doodlebot's commands
need an agent that can run commands on your machine.

## What's next

[Set up doodlebot](set-up.md).
