# Fix a Vortex bug

This page shows how to find out why something in Vortex is broken, with
`/doodlebot:investigate`, and how to have the agent fix it end to end, with `/doodlebot:fix`.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md).
- Have Vortex's build prerequisites, and a GitHub fork of Vortex if you want to push the fix.
  The agent prepares the source clone if it does not exist yet; see
  [Work on Vortex source](source-development.md).
- Have the bug report: what the user did, what they saw, their Vortex version, and any
  collection, mod or files they named; or a user's `vortex.log`. If the report depends on a
  Nexus collection, [sign in to Nexus Mods](sign-in.md).

A bug fix needs no design. If you supply one anyway, the agent holds the change to it.

## Find out why it is broken

Run:

```text
/doodlebot:investigate <the bug report, an issue link or the path to a user's vortex.log>
```

The agent:

1. reads the report or log, and searches what doodlebot has learned for the symptom;
2. gets **the user's Vortex version** with `doodlebot release get <version>`: an official
   release, checked against its published SHA-256 and extracted without running the installer.
   A release that publishes no digest makes the result _Blocked_;
3. reproduces the scenario on that version with `/doodlebot:try`'s procedure;
4. narrows it to the cause in the Vortex source, with the file and line.

It changes no code. The expected result: an **issue report** that says reproduced or not, and
on which version (a different version is "not reproduced on the user's version", never plain
"not reproduced"), the cause with its file and line, how confident it is, and a proposed fix.

A user's log is someone else's data: the agent quotes only what it needs, and never shares it
without asking you.

## Fix it

Run:

```text
/doodlebot:fix <the issue report, or the bug report>
```

Without an issue report, the agent investigates first, and continues only when the bug is
reproduced. Then it:

1. cuts a branch from upstream in `.vortex-src` (or your checkout);
2. repeats the reproduction on the branch's base: the "before" run;
3. fixes the bug, following Vortex's own contribution rules;
4. writes a regression test **in the Vortex branch**, a Vortex unit test or a spec in Vortex's
   e2e suite, so it goes into the pull request ([Add a regression test](regression-tests.md));
5. proves the test fails without the fix: with your permission for a local commit, it reverts
   the fix and checks that the test fails on its intended assertion (the revert control);
6. repeats your scenario on the fixed build: the "after" run;
7. runs Vortex's own gate, and offers `/doodlebot:pr`.

The expected result: a branch with the fix and its test, before and after run reports, the
revert control's result, and a report that ends with what doodlebot learned.

## Test the reported scenario

The agent tests a fix the way the bug was reported before it prepares a pull request, even a
draft. If a user reported a problem with their collection, mod or steps, it uses that collection,
mod or those steps. Unit tests, a hand-built fixture or reading the uploaded data can help find
the cause; they are not the test.

If the reported scenario cannot be run, for example because it needs access you have not given
or a step would upload something real, the agent does not prepare a pull request. It reports
what is missing instead.

## What's next

- [Open a pull request](pull-requests.md).
- Have the fix checked independently with `/doodlebot:qa`; see
  [Try things in Vortex](try-vortex.md#check-a-change-a-pull-request-or-a-release).
