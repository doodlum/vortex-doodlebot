# Try things in Vortex

This page shows how to have the agent try something in a test Vortex for you, with
`/doodlebot:try`, and how to have a change, a pull request or a release checked independently,
with `/doodlebot:qa`.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md). `/doodlebot:setup --check` shows what this
  machine can test against.
- For anything that needs Nexus collections, [sign in to Nexus Mods](sign-in.md) first.

## Ask for a short look

For a quick look or a single action, ask directly:

```text
/doodlebot:try open the Mods page and tell me how many mods are listed
```

The agent acts in your session on a test Vortex, takes a snapshot of the window, acts on what it
sees, and answers in the chat. No report is written.

## Run a scenario with a report

1. Describe the scenario:

   ```text
   /doodlebot:try install this mod, deploy, and report anything odd
   ```

   Name the build when it matters ("on 2.8.0", "on my build"), and content only to override the
   agent's choice ("with my Skyrim copy").

2. **The agent chooses what to test against.** The build is the one you named, or the installed
   Vortex. A release you name is fetched with `doodlebot release get <version>`: only official
   releases, checked against the published SHA-256, extracted without running the installer.
   The content comes from `doodlebot inventory`: the cheapest item that meets the scenario's
   needs, a sandbox before a game copy, the smallest copy first, an offline collection before a
   Nexus one. A need that nothing meets makes that part **not tested**, with the command that
   would meet it. The report's **Tested against** line says what was used and why.

3. The agent starts the test Vortex and delegates the scenario to `vortex-driver`. In Claude
   Code, that agent runs on Sonnet, a lower-cost model. In Codex, the same procedure runs in
   your session. The driver:

   1. carries out the steps with the `doodlebot` command only, for example `doodlebot snapshot`
      to read the window, `doodlebot click --ref <ref>` to act, and `doodlebot install <archive>`
      to install a mod;
   2. answers a dialog only when the scenario needs it, and records the title, the button and
      why;
   3. reads the renderer console (`doodlebot call ui_read_console`), Vortex log warnings and
      errors (`doodlebot log --level warn`, which keeps the lines Vortex marks `WARN` and
      `ERRO`) and Vortex's notifications;
   4. writes the report.

4. The agent stops the test Vortex and summarizes the report. It is in
   `<workspace>/harness/.artifacts/runs/<UTC time>-<slug>/report.md`, with any screenshots.

The expected result: a report with every section in [Run report](../reference/run-report.md),
ending with what doodlebot **Learned**.

A test Vortex another session started from another checkout is never stopped: the agent waits
or tells you. Your own Vortex is never closed; a launch refuses while it runs.

### Commands that take a long time or wait on a dialog

`doodlebot up`, `setup`, `test` and `install` can run longer than an agent's command timeout or
wait on a dialog. On Windows, a command that launches Vortex can also hold its captured output
open, so it never returns. The agent therefore runs these commands in the background with their
output in a log file under `<workspace>/harness/.artifacts/runs/`. A launch is done when that
process has exited and its log shows the success line, such as `Vortex is up in` for
`doodlebot up`. A first start launches Vortex up to three times, so `doodlebot status` answering
only shows that Vortex is alive, not that the start has finished. While a command that can raise
a dialog runs, it polls `doodlebot call ui_active_dialogs` and answers the dialog with
`doodlebot snapshot` and `doodlebot click --ref <ref>`. `install` gives up after 300 seconds, so
the dialog must be answered before then.

## Install a Nexus collection

1. [Sign in to Nexus Mods](sign-in.md) with `/doodlebot:setup --login`. Collections need the
   login; unattended downloads also need Nexus Mods Premium.
2. Ask for the install, naming the collection's page:

   ```text
   /doodlebot:try install the collection https://next.nexusmods.com/<game>/collections/<slug> and report anything odd
   ```

The agent runs `doodlebot collection <url>` in the background and follows the install with
`doodlebot call collection_install_state` until it finishes. A completed install is recorded in
`~/.doodlebot/content.json`, so later runs and `doodlebot test nexus` can use it. Deploy only
into a registered game copy (see [Use real games and baselines](games-and-baselines.md)).

## Check a change, a pull request or a release

Use `/doodlebot:qa` when you want a change checked by someone who did not write it. It always
starts from a fresh profile.

| You run                             | What it does                                                                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/doodlebot:qa <PR number or link>` | Builds the base and then the PR (after your go-ahead to run the PR's code), and runs each claim and the relevant QA catalogue entries on both |
| `/doodlebot:qa --design <file>`     | Checks each acceptance criterion of a design, with its negative control                                                                       |
| `/doodlebot:qa --release <version>` | Runs `doodlebot test core` and the quick catalogue checks on a release, and compares with the previous one                                    |

A claim is proved only when the base shows the old behaviour and the PR the new one. Catalogue
entries report pass, regression, fixed, failing on both, or not tested. The report lists the
changed files no catalogue entry guards, and proposes entries for them. Nothing is posted to the
pull request unless you say so.

## What's next

- [Run report](../reference/run-report.md) explains each section of the report.
- [Add a regression test](regression-tests.md).
- [Fix a Vortex bug](fix-a-bug.md).
