# Drive Vortex and get a report

This page shows how to have the agent operate the test Vortex for you, with `/doodlebot:drive`,
and how to have a change checked independently, with `/doodlebot:qa`.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md).
- Decide which Vortex and game the scenario needs. The sandbox game covers installing, enabling,
  deploying and purging mods. For a real game, see
  [Use real games and baselines](games-and-baselines.md).
- For anything that needs Nexus collections, [sign in to Nexus Mods](sign-in.md) first.

## Ask for a short task

For a quick look or a single action, ask directly:

```text
/doodlebot:drive open the Mods page and tell me how many mods are listed
```

The agent acts in your session. It starts the test Vortex if none is running, takes a snapshot
of the window, acts on what it sees, and answers in the chat. No report is written.

## Run a scenario with a report

1. Describe the scenario and ask for a report:

   ```text
   /doodlebot:drive install this mod, deploy, and report anything odd
   ```

   Name the archive, the game and the target Vortex when they matter, for example "with the
   released Vortex and the sandbox game".

2. The agent delegates the scenario to `vortex-driver`. In Claude Code, that agent runs on
   Sonnet, a lower-cost model. In Codex, the same procedure runs in your session.

3. The driver:

   1. gets a test Vortex. If one is answering and its profile is under the configured cache,
      the driver reuses it and leaves it running afterward. If the Vortex answering belongs to
      another cache, the driver stops and tells you, and does not touch it. If nothing answers,
      it starts one with `doodlebot up` in the background and stops it at the end;
   2. carries out the steps with the `doodlebot` command only, for example `doodlebot snapshot`
      to read the window, `doodlebot click --ref <ref>` to act, and `doodlebot install <archive>`
      to install a mod;
   3. answers a dialog only when the scenario needs it. It reads the dialog's text, picks the
      button, and records the title, the button and why;
   4. reads the renderer console (`doodlebot call ui_read_console`), Vortex log warnings and
      errors (`doodlebot log --level warn`) and Vortex's notifications;
   5. writes the report.

4. Read the summary in the chat. The report is in
   `<workspace>/harness/.artifacts/runs/<UTC time>-<slug>/report.md`. Screenshots the driver
   took are copied into the same folder.

The expected result: a report with every section in [Run report](../reference/run-report.md).
Its **Outcome** tells you at a glance whether the scenario worked.

### Commands that take a long time or wait on a dialog

`doodlebot up`, `setup`, `test` and `install` can run longer than an agent's command timeout or
wait on a dialog. On Windows, a command that launches Vortex can also hold its captured output
open, so it never returns. The driver therefore runs these commands in the background with their
output in a log file under `<workspace>/harness/.artifacts/runs/`. A launch is done when that
process has exited and its log shows the success line, such as `Vortex is up in` for
`doodlebot up`. A first start launches Vortex up to three times, so `doodlebot status` answering
only shows that Vortex is alive, not that the start has finished. While a command that can raise a dialog runs, it polls `doodlebot call ui_active_dialogs` and
answers the dialog with `doodlebot snapshot` and `doodlebot click --ref <ref>`. `install` gives
up after 300 seconds, so the dialog must be answered before then.

## Install a Nexus collection

1. [Sign in to Nexus Mods](sign-in.md) with `/doodlebot:login`. Collections need the login;
   unattended downloads also need Nexus Mods Premium.
2. Ask for the install, naming the collection's page and the game:

   ```text
   /doodlebot:drive install the collection https://next.nexusmods.com/<game>/collections/<slug> and report anything odd
   ```

The agent runs `doodlebot collection <url>` in the background and follows the install with
`doodlebot call collection_install_state` until it finishes. Deploy only into a disposable copy
of the game (see [Use real games and baselines](games-and-baselines.md)).

## Check a change independently

Use `/doodlebot:qa` when a change is finished and you want it checked by someone who did not write
it.

1. Make sure the author has stopped its test Vortex: run `/doodlebot:stop`.
2. In a fresh session, run:

   ```text
   /doodlebot:qa <the change, its branch and its acceptance criteria>
   ```

3. The agent delegates to `vortex-driver`, which starts with `doodlebot up --fresh`, so it does
   not inherit the author's profile, and checks each acceptance criterion.

The expected result: a run report whose steps and evidence address each criterion.

## What's next

- [Run report](../reference/run-report.md) explains each section of the report.
- [Add a regression test](regression-tests.md) turns a checked behavior into a repeatable test.
- [Fix a Vortex bug](fix-a-bug.md).
