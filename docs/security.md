# Security and privacy

Doodlebot's extension listens on loopback. Its server validates incoming hosts/origins, and write tools require the token used to launch the test app. Treat access to that local token as access to the test instance.

The high-level TypeScript helpers create isolated profiles and connection settings. Real collection credentials remain in a private local cache; the runner does not serialize the auth-cache file path into the report manifest.

## Keep test data separate

A separate Vortex profile does not by itself protect a normal game directory. Deployment writes to the game's configured path. The benchmark runner copies a supplied fixture into its disposable workspace before changing it.

Use test fixtures that you are willing to copy and modify. Keep normal mod setups out of manual deployment tests.

Real game benchmarks additionally require a QA-only Windows account or test machine and `collection.dedicatedWindowsAccount: true`. Stock game-support extensions may write that account's Documents and LocalAppData. The copied game and Vortex profile remain private, but the SDK cannot guarantee redirection of all per-user game writes and does not erase those folders.

## Share artifacts carefully

Screenshots, traces, logs, and state output can include account names, file paths, or unrelated UI content. Check them before sharing. Do not place tokens, OAuth credentials, or API keys in TypeScript source, reports, or commits.

Local synthetic tests need no account and do not need credentials. Real collection access is described in [login setup](getting-started/setup.md).
