# Doodlebot

Doodlebot is an agent companion for [Vortex](https://github.com/Nexus-Mods/Vortex), the Nexus Mods
mod manager. You install it as a plugin in Claude Code or Codex and use it from the agent window,
through commands. The agent starts an isolated test copy of Vortex, drives it, checks what
happened and reports back.

Use doodlebot to:

- try a Vortex flow, such as installing and deploying a mod, on a release or your own build, and
  get a report of what worked, what logged errors and what it was tested against;
- find out why something is broken, and fix it with a regression test and a pull request;
- QA a pull request, a design's acceptance criteria, or a new release;
- measure how fast a Vortex flow is, or compare two Vortex builds.

Doodlebot works with a stock, released Vortex. You need a Vortex source checkout only to change
Vortex itself.

## The commands

Doodlebot is one plugin, `doodlebot`, from a marketplace of the same name. It has eight
commands, one for each thing people ask:

| You ask                                      | Command                  |
| -------------------------------------------- | ------------------------ |
| "Set up doodlebot" / "What can I test here?" | `/doodlebot:setup`       |
| "Get me the Vortex source"                   | `/doodlebot:source`      |
| "Try X in Vortex" / "Does X work?"           | `/doodlebot:try`         |
| "Find out why this is broken"                | `/doodlebot:investigate` |
| "Fix it"                                     | `/doodlebot:fix`         |
| "Review / QA this PR" / "Check the release"  | `/doodlebot:qa`          |
| "Is it faster?"                              | `/doodlebot:measure`     |
| "Ship it"                                    | `/doodlebot:pr`          |

The commands are shown in their Claude Code form. In Codex, the same commands are skills with the
same names. [Commands](reference/commands.md) lists every command and its arguments.

Behind the commands is one command-line tool, `doodlebot`, which the agent runs for you.
`/doodlebot:setup` installs it. [How doodlebot works](concepts/how-it-works.md) explains the
parts.

Doodlebot also learns. Every command's report ends with a **Learned** section: a lesson whose
cause it confirmed, something the kit could not do (a kit gap), or a test nobody has written
yet. Lessons stay on your machine and later commands check them before they act. See
[What doodlebot learns](concepts/knowledge.md).

## Doodlebot and EGM

Features and refactors in Vortex start with a design. Doodlebot uses Google's
[Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) plugin (EGM) to
write and review it, with doodlebot's Vortex runtime reviewer in EGM's review loop, and you
approve the final text. Then `/doodlebot:qa --design <file>` checks the implementation against
the design's acceptance criteria. EGM is a separate plugin that you install alongside doodlebot.
See [Design first](concepts/design-first.md).

## Get started

1. Check the [requirements](get-started/requirements.md).
2. [Install the plugin](get-started/install.md).
3. [Set up doodlebot](get-started/set-up.md).
4. Run [your first session](get-started/first-session.md).
