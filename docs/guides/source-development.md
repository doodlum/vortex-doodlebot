# Work on Vortex source

Use a managed source worktree to develop a Vortex fix or feature. App inspection, local
installs and most kit checks can use released Vortex without a source build.

## Provision your fork

Install and authenticate the GitHub CLI if the source workflow needs to discover your fork.
Cloning, installing dependencies and building Vortex source must be within the work you have
agreed to do, including any instructions you give an assistant.

```powershell
Remove-Item Env:VORTEX_AI_INSTALLED -ErrorAction SilentlyContinue
pnpm run ai:source -- --owner source-setup --no-build
pnpm run ai -- source --where
pnpm run ai -- worktree add fix-123 --owner fix-123
```

The kit keeps its managed clone in `.vortex-src` rather than searching the disk for another
checkout. `source` normally builds; `--no-build` clones only. `worktree add` normally installs
dependencies and builds; `--no-install --no-build` changes that behavior. A worktree defaults
to `upstream/master` and a branch named for the worktree. `--base`, `--branch` and detached
`--ref` choose other starts. Check `worktree list` before creating redundant checkouts.

## Reproduce before editing

```powershell
pnpm run ai -- up --worktree fix-123 --slot auto --owner fix-123 --sandbox
# Record the exact trigger, expected result, actual result and runtime.
pnpm run ai -- down --worktree fix-123 --slot auto --owner fix-123 --sandbox
```

Read the Vortex checkout's current contributor instructions. Check how the change affects
callers, saved data, the extension API and recovery after failure. As the upstream submitter,
you must understand every changed line. Maintainers decide product behavior, acceptance,
merging, signing and release.

## Build and iterate

```powershell
pnpm run ai -- build --checkout 'C:\path\to\owned-worktree' --owner fix-123 --production
pnpm run ai -- up --worktree fix-123 --slot auto --owner fix-123 --sandbox --production
```

Do not overwrite build output while the app is still running from that checkout. The guarded
build path selects Vortex's pinned package manager and preserves generated documentation
files that the build may rewrite. A production start verifies that the renderer actually
loaded production React; use it for user-facing timing comparisons.

`pnpm run ai:watch` watches Doodlebot's extension, not every Vortex source change. It runs
finite guarded build/copy/reload cycles against an already owned app. Keep one watcher.

## Verify and submit

Run Vortex's required verify gate on the final commit, along with the UI/state, compatibility,
recovery and performance checks relevant to the change. Run upstream E2E separately, only
when authorized. `vortex-e2e` can select specs/titles and compare a prior JSON report. Check
for omitted account specs when credentials are absent.

`pr-preflight` checks diff size, callers, description, measurements and optional revert
controls. A revert control temporarily changes the checkout to test the fix, so it needs
authorization and a clean checkout reserved for your task. It must fail at the intended
assertion; compilation or setup failures are inconclusive. `pr-checks` reads remote GitHub
checks. Review whether the final change is suitable for production as well as checking these results.
Use [evidence](evidence.md) to identify the actual source, runtime and outcomes.
