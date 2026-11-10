# Testing doodlebot

Test the contracts doodlebot owns: safe isolation, startup and shutdown, credentials,
MCP transport, UI actions, and evidence from real installation and deployment. A Vortex
feature regression is useful evidence for that feature, but is not a universal kit gate.

## Fast gate

Cold setup regressions: `pnpm exec vitest run harness/src/bootstrap.test.ts` requires installed
kit dependencies but no Vortex, game or account. Mocked launches and temporary directories
verify register/flush/native-startup ordering, delayed activation, private path validation,
conflicting CLI arguments, no-game behavior and failure preservation. A failed first shutdown
cannot admit the second launch; activation failures cannot publish the snapshot marker.
These checks do not prove native staging creation. Run the released-app core and the relevant
source runtime separately, including actual staging tag/instance identity, archive install,
enable/deploy/purge, warm/reset reuse and graceful shutdown.

`pnpm exec vitest run harness/src/gameStartup.test.ts` exercises the actual activation/dialog
helpers with fake clocks and MCP transport. Watcher failures are captured immediately, abort
further active-game polling, and await in-flight work before rejecting. Separate UI activation
and watcher errors remain distinct causes. These tests need no Vortex, game or account.

`pnpm run ci` runs types, lint, formatting, paired documentation checks and their negative
controls, unit and filesystem/process tests, and the extension build. Run it for every kit change. Tests use synthetic credentials;
instance-record cases mock `USER_STATE_DIR` (and the default cache) to temporary folders, so
they never read or write the real `~/.doodlebot/instance.json`. `update.test.ts` passes a
temporary `stateDir` for the same reason. The operator's package-manager override must not
affect them. The `ci` job of `.github/workflows/ci.yml` runs the same `pnpm run` scripts, in the
same order, as the `ci` package script (`companion.test.ts`).

Keep boundary and failure tests: authentication/redaction, stale profile guards, the instance
record and its refusals, sandbox containment, refused destructive dialogs, incomplete installs,
failed shutdown, cache rotation/logout, and restoring a checkout after a failed check. Test
runtime selection through a real child process, and Electron installation (installed once,
then reused; an interrupted install retried by a later process) through separate processes.
These tests do not download tools or contact Nexus.

Design-first and single-instance unit tests (all need no Vortex, game or account):

| File                                 | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness/src/design.test.ts`         | Design parsing: header first match, continuation lines, contracts, open questions, numbered plan headings, `TBD` outside code; the content digest ignores Status, Date, Approved, CRLF and a BOM but changes with the body; every `checkDesign` issue in order; boundary globbing and the design-file exemption; `designs/egm-workflow.md` passes `checkDesign`                                                                                                                                                        |
| `harness/src/designCommand.test.ts`  | Against a temporary git repository: `design new` writes the template and refuses an existing file or missing flags; `design check` text and JSON output and exit codes, with and without `--ready`; `design scope` names a file outside the boundary (exit 1), reports `IN SCOPE` once it is reverted, warns on an unapproved design; unknown subcommands refuse                                                                                                                                                       |
| `harness/src/egmResources.test.ts`   | `.claude/settings.json` pins the EGM marketplace to `v0.1.1`, registers this folder as the `doodlebot` marketplace and enables the four plugins; the `vortex-runtime-goldfish` agent in `plugins/doodlebot/agents/` is read-only with `omitClaudeMd: true` and names its persona; the change standard names every required section; the `design` skill exists and the manuals point at the plugin paths; `docs/get-started/install.md` contains `v0.1.1`, both Codex commands, Claude Code `2.1.271` and EGM issue 237 |
| `harness/src/runningVortex.test.ts`  | The instance record at `~/.doodlebot/instance.json`: absent and invalid records, a dead pid or a pid owned by another program cleared as stale, a live Vortex reported with unknown fields tolerated, clearing only the named pid, a failed write throwing, and both refusal messages exactly                                                                                                                                                                                                                          |
| `harness/src/instance.test.ts`       | Legacy files: a stale `harness/.cache/instance.json` is deleted, and a live one refuses a launch (`starting Vortex`) and `down` (`stopping Vortex`)                                                                                                                                                                                                                                                                                                                                                                    |
| `harness/src/bootstrap.test.ts`      | Besides cold setup: a live record of another cache refuses the launch and `save-login`'s capture (`saving the login`) before any MCP call or stop, and leaves that instance untouched; one of the same cache is restarted or captured                                                                                                                                                                                                                                                                                  |
| `harness/src/singleInstance.test.ts` | No tracked or untracked non-ignored file outside a short allow-list mentions the removed multi-instance machinery (the identifier list is in the test)                                                                                                                                                                                                                                                                                                                                                                 |
| `harness/src/config.test.ts`         | Default cache, artifacts folder and ports (3701/9222); their variables, then `--cache-dir`, `--port` and `--cdp-port`, override them; empty variables count as unset; invalid or shared ports refuse                                                                                                                                                                                                                                                                                                                   |

Readiness tests (`readiness.test.ts`) cover schema 3: each design rule, both no-design
messages, `reviewedDesignSha256` placement, design-review reports, digest and ancestry, the
rejection of a schema-2 manifest, and `kit-core` accepting `node bin/doodlebot.cjs test core`
while refusing the removed package script, a filtered tail and a `--` after that prefix (it
reaches Playwright as a filter; only the Playwright prefix ignores a bare `--`).

Companion unit tests (no Vortex, game or account):

| File                                                         | What it proves                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `harness/src/plugins.test.ts`                                | Marketplace and plugin manifests, versions equal to `package.json`'s, unique skill names, skill and agent frontmatter, report templates, benchmark run rules, workspace-relative paths, and that every `doodlebot <command>` a skill names is real |
| `harness/src/commands.test.ts`                               | `commands.ts` equals the commands `cli.ts` dispatches (via `scripts/cli-commands.cjs`) plus the `handledBy: "bin"` ones `bin/doodlebot.cjs` handles                                                                                                |
| `harness/src/companion.test.ts`                              | No tracked or untracked non-ignored file outside its allow-list contains a removed command form or benchmark import; `ci.yml`'s `ci` job runs the `ci` script's steps in order                                                                     |
| `harness/src/cliArgs.test.ts`                                | Caller-relative path flags and positionals, the unchanged relative flags, verbatim pass-through after `test <suite>`, repeated `--a`/`--b`, `--list`                                                                                               |
| `harness/src/config.test.ts`, `configRelativeDevDir.test.ts` | An explicit non-built `--dev-dir` throws its `ConfigError`; a relative `--dev-dir` or `VORTEX_AI_DEV_DIR` resolves to the dev target; relative `VORTEX_AI_SOURCE_DIR`                                                                              |
| `harness/src/versionCommand.test.ts`, `linkCommand.test.ts`  | `version` output; both shim files and contents, the default-folder candidates, PATH detection and path comparison                                                                                                                                  |
| `harness/src/update.test.ts`                                 | `update` refusals (running Vortex in either record, local changes), missing and invalid refs, tag and branch resolution against a synthetic remote (a branch only by its full `refs/heads/<ref>` name), and the exact command sequence             |
| `harness/src/testCommand.test.ts`                            | The argv of every suite, `--list`, `--help` and `-h` listing the suites with exit 0, and exit 2 for an unknown suite                                                                                                                               |
| `harness/src/fixtureCommand.test.ts`, `logCommand.test.ts`   | The one-file mod archive (unzipped with fflate); log level threshold, `--tail`, `--since` and continuation lines                                                                                                                                   |
| `harness/src/perfSummary.test.ts`                            | Faster, Slower and No clear difference with fixed numbers, even counts, the percent formula, verdicts and percent from the rounded values the table shows, Blocked metrics and runs, one-sided reports, and every check's metric paths             |
| `harness/src/doctor.test.ts`                                 | The advisory `Sandbox baseline` (the `--no-game` baseline only with `--no-game`) and `Legacy lease store` checks, and a `targetError` shown as a failing `Vortex` check                                                                            |

Collection-start regressions use the real UI helpers with a bounded root snapshot and a
separately observable dialog footer. DOM coverage verifies the default 1,500-node limit;
startup coverage includes stock nested dialog-role containers and separate identical sibling
dialogs through actual DOM snapshots. It checks one click, stacked dialogs, missing/ambiguous dialogs and transport
failure without a second action. These checks do not establish a real collection completed.
Click identity tests exercise handlers that relabel/change role during mousedown or click;
returned metadata describes the target before the sequence. Collection startup also exercises
native DOM label replacement through its MCP response adapter.

The site's guides (`docs/guides/regression-tests.md`, `docs/guides/benchmark.md`) tell people
how to run these through the plugins; update them with this manual when selection or
prerequisites change. `docs:check` validates generated references (including
`docs/reference/commands.md` from the skills) and paired change coverage. `docs:test` verifies
stale, missing and unpaired failures and that the site navigation lists every page.
`docs:build` is the separate strict MkDocs gate for site publication, using requirements-docs.txt.

Workflow regression coverage must exercise actual boundaries: every launcher writes the
instance record at spawn and a failed write stops the child; the record is cleared only after
confirmed exit; legacy per-cache records are deleted; checkout commands (build, source install,
`evidence run`, the revert check, `vortex-e2e`) refuse while a recorded Vortex runs from that
checkout; a second cache is refused before anything is restarted; `script` returns the child's
code, 130 after an abort and `128 + signal` after a signal death, and runs in `INIT_CWD`.
Fixture shutdown errors preserve the app PID, profile and parent cache, and fail the run;
directory cleanup follows confirmed exit. Use synthetic
repositories/processes for these cases, never temporary edits to a user's Vortex source.

Watch tests check source edits/additions/deletions, debounce, one finite build/copy/reload
cycle per settled edit, immutable inputs through edit/Undo, build failure and cancellation,
verified generation freshness, staged publication/copy rollback and foreign profiles at every
attachment/reload boundary. Fixture tests include rejected shutdowns without an error value.
Evidence tests
check the running-checkout refusal and real CLI cancellation, source/runtime drift, applicable gates, nonempty complete
selection and changed E2E failures. A happy-path schema test alone cannot prove these contracts.
Readiness regressions also cover native producer-kit drift, provenance on every production
performance run, Vortex runtime/subject mismatch across checkouts, and skipped or TODO
scoped/control tests. Native assertion controls retain reporter bytes for each test group;
tests reject absent, inconsistent, empty or incomplete execution on either side, prove real
Vitest output is collected, and verify cancellation waits for child exit before restoration.
Retain the producing kit identity on both sides of native preflight and E2E execution; regenerate
current and baseline reports when that kit identity differs from the readiness manifest.

## Account-free real-app contract

Recorded CI at `1729a39` on 7 October 2026 passed the kit gate (675 unit tests in 58 files,
plus documentation controls), but the released Vortex 2.8.0 core passed 20/21. The lifecycle
test failed with `Vortex did not exit cleanly`; fixture preservation remained enabled.
Run [37673176382](https://github.com/doodlum/vortex-doodlebot/actions/runs/37673176382) retains
the failure trace. Its cause is unconfirmed; do not treat an earlier 21/21 at `343fd18` as
evidence that this run passed, or force shutdown/delete the fixture to hide the failure.

`doodlebot test core` (`node bin/doodlebot.cjs test core` without the shim, as CI runs it)
runs only the four core `.spec.ts` files; Playwright's own flags follow it. It uses disposable profiles, games, and credentials, independent of the operator's
login. Run it after changes to the extension, launch/cache code, UI driver or deployment,
and before releasing the kit. Its fixtures launch their own Vortex (in a temporary cache on
free ports), so the suite refuses to start while a harness Vortex runs (Playwright global setup
`singleInstanceGlobalSetup.ts`):
``A harness Vortex is running (pid <pid>, cache <cacheDir>); run `doodlebot down` before the core suite.``
Run `doodlebot down` first; the record is machine-wide, so a Vortex started from another
workspace also refuses it. Each fixture writes the instance record at launch and clears
it after confirmed exit.

The suite has two Playwright projects so only one Vortex exists at a time: `lifecycle`
(`bootstrap-lifecycle.spec.ts`, which launches its own instances) runs first, and `contract`
(the specs sharing the worker fixture's Vortex) depends on it. Running a single contract spec or
a `--grep` therefore runs the lifecycle test first; add `--no-deps` to skip it for a local
iteration, never for recorded core evidence. `doodlebot test oauth` clears the projects and runs only
`oauth-restore.spec.ts`.

- Launch and clean shutdown; cold/warm/fresh profile semantics and game activation.
- No unrecoverable errors in the fixture's main/renderer logs, including rotated logs.
  Check after confirmed shutdown and before deleting or resetting each profile; a responsive
  MCP endpoint and passing UI assertions do not establish a healthy startup. Retain the
  fixture evidence on a failed health check, and skip links to unrelated profiles.
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

`doodlebot test oauth` explicitly uses the operator's sandbox login. Cache it first with
`save-login --sandbox`. The check captures a clean profile, performs a fresh restore, verifies
access/refresh credential presence, and leaves Vortex running. It prints no credentials.
This verifies persistence, **not** that Nexus accepts the login.

`doodlebot test nexus` is a separate live-service collection check. It requires cached OAuth,
network access and Premium for unattended downloads. Run it deliberately after authentication
changes or before a release; never require an account for the fast or core gates.

## Optional Vortex regressions and performance checks

The `doodlebot test <suite>` check scripts outside Playwright are explicit scenarios
(`doodlebot test --list`; arguments after the suite are the script's):

| Purpose                                   | Commands                                             |
| ----------------------------------------- | ---------------------------------------------------- |
| Collection recovery and Bethesda checks   | `collection-download-retry`, `bethesda`              |
| Plugins, zoom and split panels            | `plugins-page`, `plugins-mod-link`, `zoom`, `panels` |
| Performance/scale                         | `large-library`, `mods-scroll`, `collection-scale`   |
| Measurement without a pass/fail threshold | `download-churn`                                     |

Run the relevant scenarios when changing those Vortex features or the kit helpers they use.
Use production React for performance runs, an idle machine, explicit fixture sizes, and
baseline comparisons. Do not treat a measurements-only script's successful exit as a passed
performance test. Existing Vortex bugs may fail a targeted regression without invalidating
doodlebot's core contract. Report each suite, failures and skips separately.

Benchmarking uses the same checks: `/doodlebot:measure` and `/doodlebot:compare` run one of
`mods-scroll`, `large-library`, `collection-scale`, `download-churn` or `plugins-page` on one or
two builds, alternately, and `doodlebot perf-summary` turns their evidence files into medians,
ranges and a rule-based verdict (AGENTS.md, "Benchmarking"). Only `mods-scroll`'s metric paths
have live coverage; the other four are covered by `perfSummary.test.ts` fixtures built from the
shapes their scripts write.

## Final workflow integration

After scoped checks, run the actual CI and released-app core commands through `evidence run`,
with new reporter paths, after `node bin/doodlebot.cjs down` (the core suite refuses while a harness
Vortex runs). This checks the composed workflow as well as the individual helpers.

Fresh QA runs after the author's `down`, in a fresh context, starting with `up --fresh` so it
does not inherit the author's profile state. It inspects the identified diff and independently exercises a refusal or failed check,
recovery and a subsequent handoff. Synthetic repositories cover source mutation/restoration;
an isolated released app covers runtime behavior. Inspect the final manifest and artifacts,
then run `readiness`. Verify the actual final commit for publication; a previous local-diff
receipt remains evidence for that diff only. See [the manual](AGENTS.md#recorded-checks-and-readiness)
and [the workflow](AGENT-WORKFLOW.md) for commands and report responsibilities.
