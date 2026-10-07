# Troubleshooting

Run `pnpm run ai -- doctor` with the same target/owner/slot flags as the failed session.
Keep the original command, error, app logs and runtime details before changing the setup;
they help distinguish the original problem from a new one introduced during diagnosis.

## No Vortex or the wrong runtime

Install Vortex or set `VORTEX_AI_EXE` to its actual executable. Set
`VORTEX_AI_INSTALLED=1` / `--installed` to choose it explicitly when a managed source checkout
exists. Folder redirection needs a source runtime. Keep the source-only guard in place
because a packaged runtime would write to real user folders.

## Missing extension or stale tools

Install dependencies and run `pnpm run build` from the Doodlebot root under the appropriate
kit ownership. Restart the owned app or use a guarded extension reload. Read the current
`tools --json` output and `automation_status`. Reload invalidates
UI refs and changes the runtime ID.

## `Cannot find module './common'` in a packaged app

An installed Vortex placed underneath a directory with an inherited `package.json` containing
`"type": "module"` can have its CommonJS plugins misclassified, even when the files exist
inside `app.asar`. This was confirmed for the official 2.8.0 app installed beneath Doodlebot's
ESM harness directory.

Prefer an installation outside that ESM package scope. For an authorized disposable install
inside it, a package boundary at the installation root can explicitly set CommonJS:

```json
{ "private": true, "type": "commonjs" }
```

Correct the installation's package scope rather than editing Vortex's source or packed bundle.
Keep the fatal dialog and renderer stack, then rerun startup and the app health check after
the correction. A CLI or UI assertion may pass while the fatal error remains. This remedy
applies to the confirmed package-scope condition; investigate other missing-module errors separately.

## MCP does not answer

Confirm the app is running, the owner/slot ports match and the endpoint ends in `/mcp`.
Check the bearer header. Inspect startup and renderer errors; slow or blocked renderer work
can delay MCP. Check the surrounding errors before attributing a connection reset to login.

## Stale or ambiguous UI references

Take a fresh scoped snapshot, inspect truncation and select a current actionable node.
Use the new reference after another snapshot or reload. For ambiguous labels, add a role,
test ID or narrower scope; the driver leaves the choice to you when several nodes match.

## Lease or operation contention

Use `lease status`, `kit status` and `slots` to inspect the live owner and original acquisition.
Independent commands with the same owner still conflict. Stop known child operations and
confirm app exit before releasing ownership. Inspect the reservation and processes before
attempting forced recovery; another task may still be using them.

## OAuth or collection failure

Check presence with `auth-status`, complete sign-in yourself and save the authorized cache.
Presence is not proof of live-server validity. Check exact revision, network/service errors
and download entitlement. A new slot can inherit another saved login; use the core fixtures
when verifying anonymously. [Authentication](getting-started/authentication.md) explains the boundaries.

## Bad performance comparisons

Inspect the actual React build, workload size/shape, layout, viewport and cold/warm state.
Use the same React mode for both sides: development-source and production-release timings
cannot isolate a code regression. Repeat comparable baseline and candidate runs sequentially; retain
outliers and omissions. See [benchmarks](testing/benchmarks.md).

## Test setup failure

An import, compile or fixture error leaves the intended behavior untested. Use the appropriate
config, installed selection and pinned package manager; list selected tests before launching
when selection is uncertain. Preserve failed profiles/logs until processes have exited.
Report core failures separately from deliberately opt-in Vortex regressions and measurements.
