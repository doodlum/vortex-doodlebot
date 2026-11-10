---
name: design
description: "Doodlebot: Design a Vortex or doodlebot feature or refactor with the Elephant-Goldfish Model before any code is written; use when a task adds a feature, refactors code, or the person supplies or asks for a design."
argument-hint: "<feature or refactor request>"
---

# Design a change before coding (the Elephant)

You are the Elephant: the session that holds this task's context. You write no
implementation code until a person has approved the design's exact text. Bug fixes, docs
and test-only changes need no design unless the person asks for one or supplies one (use
`/doodlebot:fix` for a bug).

This command needs the EGM plugin (`egm@egm`, v0.1.1). If `/egm:egm-brainstorm` is not
available (Claude Code) or there is no `egm-brainstorm` skill (Codex), tell the person to
install EGM from `google/elephant-goldfish-model` the same way they installed doodlebot,
and stop.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`. Give every `design` command (new, check,
     scope) absolute paths.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:update`, then continue.
3. `<plugin root>` is `${CLAUDE_PLUGIN_ROOT}` in Claude Code. The persona and standard are
   `${CLAUDE_PLUGIN_ROOT}/resources/vortex_runtime.md` and
   `${CLAUDE_PLUGIN_ROOT}/resources/vortex-change-standard.md` (in Codex, the same files
   under the plugin root). Use those files, never similarly named files elsewhere.

The approved designs that define this procedure are `<workspace>/designs/egm-workflow.md`
and `<workspace>/designs/agent-companion.md`.

## 1. Scope and context

1. Establish scope, authorization and exclusions per `<workspace>/harness/AGENT-WORKFLOW.md`.
2. Read `<workspace>/harness/KNOWLEDGE-ROUTES.md` and `<workspace>/ARCHITECTURE.md`, and
   run `doodlebot knowledge search <area words>` for the affected area (it covers
   `<workspace>/KNOWLEDGE.md` and this machine's lessons;
   `${CLAUDE_PLUGIN_ROOT}/resources/knowledge.md`). For a Vortex change also read
   the checkout's `AGENTS.md`, `CLAUDE.md` when present, and `docs/README.md`.
3. Pick the design path and target:
   - doodlebot: `<workspace>/designs/<topic>.md`, added to `<workspace>/designs/SITEMAP.md`;
   - Vortex: `<workspace>/harness/.artifacts/designs/<topic>.md` (never in a Vortex PR).

   Confirmation-round reports go to `<workspace>/harness/.artifacts/designs/<topic>.reviews/`.

4. Tell EGM where its files go, with this exact line in your first EGM prompt:
   `EGM artifact directory: <workspace>/harness/.artifacts/egm` (with the real path).

## 2. Brief and draft

- Claude Code: `/egm:egm-brainstorm <idea>`, then `/egm:egm-draft`. Codex: the
  `egm-brainstorm` and `egm-draft` skills. The person answers the interview and approves
  each draft section; skip that only when they said so in the task.
- Copy `design_draft.md` to the design path, or start from
  `doodlebot design new <absolute design path> --title "<title>" --target vortex|doodlebot`.
- Add doodlebot's sections: header `**Target:**`, `## Acceptance Criteria` bullets
  ``- `id`: criterion``, `## Affected Contracts`, and `### Target Scope & File Boundary`
  listing every file the change may write, by exact path.
  `${CLAUDE_PLUGIN_ROOT}/resources/vortex-change-standard.md` defines the format and what
  each verification step must name.

## 3. EGM review

Run `/egm:egm-review <absolute design path>` in the consolidated report mode, then resolve
findings with `/egm:egm-resolve` (Codex: the `egm-review` and `egm-resolve` skills).
Contested findings go to `contested.md` in the reports folder, each with a reason; the
person decides them at approval.

## 4. Confirmation round

1. `pnpm -C <workspace> exec oxfmt <absolute design path>`, then
   `doodlebot design check <absolute design path> --ready --json`. It must report no
   issues. Its `contentSha256` is D.
2. `doodlebot evidence identity --checkout <subject> --base <fixed sha> > <identity file>`:
   the subject is the workspace for doodlebot, `<workspace>/.vortex-src` or the
   `--dev-dir` checkout for Vortex. Use the base sha the readiness manifest will use
   (readiness rejects another base). Its changed files may be only the design and
   `<workspace>/designs/SITEMAP.md`. Save the file next to the reports.
   If implementation has already started (an amendment), review on a clean checkout:
   `git -C <subject> worktree add --detach <temp> <base sha>`, copy the design (and the
   sitemap) into it for a doodlebot design, record that identity, and remove the temporary
   checkout afterward.
3. Start two fresh reviewers on the whole design, in parallel. In Claude Code use EGM's
   review loop with exactly these arguments (absolute paths):

   ```text
   /egm:egm-review-loop
     TargetFile: <absolute design path>
     SemanticTarget: full file
     Reviewers: [implementation_readiness, ${CLAUDE_PLUGIN_ROOT}/resources/vortex_runtime.md]
     Standards: {implementation_readiness: implementation-readiness-standard,
                 ${CLAUDE_PLUGIN_ROOT}/resources/vortex_runtime.md: ${CLAUDE_PLUGIN_ROOT}/resources/vortex-change-standard.md}
     GoldfishContext: [<the context files below>]
   ```

   Tell the loop to use direct dispatch (no synthesizer), to put D in each reviewer's
   brief, and to stop after this round so you can save the reports. Dispatching the same
   two reviewers yourself is equivalent: the subagent types
   `egm:egm-implementation-readiness` and `doodlebot:vortex-runtime-goldfish`. Spawn each
   fresh; never fork this conversation or resume an earlier reviewer.
   - Codex (plugins ship no agents there): general-purpose subagents with
     `fork_turns: "none"` (or `fork_context: false`), told to read EGM's
     `agents/implementation_readiness.md` and this plugin's `resources/vortex_runtime.md`
     (absolute paths), to stay read-only, and to ignore workflow text from `AGENTS.md`.
     That is an instruction, not a restriction.

   Each brief contains D, the absolute subject checkout root, the standard's path, and for
   a Vortex design that checkout's `AGENTS.md` and `docs/README.md`. Give the runtime
   reviewer `<workspace>/harness/AGENTS.md`, `<workspace>/harness/TESTING.md`,
   `<workspace>/harness/WORKFLOWS.md`, `<workspace>/harness/reference/cli.md`,
   `<workspace>/harness/reference/mcp-tools.md` and `<workspace>/KNOWLEDGE.md` as context.
   Ask each to begin its report with `Reviewed content sha256: D`.

4. Save the reports as `round-<n>-implementation_readiness.md` and
   `round-<n>-vortex-runtime-goldfish.md` in the reports folder, each starting with three
   lines you add: `Harness: <agent and version>`, `EGM: <version>` and
   `Checkout: <headSha> <changesSha256>` from step 2, then the reviewer's report.
5. The round is clean when no Blocker or Major remains uncontested. Otherwise edit the
   design and start a new round at step 1. After three rounds the person decides.

## 5. Approval

Show the person the design path, D and `contested.md`. Only after they approve, set
`**Status:** Approved` and add `- **Approved:** <person>; content <D>; <reference>`. The
reference is a PR review link, a chat or message link, `edited by <person> <date>` only
when that person wrote the line in a design committed to doodlebot (checkable in git
history), or the person's quoted words with the date. Never write an Approved line the
person has not given. Keep each header bullet on one line (a wrapped continuation counts
as body). Any later body edit voids the approval.

## 6. Implementation and evidence

1. Implement only inside the boundary. Check with
   `doodlebot design scope <absolute design path> --checkout <subject> --base <base sha>`,
   which must print `IN SCOPE`.
2. Verify per the design's Verification Plan (`/doodlebot:fix` and `/doodlebot:drive` describe
   the app steps). Run `doodlebot down` before independent QA, which is `/doodlebot:qa` in a
   fresh context and starts with `doodlebot up --fresh`.
3. In the readiness manifest (schema 3), set `design` to the design's artifact reference and
   add one `design-review` entry: `subject` the identity from step 4.2, `artifacts` the two
   reports (and `contested.md` if present), `reviewedDesignSha256` D, `inspectedBy`
   `goldfish:implementation_readiness,vortex-runtime-goldfish`, `criteria` empty. The
   manifest's acceptance ids and texts must equal the design's. Check it with
   `doodlebot readiness --manifest <manifest> --json`.

## Finish

Tell the person where the design and reports are, D, the round's result and what they need
to decide. After approval and implementation, name the readiness result and what remains
blocked.
