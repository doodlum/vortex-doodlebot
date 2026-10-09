# Test Vortex with TypeScript

Doodlebot is a test toolkit for Vortex. You write a TypeScript script or test, run it on Windows, and inspect the result. It starts a separate Vortex profile, gives your code access to the app and its UI, and saves measurements, screenshots, and reports.

Use it to check an installation or deployment, reproduce a UI problem, or compare the performance of two Vortex releases. You can begin with a disposable local game and generated mods, without a Nexus account. Real collection tests use Nexus downloads and a game fixture you supply.

You need a released Vortex installation, Node.js, and pnpm. You do not need an LLM, a modified Vortex build, or Vortex's source code.

## Start with a small test

1. [Install Doodlebot](getting-started/installation.md).
2. [Write your first TypeScript test](getting-started/first-session.md).
3. Adapt it to [a UI check](guides/ui-automation.md) or [a mod workflow](guides/mod-workflows.md).

For a walkthrough that creates an example or prepares a real game and collection, use [guided setup](getting-started/setup.md). For repeated timings, start with [a local benchmark](testing/benchmarks.md#try-one-local-smoke-case).

## Choose the work you want to do

| Task                                            | Guide                                           |
| ----------------------------------------------- | ----------------------------------------------- |
| Check a button, search, or table                | [Drive the UI](guides/ui-automation.md)         |
| Install an archive and check the deployed files | [Test a mod workflow](guides/mod-workflows.md)  |
| Measure collections and large tables            | [Performance proposal](testing/proposal.md)     |
| Add a measurement to a suite                    | [Add a benchmark](testing/adding-benchmarks.md) |
| Diagnose a failed run                           | [Troubleshooting](troubleshooting.md)           |
| Contribute code or tests                        | [Development](contributing.md)                  |

The [reference](reference/index.md) explains the session, table and benchmark APIs and their options.
