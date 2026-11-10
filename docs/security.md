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
- The saved login is kept in the workspace's cache, `<workspace>/harness/.cache`, which Git
  ignores. Keep that folder private.
- `doodlebot auth-status` reports only whether credentials are present.
- Do not paste passwords, API keys or tokens into the chat, and do not put them in files you
  commit.
- Vortex's log can contain sensitive URLs from sign-in flows. Doodlebot reads log entries by
  level instead of printing whole logs.

## Keep test data separate

A separate Vortex profile does not by itself protect a game folder: deployment writes to the
game path the profile uses. Use the sandbox game, or a copy of a real game. Game support can also
write the Windows account's Documents and AppData folders; back them up before a real-game run,
or use a test machine or QA-only Windows account. See
[Use real games and baselines](guides/games-and-baselines.md).

Benchmarks run in signed-out profiles, so their runs do not use your account.

## Share reports carefully

Screenshots, run reports, logs and state output can include account names, file paths or
unrelated content on screen. Check them before you share them or attach them to a pull request.

## What's next

- [Configuration](reference/configuration.md) lists the files doodlebot keeps.
