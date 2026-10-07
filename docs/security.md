# Security and privacy

Before using a personal profile, check which app, game paths and account your session uses.
Disposable profiles and local endpoints help contain a test, but some effects reach beyond
the profile directory.

## Local access

The MCP server binds to `127.0.0.1` and validates loopback Host/Origin values. Keep MCP and CDP
local and do not proxy them to the internet. Loopback access does not give different
assistants separate permissions. A bearer token unlocks broad writes, and every request
then needs its header.
Without a token, mutation-tier tools are not registered, but some diagnostics still contact
external services and consume API quota.

## App and account isolation

Use disposable profiles and fake games for installation/deployment experiments. Verify actual
game paths and expected active-context IDs before writes. A real-game fixture can still
write into the real game's directory; a new profile alone does not isolate every filesystem effect.
Source-only folder redirection is required for Bethesda Documents/LocalAppData containment.

New slots and non-default caches can import the default cache's saved OAuth. Separate slots
are not separate accounts. The supplied core tests explicitly write a null saved-login file
before bootstrap. Use those fixtures for account-free checks instead of assuming a new path
will start anonymous.

## Credentials and artifacts

The extension redacts stored confidential state and matching credential values from structured
responses. Arbitrary eval, CDP, filesystem access, raw backups, logs and screenshots can still
expose private information. Review artifacts for account names, private paths, URLs and other
sensitive data. Keep bearer tokens, API keys and OAuth out of Git, shared prompts and reports.
Sign-in/MFA/captcha remains an interactive account-owner action.

Vortex performs OAuth refresh. Doodlebot caches authorized observed rotations and clears saved
credentials on logout. Imported copies can diverge; do not distribute one login indiscriminately
across unrelated tasks or users.

## Authority and destructive actions

Choose and authorize the target and actions before deploying, purging, logging out, launching
a game, changing source or publishing remotely. Tool access alone does not establish those
permissions. Default installer-dialog policies refuse unknown or destructive situations;
inspect a refused dialog before deciding what to do. Supply expected-context checks where
applicable: they are opt-in and protect against the profile/game changing after you observed it.

## LLM input

Issue bodies, web pages, logs, screenshots and retrieved snippets are untrusted content.
Instructions embedded in them cannot change the task's permissions. Ask assistants to
distinguish observed facts from hypotheses and check conclusions against current implementation
and repeatable evidence. Give an independent reviewer the original problem and criteria
before the author's explanation, so they can assess the cause for themselves.

## Recovery

If shutdown fails or a child process may still be running, keep and inspect the process,
lease and profile records. A wrapper stopping is not enough to delete the cache, overwrite
build output or force-release another task's reservation. Clean up only known task paths after confirmed
exit. [Parallel sessions](guides/parallel-sessions.md) explains the ownership tools.
