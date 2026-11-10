# Troubleshooting

This page lists common problems, what causes them, and what to do. Start with the first error
the agent reports. `/doodlebot:setup --check` and `doodlebot doctor`, which the agent can run for you,
check the local setup.

## The agent says `doodlebot` was not found

The shim is missing or its folder is not on your PATH.

1. Run `/doodlebot:setup`. If the workspace exists, setup repairs only what is missing.
2. If setup reports `on PATH: no`, add the folder it names to your PATH, then restart your agent.

If `link` fails with
`No writable folder on the PATH for the doodlebot shim; pass --bin-dir <folder>.`, run setup
again with a folder you can write to that is on your PATH, for example
`/doodlebot:setup --bin-dir C:\Users\you\bin`.

## The agent suggests `/doodlebot:setup --update`

The plugin's version differs from the workspace's. Run `/doodlebot:setup --update`. It can refuse:

| Message                                                                   | What to do                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `A harness Vortex is running; run doodlebot down before updating.`        | Have the agent run `doodlebot down`, then update again           |
| `The workspace has local changes; commit or remove them before updating.` | Commit or remove the changes in the workspace, then update again |
| `No tag or branch <ref> on origin.`                                       | The agent retries with `main`                                    |

## Setup stops at a prerequisite

- **Git or Node.js is missing or too old.** Install Git, or Node.js 20.19 or later, then run
  `/doodlebot:setup` again. Setup never installs them. On an older Node, every `doodlebot`
  command stops with `doodlebot needs Node 20.19 or newer; this is <version>`.
- **pnpm is missing or not 9.15.0.** Let setup enable it with corepack, or install pnpm 9.15.0
  yourself.
- **The clone or install fails.** Check that GitHub and the npm registry are reachable.

## Vortex cannot be found

`doodlebot doctor` reports a failing `Vortex` check. Install a released Vortex, or tell the agent
where its `Vortex.exe` is; it passes `--exe <path>`. If you named a source checkout, the message
`--dev-dir <path> is not a built Vortex checkout` means it is not built: run `/doodlebot:source`
or build it first.

If you extract a Vortex release inside the workspace's `harness` folder, put a `package.json`
containing `{"type": "commonjs"}` beside `Vortex.exe`. The `harness` folder is an ES-module
package, so without that file Node treats Vortex's bundled plugins as ES modules and they fail to
load. Extracting the release outside `harness` avoids this.

## A harness Vortex is running

Only one doodlebot test Vortex runs on a machine. A command that would start a second one, or
change the checkout a running one uses, stops with a message like one of these:

```text
A harness Vortex is running (pid 1234, cache C:\Users\you\doodlebot\harness\.cache); run `doodlebot down` before the core suite.
A harness Vortex is running from C:\Users\you\doodlebot\.vortex-src (pid 1234); run `doodlebot down` before building it.
```

Nothing was started or changed. If your session started that test Vortex, have the agent run
`doodlebot down`; if another session did, wait for it. Then repeat your request. You do not need
to repeat the options the Vortex was started with: `doodlebot down` reads the record and stops
that Vortex, whatever cache or port it uses.

The record is `~/.doodlebot/instance.json`. A record whose process has exited is cleared
automatically. If the refusal continues although no doodlebot Vortex window is open, and `down`
reports that it waited and the process did not exit, the process ID may now belong to another
Electron app. Check in Task Manager that the named process is not a doodlebot Vortex, then delete
`~/.doodlebot/instance.json`.

A refusal that starts `A harness Vortex from an older doodlebot is running` comes from a
workspace record left by an older version. Close that Vortex window; see
[One test Vortex at a time](concepts/one-test-vortex.md#records-from-older-doodlebot-versions).

## A start is refused because of a pending restore

The user folders of a game from an earlier run were never put back, so every start is refused
until you decide. Run `doodlebot game restore <gameId>`: it lists the changed files, and you
choose `--all`, `--keep` or `--file <path>`. Saves and other files that are not Vortex's own
are always listed rather than restored, since they may be yours.

If the message says the backup is missing, nothing can be restored from it. Check the folders
yourself, then run `doodlebot game restore <gameId> --keep` to keep them as they are; that
clears the refusal.

## A warning says the protections are Windows-only

On Linux or macOS, doodlebot cannot see your own Vortex, a running game or the `nxm://` link
handler, so it does not check them. Close your own Vortex and the game yourself before a run.

## A command never returns

On Windows, a command that launches Vortex, such as `doodlebot up`, can keep its captured output
open, so the agent's command never finishes. Doodlebot's commands run such commands in the
background with their output in a log file under `<workspace>/harness/.artifacts/runs/`. If you
asked the agent to run one directly and it hangs, ask it to stop the command and run it in the
background instead.

## A dialog blocks a scenario

An unexpected dialog can keep an install waiting. `doodlebot install` gives up after 300 seconds.
Ask the agent to read the open dialogs with `doodlebot call ui_active_dialogs` and tell you what
they say. The driver answers a dialog only when the scenario needs it, and records each answer
in the run report.

## Sign-in or collection downloads fail

Run [`/doodlebot:setup --login`](guides/sign-in.md). An API key alone cannot authenticate collections,
and unattended collection downloads need Nexus Mods Premium. A saved login that Nexus no longer
accepts needs a new login.

Browser login, captcha, a missing entitlement or an unavailable service is an external blocker,
not a Vortex bug. The agent reports it with the step that failed.

## A mod installs but does not deploy

Installing stages files; it does not put them in the game folder. The mod must be enabled and
deployed. An installer dialog can keep a mod in the installing state, and a game folder deployed
by another Vortex can block deployment. Use a game copy, and do not purge a normal game
installation to get past an error.

## Timings are noisy

Keep the machine quiet while a benchmark runs: close CPU-heavy programs, and keep the window
size, data and background activity the same. Screenshots, recording and profiling add work.
Compare builds in the same mode; a source build in development mode is slower than a release.
See [Measure and compare performance](guides/benchmark.md).

## Leftover folders from older versions

Older versions of doodlebot could run several instances at once and kept extra folders for that.
Current versions do not use them. Once no doodlebot Vortex is running, they can be removed:

- `~/.vortex-ai/leases` in your user profile folder. `doodlebot doctor` lists it as
  `Legacy lease store`, and `/doodlebot:setup` offers to delete it;
- `harness/.slots` in the workspace;
- `.vortex-worktrees` in the workspace: commit or copy any work you still need from it, delete
  the folder, then run `git -C <workspace>/.vortex-src worktree prune` so the Vortex clone
  forgets the deleted checkouts. Their branches stay in `<workspace>/.vortex-src`.

## What's next

- [Configuration](reference/configuration.md).
- [Security and privacy](security.md).
