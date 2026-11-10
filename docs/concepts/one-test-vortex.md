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
closes it.

## The instance record

Every doodlebot command that launches Vortex writes the record `~/.doodlebot/instance.json` in
your user profile folder, right after the launch. It holds the process ID, start time, cache,
profile folder, MCP port and, for a source build, the checkout.

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
  recording evidence in it, reverting it or patching it:

  ```text
  A harness Vortex is running from C:\Users\you\doodlebot\.vortex-src (pid 1234); run `doodlebot down` before building it.
  ```

- **Updating the workspace**:

  ```text
  A harness Vortex is running; run doodlebot down before updating.
  ```

Nothing was started or changed. Run `/doodlebot:stop`, then repeat the command. Starting the
same profile again is not refused: it restarts that profile.

## How stopping works

`/doodlebot:stop` runs `doodlebot down`. It reads the record, so it stops the running test
Vortex whatever cache or port it uses. It asks Vortex to quit, waits up to 30 seconds for a clean
exit, then clears the record. It never kills a process: a Vortex that does not exit is reported
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
