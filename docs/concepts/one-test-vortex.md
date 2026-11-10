# One test Vortex at a time

This page explains why only one doodlebot test Vortex runs on a machine, how doodlebot keeps
track of it, and what to do when a command refuses because one is running.

## Before you begin

Read [How doodlebot works](how-it-works.md).

## The rule

One doodlebot test Vortex runs on a machine at a time, driven by one agent. This holds across
every workspace on the machine: a second workspace cannot start a test Vortex while the first
one's runs.

Doodlebot does not queue commands from two sessions. Do not drive, rebuild or test the same test
Vortex from two sessions at once. Stop it with `/doodlebot:stop` before you hand work to another
session, start a different profile, run regression tests or benchmark.

The rule covers only doodlebot's test Vortex. Your own Vortex is separate, and doodlebot never
closes it. While it runs, doodlebot does not start a test Vortex at all:

```text
Your own Vortex is running (pid 1234). Close it, then retry.
```

Any `Vortex.exe` counts, and so does a Vortex source build you started yourself. There is no
option to start beside it.

## The instance record

Every doodlebot command that launches Vortex writes the record `~/.doodlebot/instance.json` in
your user profile folder, right after the launch. It holds the process ID, start time, cache,
profile folder, MCP port, the checkout or executable it runs, and your `nxm://` link handler.

Every Vortex registers itself as the handler for `nxm://` links, so doodlebot keeps the one you
had. When the test Vortex is stopped, or found closed after a crash, doodlebot puts your handler
back.

A record counts as running only while its process is alive and is `Vortex.exe`, `electron.exe`,
`vortex` or `electron`. Otherwise it is stale and is cleared when read.

## What refuses while Vortex runs

- **Starting another test Vortex**, from any workspace or cache, and running the regression
  suite:

  ```text
  A harness Vortex is running (pid 1234, cache C:\Users\you\doodlebot\harness\.cache); run `doodlebot down` before starting Vortex.
  ```

  The end of the message names what was refused, for example `before the core suite.` for
  the regression suite.

- **Changing or recording the checkout it runs from**: building it, installing into it,
  recording evidence in it or reverting it:

  ```text
  A harness Vortex is running from C:\Users\you\doodlebot\.vortex-src (pid 1234); run `doodlebot down` before building it.
  ```

- **Updating the workspace**:

  ```text
  A harness Vortex is running; run doodlebot down before updating.
  ```

- **Starting the same profile with another build**, such as a second worktree or another
  release. The test Vortex belongs to the session that started it, so it is left running:

  ```text
  A harness Vortex of another build is running from C:\work\vortex-a (branch fix-a) (pid 1234); run `doodlebot down` before starting Vortex.
  ```

Nothing was started or changed. Run `/doodlebot:stop`, then repeat the command. Starting the
same profile with the same build again is not refused: it restarts that profile. The first start
with a different build on a profile starts fresh from its baseline.

## How stopping works

`/doodlebot:stop` runs `doodlebot down`. It reads the record, so it stops the running test
Vortex whatever cache or port it uses, and first names the checkout and branch, or the
executable, it runs. It asks Vortex to quit, waits up to 30 seconds for a clean exit, then clears
the record and restores your `nxm://` handler and the game's user folders
([Use real games and baselines](../guides/games-and-baselines.md#keep-a-real-game-safe)). It never kills a process: a Vortex that does not exit is reported
and left running. Close its window and stop it again.

## Records from older doodlebot versions

Older versions kept the record in the workspace, at `harness/.cache/instance.json`. Doodlebot
still reads that file. If it names a running Vortex, launches and `doodlebot down` refuse with:

```text
A harness Vortex from an older doodlebot is running (pid 1234); stop it before starting Vortex.
```

Close that Vortex window. Once its process has exited, the old file is deleted when next read.

## What's next

- [Troubleshooting](../troubleshooting.md#a-harness-vortex-is-running) covers a refusal that
  continues after you stop Vortex.
- [Configuration](../reference/configuration.md).
