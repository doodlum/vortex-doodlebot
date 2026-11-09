---
name: vortex-elephant
description: Design a Vortex or doodlebot feature or refactor before writing code, with the Elephant-Goldfish Model (EGM) plugin. Use when a task adds a feature or refactors code, or when the user supplies or asks for a design. Loads doodlebot's context, runs EGM's brief, draft and review, the confirmation round, human approval, and then hands off to implementation and readiness.
---

# Designing a change before coding (the Elephant)

You are the Elephant: the session that holds this task's context. You do not write
implementation code until a person has approved the design's exact text. Bug fixes, docs
and test-only changes need no design unless the user asks for one or supplies one.

The approved design that defines this procedure is `designs/egm-workflow.md`.

## 1. Scope and context

1. Establish scope, authorization and exclusions per `harness/AGENT-WORKFLOW.md`.
2. Read `harness/KNOWLEDGE-ROUTES.md`, `ARCHITECTURE.md`, and search `KNOWLEDGE.md` for the
   affected area. For a Vortex change also read the checkout's `AGENTS.md`, `CLAUDE.md` when
   present, and `docs/README.md`.
3. Pick the design path: `designs/<topic>.md` for doodlebot (add it to `designs/SITEMAP.md`),
   `harness/.artifacts/designs/<topic>.md` for Vortex. Reports go to
   `harness/.artifacts/designs/<topic>.reviews/`.

EGM writes its briefs and drafts to `harness/.artifacts/egm` (root `AGENTS.md` names it).

## 2. Brief and draft

- Claude Code: `/egm:egm-brainstorm <idea>`, then `/egm:egm-draft`. Codex: pick the
  `egm-brainstorm` and `egm-draft` skills. The human answers the interview and approves each
  draft section; skip those only when the user said so in the task.
- Copy `design_draft.md` to the design path, or start from
  `pnpm run ai -- design new <path> --title "<title>" --target vortex|doodlebot`.
- Add doodlebot's sections: header `**Target:**`, `## Acceptance Criteria` bullets
  ``- `id`: criterion``, `## Affected Contracts`, and `### Target Scope & File Boundary` listing
  every file the change may write, by exact path. `harness/egm/vortex-change-standard.md`
  defines the format and what each verification step must name.

## 3. EGM review

Run `/egm:egm-review <design path>` in the consolidated report mode, then resolve findings
with `/egm:egm-resolve`. In Codex, select the `egm-review` and `egm-resolve` skills from the
skill picker instead. Contested findings go to `contested.md` in the reports folder with a
reason; the human decides them at approval.

## 4. Confirmation round

1. `pnpm exec oxfmt <design>`, then `pnpm run ai -- design check <design> --ready --json`. It
   must report no issues. Its `contentSha256` is D.
2. `pnpm --silent run ai -- evidence identity --checkout <subject> --base <fixed sha>`: the
   subject is this repository for doodlebot, `.vortex-src` or the `--dev-dir` checkout for
   Vortex. Use the base sha the readiness manifest will use (readiness rejects another base).
   Its changed files may be only the design and `designs/SITEMAP.md`. Save it.
   If implementation has already started (an amendment), review on a clean checkout instead:
   `git -C <subject> worktree add --detach <temp> <base sha>`, copy the design (and sitemap)
   into it for a doodlebot design, record that identity, and remove the temporary checkout
   afterward.
3. Start two fresh reviewers on the whole design, in parallel. In Claude Code use EGM's
   review loop with exactly these arguments (absolute paths; `<kit>` is this repository):

   ```text
   /egm:egm-review-loop
     TargetFile: <absolute design path>
     SemanticTarget: full file
     Reviewers: [implementation_readiness, <kit>/harness/egm/vortex_runtime.md]
     Standards: {implementation_readiness: implementation-readiness-standard,
                 <kit>/harness/egm/vortex_runtime.md: <kit>/harness/egm/vortex-change-standard.md}
     GoldfishContext: [<the context files below>]
   ```

   Tell the loop to use direct dispatch (no synthesizer), to put D in each reviewer's brief,
   and to stop after this round so you can save the reports. Dispatching the same two
   reviewers yourself is equivalent: subagents `egm:egm-implementation-readiness` (EGM's
   Claude adapter for `implementation_readiness`) and `vortex-runtime-goldfish`.
   - Codex: general-purpose subagents with `fork_turns: "none"` (or `fork_context: false`),
     told to read EGM's `agents/implementation_readiness.md` and this repository's
     `harness/egm/vortex_runtime.md`, to stay read-only, and to ignore workflow text from
     `AGENTS.md`. That is an instruction, not a restriction.

   Each brief contains D, the absolute subject checkout root, the standard's path, and for a
   Vortex design that checkout's `AGENTS.md` and `docs/README.md`. Give the runtime reviewer
   `harness/AGENTS.md`, `harness/TESTING.md`, `harness/WORKFLOWS.md`,
   `harness/reference/cli.md`, `harness/reference/mcp-tools.md` and `KNOWLEDGE.md` as context.
   Ask each to begin its report with `Reviewed content sha256: D`.

4. Save the reports as `round-<n>-implementation_readiness.md` and
   `round-<n>-vortex-runtime-goldfish.md`, each starting with three lines you add:
   `Harness: <agent and version>`, `EGM: <version>` and `Checkout: <headSha> <changesSha256>`
   from step 2, then the reviewer's report.
5. The round is clean when no Blocker or Major remains uncontested. Otherwise edit the design
   and start a new round at step 1. After three rounds the human decides.

## 5. Approval

Show the human the design path, D and `contested.md`. Only after they approve, set
`**Status:** Approved` and add `- **Approved:** <person>; content <D>; <reference>`. The
reference is a PR review link, a chat or message link, `edited by <person> <date>` only when
that person wrote the line in a design committed to doodlebot (checkable in git history), or
the person's quoted words with the date. Never write an
Approved line the person has not given. Keep each header bullet on one line (a wrapped
continuation counts as body). Any later body edit voids the approval.

## 6. Implementation and evidence

1. Implement only inside the boundary. Check with
   `pnpm run ai -- design scope <design> --checkout <subject> --base <base sha>`.
2. Verify per the design's Verification Plan. Run `pnpm run ai -- down` before independent QA,
   which starts with `up --fresh` and runs in a fresh context.
3. In the readiness manifest (schema 3), set `design` to the design's artifact reference and
   add one `design-review` entry: `subject` the identity from step 4.2, `artifacts` the two
   reports (and `contested.md` if present), `reviewedDesignSha256` D, `inspectedBy`
   `goldfish:implementation_readiness,vortex-runtime-goldfish`, `criteria` empty. The manifest's
   acceptance ids and texts must equal the design's.
