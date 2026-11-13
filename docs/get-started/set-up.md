# Set up doodlebot

This page shows how `/doodlebot:setup` takes your machine from installed plugins to a working
companion, without you typing a terminal command.

## Before you begin

- [Install the plugin](install.md).
- A released Vortex: either install it yourself, or let doodlebot fetch an official release with `doodlebot release get <version>`, which it extracts without running the installer. Setup checks for either and never installs Vortex.
- Close any test Vortex you started earlier with doodlebot. Your own Vortex can stay open.

## What setup creates

Setup installs the doodlebot runtime into a **workspace**: a clone of the doodlebot repository,
with its dependencies installed and its Vortex extension built. The default folder is
`%USERPROFILE%\doodlebot`. Test profiles and reports live inside the workspace. Vortex's own
source is not in it: work on Vortex's code happens in a Vortex checkout you open Claude in. Your Nexus login, lessons, kit gaps, releases and registered game copies live in
`%USERPROFILE%\.doodlebot`, so they survive updates and a new workspace.

Setup also writes a small launcher, the **shim**, so that the `doodlebot` command works from any
folder. The agent uses that command for everything else.

## Run setup

1. In your agent, run:

   ```text
   /doodlebot:setup
   ```

   You can give setup three inputs. Name only the ones you want to change:

   | Input             | Default                                                                               |
   | ----------------- | ------------------------------------------------------------------------------------- |
   | The folder        | `%USERPROFILE%\doodlebot`, or an existing doodlebot checkout you name                 |
   | `--ref <ref>`     | `v<plugin version>`, the release matching your plugins; `main` if that tag is missing |
   | `--bin-dir <dir>` | The first writable folder on your PATH that suits a command shim                      |

   For example: `/doodlebot:setup D:\tools\doodlebot --bin-dir D:\tools\bin`.

2. The agent checks Git, Node.js 20.19 or later, and pnpm 9.15.0. If pnpm is missing or a
   different version, it asks whether to enable pnpm 9.15.0 with corepack. Answer yes, or install
   pnpm 9.15.0 yourself and run setup again.

3. The agent asks where to put the workspace. Accept the default or name a folder. It then:

   1. clones `https://github.com/doodlum/vortex-doodlebot.git` into the folder and checks out
      the ref;
   2. runs `pnpm install --frozen-lockfile`;
   3. runs `pnpm run build`;
   4. runs `node bin/doodlebot.cjs link`, which writes the shim and prints
      `shim: <path>` and `on PATH: yes` or `on PATH: no`. It also records the workspace in
      `~/.doodlebot/workspace.json`, including the absolute shim path, so a session opened in a Vortex checkout is told where
      doodlebot is ([What a Vortex session knows](install.md#what-a-vortex-session-knows));
   5. runs `doodlebot version --json` and the absolute command route in the agent's normal
      execution environment to confirm they report the chosen workspace. If linking needed
      host approval, a host-only version check does not establish that sandboxed skills work.

   If `link` reports `on PATH: no`, the agent tells you which folder to add to your PATH. Setup
   itself keeps working, because it calls the shim by its full path. Add the folder so that
   later sessions find `doodlebot`. If the sandbox hides or blocks it, the agent reports that
   distinction and follows [command discovery troubleshooting](../troubleshooting.md#the-agent-says-doodlebot-was-not-found)
   before reinstalling. A later context can recover the absolute shim from the workspace record.

4. The agent runs `doodlebot doctor --installed --sandbox` to check Vortex and the local setup.

   - If Vortex is missing, the agent tells you how to install it and stops. Install Vortex and
     run `/doodlebot:setup` again; it continues from where it stopped.
   - If doctor lists `Legacy lease store`, a folder left by an older doodlebot
     (`~/.vortex-ai/leases`), the agent offers to delete it. It deletes it only if you say yes.

5. The agent runs `doodlebot check`, the read-only status table of `/doodlebot:setup --check`
   (below). Setup does not start Vortex: the first `/doodlebot:try` builds the sandbox
   **baseline** profile.

## Expected result

The agent reports what is ready: the workspace folder, the shim and whether it is on your PATH,
and the status table. It suggests `/doodlebot:try` as the next step, and
`/doodlebot:setup --login` only if you will use Nexus collections.

If you run `/doodlebot:setup` again on a set-up machine, it finds the dependencies, the built
extension and a shim that reports the workspace, and only prints the status table. It changes
nothing.

## Check what this machine can test

Run `/doodlebot:setup --check` at any time. It is read only and prints one row per item, each
ready, missing with the exact next step, or blocked with the reason:

- the workspace and its version, and `doodlebot doctor` for the installed Vortex and the sandbox
  (Vortex, the extension, the sandbox baseline, 7-Zip, the login folder's privacy, a running
  test Vortex);
- whether the EGM plugin is installed, and the Vortex checkout the session is in: its remotes,
  branch and build (a Vortex clone an older doodlebot kept in the workspace is listed with its
  worktrees, as a checkout to open Claude in; doodlebot never deletes it);
- `doodlebot inventory`: releases, game copies, snapshots, sandboxes and collections;
- the Nexus login;
- the folder game copies go in, and any pending restore of a game's user folders, with
  `doodlebot game restore <gameId>`;
- open kit gaps, and lessons on your machine that `KNOWLEDGE.md` now holds;
- disk use, with a warning below 10 GB free that names `doodlebot clean`.

The first time it finds no folder for game copies, the agent asks you for one and stores it
(`doodlebot game folder <dir>`), so it never asks again. The agent acts on a row only with your
yes: it deletes nothing on its own.

A checkout that is not built yet needs nothing from you: the first `/doodlebot:try` on your
build (or `fix`, `qa`, `prototype`) prepares it. With no checkout yet, ask for one: the agent
asks for a folder, runs `doodlebot source --clone <dir>`, and you open Claude in `<dir>`.

If setup stops with an error, see [Troubleshooting](../troubleshooting.md).

## Update doodlebot

The plugin and the workspace update separately.

1. Update the plugin. In Claude Code, run `/plugin marketplace update doodlebot`, then restart
   Claude Code. In Codex, refresh the `doodlebot` marketplace with Codex's plugin marketplace
   command (`codex plugin marketplace --help` lists it) and add the plugin again with
   `codex plugin add doodlebot@doodlebot`.
2. Update the workspace to match. Run:

   ```text
   /doodlebot:setup --update
   ```

   The agent stops any test Vortex (it asks first) and moves the workspace to the release that
   matches your plugins, then reinstalls its dependencies and rebuilds it. It refuses while the
   workspace has local changes, such as a regression test you added; commit or remove them
   first.

The expected result: `/doodlebot:setup --check` reports the same doodlebot version as your plugin.
Lessons doodlebot has learned on your machine are kept outside the workspace, so an update
keeps them ([What doodlebot learns](../concepts/knowledge.md)).

## Remove doodlebot

1. Make sure no test Vortex is left running (the agent can run `doodlebot down`).
2. Uninstall the plugin. In Claude Code:

   ```text
   /plugin uninstall doodlebot@doodlebot
   /plugin marketplace remove doodlebot
   ```

   In Codex, remove the plugin and the `doodlebot` marketplace with Codex's plugin commands
   (`codex plugin --help` lists them).

3. Delete the workspace folder (by default `%USERPROFILE%\doodlebot`). This also deletes its test
   profiles, saved Nexus logins and reports, so copy anything you
   want to keep first.
4. Delete the shim: `doodlebot.cmd` and `doodlebot` in the folder that `link` wrote them to
   (`where.exe doodlebot` shows it).
5. Delete `%USERPROFILE%\.doodlebot` (`~/.doodlebot`), which holds the instance record, the
   workspace record and the lessons doodlebot learned on this machine (`knowledge.md`). Keep `knowledge.md` if you may
   set doodlebot up again.

Your own Vortex and its profile are not touched by any of these steps.

## What's next

- Run [your first session](first-session.md).
- To check a set-up machine later, run `/doodlebot:setup --check`.
- To use Nexus collections, [sign in to Nexus Mods](../guides/sign-in.md) with `/doodlebot:setup --login`.
