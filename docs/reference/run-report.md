# Run report

This page describes the report that `/doodlebot:try` writes after a driven scenario.
`/doodlebot:investigate`, `/doodlebot:fix` and `/doodlebot:qa` write the same report for each run
they make.

## Where it is

The report is written to `<workspace>/harness/.artifacts/runs/<UTC time>-<slug>/report.md` and
summarized in the chat. Each screenshot the driver takes is copied into the same folder. Logs of
commands the driver ran in the background are in `<workspace>/harness/.artifacts/runs/`.

## Sections

The sections appear in this order.

| Section                      | Contents                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Outcome                      | One of the outcomes below, with one sentence                                                                                   |
| Tested against               | The build (release, installed, or source with its head), the content (sandbox, game copy, collection), and why each was chosen |
| Scenario and target          | The scenario as asked, the flags, the profile, and whether the instance was started for the run                                |
| Steps                        | What the driver did, in order, and what it observed after each step                                                            |
| Dialogs and prompts answered | For each dialog: its title, the button the driver chose, and why                                                               |
| Errors and warnings          | Renderer console errors, Vortex log warnings and errors from `doodlebot log`, and notifications                                |
| Evidence                     | Paths of screenshots, logs and other files the run produced                                                                    |
| Not checked                  | What the scenario asked for or implied that the driver did not verify, and each unmet need's next command                      |
| Learned                      | Lessons recorded, noted or removed; kit gaps found; QA catalogue entries proposed; or "nothing"                                |

## Outcomes

| Outcome                     | Meaning                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Worked                      | Every step completed as expected, with no errors or warnings                                                |
| Worked with errors          | Every step completed, but the console, log or notifications reported problems                               |
| Passed with workaround: <x> | A step needed a workaround, named; one that bypasses the UI says so                                         |
| Blocked                     | The scenario could not be carried out for a reason outside Vortex, such as a missing login, game or service |
| Not tested                  | Nothing on this machine met what the scenario needs; the report names the command that would                |
| Failed                      | A step did not do what the scenario expected                                                                |

When a check passed but the scenario failed, the outcome is Failed, and the check is recorded as
a kit gap.

## Where the errors come from

- **Console**: the renderer console from the start of its buffer, read with
  `doodlebot call ui_read_console`.
- **Vortex log**: entries at warning level or above in the test profile's `vortex.log`, read
  with `doodlebot log --level warn`.
- **Notifications**: Vortex's notifications, read from its state.

## What's next

- [Try things in Vortex](../guides/drive-vortex.md).
- [Evidence and the QA catalogue](../concepts/evidence.md).
