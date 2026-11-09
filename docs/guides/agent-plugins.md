# Set up design review in your coding agent

Before a coding agent adds a feature or refactors code in Vortex or Doodlebot, it writes a design and has it reviewed. A person then approves the exact text. [Review and approve a design](design-review.md) explains that part for the person who approves.

The review uses Google's [Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) plugin (EGM), release `v0.1.1`. EGM runs inside your coding agent, not inside Doodlebot. Doodlebot only checks the finished design and later compares the code change with it. The [EGM announcement](https://opensource.googleblog.com/2026/10/introducing-elephant-goldfish-model-plugin.html) describes the model in more detail.

EGM uses two kinds of agent:

- The **Elephant** is your normal agent session. It keeps the context of the task, asks you questions and writes the design. It does not write code during this stage.
- A **Goldfish** is a reviewer started without the conversation history. It reads only the design and the files it is given, so it notices what the design leaves unsaid.

How well the reviewers are kept apart from the conversation depends on your coding agent. Follow the section for the one you use.

## What each coding agent supports

| Coding agent                 | Install                                                    | Pinned to `v0.1.1`                 | Reviewer isolation                                                                        | Doodlebot commands              | Supported steps                                          |
| ---------------------------- | ---------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------- |
| Claude Code 2.1.271 or later | Automatic after you trust the folder                       | Yes                                | Reviewers can only read files and do not receive the project instructions                 | Run by the agent in its shell   | All                                                      |
| Codex CLI                    | Two commands                                               | No; note the version you installed | Reviewers start without the conversation, but can write files and still see project rules | Run by the agent in its shell   | All, with weaker isolation                               |
| ChatGPT or Codex desktop app | Published EGM plugin listing in the app's plugin directory | No; note the version you installed | Only where the session offers subagents that start without the conversation               | Run them in a terminal yourself | Brainstorm, draft and review; not checked with Doodlebot |

## Claude Code

You need Claude Code 2.1.271 or later. Earlier versions do not keep the plugin's reviewers away from the project instructions. Check your version with `claude --version`.

1. Start Claude Code in your Doodlebot clone and accept the prompt that asks whether you trust the folder.
2. The repository's `.claude/settings.json` registers the EGM marketplace pinned to the `v0.1.1` tag and enables the `egm@egm` plugin. Claude Code loads it without an install command.
3. Run `/plugin` and check that `egm` version `0.1.1` is listed as enabled. A moved tag would not be detected any other way, so check the version number, not only the name.

If the plugin is missing after you trust the folder, install it for this project yourself:

```powershell
claude plugin install egm@egm --scope project
```

Then run `/plugin` again and check for version `0.1.1`.

### Headless runs

A headless run (`claude -p`) cannot answer permission prompts. EGM's reviewers read their instructions from the plugin's folder in your user profile, so allow those reads in advance. Add these rules to `permissions.allow` in your own Claude Code settings, for example `.claude/settings.local.json` in your clone, replacing `<you>` with your Windows user name:

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

The `//c/` prefix is the absolute path `C:\`. On macOS or Linux, use the absolute path of your home folder in the same form, starting with `//`.

### Commands in Claude Code

| Command                | What it does                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `/egm:egm-brainstorm`  | Interviews you about the idea, gathers several reviewer views and writes a brief     |
| `/egm:egm-draft`       | Turns the brief into a design, one section at a time, and asks you to approve each   |
| `/egm:egm-review`      | Reviews the design in stages: overall direction, clarity, criticism and readiness    |
| `/egm:egm-resolve`     | Sorts review findings into fixes and disagreements and applies the edits you approve |
| `/egm:egm-review-loop` | Runs named reviewers against named standards; the agent uses it for the final round  |

You can start the process yourself with `/egm:egm-brainstorm <your idea>`. When you ask the agent for a feature or a refactor, it starts the process on its own.

## Codex CLI

Install the plugin with these two commands:

```powershell
codex plugin marketplace add google/elephant-goldfish-model
codex plugin add egm@egm
```

These commands are not pinned to a release; they install the current version. Note the version Codex reports. The agent records the EGM version at the top of every review report, so you can compare it with what you installed.

Codex does not read Claude Code's settings folder, so it does not use the reviewer definitions there. Codex reviewers start with `fork_turns: "none"` (or `fork_context: false` in some Codex versions), which means they do not receive the conversation. They are still general-purpose agents: they are not limited to reading files. They are told to stay read-only and to ignore the project's workflow rules, but that is an instruction, not a restriction. EGM [issue 237](https://github.com/google/elephant-goldfish-model/issues/237) reports that the repository's agent instructions still reach them.

To start a step yourself, pick the `egm-brainstorm`, `egm-draft` or `egm-review` skill from the Codex skill picker.

## ChatGPT and Codex desktop apps

In the ChatGPT or Codex desktop app, open the app's plugin directory and install the published EGM plugin listing. This is available in the desktop apps only. EGM's [Codex instructions](https://github.com/google/elephant-goldfish-model/blob/v0.1.1/docs/codex.md) describe the listing. Note the version you installed.

Use the desktop apps for the brainstorm, draft and review steps, and only where the session offers subagents that start without the conversation. Without them, the reviewers are not Goldfish: they see everything the Elephant saw. Doodlebot has not been checked with the desktop apps.

The apps may not be able to run commands in your clone. Run the Doodlebot commands, such as `pnpm run ai -- design check <file>`, in a terminal yourself, and give the output to the session.

## Where the files go

| Files                                                   | Folder                                               |
| ------------------------------------------------------- | ---------------------------------------------------- |
| EGM's briefs, drafts and stage reports                  | `harness/.artifacts/egm`                             |
| A finished design for a change to Doodlebot             | `designs/<topic>.md`, listed in `designs/SITEMAP.md` |
| A finished design for a change to Vortex                | `harness/.artifacts/designs/<topic>.md`              |
| Reports from the final review round, and `contested.md` | `harness/.artifacts/designs/<topic>.reviews/`        |

Everything under `harness/.artifacts` is ignored by Git. Doodlebot designs are committed with the change. Vortex designs stay on your machine and are not added to Vortex pull requests.

## Check the setup

Ask the agent to draft a small design, or start it yourself:

```powershell
pnpm run ai -- design new harness/.artifacts/designs/try-egm.md --title "Try EGM" --target vortex
pnpm run ai -- design check harness/.artifacts/designs/try-egm.md
```

`design new` writes an empty design with every required heading. `design check` prints `ISSUES` followed by what the design still lacks, such as acceptance criteria and a file list, and ends with the design's content digest. Delete the file when you are done.
