# Requirements

This page lists what your machine needs before you install doodlebot.

## Before you begin

Doodlebot runs on Windows. Its test Vortex opens a window, so use a visible desktop, not a locked
or headless session.

## What you need

| Requirement  | Version or detail                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| Coding agent | Claude Code 2.1.271 or later, or Codex                                                                      |
| Git          | Any current version, on the PATH                                                                            |
| Node.js      | 20.19 or later, on the PATH                                                                                 |
| pnpm         | 9.15.0. If it is missing, `/doodlebot:setup` offers to enable it with corepack                              |
| Vortex       | A released Vortex, installed or extracted                                                                   |
| Network      | Access to GitHub and the npm registry while you set up                                                      |
| Disk space   | Room for the workspace, its dependencies and test profiles; real game copies and collections need much more |

Setup never installs Node.js, Git or Vortex for you, and never runs a Vortex installer. Install
them first.

Setup asks before it enables pnpm. If you agree, it runs `corepack enable`, then
`corepack prepare pnpm@9.15.0 --activate`.

## What you need only for some tasks

| Task                               | Also needed                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Local checks with the sandbox game | Nothing more. No game and no Nexus account                                                                                                 |
| Nexus collections                  | A Nexus Mods account, signed in once with [`/doodlebot:login`](../guides/sign-in.md)                                                       |
| Unattended collection downloads    | Nexus Mods Premium                                                                                                                         |
| A real game                        | The game installed; a test machine or QA-only Windows account is safest ([Use real games and baselines](../guides/games-and-baselines.md)) |
| Changing Vortex itself             | A GitHub fork of Vortex and Vortex's own build prerequisites ([Work on Vortex source](../guides/source-development.md))                    |
| Designing features                 | The EGM plugin, `v0.1.1` ([Install the plugin](install.md))                                                                                |

## What's next

[Install the plugin](install.md).
