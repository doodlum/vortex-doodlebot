# Your first session

This page walks you through a first session: have the agent try something in a test Vortex and
report what happened. It needs no game and no Nexus account.

## Before you begin

- [Set up doodlebot](set-up.md).
- Make sure no other doodlebot test Vortex is running. Only one runs on a machine at a time.

## See what this machine can test

Run:

```text
/doodlebot:setup --check
```

The agent prints one status table: the doodlebot version, Vortex, EGM, the Vortex source, what
doodlebot can test against (releases, game copies, sandboxes, collections), the Nexus login,
pending restores, open kit gaps and disk use. Every row is ready, or missing with the exact next
step. It changes nothing.

## Try something and get a report

1. Run:

   ```text
   /doodlebot:try install a small test mod, enable it, deploy, and report anything odd
   ```

2. The agent chooses what to test against: the installed Vortex (or a release you name) and the
   cheapest content that meets the scenario, here the **sandbox**, a disposable game that
   supports real mod installs, enabling, deployment and purging, but is not a playable game. It
   starts the test Vortex, which uses its own profile and never touches your own Vortex.
3. The agent hands the scenario to the `vortex-driver` agent. In Claude Code, that agent runs on
   a lower-cost model (Sonnet); in Codex, your session carries out the same procedure. The
   driver:

   - carries out each step in the test Vortex through the `doodlebot` command;
   - answers a dialog only when the scenario needs it, and records what it answered;
   - reads the renderer console, the Vortex log and Vortex's notifications;
   - writes a run report.

4. The agent stops the test Vortex and summarizes the report in the chat. The full report is in
   `<workspace>/harness/.artifacts/runs/<UTC time>-<slug>/report.md`, next to any screenshots.

The expected result: a report whose **Outcome** is _Worked_, _Worked with errors_, _Passed with
workaround_, _Blocked_, _Not tested_ or _Failed_, with a **Tested against** line (the build, the
content and why), the steps, the dialogs answered, errors and warnings, evidence, what was not
checked, and what doodlebot **Learned**. [Run report](../reference/run-report.md) describes each
section.

## What's next

- [Try things in Vortex](../guides/try-vortex.md) covers longer scenarios, collections and QA.
- [Fix a Vortex bug](../guides/fix-a-bug.md).
- [Measure and compare performance](../guides/benchmark.md).
