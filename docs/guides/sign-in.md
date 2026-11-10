# Sign in to Nexus Mods

This page shows how to sign the test Vortex in to Nexus Mods once, with `/doodlebot:setup --login`, so
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
   /doodlebot:setup --login
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

- The login is one file per target, installed Vortex or source build, in
  `~/.doodlebot/login`. It is outside the workspace. Every workspace on this machine uses it,
  and it stays after `/doodlebot:setup --update` and a new `/doodlebot:setup`.
- `/doodlebot:setup --login` signs in the installed target. To sign in a source build, name its
  checkout: `/doodlebot:setup --login --dev-dir <path>`. The agent uses `--dev-dir <path>` instead of
  `--installed` on every command, `setup` and `save-login` included.
- If the target already has a saved login present, the agent reports it and no click
  is needed.
- The main test Vortex uses the login directly. Fresh and rebuilt profiles keep it, but not
  mod lists or game paths.
- Test profiles, benchmarks and the core suite are signed out. They never get a copy of your
  login, so they cannot use it up.
- Doodlebot never copies the login. Nexus replaces part of it each time it refreshes, so a copy
  stops working.
- Logging out in the main test Vortex signs you out everywhere. The agent never clicks
  **Log out** unless you ask for it.
- Only you, Windows (SYSTEM) and administrators can read the folder. The agent's check reports
  anything else, with the command that fixes it.

## If your login is lost or expired

Run `/doodlebot:setup --login` and sign in again. It takes about a minute. `/doodlebot:setup --check`
shows whether a login is present.

There is no backup command. A copy of the login stops working the first time the real login
refreshes, and it would leave a password-like file on disk. A saved login also does not prove
Nexus still accepts it: if Nexus refuses it, sign in again the same way.

## What's next

- [Install a Nexus collection](try-vortex.md#install-a-nexus-collection) with `/doodlebot:try`.
- [Use real games and baselines](games-and-baselines.md).
- [Security and privacy](../security.md) explains where credentials are stored.
