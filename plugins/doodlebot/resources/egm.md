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

## The person types every `/egm:*` command

Every EGM skill has `disable-model-invocation: true`, so an agent cannot start one. At each step
print the filled-in line below in a `text` block, say what it does, and wait for the person to
run it. Never write an approval the person has not given.

## Placeholders

- `<workspace>`: the doodlebot workspace, `workspace` in `doodlebot version --json`.
- `<checkout>`: the session's checkout, from `doodlebot source --where`.
- `<egm>`: EGM's artifact folder for this session.
  - `.doodlebot/egm` when `.doodlebot/` is excluded from the checkout's commits:
    `git -C <checkout> check-ignore -q .doodlebot/egm` exits 0. `doodlebot source` adds the
    exclude after the person's yes, and every worktree of the checkout shares it.
  - Otherwise `<workspace>/harness/.artifacts/egm/<checkout folder name>`, so nothing lands in
    the Vortex tree.
- `<draft>`: the draft EGM writes, `<egm>/design_draft.md`, as an absolute path
  (`<checkout>/.doodlebot/egm/design_draft.md` with the exclude).
- `<topic>`: a short name for the change, also the feature branch's `feat/<topic>`.

## The walk

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
   At the save step, keep the draft in `<egm>`. Never save it in the checkout's `docs/designs/`
   folder and never commit it on the feature branch: a design never travels with the code.
3. **The design branch.** When the draft is ready for the person to read, ask: "May I commit the
   draft to `designs/<topic>` and push it to your fork, so you can read and approve it at its
   commit?" On a yes, run `doodlebot design-branch <topic> --file <draft>`. It commits the draft as `docs/designs/<topic>.md` on the sibling branch
   `designs/<topic>`, built from the session branch's upstream base in a temporary worktree, so
   the session's branch and files never change. It pushes the branch only to the person's own
   fork (the same check as `doodlebot push-branch`) and prints the design's link at that
   commit, `<fork>/blob/<sha>/docs/designs/<topic>.md`: give it to the person. Run it again
   after each revision; each revision is a new commit with its own link.
4. **EGM's staged review.** The person types `/egm:egm-review <draft>`, with the artifact
   directory line under it. Give `GoldfishContext` the Vortex files the design names.
5. **The runtime review.** The person types EGM's review loop with doodlebot's runtime reviewer,
   which checks that every acceptance criterion can be proved on a real Vortex:

   ```text
   /egm:egm-review-loop TargetFile: <draft>; SemanticTarget: full file; Reviewers: [<workspace>/plugins/doodlebot/resources/vortex_runtime.md]; Standards: {"<workspace>/plugins/doodlebot/resources/vortex_runtime.md": "<workspace>/plugins/doodlebot/resources/vortex-change-standard.md"}; GoldfishContext: [<workspace>/ARCHITECTURE.md, <workspace>/KNOWLEDGE.md, <workspace>/harness/reference/cli.md, <workspace>/harness/reference/mcp-tools.md, <workspace>/harness/qa/catalog.json]; Dispatch: Direct Dispatch with subagent type doodlebot:vortex-runtime-goldfish
   EGM artifact directory: .doodlebot/egm
   ```

   Replace every placeholder with its absolute path, add the absolute paths of the Vortex files
   the design names to `GoldfishContext`, and use the fallback artifact line without the
   exclude. The runtime reviewer (`doodlebot:vortex-runtime-goldfish`) is read-only and runs on
   Sonnet without `CLAUDE.md`. In Codex, spawn a general-purpose subagent and tell it to read the
   persona first. The loop runs `/egm:egm-resolve` itself.

6. **Approval.** The person approves the sections and the final text. The approved revision is
   the `designs/<topic>` commit holding the text they approved; the pull request links the
   design at that commit. A revision after approval needs a new approval.

EGM's own reviewers run on the session's model (`model: inherit`); start the review from a
Sonnet session for an all-Sonnet review.

## After approval

- Cut the work branch from upstream: `doodlebot source --no-build --branch feat/<topic>`, or a
  new desktop worktree session on `feat/<topic>`. When a prototype came first, port its diff
  there; the `proto/*` branch is never shipped.
- Implement following Vortex's own `AGENTS.md`, `CLAUDE.md` and `docs/README.md`, with the tests
  that prove each criterion in the same branch (`${CLAUDE_PLUGIN_ROOT}/resources/testing.md`).
- `/doodlebot:qa --design <draft>` checks every criterion with its negative control, then
  `/doodlebot:pr` opens the pull request with the design's Overview, criteria, the approval line
  and the link at the approved commit.
