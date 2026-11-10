# Fix a Vortex bug

This page shows how to have the agent reproduce a Vortex bug, fix it on a branch, and verify the
fix in the scenario that was reported, with `/doodlebot:fix`.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md).
- Have a GitHub fork of Vortex and Vortex's build prerequisites. The agent prepares the source
  clone if it does not exist yet; see [Work on Vortex source](source-development.md).
- Have the bug report: what the user did, what they saw, and any collection, mod or files they
  named. If the report depends on a Nexus collection, [sign in to Nexus Mods](sign-in.md).

A bug fix needs no design. If you supply one anyway, the agent holds the change to it.

## Fix the bug

1. Run:

   ```text
   /doodlebot:fix <the bug report or a link to it>
   ```

2. If the source clone is missing, the agent runs `doodlebot source`, which clones your fork into
   `<workspace>/.vortex-src` and builds it.

3. The agent reproduces the bug on the unchanged base build, in the reported scenario. If it
   cannot reproduce it, it stops and tells you what it tried.

4. The agent makes a branch of `.vortex-src` and fixes the bug there.

5. The agent builds the branch with `doodlebot build --checkout <workspace>/.vortex-src`,
   starts it with `doodlebot up --dev-dir <workspace>/.vortex-src --sandbox` (or with the
   fixture the report needs, such as a copy of a real game or `--bethesda-sandbox`), and
   verifies that the reported scenario now works.

6. The agent records evidence: the commands it ran, their results and the files they wrote.

7. The agent reports the cause, the fix, and the evidence, and offers `/doodlebot:pr`.

The expected result: a branch with the fix, a before-and-after observation of the reported
scenario, and the evidence paths.

## Test the reported scenario

The agent tests a fix the way the bug was reported before it prepares a pull request, even a
draft. If a user reported a problem with their collection, mod or steps, it uses that collection,
mod or those steps. Unit tests, a hand-built fixture or reading the uploaded data can help find
the cause; they are not the test.

If the reported scenario cannot be run, for example because it needs access you have not given
or a step would upload something real, the agent does not prepare a pull request. It reports
what is missing instead.

## What's next

- [Add a regression test](regression-tests.md) for the fixed behavior.
- [Open a pull request](pull-requests.md).
- Have the fix checked independently with `/doodlebot:qa`; see
  [Drive Vortex and get a report](drive-vortex.md#check-a-change-independently).
