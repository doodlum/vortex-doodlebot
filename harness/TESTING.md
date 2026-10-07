# Testing doodlebot

Test the contracts doodlebot owns: safe isolation, startup and shutdown, credentials,
MCP transport, UI actions, and evidence from real installation and deployment. A Vortex
feature regression is useful evidence for that feature, but is not a universal kit gate.

## Fast gate

`pnpm run ci` runs types, lint, formatting, unit and filesystem/process tests, and the
extension build. Run it for every kit change. Tests use synthetic credentials and an
isolated lease directory. The operator's package-manager override must not affect them.

Keep boundary and failure tests: authentication/redaction, stale profile guards, leases,
sandbox containment, refused destructive dialogs, incomplete installs, failed shutdown,
cache rotation/logout, and restoring a checkout after a failed check. Test runtime selection
through a real child process and concurrent Electron resolution through separate processes.
These tests do not download tools or contact Nexus.

## Account-free real-app contract

`pnpm run ai:test:core` (`ai:test` is the same suite) runs only the four core `.spec.ts`
files. It uses disposable profiles, games, and credentials, independent of the operator's
login. Run it after changes to the extension, launch/cache code, UI driver or deployment,
and before releasing the kit.

- Launch and clean shutdown; cold/warm/fresh profile semantics and game activation.
- Correct profile/debug ports; MCP tools available with writes enabled.
- Snapshot references, React clicks/input, native select, keyboard, scroll and hover.
- Real window dimensions and restoration, allowing at most two DIPs of OS rounding.
- Known layout faults, decoded PNG dimensions/content, and a fresh renderer after reload.
- Archive installation, enable/disable, deployed file contents and purge.

Use Playwright or filesystem observations to check MCP actions independently. Ordinary
assertions time out in 60 seconds; cold worker fixtures have a separate four-minute budget.
The lifecycle test sets its own four-minute limit. Restore modified window/DOM state even
when assertions fail. Performance is not measured by these timings.

CI runs this suite against official Vortex **2.8.0**, with a pinned SHA-256 installer, after
the fast gate. Update the version, URL and checksum together when changing the supported
baseline. Source builds run the same suite locally with the managed source checkout;
`VORTEX_AI_INSTALLED=1` and `VORTEX_AI_EXE` explicitly select a release instead. A green source
run alone does not establish compatibility with a released Vortex.

## Authentication and live services

`pnpm run ai:test:oauth` explicitly uses the operator's sandbox login. Cache it first with
`save-login --sandbox`. The check captures a clean profile, performs a fresh restore, verifies
access/refresh credential presence, and leaves Vortex running. It prints no credentials.
This verifies persistence, **not** that Nexus accepts the login.

`pnpm run ai:test:nexus` is a separate live-service collection check. It requires cached OAuth,
network access and Premium for unattended downloads. Run it deliberately after authentication
changes or before a release; never require an account for the fast or core gates.

## Optional Vortex regressions and benchmarks

The named `ai:test:*` scripts outside Playwright are explicit scenarios:

| Purpose                                   | Commands                                             |
| ----------------------------------------- | ---------------------------------------------------- |
| Collection recovery and Bethesda checks   | `collection-download-retry`, `bethesda`              |
| Plugins, zoom and split panels            | `plugins-page`, `plugins-mod-link`, `zoom`, `panels` |
| Multi-session isolation                   | `parallel-sessions`                                  |
| Performance/scale                         | `large-library`, `mods-scroll`, `collection-scale`   |
| Measurement without a pass/fail threshold | `download-churn`                                     |

Run the relevant scenarios when changing those Vortex features or the kit helpers they use.
Use production React for performance runs, an idle machine, explicit fixture sizes, and
baseline comparisons. Do not treat a measurements-only script's successful exit as a passed
performance test. Existing Vortex bugs may fail a targeted regression without invalidating
doodlebot's core contract. Report each suite, failures and skips separately.
