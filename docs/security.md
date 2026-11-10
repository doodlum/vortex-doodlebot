# Security and privacy

This page explains what doodlebot can reach, where it keeps credentials, and how to keep test
work away from your own data.

## Before you begin

Read [How doodlebot works](concepts/how-it-works.md).

## The local server

Doodlebot's extension runs an MCP server inside the test Vortex. It listens only on the local
machine (loopback), checks the host and origin of every request, and requires the bearer token
the test Vortex was started with for write tools. Treat access to that token as access to the
test Vortex.

Doodlebot's extension is installed only into the test Vortex's private profile, never into your
own Vortex.

## Credentials

- No doodlebot command asks for a password, API key or token. You sign in to Nexus Mods in your
  browser; see [Sign in to Nexus Mods](guides/sign-in.md).
- The saved login is one file per target in `~/.doodlebot/login`, outside every workspace.
  Only you, Windows (SYSTEM) and administrators should be able to read that folder; doodlebot's
  check reports anything else, with the `icacls` command that fixes it. Doodlebot never copies
  the login.
- When you share a lesson or a kit gap, the text is shown to you first, with your folders and
  user, computer and Nexus names replaced. Nothing is published until you confirm.
- `doodlebot auth-status` reports only whether credentials are present.
- Do not paste passwords, API keys or tokens into the chat, and do not put them in files you
  commit.
- Vortex's log can contain sensitive URLs from sign-in flows. Doodlebot reads log entries by
  level instead of printing whole logs.

## Keep test data separate

A separate Vortex profile does not by itself protect a game folder: deployment writes to the
game path the profile uses. Use the sandbox game, or a copy of a real game. Game support can also
write the Windows account's Documents and AppData folders. Doodlebot backs them up before each
run of a known game or the Bethesda sandbox, which uses your real Fallout 4 folders, and restores
them at `down`. A test machine or QA-only Windows account is still safest. See
[Use real games and baselines](guides/games-and-baselines.md).

Benchmarks run in signed-out profiles, so their runs do not use your account.

## Share reports carefully

Screenshots, run reports, logs and state output can include account names, file paths or
unrelated content on screen. Check them before you share them or attach them to a pull request.

## What's next

- [Configuration](reference/configuration.md) lists the files doodlebot keeps.
