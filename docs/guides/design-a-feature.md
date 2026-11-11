# Design a feature with EGM

This page shows how to design a Vortex feature with Google's Elephant-Goldfish Model plugin
(EGM) and doodlebot, approve it before any code is written, and carry it to a pull request.
Bug fixes, documentation and test-only changes need no design; use
[Fix a Vortex bug](fix-a-bug.md) instead.

## Before you begin

- [Install EGM](../get-started/install.md#install-egm-for-design-review), release `v0.1.1`.
- Open your agent **in your Vortex checkout**, or a worktree of it. Without a checkout,
  `/doodlebot:setup` asks for a folder and clones your fork into it with
  `doodlebot source --clone <dir>`; then open the agent there. Say yes when the agent asks to
  keep `.doodlebot/` out of commits: EGM's working files go in `.doodlebot/egm`. The checkout is
  installed and built the first time a command needs it.
- Run `/doodlebot:setup --check`: EGM is installed and a sandbox is ready.

**You type the EGM commands.** EGM's commands cannot be started by the agent, only by you. At
each EGM step the agent gives you the line to paste. Its second line,
`EGM artifact directory: .doodlebot/egm`, tells EGM where its working files go, since nothing
about EGM is written into Vortex.

[Design with EGM](../concepts/design-first.md) explains why features start this way.

## The walk

1. Optionally, `/doodlebot:prototype <idea>` first, to see the idea working before it is
   designed, or `/doodlebot:try` on the current build to see today's behaviour.
2. Type `/egm:egm-brainstorm <the idea>` with the artifact line under it, as the agent gives it.
   After a prototype, a third line points EGM at the prototype's summary.
3. Type `/egm:egm-draft`. The draft stays in `.doodlebot/egm`, never on the feature branch. When
   it is ready to read, the agent asks to commit it to the sibling branch `designs/<topic>` on
   your fork with `doodlebot design-branch`, and gives you the link at that commit. Your own
   checkout never switches branch.
4. Type `/egm:egm-review <draft>`: EGM's staged review. Give it the Vortex files the design
   names.
5. Type the `/egm:egm-review-loop` line the agent gives you. It is filled in with your design's
   path, doodlebot's runtime reviewer and its standard, and the files the reviewer reads. The
   runtime reviewer (on Sonnet, read-only) checks that every acceptance criterion can be proved
   on a real Vortex, with a negative control, the content it needs and the build it runs on.
   The loop applies the fixes you agree to.
6. **You approve.** Set the design's Status to Approved, or tell the agent to. The approved
   revision is the `designs/<topic>` commit holding the text you approved. The agent never
   writes an approval you have not given.
7. Ask the agent to start the feature: `doodlebot source --branch feat/<topic>` cuts the work
   branch from upstream, or open a new
   worktree session on `feat/<topic>`. The agent implements there, following Vortex's own rules, and writes
   the tests that prove it in the same branch. A prototype's diff is ported, never shipped.
   `/doodlebot:try` shows it working.
8. `/doodlebot:qa --design <draft>`: from a fresh profile, each acceptance criterion with its
   negative control, and the QA catalogue entries the change touches.
9. `/doodlebot:pr`: opens the pull request from your branch, with the design's Overview,
   criteria, approval line and a link to the design at its approved commit on your fork.

## Where the files go

| Files                                           | Folder                                                                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| EGM's briefs, drafts and stage reports (Vortex) | `.doodlebot/egm` in the checkout, kept out of commits; without that, `<workspace>/harness/.artifacts/egm/<checkout folder name>` |
| A design for a change to Vortex                 | `docs/designs/<topic>.md` on the sibling branch `designs/<topic>` in your fork                                                   |
| A design for a change to doodlebot              | `designs/<topic>.md` in the doodlebot repository, in `designs/SITEMAP.md`; EGM's files in `harness/.artifacts/egm`               |

## What a design must contain

Doodlebot's runtime reviewer checks the design against the plugin's change standard:

- acceptance criteria, each with an id;
- for each criterion, the doodlebot command or test that proves it, the content it needs, the
  build it runs on, and a negative control;
- the QA catalogue entries to add or reuse;
- the affected contracts, and the file boundary.

## What's next

- [Open a pull request](pull-requests.md).
- [Use cases](use-cases.md) puts this walk beside every other task.
