# EGM in a Vortex session

Features and refactors of Vortex start with a design written and reviewed with Google's
Elephant-Goldfish Model plugin (EGM, `v0.1.1`), as EGM ships it. Bug fixes, docs and test-only
changes need none unless the person supplies or asks for one. This page is the walk for a
session opened in a Vortex checkout or one of its worktrees. Doodlebot's own designs follow the
doodlebot repository's `AGENTS.md` instead.

A Vortex session reads Vortex's `CLAUDE.md` and `AGENTS.md`, not doodlebot's, and doodlebot
writes no instruction file into Vortex. So everything EGM needs from doodlebot travels in the
lines the person pastes: the artifact folder on its own line, and the runtime review's
arguments.

Doodlebot follows EGM's own model (EGM's `docs/harnesses.md`): the approved design is a project
file, `docs/designs/<topic>.md`, committed on the work branch so it travels with the code in the
pull request. Only EGM's scratch work (briefs, review reports) goes in the artifact folder, which
stays out of commits.

## The person types every `/egm:*` command

Every EGM skill has `disable-model-invocation: true`, so an agent cannot start one. At each step
print the filled-in line below in a `text` block, say what it does, and wait for the person to
run it. Never write an approval the person has not given.

## Placeholders

- `<workspace>`: the doodlebot workspace, `workspace` in `doodlebot version --json`.
- `<checkout>`: the session's checkout, from `doodlebot source --where`.
- `<topic>`: a short name for the change, also the work branch's `feat/<topic>`.
- `<design>`: the design, `<checkout>/docs/designs/<topic>.md`, as an absolute path.
- `<egm>`: EGM's artifact folder for this session's scratch work.
  - `.doodlebot/egm` when `.doodlebot/` is excluded from the checkout's commits:
    `git -C <checkout> check-ignore -q .doodlebot/egm` exits 0. When it is not, ask the
    person once before the first EGM line, as step 3 of "Prepare this checkout"
    (`${CLAUDE_PLUGIN_ROOT}/resources/checkout.md`) says; on a yes,
    `doodlebot source --no-build --exclude` adds it, and every worktree of the checkout shares it.
  - Otherwise `<workspace>/harness/.artifacts/egm/<checkout folder name>`, so EGM's scratch
    files never land in the Vortex tree.

## The walk

0. **The work branch.** The design is committed where the code will be, so start on the work
   branch: `doodlebot source --no-build --branch feat/<topic>` when the session is not on one
   already (in the checkout, or a new Claude desktop or Codex app worktree session).
1. **Brainstorm.** The person types:

   ```text
   /egm:egm-brainstorm <the idea>
   EGM artifact directory: .doodlebot/egm
   ```

   Without the exclude the second line is
   `EGM artifact directory: <workspace>/harness/.artifacts/egm/<checkout folder name>`. After a
   `/doodlebot:prototype` round, add a third line,
   `Start from <workspace>/harness/.artifacts/prototypes/<idea>/summary.md`.

2. **Draft.** The person types `/egm:egm-draft` with the same artifact directory line under it.
   At the save step, choose EGM's default, the checkout's `docs/designs/`, as `<topic>.md`.
   Write every acceptance criterion as something observable on a running Vortex, using
   `<workspace>/harness/reference/cli.md` and `<workspace>/harness/reference/mcp-tools.md` for
   what doodlebot can observe.
3. **EGM's staged review.** The person types `/egm:egm-review <design>`, with the artifact
   directory line under it. Give `GoldfishContext` the Vortex files the design names.
4. **The runtime review.** The person types EGM's review loop with doodlebot's runtime reviewer,
   which checks that every acceptance criterion can be proved on a real Vortex:

   ```text
   /egm:egm-review-loop TargetFile: <design>; SemanticTarget: full file; Reviewers: [<workspace>/plugins/doodlebot/resources/vortex_runtime.md]; Standards: {"<workspace>/plugins/doodlebot/resources/vortex_runtime.md": "<workspace>/plugins/doodlebot/resources/vortex-change-standard.md"}; GoldfishContext: [<workspace>/ARCHITECTURE.md, <workspace>/KNOWLEDGE.md, <workspace>/harness/reference/cli.md, <workspace>/harness/reference/mcp-tools.md, <workspace>/harness/qa/catalog.json]; Dispatch: Direct Dispatch with subagent type doodlebot:vortex-runtime-goldfish
   EGM artifact directory: .doodlebot/egm
   ```

   Replace every placeholder with its absolute path, add the absolute paths of the Vortex files
   the design names to `GoldfishContext`, and use the fallback artifact line without the
   exclude. The runtime reviewer (`doodlebot:vortex-runtime-goldfish`) is read-only and runs on
   Sonnet without `CLAUDE.md`. In Codex, spawn a general-purpose subagent and tell it to read the
   persona first. The loop runs `/egm:egm-resolve` itself.

5. **Approval and commit.** The person approves the sections and the final text. Then ask "May
   I commit the approved design on `feat/<topic>`?" and on a yes commit `<design>` (and
   `docs/designs/SITEMAP.md` when EGM registered it there) as `docs(design): <topic>`. A
   revision after approval needs a new approval and its own commit. To let the person read it on
   GitHub first, `doodlebot push-branch` pushes the branch to their fork, after their yes.

EGM's own reviewers run on the session's model (`model: inherit`); start the review from a
Sonnet session for an all-Sonnet review.

## After approval

- Implement on the same branch, following Vortex's own `AGENTS.md`, `CLAUDE.md` and
  `docs/README.md`, with the tests that prove each criterion
  (`${CLAUDE_PLUGIN_ROOT}/resources/testing.md`). When a prototype came first, port its diff;
  the `proto/*` branch is never shipped.
- `/doodlebot:qa --design <design>` checks every criterion with its negative control, then
  `/doodlebot:pr` opens the pull request. The design travels in it, and the description carries
  its Overview, criteria and the approval line.
