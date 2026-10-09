# Troubleshooting

Start with the first error and the preserved output directory. A benchmark's `blocked` reason often identifies a missing prerequisite; its `failed` reason usually identifies an operation or assertion to investigate.

## Vortex cannot be found

Install a released Vortex, or pass its executable explicitly:

```typescript
await withVortex({ executable: "D:/Apps/Vortex/Vortex.exe" }, async (vortex) => {
  // Test the app here.
});
```

Do not point this option at a source Electron runtime. The benchmark API uses released Vortex builds.

## The script does not start

Run `pnpm install` from the repository root. Use Node.js 20.19 or newer and pnpm 9.15.0. Save scripts using top-level `await` as `.mts`, and run them with `pnpm exec tsx filename.mts`.

Examples import paths relative to a file at the repository root. If you moved a file, update its imports.

## A benchmark is blocked by TBD

Fill in `manifest.profile` with the actual conditions of the run. The proposal's approved hardware, bandwidth, collections, revisions, and targets remain undecided; do not invent them. An exploratory machine profile should be described as exploratory.

For real runs, confirm the collection engine and mod count, pinned revision URL, source game fixture, readiness check, and account profile.

The unattended real-game runner also requires a QA-only Windows account or test machine and `collection.dedicatedWindowsAccount: true`. Stock game-support extensions can write that account's Documents and LocalAppData; a copied game fixture alone does not isolate those writes.

## Collection login or download fails

Complete [OAuth setup](getting-started/authentication.md). API keys alone cannot authenticate collections. The unattended collection runner requires Premium download access.

Check whether the pinned revision and all required files are still available. Browser login, CAPTCHA, missing entitlement, or an unavailable service is an external blocker. Save the exact failed setup step or download reason; do not turn it into a Vortex regression.

## A table action is blocked

A control must exist, be visible and enabled, and uniquely match the selector. Its expected effect must differ from the starting value. An already-sorted list, already-selected row, or zero-scroll-range table can make an action a no-op.

Inspect the actual page with `vortex.page`, save a [screenshot](guides/capture.md), and update the fixture or selector. Plugins and Load Order need their game's real installed data and an explicit table mapping.

A missing game-specific page is not covered by a synthetic Mods table.

## Installation completes but deployment fails

Installing stages files; it does not put them into the game directory. Enable the intended mods, wait for installers to finish, and deploy. [The local archive example](guides/mod-workflows.md) checks the deployed bytes.

An installer dialog can keep a mod in the installing state. A game directory deployed by another Vortex instance can also block deployment. Use a clean private fixture; do not purge a normal game installation just to get a test past an error.

## UI timing is noisy

Use a visible desktop and keep viewport, zoom, generated data, storage, and background activity fixed. Run comparisons sequentially. Screenshots, video, and CPU profiling add work; collect them separately from the baseline unless included deliberately.

Check repeat spread, cold/warm cache mode, network changes, and security scanning. Read the [measurement limits](testing/results.md) before interpreting a difference.

## The app or fixture remains after failure

Failed tests preserve the disposable workspace so you can inspect logs and files. Successful runs close the app and remove that workspace. A cleanup failure means app shutdown could not be confirmed; retain the reported path and diagnose the running process before removing its files.

## Advanced existing-session problems

For a manually managed session, use the same owner, slot, cache, and target options for setup and scripts. A token rejection or connection failure often means the script is connecting to a different session. Close and restart the intended test session with those same options.

`pnpm run ai -- doctor --installed --sandbox` checks the lower-level local setup. [App sessions](guides/lifecycle.md) explains that workflow.
