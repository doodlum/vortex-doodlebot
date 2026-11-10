# What doodlebot learns

Doodlebot keeps the lessons it learns while it works, so later commands don't fall into the same
trap twice. This page explains where lessons are stored, when doodlebot records one, and how
to share a lesson with everyone else.

## Two stores

| Store  | Where                       | Who writes it                                             | Who sees it                         |
| ------ | --------------------------- | --------------------------------------------------------- | ----------------------------------- |
| Shared | `KNOWLEDGE.md` in doodlebot | Doodlebot's maintainers, through pull requests            | Everyone who installs doodlebot     |
| Local  | `~/.doodlebot/knowledge.md` | The agent on your machine, with `doodlebot knowledge add` | You, in Claude Code and Codex alike |

The local store sits outside the workspace. It survives `/doodlebot:update` and a new
`/doodlebot:setup`, and it never makes the workspace look changed.

## When doodlebot reads lessons

Before `/doodlebot:fix`, `/doodlebot:drive`, `/doodlebot:design` and `/doodlebot:ui-test`
act, they search both stores for the symptom or the area they are working on.

Every match is treated as a lead, not a fact. The agent rechecks it against the current Vortex
code and against what it observes. Its report says which lesson it used and whether the lesson
still held.

## When doodlebot records a lesson

After `/doodlebot:fix`, `/doodlebot:drive` or `/doodlebot:qa`, the agent records a lesson only
when all of these are true:

- it confirmed the cause, for example from the source code, a control test, or a
  reproduction that stopped when the cause was removed;
- knowing the lesson would have saved real time;
- neither store already has it.

Guesses, one-off failures and workarounds nobody understands stay in the run report. The
agent tells you what it recorded, with the lesson's id.

Each lesson has a title, the area, the symptom, the confirmed cause, the remedy, where it
applies, the evidence, and the Vortex version and date it was seen. `doodlebot knowledge add`
refuses text that looks like a token, so credentials never end up in a lesson.

## See, search or remove lessons

Ask the agent, or run these yourself in a terminal:

```powershell
doodlebot knowledge list                    # every local lesson, with its id
doodlebot knowledge search install dialog   # local lessons and KNOWLEDGE.md holding every word
doodlebot knowledge remove <id>             # delete a lesson that turned out wrong
doodlebot knowledge path                    # where the local store is
```

The local store is a plain Markdown file, so you can also open it and edit it.

## Share a lesson

When a local lesson keeps holding, it can help everyone. Ask the agent to share it. It
prepares a doodlebot pull request that adds the lesson and its evidence to `KNOWLEDGE.md`, and
the lesson reaches everyone once it is reviewed and merged. The agent never shares a lesson on
its own.

## What's next

- [Drive Vortex and get a report](../guides/drive-vortex.md)
- [Fix a Vortex bug](../guides/fix-a-bug.md)
