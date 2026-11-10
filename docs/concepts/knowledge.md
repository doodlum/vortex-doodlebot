# What doodlebot learns

Doodlebot keeps the lessons it learns while it works, so later commands don't fall into the same
trap twice. It also notes what it could not do for you. This page explains where these are
stored, when doodlebot records them, and how to share them with everyone else.

## Three kinds of learning

| Kind          | Example                                                     | Where it goes                                  |
| ------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| Vortex lesson | "Collection review stays open after Resume; close it first" | `~/.doodlebot/knowledge.md`                    |
| Kit gap       | No doodlebot tool reads the Downloads queue                 | `~/.doodlebot/gaps.md`                         |
| Test gap      | A changed part of Vortex that no QA check covers            | A proposed QA catalogue entry in the QA report |

Every report ends with a **Learned** section that lists what was recorded, or says "nothing".

## Where lessons are stored

| Store  | Where                       | Who writes it                                             | Who sees it                         |
| ------ | --------------------------- | --------------------------------------------------------- | ----------------------------------- |
| Shared | `KNOWLEDGE.md` in doodlebot | Doodlebot's maintainers, through pull requests            | Everyone who installs doodlebot     |
| Local  | `~/.doodlebot/knowledge.md` | The agent on your machine, with `doodlebot knowledge add` | You, in Claude Code and Codex alike |

The local files sit outside the workspace. They survive `/doodlebot:setup --update` and a new
`/doodlebot:setup`, and they never make the workspace look changed.

## When doodlebot reads lessons

Before `/doodlebot:try`, `/doodlebot:investigate` and `/doodlebot:fix` act, they search both stores for the symptom or the area they are working on.

Every match is treated as a lead, not a fact. The agent rechecks it against the current Vortex
code and against what it observes. Its report says which lesson it used and whether the lesson
still held.

## When doodlebot records a lesson

After `/doodlebot:try`, `/doodlebot:investigate`, `/doodlebot:fix` or `/doodlebot:qa`, the agent records a lesson only
when all of these are true:

- it confirmed the cause, for example from the source code, a control test, or a
  reproduction that stopped when the cause was removed;
- knowing the lesson would have saved real time;
- neither store already has it.

Guesses, one-off failures and workarounds nobody understands stay in the run report. The
agent tells you what it recorded, with the lesson's id.

Each lesson has a title, the area, the symptom, the confirmed cause, the remedy, where it
applies, the evidence, the Vortex version it was confirmed on, and the date. The version is
required. `doodlebot knowledge add` refuses text that looks like a token or a stack trace, so
credentials never end up in a lesson.

## When a lesson turns out wrong

The agent says so in its report. It removes a local lesson only when the lesson fails on the
same Vortex version and in the same situation. Otherwise it adds a dated note, such as "does
not hold on 2.9.0", and you decide whether to remove it.

## Kit gaps

A kit gap is something doodlebot should have done for a task and didn't. For example, no tool
could read a page, or `install` could not answer a dialog. A bug in Vortex is not a gap.

- The agent never changes doodlebot in the middle of your task. It finishes or stops the task,
  records the gap and offers to fix it in doodlebot afterwards.
- A result that needed a workaround says "passed with workaround", never a plain pass.
- The same gap seen again is counted, not added twice.
- When a gap is fixed, it is closed with the commit that fixed it. If it is seen again, it is
  re-opened only when your doodlebot already has that fix; otherwise the agent tells you to
  update.
- A gap you reject is closed as "wontfix" and is not raised again.

## See, search or remove

Ask the agent, or run these yourself in a terminal:

```powershell
doodlebot knowledge list                    # every local lesson, with its id
doodlebot knowledge search install dialog   # local lessons and KNOWLEDGE.md holding every word
doodlebot knowledge remove <id>             # delete a lesson that turned out wrong
doodlebot knowledge path                    # where the local store is
doodlebot gap list                          # the open kit gaps (--all for closed ones too)
doodlebot gap close <id> --wontfix          # reject a gap
```

The local stores are plain Markdown files, so you can also open them and edit them.

## Share a lesson or a gap

Nothing leaves your machine unless you ask. When a lesson keeps holding, or a gap matters to
others, ask the agent to share it. It becomes an issue on doodlebot's GitHub repository, which
the maintainer turns into a change.

1. The agent runs `doodlebot knowledge share <id>` (or `doodlebot gap share <id>`). This
   only prints the text. Your folders, Windows user name, computer name and Nexus user name are
   replaced with placeholders, and data from other people, such as someone's Vortex log, is
   left out.
2. The agent shows you the text and asks you to confirm, because the repository is public.
3. After you confirm, it publishes exactly that text. If an open issue already has the same
   title, it adds a comment there instead.
4. The issue link is saved, and the same entry is never shared twice.

Without the GitHub CLI (`gh`), the agent gives you the text to paste into a new issue yourself.
Once the maintainer adds the lesson to `KNOWLEDGE.md`, you get it with `/doodlebot:setup --update`.

## What's next

- [Try things in Vortex](../guides/try-vortex.md)
- [Fix a Vortex bug](../guides/fix-a-bug.md)
