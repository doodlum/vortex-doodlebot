# Your first session

This page walks you through a first session: start the test Vortex, have the agent install and
deploy a mod and report what happened, then stop Vortex. It needs no game and no Nexus account.

## Before you begin

- [Set up doodlebot](set-up.md).
- Make sure no other doodlebot test Vortex is running. Only one runs on a machine at a time.

## Start the test Vortex

1. In your agent, run:

   ```text
   /doodlebot:start with the sandbox game
   ```

   The agent runs `doodlebot up --installed --sandbox` in the background and waits until the
   test Vortex answers.

2. Wait for the agent to report the MCP endpoint. A Vortex window opens with the **sandbox**: a
   disposable game that supports real mod installs, enabling, deployment and purging, but is not
   a playable game.

The test Vortex uses its own profile. It does not touch your own Vortex, its mods or its
settings.

## Drive Vortex and get a report

1. Run:

   ```text
   /doodlebot:drive install a small test mod, enable it, deploy, and report anything odd
   ```

2. The agent hands the scenario to the `vortex-driver` agent. In Claude Code, that agent runs on
   a lower-cost model (Sonnet); in Codex, your session carries out the same procedure. The
   driver:

   - carries out each step in the test Vortex through the `doodlebot` command;
   - answers a dialog only when the scenario needs it, and records what it answered;
   - reads the renderer console, the Vortex log and Vortex's notifications;
   - writes a run report.

3. Read the summary in the chat. The full report is in
   `<workspace>/harness/.artifacts/runs/<UTC time>-<slug>/report.md`, next to any screenshots the
   driver took.

The expected result: a report whose **Outcome** is _Worked_, _Worked with errors_, _Blocked_ or
_Failed_, followed by the steps, the dialogs answered, errors and warnings, evidence, and what
was not checked. [Run report](../reference/run-report.md) describes each section.

## Check the status

Run:

```text
/doodlebot:status
```

The agent reports the doodlebot version and workspace, whether a test Vortex is running and
answering, and, if it is, whether a Nexus login is saved.

## Stop the test Vortex

1. Run:

   ```text
   /doodlebot:stop
   ```

2. The agent runs `doodlebot down`, which asks the test Vortex to quit and waits for a clean
   exit.

The expected result: the Vortex window closes and the agent reports that no test Vortex is
running. Stop it whenever you finish, before you start a different profile, and before a
regression test or benchmark.

## What's next

- [Drive Vortex and get a report](../guides/drive-vortex.md) covers longer scenarios and
  independent QA.
- [Fix a Vortex bug](../guides/fix-a-bug.md).
- [Measure and compare performance](../guides/benchmark.md).
