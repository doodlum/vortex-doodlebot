# Make a change

Add a tool, repair a harness workflow or turn a reproduced bug into a regression test.
Start by choosing which repository owns the behavior, then make and verify the change there.

## Choose the repository

Doodlebot's extension tools, CLI/helpers, fixtures, session controls, evidence, tests and
documentation belong in this repository. Product changes go in a Vortex fork/worktree when
that work is authorized, following its current contribution rules. General Doodlebot
capabilities must keep working with released Vortex without a patch.

## A complete change

1. Describe the trigger, expected result, affected interface and actions the task allows.
2. Read the implementation and its callers; reproduce the problem when applicable.
3. Reserve the kit with `kit lock`, then `kit sync` before editing. Keep one writer at a time.
4. Implement the smallest complete change and test its important failure cases or unchanged behavior.
5. Update the relevant human guides and paired AI contracts/manuals in the same change.
6. Regenerate shared references, run focused checks, review the result and run the required final gates.
7. Commit and publish only when authorized for the task; confirm the remote revision and cleanup.

Use Conventional Commits. oxfmt and oxlint own formatting/lint. The local kit gate is
`pnpm run ci`; runtime-contract changes also need the account-free released-app core. See
[running checks](testing/running.md) and [evidence](guides/evidence.md).

## Test the right claim

Pure DOM/logic tests belong in the unit layer. Installation, renderer behavior and deployment
need real-app fixtures with an independent result check. For a fix, verify that the test fails
at the intended assertion without it. Report measurement-only benchmarks as measurements,
and keep the original outcomes with any selection changes or skips explained.

## Maintain both audiences

The README and this site are for people. Machine-facing repository, operating, specialist
and review instructions are separate files outside `/docs`. Explain the human operation in
the site so readers can follow it without opening instructions written for agents.

`pnpm run docs:generate` creates interface references for both audiences from current source.
`pnpm run docs:check` rejects stale references, missing mapped companions and a behavior change
without updates to both mapped audiences. Review the meaning of the changes as well:
generated references still need an accurate guide beside them. [Documentation maintenance](maintaining-documentation.md)
explains preview, mapping, checks and deployment.

## License and attribution

The repository is GPL-3.0-only, based on Alan Tse's vortex-mcp. Retain third-party licenses
for theme/font assets; see [credits](credits.md). Keep tokens, personal profiles, private
caches and raw incident data out of commits.
