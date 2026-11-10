# Run report

This page describes the report that `/vortex:drive` and `/vortex:qa` write after a driven
scenario.

## Where it is

The report is written to `<workspace>/harness/.artifacts/runs/<UTC time>-<slug>/report.md` and
summarized in the chat. Each screenshot the driver takes is copied into the same folder. Logs of
commands the driver ran in the background are in `<workspace>/harness/.artifacts/runs/`.

## Sections

The sections appear in this order.

| Section                      | Contents                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| Outcome                      | _Worked_, _Worked with errors_, _Blocked_ or _Failed_, with one sentence                        |
| Scenario and target          | The scenario as asked, and the Vortex, game and profile it ran against                          |
| Steps                        | What the driver did, in order, and what it observed after each step                             |
| Dialogs and prompts answered | For each dialog: its title, the button the driver chose, and why                                |
| Errors and warnings          | Renderer console errors, Vortex log warnings and errors from `doodlebot log`, and notifications |
| Evidence                     | Paths of screenshots, logs and other files the run produced                                     |
| Not checked                  | What the scenario asked for or implied that the driver did not verify                           |

## Outcomes

| Outcome            | Meaning                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------- |
| Worked             | Every step completed as expected, with no errors or warnings                                                |
| Worked with errors | Every step completed, but the console, log or notifications reported problems                               |
| Blocked            | The scenario could not be carried out for a reason outside Vortex, such as a missing login, game or service |
| Failed             | A step did not do what the scenario expected                                                                |

## Where the errors come from

- **Console**: the renderer console from the start of its buffer, read with
  `doodlebot call ui_read_console`.
- **Vortex log**: entries at warning level or above in the test profile's `vortex.log`, read
  with `doodlebot log --level warn`.
- **Notifications**: Vortex's notifications, read from its state.

## What's next

- [Drive Vortex and get a report](../guides/drive-vortex.md).
- [Evidence and readiness](../concepts/evidence.md).
