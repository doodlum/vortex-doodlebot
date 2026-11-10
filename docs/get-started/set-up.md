# Set up doodlebot

This page shows how `/doodlebot:setup` takes your machine from installed plugins to a working
companion, without you typing a terminal command.

## Before you begin

- [Install the plugin](install.md).
- Install a released Vortex. Setup checks for it but never installs it.
- Close any test Vortex you started earlier with doodlebot. Your own Vortex can stay open.

## What setup creates

Setup installs the doodlebot runtime into a **workspace**: a clone of the doodlebot repository,
with its dependencies installed and its Vortex extension built. The default folder is
`%USERPROFILE%\doodlebot`. Test profiles, saved logins, reports and the Vortex source clone live
inside the workspace, so they survive plugin updates.

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
      `shim: <path>` and `on PATH: yes` or `on PATH: no`;
   5. runs `doodlebot version` to confirm the shim reports the new workspace.

   If `link` reports `on PATH: no`, the agent tells you which folder to add to your PATH. Setup
   itself keeps working, because it calls the shim by its full path. Add the folder so that
   later sessions find `doodlebot`.

4. The agent runs `doodlebot doctor --installed --sandbox` to check Vortex and the local setup.

   - If Vortex is missing, the agent tells you how to install it and stops. Install Vortex and
     run `/doodlebot:setup` again; it continues from where it stopped.
   - If doctor lists `Legacy lease store`, a folder left by an older doodlebot
     (`~/.vortex-ai/leases`), the agent offers to delete it. It deletes it only if you say yes.

5. The agent runs `doodlebot setup --installed --sandbox` in the background. This starts the
   test Vortex once with the sandbox game and saves a clean **baseline** profile. A Vortex window
   opens and closes again during this step.

6. The agent runs `doodlebot down`, so no test Vortex is left running.

## Expected result

The agent reports what is ready: the workspace folder, the shim and whether it is on your PATH,
the Vortex it found, and the sandbox baseline. It suggests `/doodlebot:login` and
`/doodlebot:drive` as next steps.

If you run `/doodlebot:setup` again on a set-up machine, the agent finds the dependencies, the
built extension, a shim that reports the workspace, and the baseline (doctor shows
`Sandbox baseline` with detail `present`). It then only runs `doctor` and reports that
doodlebot is already set up. It changes nothing.

If setup stops with an error, see [Troubleshooting](../troubleshooting.md).

## Update doodlebot

The plugin and the workspace update separately.

1. Update the plugin. In Claude Code, run `/plugin marketplace update doodlebot`, then restart
   Claude Code. In Codex, refresh the `doodlebot` marketplace with Codex's plugin marketplace
   command (`codex plugin marketplace --help` lists it) and add the plugin again with
   `codex plugin add doodlebot@doodlebot`.
2. Update the workspace to match. Run:

   ```text
   /doodlebot:update
   ```

   The agent stops any test Vortex (it asks first) and moves the workspace to the release that
   matches your plugins, then reinstalls its dependencies and rebuilds it. It refuses while the
   workspace has local changes, such as a regression test you added; commit or remove them
   first.

The expected result: `/doodlebot:status` reports the same doodlebot version as your plugin.
Lessons doodlebot has learned on your machine are kept outside the workspace, so an update
keeps them ([What doodlebot learns](../concepts/knowledge.md)).

## Remove doodlebot

1. Run `/doodlebot:stop`, so no test Vortex is left running.
2. Uninstall the plugin. In Claude Code:

   ```text
   /plugin uninstall doodlebot@doodlebot
   /plugin marketplace remove doodlebot
   ```

   In Codex, remove the plugin and the `doodlebot` marketplace with Codex's plugin commands
   (`codex plugin --help` lists them).

3. Delete the workspace folder (by default `%USERPROFILE%\doodlebot`). This also deletes its test
   profiles, saved Nexus logins, reports and any Vortex source clone in it, so copy anything you
   want to keep first.
4. Delete the shim: `doodlebot.cmd` and `doodlebot` in the folder that `link` wrote them to
   (`where.exe doodlebot` shows it).
5. Delete `%USERPROFILE%\.doodlebot` (`~/.doodlebot`), which holds the instance record and the
   lessons doodlebot learned on this machine (`knowledge.md`). Keep `knowledge.md` if you may
   set doodlebot up again.

Your own Vortex and its profile are not touched by any of these steps.

## What's next

- Run [your first session](first-session.md).
- To check a set-up machine later, run `/doodlebot:status`.
- To use Nexus collections, [sign in to Nexus Mods](../guides/sign-in.md).
