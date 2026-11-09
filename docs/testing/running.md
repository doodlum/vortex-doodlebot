# Choose and run checks

Doodlebot has fast repository checks, real-app integration tests, and performance scripts. Pick the layer that answers your question.

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
pnpm run ai:test
```

To run against a particular released build, set `VORTEX_AI_EXE` to its `Vortex.exe`. If you extract that build inside the `harness` folder, for example under `harness/.artifacts`, also put a `package.json` containing `{"type": "commonjs"}` beside `Vortex.exe`. The `harness` folder is an ES-module package, so without that file Node treats the app's bundled plugins as ES modules and they fail to load. Extracting the build outside `harness` avoids this.

The suite runs one worker and writes an HTML report to `harness/playwright-report`. Failure traces are retained. A Playwright test timeout is different from an approved performance budget.

The suite starts its own Vortex, and Doodlebot runs only one at a time. If a Vortex you started with `pnpm run ai -- up` or `setup` is still running, the suite stops before any test with:

```text
A harness Vortex is running (pid 1234, cache C:\dev\doodlebot\harness\.cache); run `pnpm run ai -- down` before the core suite.
```

Run `pnpm run ai -- down`, then start the suite again. [Troubleshooting](../troubleshooting.md#a-harness-vortex-is-running) covers a refusal that remains after `down`.

The lifecycle test starts and stops Vortex several times on its own, so it always runs first, before the other tests share one app. Running a single test file or a `--grep` filter therefore runs the lifecycle test first as well. To skip it while iterating on one test, add `--no-deps`, for example `pnpm run ai:test -- harness/src/tests/local-mod.spec.ts --no-deps`. Run the whole suite without it before relying on the result.

Account and game-specific tests are separate. Do not infer that a local synthetic test covers a real collection or engine page.

The repository gate checks collection startup with simulated UI responses and DOM snapshots, including large pages, nested dialog wrappers, separate matching dialogs, and failed clicks without another action. It also checks that a click reports the button it targeted when that action immediately changes the button's label. That result identifies the action; it does not prove the collection finished. A real collection run must still reach its verified installation and deployment result.

The repository gate also runs the unit tests for the one-Vortex rule and for the `design` commands described in [unit tests](unit.md). They use temporary folders and do not start Vortex, so they do not show that a real launch and shutdown work; the local integration suite does.

## Add the right test

Use [unit tests](unit.md) for pure logic and DOM helpers. Use [real-app tests](integration.md) for Vortex integration and deployed files. Use [benchmarks](benchmarks.md) to compare observable performance.

A passing repository gate does not run Vortex. Report the specific check you ran and any untested real-app behavior.
