# Choose and run checks

Run `ci` for toolkit changes and the real-app core for behavior that depends on Vortex.
Choose additional scenarios for the specific game, service or performance question you
are investigating; each has its own prerequisites.

## Fast kit gate

```powershell
pnpm run ci
```

This checks types for the extension and harness, lint, formatting, documentation consistency, unit and
filesystem/process tests, and the extension build. It needs no Vortex, network service,
game or account after dependencies are installed. Run it for every kit change.

## Account-free real-app core

```powershell
$env:VORTEX_AI_OWNER = 'core-check'
$env:VORTEX_AI_SLOT = 'auto'
$env:VORTEX_AI_INSTALLED = '1'
pnpm run ai:test:core
```

`ai:test` is the same suite. The current four `.spec.ts` files cover lifecycle, MCP/UI
automation, local archive installation and deployment. The OAuth restore spec is excluded.
Fixtures create anonymous disposable profiles and game paths, then check main/renderer logs
for unrecoverable errors before cleanup. A cold worker can take several minutes.

Run this after extension, lifecycle/cache, UI-driver or deployment changes and before a kit
release. CI uses a checksum-pinned official Vortex 2.8.0 installer. Source runs alone do not
establish released-app compatibility. See [integration test writing](integration.md).

## Deliberate opt-in scenarios

Run from the repository root. For scripts that attach to an existing app, first configure
and start the session under your owner. The [package reference](../reference/package-scripts.md) shows
the actual command behind each entry.

| Script                                             | Purpose                                  | Prerequisites and outcome                                                           |
| -------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `ai:test:oauth`                                    | Login survives restore                   | Operator's authorized sandbox login; leaves app running; not live-server validation |
| `ai:test:nexus`                                    | Live collection path                     | Cached OAuth, network and unattended-download entitlement                           |
| `ai:test:bethesda`                                 | Fake Bethesda game and plugin conditions | Source-only private user-folder preload                                             |
| `ai:test:collection-download-retry`                | Recover a failed collection member       | Inspect fixture/service conditions in the scenario source                           |
| `ai:test:plugins-page`, `ai:test:plugins-mod-link` | Plugin UI/link behavior                  | Their selected game/source fixture; separate from core                              |
| `ai:test:zoom`, `ai:test:panels`                   | Zoom and split panels                    | Real visible-window state and restoration                                           |
| `ai:test:parallel-sessions`                        | Multi-session isolation                  | Distinct owners, caches and endpoints                                               |
| `ai:test:large-library`, `ai:test:mods-scroll`     | Large mod-table behavior                 | Owned sandbox; production runtime for meaningful timings                            |
| `ai:test:collection-scale`                         | Offline collection scale                 | Owned sandbox and chosen member/rule shapes                                         |
| `ai:test:download-churn`                           | Concurrent download measurement          | Local throttled download fixture; measurement only, no automatic pass/fail budget   |

Read a scenario's header and actual flags before running it. Some fixtures deploy/purge or
take minutes to seed. A scenario aimed at a Vortex bug may still fail on a released version
even when Doodlebot's account-free core passes. Keep login-dependent checks outside the fast gate.

## Diagnose a failure

Keep the original output, selected tests, runtime and fixture. Find out whether the failure
came from setup, imports, the assertion you intended to test or an unexpected app error.
Report skipped cases and explain any selection changes; changing a failure to a skip does
not resolve it. Keep failed fixture data until app exit is confirmed. Logs can reveal an
unrecoverable renderer error even when a UI assertion passed.

To list the core tests without launching the app:

```powershell
pnpm exec playwright test --config harness/playwright.config.ts --list
```

For an isolated file/title, use Playwright's selection flags with that config and report what
was omitted. For Vortex upstream verification, follow [source development](../guides/source-development.md),
not the kit's test summary. [Record evidence](../guides/evidence.md) for final review.
