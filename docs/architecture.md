# How Doodlebot connects to Vortex

A TypeScript test controls a released Vortex app through two connections.

The Doodlebot extension runs inside Vortex and exposes state, actions, and UI controls through a local MCP server. The harness starts Vortex with a separate test profile and connects to its renderer through Chrome DevTools Protocol. Playwright uses that renderer connection for user input and visible assertions.

The benchmark API puts these pieces behind `withVortex()` and `runBenchmarks()`. Your callback receives the app client and Playwright page. The wrapper prepares a disposable workspace and closes the app after the callback.

## Why use both connections?

Vortex state tells you which mods are installed or enabled. The renderer shows whether a page or control actually changed. Files show whether deployment wrote the expected content. Choose the observation that answers the test's question.

The extension does not need a patched Vortex. Operations needing access outside the renderer, such as launch and screenshots, are performed by the harness.

## Limits of a fixture

A disposable local game is enough to test archive installation, basic deployment, and generated lists. It cannot prove that a real collection downloads successfully or that a game-specific plugin parser accepts real data.

Real collection benchmarks copy a supplied game fixture and require OAuth, a pinned collection revision, download access, and a QA-only Windows account. Game-support extensions can still write that account's Documents and LocalAppData; the SDK does not erase them. Engine-specific pages need that game's installed data and actual controls. See [the performance plan](testing/proposal.md).
