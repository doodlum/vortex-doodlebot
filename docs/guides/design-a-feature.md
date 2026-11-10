# Design a feature

This page shows how to design a Vortex feature with Google's Elephant-Goldfish Model plugin
(EGM) and doodlebot, approve it before any code is written, and carry it to a pull request.
Bug fixes, documentation and test-only changes need no design; use
[Fix a Vortex bug](fix-a-bug.md) instead.

## Before you begin

- [Install EGM](../get-started/install.md#install-egm-for-design-review), release `v0.1.1`.
- Open your agent **in the doodlebot workspace**, not in `.vortex-src`: the workspace's
  `AGENTS.md` tells EGM where its files go and how to call doodlebot's runtime reviewer.
- Run `/doodlebot:setup --check`: EGM is installed, the Vortex source is built, and a sandbox is
  ready.

[Design first](../concepts/design-first.md) explains why features start this way.

## The walk

1. `/doodlebot:source --branch feat/<topic>` updates the Vortex source and cuts the branch from
   upstream.
2. `/egm:egm-brainstorm <the idea>`: tell it the code is in `.vortex-src`. Optionally
   `/doodlebot:try` on the current build first, to see today's behaviour.
3. `/egm:egm-draft`: at its save step, choose the Vortex checkout's `docs/designs/` folder.
   Commit the design on the feature branch as `docs(design): <topic>`.
4. `/egm:egm-review <design>`: EGM's staged review. Give it the Vortex files the design names.
5. `/egm:egm-review-loop` with the arguments in the workspace's `AGENTS.md`: doodlebot's runtime
   reviewer (`vortex-runtime-goldfish`, on Sonnet, read-only) checks that every acceptance
   criterion can be proved on a real Vortex, with a negative control, the content it needs and
   the build it runs on. The loop runs `egm-resolve` itself.
6. **You approve.** Set the design's Status to Approved, or tell the agent to. The agent never
   writes an approval you have not given.
7. The agent implements on the branch, following Vortex's own rules, and writes the tests that
   prove it in the same branch. `/doodlebot:try` shows it working.
8. `/doodlebot:qa --design <design>`: from a fresh profile, each acceptance criterion with its
   negative control, and the QA catalogue entries the change touches.
9. `/doodlebot:pr`: pushes `pr/<topic>` without the design commits, and writes the description
   with the design's Overview, criteria, approval line and a link to the design at its
   `design/<topic>` tag on your fork.

## Where the files go

| Files                                  | Folder                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------- |
| EGM's briefs, drafts and stage reports | `<workspace>/harness/.artifacts/egm`                                      |
| A design for a change to Vortex        | The Vortex branch's `docs/designs/<topic>.md`, in `docs(design)` commits  |
| A design for a change to doodlebot     | `designs/<topic>.md` in the doodlebot repository, in `designs/SITEMAP.md` |

A Vortex design travels with its branch and is pushed to your fork with the work. The pull
request never contains it: `doodlebot pr-branch <topic>` builds `pr/<topic>` without the
`docs(design)` commits and tags the design `design/<topic>`, and the preflight fails if a design
file is still in the pull request's branch. See [Open a pull request](pull-requests.md).

## What a design must contain

Doodlebot's runtime reviewer checks the design against the plugin's change standard:

- acceptance criteria, each with an id;
- for each criterion, the doodlebot command or test that proves it, the content it needs, the
  build it runs on, and a negative control;
- the QA catalogue entries to add or reuse;
- the affected contracts, and the file boundary.

## What's next

- [Open a pull request](pull-requests.md).
- [Design first](../concepts/design-first.md).
