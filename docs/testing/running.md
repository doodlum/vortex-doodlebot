# Choose and run checks

Doodlebot has fast repository checks, real-app integration tests, and performance scripts. Pick the layer that answers your question.

Experimental [native Linux VM deployment](../guides/linux-vm.md) includes scoped transport
tests requiring kit dependencies and Git; real app checks also require a prepared native guest.

| Check              | Command                           | What it proves                                                                 |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------ |
| Repository gate    | `pnpm run ci`                     | Types, lint, formatting, documentation checks, unit tests, and extension build |
| Unit tests         | `pnpm run test`                   | Pure logic and simulated DOM behavior                                          |
| Real-app tests     | `pnpm run ai:test`                | Integration with an actual Vortex app and a disposable game                    |
| Your benchmark     | `pnpm exec tsx run-benchmark.mts` | Your defined actions, observations, timings, and supplied budgets              |
| Documentation site | `pnpm run docs:build`             | The site builds with valid navigation and links                                |

## Local integration suite

Install dependencies and a released Vortex first. The core Playwright suite runs without a Nexus account and uses disposable profiles and a test game. To force the installed app when a source checkout exists:

```powershell
$env:VORTEX_AI_INSTALLED = 'true'
$env:VORTEX_AI_OWNER = 'core-tests'
pnpm run ai:test
```

The suite runs one worker under the named owner and writes an HTML report to `harness/playwright-report`. Its runner and fixtures share that owner so a source build can use the same checkout lease. Profiles, credentials and debug ports remain isolated. Failure traces are retained. A Playwright test timeout is different from an approved performance budget.

Account and game-specific tests are separate. Do not infer that a local synthetic test covers a real collection or engine page.

When a core test fails, its disposable profile and logs remain at the path printed by
the runner. Inspect them alongside the failure trace before cleaning up. Shutdown is
still checked; a retained profile alone does not mean its app is running. Reload checks
also attach MCP probe and browser navigation evidence.
Game checks open the Mods workspace explicitly after verifying the active game. Failure
attachments include process and window state as well as navigation events, helping
distinguish a closed app from a renderer that has stopped responding.

Run `pnpm exec vitest run harness/src/uiDriver.test.ts harness/src/uiSession.test.ts` for UI wait and targeting
regressions. These need no app, game or account. An intentionally unanswered local HTTP
request checks that a UI wait respects its deadline; each snapshot request is capped
at five seconds or the remaining wait, whichever is shorter. Contention checks also
hold the shared UI lock past a wait's deadline and verify that the expired waiter
fails without issuing a late snapshot. Cancellation preserves the current action's
lock, including nested transactions.

The repository gate checks collection startup with simulated UI responses and DOM snapshots, including large pages, nested dialog wrappers, separate matching dialogs, and failed clicks without another action. It also checks that a click reports the button it targeted when that action immediately changes the button's label. That result identifies the action; it does not prove the collection finished. A real collection run must still reach its verified installation and deployment result.

## Real-mode game onboarding

The checks above run Vortex in test mode, which turns off game detection, and press buttons
through JavaScript. Neither matches a person adding a game. Run:

```sh
VORTEX_AI_OWNER=real-mode pnpm run ai:test:real-mode
```

It starts Vortex normally in a private folder under the harness cache, opens Games and presses
every **Add game** button with the real mouse pipeline. It fails if the window's renderer
crashes, a detected game is not added, or Vortex shows an error notification, and prints the
path of a JSON report listing the detected games, so Windows and Linux results can be compared.
It also requires Vortex to close normally with exit code zero; forced shutdowns fail the check.
The report includes the exit code, termination signal and whether cleanup had to stop the app.
If an app survives cleanup, its profile and ownership stay reserved for inspection.
It needs at least one supported game installed, for example through Steam, and writes only what
adding a game normally writes to that game's settings.

On Windows, select a packaged or installed Vortex (`VORTEX_AI_INSTALLED=1`, optionally
`VORTEX_AI_EXE`): a source build chooses its own data folder and would use your real one. A
normal first start also makes that Vortex the handler for Nexus download links, so the run saves
your current handler and puts it back after Vortex stops. Concurrent real-mode checks serialize
this Windows registration. Linux keeps its configuration and desktop registration data inside
the private run folder. macOS is not supported.

## Add the right test

Use [unit tests](unit.md) for pure logic and DOM helpers. Use [real-app tests](integration.md) for Vortex integration and deployed files. Use [benchmarks](benchmarks.md) to compare observable performance.

A passing repository gate does not run Vortex. Report the specific check you ran and any untested real-app behavior.
