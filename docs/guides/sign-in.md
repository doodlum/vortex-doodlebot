# Sign in to Nexus Mods

This page shows how to sign the test Vortex in to Nexus Mods once, with `/doodlebot:login`, so
the agent can work with collections.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md).
- Have a Nexus Mods account. Unattended collection downloads need Nexus Mods Premium.
- Be at the machine: you complete the browser login yourself.

Local checks with the sandbox game need no account. Sign in only for collections and other
Nexus features. An API key is not enough for collections, and no doodlebot command asks you for
a password, API key or token.

## Sign in

1. Run:

   ```text
   /doodlebot:login
   ```

2. The agent runs `doodlebot setup --oauth --installed --no-wait`. A test Vortex opens with
   **Log in** showing.

3. Click **Log in** in that Vortex window and complete the login in your browser, including any
   two-factor step or captcha.

4. Tell the agent when you have finished. The agent polls `doodlebot auth-status` until the
   login is present, then runs `doodlebot save-login --installed` to save it.

The expected result: the agent reports that the login is saved. `doodlebot auth-status` reports
only whether credentials are present, never the credentials themselves.

## How the saved login is used

- The login is saved per target, installed Vortex or source build, in the workspace's private
  cache. `/doodlebot:login` signs in the installed target.
- To sign in a source build, name its checkout: `/doodlebot:login --dev-dir <path>`. The agent
  uses `--dev-dir <path>` instead of `--installed` on every command, `setup` and `save-login`
  included.
- If the target already has a saved login present, the agent reports it and no click
  is needed.
- Fresh and rebuilt profiles of the same target inherit the login, but not mod lists or game
  paths.
- A saved login does not prove Nexus still accepts it. If Nexus refuses it, run
  `/doodlebot:login` again.
- Benchmarks use signed-out profiles on purpose, so measurements do not depend on your account.

## What's next

- [Install a Nexus collection](drive-vortex.md#install-a-nexus-collection) with `/doodlebot:drive`.
- [Use real games and baselines](games-and-baselines.md).
- [Security and privacy](../security.md) explains where credentials are stored.
