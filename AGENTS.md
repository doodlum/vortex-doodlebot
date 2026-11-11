# Agent instructions

This repo is **doodlebot**, the agent companion for Vortex. People install it as plugins in
Claude Code or Codex and use it from the agent window through commands; the commands call one
CLI, `doodlebot`. The repository holds the plugins, the CLI and harness, the docs and the
hard-won knowledge. Nothing here requires a patched or self-built Vortex.

## What's here

| Path                              | What it is                                                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/`                            | The Vortex extension: an MCP server exposing Vortex's state **and** its UI                                      |
| `harness/`                        | The `doodlebot` CLI and Playwright suite: launch, cache, drive, verify                                          |
| `bin/doodlebot.cjs`               | The CLI entry point; `bin/update.cjs` is `doodlebot update`; `bin/nodeVersion.cjs` checks Node first            |
| `plugins/`                        | The `doodlebot` plugin: skills, agents, EGM resources and its icon                                              |
| `.claude-plugin/marketplace.json` | The `doodlebot` marketplace for Claude Code; `.agents/plugins/marketplace.json` is Codex's                      |
| `plugins/doodlebot/resources/`    | EGM resources: the Vortex change standard, the runtime Goldfish persona and the EGM walk for a Vortex session   |
| `plugins/doodlebot/agents/`       | Claude Code subagents: `vortex-runtime-goldfish`, `vortex-driver`                                               |
| `harness/AGENTS.md`               | **The agent manual**: CLI, tools, traps and the working rules every skill shares                                |
| `harness/PULL-REQUESTS.md`        | Vortex PR titles, description template, review brief, review lessons                                            |
| `harness/TESTING.md`              | Kit gates, the core suite and opt-in checks                                                                     |
| `designs/`                        | Approved doodlebot designs, indexed in `designs/SITEMAP.md`                                                     |
| `harness/qa/catalog.json`         | The QA catalogue: checks Vortex's own e2e suite lacks, with the Vortex files each guards                        |
| `KNOWLEDGE.md`                    | Confirmed diagnostic traps; search the relevant area                                                            |
| `ARCHITECTURE.md`                 | Why the extension reflects Vortex's API instead of wrapping it; the one-instance model                          |
| `docs/`                           | The documentation site for people: installing and using the companion, task by task                             |
| `.claude/settings.json`           | Registers the EGM marketplace (pinned to `v0.1.1`) and this folder's marketplace; enables `egm` and `doodlebot` |

## Getting to a driveable Vortex

From a workspace (a clone of this repository; `/doodlebot:setup` makes one):

```powershell
pnpm install --frozen-lockfile
pnpm run build                              # build the extension
node bin/doodlebot.cjs link                 # put the doodlebot command on the PATH
doodlebot setup --installed --sandbox       # no game or account required; run it in the background
doodlebot tools --json                      # live tool schemas
doodlebot down                              # stop it before another launch, suite or handoff
```

On Windows a captured `doodlebot up` or `setup` can keep its output capture open and never
return: run it in the background with output to a log file (KNOWLEDGE.md, harness/AGENTS.md).

Only one doodlebot Vortex runs at a time **on the machine**, across every workspace. Every kit
launcher (`up`, `setup`, `bootstrap`, the core suite's fixture)
writes the instance record `~/.doodlebot/instance.json` and refuses while a live one exists,
including one started from another workspace or cache:
"A harness Vortex is running (pid N, cache C); run `doodlebot down` before <action>."
`down` waits for a clean exit and then clears the record; a record whose pid is dead or no
longer belongs to Vortex or Electron is cleared as stale. The older record
`harness/.cache/instance.json` is deleted when found, unless it names a running Vortex
("A harness Vortex from an older doodlebot is running (pid N); stop it before starting Vortex.").

To work on Vortex's own code, open the session in a Vortex checkout or one of its worktrees:
doodlebot uses the session's Vortex checkout (the git top level of the folder it runs in), or one
named with `--dev-dir <dir>`. The commands that need it built (`try` on a source build, `fix`,
`qa`, `prototype`) prepare it on the way with `doodlebot source`, following
`plugins/doodlebot/resources/checkout.md` (the `upstream` remote and the `.doodlebot/` exclude
after the person's yes, install and build). Without a checkout, `doodlebot source --clone <dir>`
clones **your** GitHub fork into `<dir>` (as `origin`, beside Nexus-Mods/Vortex as `upstream`);
without a fork it clones upstream alone, which is enough to build and test. Make a branch from
`upstream` for each piece of work (`doodlebot source --branch <name>`). The kit pushes only to your own fork
(`doodlebot push-branch` for the session's branch, which `/doodlebot:pr` opens the PR from, and
`doodlebot design-branch <topic> --file <draft>` for a design). The kit never searches the filesystem
for a Vortex checkout. Building, installing, patching, reverting or recording evidence in the
checkout a running harness Vortex was launched from refuses with
"A harness Vortex is running from <checkout> (pid N); run `doodlebot down` before <action>."

Collections need a Nexus login, once per machine: `/doodlebot:setup --login`, or
`doodlebot setup --installed --oauth`. The account owner completes the browser login; the kit
caches and refreshes it. See `harness/AGENTS.md`.

## Design first (EGM)

Features and refactors start with an approved design, written and reviewed with Google's
Elephant-Goldfish Model plugin (EGM, `v0.1.1`) as EGM ships it. Bug fixes, docs and test-only
changes need none unless the user supplies or asks for one. Doodlebot adds one thing to EGM: a
reviewer that checks every acceptance criterion can be proved on a real Vortex.

**The person types each `/egm:*` command.** Every EGM skill has
`disable-model-invocation: true`, so an agent cannot start one: it tells the person which command
to type next (with the line below for the runtime review, filled in) and carries on when the
person has run it.

**A Vortex change is designed in its Vortex session**, not here: a session opened in a Vortex
checkout reads Vortex's instructions, not this file. The walk, the artifact folder
(`.doodlebot/egm`) and the lines to paste for it are in `plugins/doodlebot/resources/egm.md`.
This section is for doodlebot's own designs.

1. `/egm:egm-brainstorm`, then `/egm:egm-draft`. At the draft's save step choose `designs/` (it
   is listed in `designs/SITEMAP.md`).
2. `/egm:egm-review <design>`. Give `GoldfishContext` the files the design names.
3. `/egm:egm-review-loop` for the runtime review, with exactly these arguments (paths are under
   this workspace, `<workspace>`):
   - **TargetFile:** `<workspace>/<design path>`
   - **SemanticTarget:** `full file`
   - **Reviewers:** `<workspace>/plugins/doodlebot/resources/vortex_runtime.md`
   - **Standards:** `{"<workspace>/plugins/doodlebot/resources/vortex_runtime.md": "<workspace>/plugins/doodlebot/resources/vortex-change-standard.md"}`
   - **GoldfishContext:** `<workspace>/ARCHITECTURE.md`, `<workspace>/KNOWLEDGE.md`,
     `<workspace>/harness/reference/cli.md`, `<workspace>/harness/reference/mcp-tools.md`,
     `<workspace>/harness/qa/catalog.json` when it exists, and the absolute paths of the Vortex
     files the design names.
   - **Dispatch:** Direct Dispatch, spawning subagent type `doodlebot:vortex-runtime-goldfish`
     (`plugins/doodlebot/agents/vortex-runtime-goldfish.md`): read-only, on Sonnet, without
     `CLAUDE.md`. In Codex, spawn a general-purpose subagent on GPT-6.1 Terra and tell it to read
     the persona first. The loop runs `/egm:egm-resolve` itself.

   The line for the person to paste, with `<workspace>` replaced by the workspace's absolute path
   (`doodlebot version --json`) and `<design path>` by the design's absolute path; add the
   absolute paths of the Vortex files the design names to `GoldfishContext`:

   ```text
   /egm:egm-review-loop TargetFile: <design path>; SemanticTarget: full file; Reviewers: [<workspace>/plugins/doodlebot/resources/vortex_runtime.md]; Standards: {"<workspace>/plugins/doodlebot/resources/vortex_runtime.md": "<workspace>/plugins/doodlebot/resources/vortex-change-standard.md"}; GoldfishContext: [<workspace>/ARCHITECTURE.md, <workspace>/KNOWLEDGE.md, <workspace>/harness/reference/cli.md, <workspace>/harness/reference/mcp-tools.md, <workspace>/harness/qa/catalog.json]; Dispatch: Direct Dispatch with subagent type doodlebot:vortex-runtime-goldfish
   ```

4. The person approves the sections. Never write an approval the person has not given.

EGM's own reviewers run on the session's model (`model: inherit`); start the review from a
Sonnet session for an all-Sonnet review.

- A Goldfish reviewer started from this repository ignores this file's workflow instructions,
  stays read-only and follows its brief.

EGM artifact directory: harness/.artifacts/egm

## Verification

- `pnpm run ci` is the gate: types (extension and harness), lint, format check, documentation
  checks and their tests, the QA catalogue check (`qa:check`), unit tests and build. It needs no
  Vortex. `.github/workflows/ci.yml`
  runs the same scripts in the same order (`harness/src/companion.test.ts` asserts it). The site
  also runs `pnpm run docs:build` with pinned Python packages for publication.
- `doodlebot test core` runs the Playwright suite against a real Vortex, with a disposable test
  game and no account. It is outside `ci` because it needs Electron. It refuses while a harness
  Vortex is running; run `doodlebot down` first.
- Say which one you ran. Passing unit tests alone is not evidence that a Vortex workflow works.
- oxfmt and oxlint own formatting and lint. Don't hand-fix them.

## Improve verified workflows

When asked to perform or test something in Vortex:

1. Start from the plugin skill for the use case (`plugins/doodlebot/skills/`), and read
   `harness/AGENTS.md`'s "Working rules". Search `KNOWLEDGE.md` for the symptom; verify its
   explanation against the current source. Read `ARCHITECTURE.md` when locating a capability. When changing
   Vortex, also follow its own `AGENTS.md`, `CLAUDE.md` and `docs/README.md`: this kit
   supplements Vortex's rules and doesn't replace them. For a feature or refactor, start with
   the design (above).
2. Inspect the live tool schemas, state and UI before acting. Use existing capabilities first.
3. If authorized work needs a missing capability, implement the reusable extension tool,
   harness orchestration, CLI command or plugin skill here, preserving stock Vortex
   compatibility.
4. Verify the affected contract, add meaningful regression coverage and update its canonical
   documentation. Keep unverified lessons in task reports. Promote a reusable lesson only
   after checking its cause and scope; material behavior/policy changes need independent review.
   Useful work need not generate a new global rule on every request.
5. Keep missing automation apart from external constraints. Login, captcha, unavailable
   services and missing software can't be claimed away: report them with the exact setup step.

A task is complete only when its result is verified, or a concrete external blocker is reported.

## Working on this repo

- **The site documents setup and commands for people; the manuals document internals for
  agents.** `README.md` and `docs/` are the site: task-based pages for installing and using the
  companion. This file, `harness/*.md`, `KNOWLEDGE.md`, `ARCHITECTURE.md` and the plugin skills
  are the manuals. Update both in the same change when a command, tool, prerequisite or
  guarantee changes. Run `pnpm run docs:generate` for the generated references
  (`docs/reference/commands.md` from the skills, `cli.md`, `mcp-tools.md`, `harness/reference/`)
  and `pnpm run docs:check` to catch drift; `scripts/documentation-map.json` maps each source
  area to its pages. A generated reference cannot substitute for an accurate procedure. See
  `docs/contributing.md` for building and previewing the site.
- **Plugins.** Skill and agent bodies write repository paths as `<workspace>/<path>` or
  `${CLAUDE_PLUGIN_ROOT}/<path>` and name only commands in `harness/src/commands.ts`
  (`harness/src/plugins.test.ts`). Keep every manifest `version` equal to `package.json`'s. After
  editing a plugin, run `/plugin marketplace update doodlebot`.
- **One accountable owner per issue.** One agent is accountable for each issue and follows
  the working rules in [the agent manual](harness/AGENTS.md#working-rules). Only one doodlebot Vortex runs at a
  time, and nothing serializes two harness commands, so do not drive, rebuild or test the
  instance from two sessions at once. Run `doodlebot down` before handing over. Independent
  QA runs after the author's `down`, in a fresh context, and starts with `up --fresh` so it does
  not inherit the author's profile state. Publication follows the user's authorization and the
  kit-lesson exception (below). No backward compatibility with obsolete callers or evidence
  formats is required.
- **The extension must keep working against a stock, released Vortex.** Anything that needs the
  main process goes in the harness over CDP, never into a patch to Vortex.
- **Two test layers.** Pure DOM logic goes in `src/uiAutomation.test.ts` under jsdom; anything
  that needs a real app goes in `harness/src/tests/`.
- **Promote verified lessons** as `harness/AGENTS.md` ("Improving the kit") and
  `plugins/doodlebot/resources/knowledge.md` say. Keep knowledge entries short:
  symptom, confirmed cause, remedy, applicable scope and source/test evidence.
- Extension changes hot-reload through finite build, copy and reload cycles: run
  `doodlebot watch` (or `pnpm run dev`) against your already-running instance. One watcher is
  sufficient; don't run it together with `build-extension`, or during a test, since a reload
  invalidates UI refs mid-action.

## Committing

Conventional Commits. Don't commit, push or open a PR unless asked, except for verified kit
lessons: those may be committed and pushed to `main` after `pnpm run ci` passes. Every Vortex
PR description ends with the doodlebot footer (`harness/PULL-REQUESTS.md`).
