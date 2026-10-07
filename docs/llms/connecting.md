# Connect your assistant

Connect an assistant to inspect the app with you, investigate a bug or help write a test.
You need an LLM client that supports **MCP Streamable HTTP**, installed and configured
separately. Doodlebot supplies the app tools; it has no built-in LLM and does not send your
prompts to a model provider itself.

## Start the app before the client

```powershell
$env:VORTEX_AI_OWNER = 'assistant-session'
$env:VORTEX_AI_INSTALLED = '1'
$env:VORTEX_AI_SLOT = 'auto'
pnpm run ai -- setup --installed --sandbox
pnpm run ai -- up --installed --sandbox
pnpm run ai -- tools --json
```

`up` reuses the running app and prints the endpoint and a connection command containing the
bearer token. Keep those values private. With slots, the endpoint may not use 3701.
Confirm `automation_status` refers to your intended renderer and disposable game before
allowing writes. The app must stay running while the assistant uses its tools.

## Configure the MCP connection

In your client's MCP settings, add:

| Setting        | Value                                              |
| -------------- | -------------------------------------------------- |
| Server name    | A recognizable local name, such as `doodlebot`     |
| Transport      | Streamable HTTP                                    |
| URL            | The printed `http://127.0.0.1:<port>/mcp` endpoint |
| Request header | `Authorization: Bearer <printed-token>`            |

Settings formats vary by client. Enter the four values above in the format your client
expects. Store the token in your client's private
settings or environment mechanism, rather than a repository file or chat prompt. A configured
token is required on every request and unlocks broad writes.

For a stdio-only client, use an MCP stdio-to-Streamable-HTTP bridge supported by that client.
The bridge needs the same endpoint and bearer header. Check the bridge's own versioned
configuration before installing it; it is additional software, not bundled into Doodlebot.
If your client cannot send a bearer header, use its terminal access to run the CLI instead
of exposing the unauthenticated server externally.

## Verify the connection

Ask the client to list its MCP tools, then call `automation_status` and `list_profiles`.
Compare the game/profile with the terminal and visible app. Check the runtime ID again after
a renderer reload. If discovery fails:

1. Check `pnpm run ai -- status` with the original owner/slot.
2. Confirm the URL is the printed `/mcp` endpoint, not the CDP port.
3. Confirm the configured bearer header and restart the client connection if needed.
4. Inspect actual runtime errors rather than assuming every tool failure is a client problem.

An assistant with shell access can also run the CLI or TypeScript scripts; it does not need
MCP for every task. Keep the same owner, target and slot across those commands. Direct MCP
calls do not automatically acquire the CLI's operation guards. Have one operator inspect
and act on a renderer at a time to keep snapshots and actions from interfering.

## Give it a useful first task

> Inspect the disposable Vortex sandbox. Report the active game and profile, describe the
> visible Mods page, and save a screenshot. Do not install, deploy, purge, modify source or
> access my personal profile. Use current snapshots and tell me what you actually observed.

Then try a concrete [debugging, testing or benchmark task](workflows.md). Write down which
actions it may take and what evidence you want back. You complete sign-in, MFA and captcha;
the assistant can use a cache you have authorized.

## Finish the session

Stop the app through the original owned terminal session:

```powershell
pnpm run ai -- down --installed --sandbox --owner assistant-session --slot auto
```

The client may still remember the connection settings, but its tools need a running app.
Do not release ownership or delete profiles before confirmed app exit.
