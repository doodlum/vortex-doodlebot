# Doodlebot

Doodlebot is an agent companion for [Vortex](https://github.com/Nexus-Mods/Vortex), the Nexus Mods
mod manager. You install it as plugins in Claude Code or Codex and use it from the agent window,
through commands. The agent starts an isolated test copy of Vortex, drives it, checks what
happened and reports back.

Use doodlebot to:

- check a Vortex flow, such as installing and deploying a mod, and get a report of what worked,
  what logged errors and which dialogs were answered;
- reproduce and fix a Vortex bug, and prepare the pull request;
- design a Vortex feature before it is coded, with a review you approve;
- measure how fast a Vortex flow is, or compare two Vortex versions.

Doodlebot works with a stock, released Vortex. You need a Vortex source checkout only to change
Vortex itself.

## The three plugins

Doodlebot is a plugin marketplace named `doodlebot` with three plugins. Their commands never mix.

| Plugin      | Commands                                                                                                                                                            | For                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `doodlebot` | `/doodlebot:setup`, `/doodlebot:login`, `/doodlebot:baseline`, `/doodlebot:start`, `/doodlebot:stop`, `/doodlebot:status`, `/doodlebot:update`, `/doodlebot:source` | Installing and running the companion and its test Vortex    |
| `vortex`    | `/vortex:design`, `/vortex:fix`, `/vortex:drive`, `/vortex:qa`, `/vortex:ui-test`, `/vortex:pr`                                                                     | Working on Vortex: designs, bug fixes, driving the app, PRs |
| `benchmark` | `/benchmark:measure`, `/benchmark:compare`                                                                                                                          | Measuring Vortex performance and comparing versions         |

The commands are shown in their Claude Code form. In Codex, the same commands are skills with the
same names. [Commands](reference/commands.md) lists every command and its arguments.

Behind the commands is one command-line tool, `doodlebot`, which the agent runs for you.
`/doodlebot:setup` installs it. [How doodlebot works](concepts/how-it-works.md) explains the
parts.

## Doodlebot and EGM

Features and refactors in Vortex start with a design. Doodlebot uses Google's
[Elephant-Goldfish Model](https://github.com/google/elephant-goldfish-model) plugin (EGM) to
write and review it: `/vortex:design` runs EGM's procedure with a Vortex-specific reviewer, and
you approve the final text. EGM is a separate plugin that you install alongside doodlebot. See
[Design first](concepts/design-first.md).

## Get started

1. Check the [requirements](get-started/requirements.md).
2. [Install the plugins](get-started/install.md).
3. [Set up doodlebot](get-started/set-up.md).
4. Run [your first session](get-started/first-session.md).
