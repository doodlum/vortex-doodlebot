# Set up doodlebot

This page shows how `/doodlebot:setup` takes your machine from installed plugins to a working
companion, without you typing a terminal command.

## Before you begin

- [Install the plugins](install.md).
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
`/vortex:drive` as next steps.

If you run `/doodlebot:setup` again on a set-up machine, the agent finds the dependencies, the
built extension, a shim that reports the workspace, and the baseline (doctor shows
`Sandbox baseline` with detail `present`). It then only runs `doctor` and reports that
doodlebot is already set up. It changes nothing.

If setup stops with an error, see [Troubleshooting](../troubleshooting.md).

## What's next

- Run [your first session](first-session.md).
- To check a set-up machine later, run `/doodlebot:status`.
- To use Nexus collections, [sign in to Nexus Mods](../guides/sign-in.md).
