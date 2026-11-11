# Doodlebot in your Vortex checkout, and /doodlebot:prototype

- **Author:** Claude (Opus 5.5), for doodlum
- **Status:** Draft, iteration 3. Written under the owner's goal of 2026-11-11: "doodlebot
  designed to run in vortex/worktree only, prototype command, fixed any issues, and included any
  open PRs". Iteration 1 was reviewed by EGM's Zoom Out and Implementation Readiness reviewers and
  doodlebot's runtime reviewer; all three said "agree with changes", and this iteration makes
  them (section 9). The owner has not given a formal approval line.
- **Target:** doodlebot
- **Builds on:** `designs/companion-simplified.md` (merged in doodlum/vortex-doodlebot#2). This
  design changes its 4.10 (`.vortex-src`, worktrees), 4.11 (the EGM walk) and 4.2.1 (where
  Vortex designs live), and adds a ninth command.
- **Brief:** `harness/.artifacts/egm/prototype-command-brief.md`

## 1. Overview

Today a person opens Claude in the doodlebot workspace, and Vortex is a nested clone,
`.vortex-src`. Claude desktop tracks only the folder the session opened, so a Vortex PR never
shows in its PR bar: no CI status, no Auto-fix, no merge button. The app's worktree sessions
(one per branch) can't be used for Vortex work either.

After this change, **the person opens Claude in a Vortex checkout or one of its worktrees**:

- The session's folder is the Vortex code, and the PR the session opens is opened from the
  session's branch.
- Doodlebot is the plugin plus the `doodlebot` command. Its workspace (CLI, caches, releases,
  run reports) stays where `/doodlebot:setup` put it.
- The managed clone `.vortex-src` is retired.

Prototyping gets `/doodlebot:prototype`: change, rebuild and look on a `proto/<idea>` branch,
ending in a summary and the exact line that starts the EGM design. Six open issues are fixed,
and open PR #3 is already merged into this branch (`9f7fed5`).

## 2. Use cases (changed or new)

| #   | Ask                               | Path after this change                                                                                                                                                               |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| U12 | "Work on Vortex in this checkout" | Open Claude in the checkout, or a desktop worktree session of it → `/doodlebot:source` prepares it (remotes and exclude after the person's yes; install and build) → commands use it |
| U13 | "Prototype this idea"             | A worktree session on a fresh branch → `/doodlebot:prototype <idea>`: change, build, look (screenshots), ask, repeat → a summary and the `/egm:egm-brainstorm` line                  |
| U3  | "Fix it" (changed)                | As before, in the session's checkout. `/doodlebot:pr` opens the PR from the session's branch, so the desktop app can show it with Auto-fix                                           |
| U4  | "Build this feature" (changed)    | The EGM walk in the session's checkout. The design is committed on a sibling branch `designs/<topic>`, never on the feature branch                                                   |
| U10 | "Improve doodlebot" (unchanged)   | In the doodlebot repository                                                                                                                                                          |

The other use cases are unchanged, except that "my build" means the session's checkout.

## 3. Goals and non-goals

**Goals**

1. Every command that builds or changes Vortex code uses the session's checkout, and refuses
   with one clear step when the session isn't in one.
2. `/doodlebot:pr` opens the PR from the session's branch, in the session.
3. Nothing doodlebot writes can reach a Vortex commit, in any worktree, and `source` and `build`
   leave `git status` clean.
4. EGM works in a Vortex session without any file written into Vortex.
5. `/doodlebot:prototype` exists and ends in one line that starts the EGM brainstorm.
6. The six open issues (4.8) are fixed. PR #3 is included.

**Non-goals**

- Hot-reloading Vortex's own code without a rebuild and restart.
- Changing the one-instance rule, the protections, releases, or the QA catalogue's entries.

**Affected contracts:** `runtime` (target resolution, stale-build refusal), `ui` (narrow
viewport, refs), `public-api` (the CLI's commands and flags, the MCP ref contract, the
`gap list --json` shape), `persistent-data` (`.git/info/exclude`, the build record, the
`designs/*` branches in the fork).

## 4. Design

### 4.1 Which checkout

- **Resolution:** `resolveTarget` gains the caller's folder: `resolveTarget({ cwd:
callerCwd() })`.
  - It walks up to the git top level (`git rev-parse --show-toplevel`, which works in worktrees).
  - That folder is a Vortex checkout when its root `package.json` is named `@vortex/monorepo`.
- **Precedence:**
  1. an explicit `--dev-dir <dir>`;
  2. the session's checkout;
  3. for commands that don't need source, the target flags as today: `--release`,
     `--installed`, `--exe`, otherwise the installed Vortex or the newest registered release.
- **`VORTEX_AI_DEV_DIR` is removed.** A value left over from the old worktree advice would
  quietly send commands to another tree. Its two internal users change:
  - `evidence run --runtime` (`evidence.ts` set it for its child) passes `--dev-dir <checkout>`
    and runs the child from the checkout, with `INIT_CWD` set to it;
  - the measure skill builds each side with `--dev-dir`.

  The messages in `doctor.ts` and `config.ts` that name the variable are reworded.

- **Commands that need source** refuse outside a checkout with: "Open Claude in a Vortex checkout
  or worktree (or clone one with `doodlebot source --clone <dir>`)." These are `build`,
  `source` (except `--clone`), `pr-preflight`, `pr`, `prototype`, and `up` without a target
  flag when a source build is asked for. `up --release`, `check`, `inventory`, `clean`, `test
<suite> --release` and `release` work anywhere.
- **Retired:**
  - `vortexSourceDir`, `VORTEX_AI_SOURCE_DIR`, `.vortex-src` as a default, and `source`'s
    clone-into-the-workspace path;
  - `doctor`'s "Vortex source" row, which becomes "This checkout";
  - `.gitignore` keeps `.vortex-src/`, so an existing user's old clone doesn't appear in
    doodlebot's `git status`.
  - `check` reports an old `.vortex-src` as `advisory: old managed clone (no longer used)` with
    the size. `clean` removes it only with `--yes`, after the person agrees.
- **The QA catalogue:** `qa check`'s spec diff and `vortexE2e.commit` read the session's
  checkout. With none, `qa check` validates the entries, skips the spec diff and says so.

### 4.2 Preparing a checkout (`/doodlebot:source`)

`doodlebot source`, run in the session's checkout, changes only what is missing and reports
the rest.

1. **Remotes.** `upstream` must be Nexus-Mods/Vortex.
   - If it is missing, the skill asks "May I add Nexus-Mods/Vortex as `upstream`?" and runs
     `source --add-upstream` on a yes.
   - If it points anywhere else, `source` refuses and changes nothing.
   - `origin` is reported: the person's fork, upstream itself, or absent. The push check
     (`prPush.ts`) is unchanged.
2. **Exclude.** With the person's yes (the same question), `.doodlebot/` is appended to
   `$(git rev-parse --git-common-dir)/info/exclude`. That file is shared by every worktree of
   the checkout.
3. **Install and build.**
   - `pnpm install --frozen-lockfile` with the checkout's pinned pnpm, then `doodlebot build
--checkout <root>`.
   - That build already restores `etc/vortex.api.md` and `etc/Dependency Report.md` when the
     build rewrites them, so `git status` stays clean. It also writes the build record (4.6).
   - Skipped when the build record matches the checkout.
   - It takes minutes and several GB per checkout or worktree; pnpm's store keeps downloads
     shared.
4. **Report:** checkout, branch, remotes, built or not, and the next step.

**`doodlebot source --clone <dir>`:**

- clones the fork as `origin` (or upstream alone when there's no fork) into the folder the person
  names, outside the doodlebot workspace;
- `<dir>` is resolved against the caller's folder (`clone` joins `PATH_FLAGS`);
- has no default folder: the skill asks;
- then says: "Open Claude in <dir> and run `/doodlebot:source`."

**Worktrees:**

- One test Vortex runs at a time across the machine, as before.
- The instance record's `sourceDir` names the worktree that started it, and a session never stops
  another's.
- Each worktree needs its own `/doodlebot:source` (install and build).

### 4.3 Where doodlebot's files go

- **Per worktree, excluded:** `<checkout>/.doodlebot/`.
  - `egm/` holds EGM's briefs, drafts and stage reports for this session.
  - (The build record is not here: it is in the git folder, 4.6.)
- **Shared, in the doodlebot workspace:** `harness/.artifacts/`.
  - `prototypes/<idea>/summary.md` holds each prototype summary. It is shared, so the later
    `feat/*` worktree can read what the `proto/*` worktree learned.
  - `runs/` holds run reports and screenshots as today. Summaries link to them; they don't copy
    them.
- **Unchanged:** caches, releases, the login, `content.json` and the instance record.

### 4.4 EGM in a Vortex session

A Vortex session reads Vortex's `CLAUDE.md` and `AGENTS.md`, not doodlebot's. So:

- **The guidance is in the plugin:** `plugins/doodlebot/resources/egm.md` holds the walk, the
  runtime review and the paste-ready lines. The root `AGENTS.md` keeps a short pointer to it for
  doodlebot's own repository, and keeps its own `EGM artifact directory:` line for doodlebot
  work.
- **The artifact folder is on its own line in the prompt.** EGM v0.1.1 accepts it from the
  person's prompt, and resolves a relative path against the working directory (`docs/claude.md`,
  lines 32–34). A line doodlebot gives the person looks like:

  ```text
  /egm:egm-brainstorm
  EGM artifact directory: .doodlebot/egm
  Start from <workspace>/harness/.artifacts/prototypes/<idea>/summary.md
  ```

  No tracked file is written into Vortex, and no instruction file at all. Without the exclude (the person said no in 4.2), the artifact folder is `<workspace>/harness/.artifacts/egm/<checkout folder name>` instead. `CLAUDE.local.md` was rejected: it exists in one worktree only,
  and it can stop Claude reading `AGENTS.md`.

- **The runtime review line** is unchanged, with `<workspace>` meaning the doodlebot workspace
  (`doodlebot version --json`).
- The person types every `/egm:*` command; an agent only prints the filled-in line.

### 4.5 Designs and PRs

- **The design goes on a sibling branch, `designs/<topic>`.** The plural avoids the
  `design/<topic>` tags the merged design pushed to forks, so `git push origin designs/<topic>`
  is never ambiguous.
- **`doodlebot design-branch <topic> --file <draft>`:**
  1. creates or updates `designs/<topic>` from the session branch's upstream base, in a
     temporary worktree. It reuses `prPush.ts`'s temp-worktree code; the session's checkout
     never switches;
  2. copies the draft from `.doodlebot/egm/` to `docs/designs/<topic>.md` and commits it as
     `docs(design): <topic>`;
  3. pushes it to the fork after the push check;
  4. prints the link at the commit: `<fork>/blob/<sha>/docs/designs/<topic>.md`.

  The approved revision is the commit the person approved. The PR description links that SHA.

- **Removed:** `pr-branch`, `pr/<topic>`, the cherry-pick, and the `design/<topic>` tags.
  Existing tags in forks are left alone.
- **`/doodlebot:pr`:**
  1. preflight, with the revert check;
  2. push the session's branch to the fork (the existing check);
  3. ask the person whether the PR goes to the fork or to Nexus-Mods/Vortex. The owner's reviews
     have been PRs inside the fork (doodlum/Vortex#22 and #23);
  4. `gh pr create` from the session's branch, as a draft unless the person says otherwise;
  5. on Claude desktop, bind it with the app's PR tools if the PR bar didn't pick it up.
- **`doodlebot push-branch`** (added during implementation):
  - pushes the session's branch with `-u` after the fork check;
  - refuses `proto/*`, `designs/*`, the default branch and a detached HEAD;
  - the pr skill pushes only through it, so the refusals are in code, not only in skill text.
- **Refusals:** `pr` refuses a `proto/*` branch. `pr-preflight` FAILs when the diff contains a
  `docs/designs/` file.
- **Not documented, verified live:** how the desktop app binds a PR into another repository
  (fork to upstream). A PR inside the fork binds, because the fork is `origin`.

### 4.6 A stale build never runs silently (issue 1)

- **The build record.** `doodlebot build` writes `$(git rev-parse --git-dir)/doodlebot-build.json` (inside the worktree's own git folder, never in the working tree, so it never shows in `git status` and is never part of the identity it records) with the
  checkout's identity at build time:
  - `HEAD`;
  - a hash of the working-tree changes, tracked and untracked (`git ls-files --cached --others
--exclude-standard`, reusing `evidence.ts`'s identity code);
  - the build mode.

  File times are not used: `git switch` and worktree creation rewrite them.

- **The check.** `up` and `bootstrap` with a source build compare the current identity with the
  record. The check sits beside `bundleModeOf` (`productionMode.ts`), and the bundle is
  `src/main/build/renderer.js`, as `doctor` reads it.
  - **Mismatch:** refuse, naming what changed: "The build is from <HEAD short> and the checkout
    has changed since (<n> files, for example <file>). Run `doodlebot build --checkout
<checkout>`."
  - **No record** (a build not made by `doodlebot build`): a warning, not a refusal.
  - **`--stale-ok`** (a boolean flag) launches anyway and says so in the run report.
- **Callers:** `prototype` and `try` run `doodlebot build` before `up`, so their normal path
  never hits the refusal.

### 4.7 `/doodlebot:prototype <idea>`

A ninth command, the owner's choice.

- **Start:**
  1. On Claude desktop, the skill first asks the person to start a new worktree session
     (`proto/<idea>`) and run `/doodlebot:prototype` there. It never switches the branch of the
     owner's current checkout.
  2. In the session's checkout, `prototype` refuses a dirty tree, and refuses a branch that is
     not a new `proto/*` branch or the upstream default.
  3. When the session is on the upstream default (a desktop worktree session opened on an
     upstream base), `doodlebot source --branch proto/<idea>` cuts the branch. When it is already
     on a new `proto/<idea>` branch with no commits beyond upstream, the step is skipped.
  4. `/doodlebot:source` prepares the checkout if needed. The cost is install and build.
- **Loop,** until the person says it's enough:
  1. the agent changes Vortex's code for the idea;
  2. `doodlebot build --checkout <checkout>`;
  3. a `try`-style run on that build: content choice, `up`, drive, screenshots at the
     `resources/testing.md` sizes, `down`;
  4. show the person the screenshots and what changed, and ask what to change.

  Nothing is reviewed or approved.

- **Finish:**
  1. write `<workspace>/harness/.artifacts/prototypes/<idea>/summary.md`: the idea, what was
     tried, what worked, open questions, the branch and commit, and links to the run reports;
  2. print the brainstorm lines (4.4);
  3. say that the prototype is never shipped (`pr` refuses `proto/*`). A feature starts as
     `feat/<topic>` from upstream, after an approved design, with the prototype's diff ported.
- **Learned:** as in every command.

### 4.8 The six issues

**Issue 1: `up --dev-dir` launches a stale renderer bundle.** Fixed by 4.6.

**Issue 2: `ui_set_viewport` can't go below 1024 px wide** (blocked a responsive check).

- **Why users reach it.** Vortex's window has a 1024 px minimum, but users reach narrower CSS
  widths: Vortex's own UI zoom (150% on a 1024 px window is about 683 CSS px) and Windows display
  scaling both do it. Emulating the width tests what those users see.
- **How:** with the renderer's own zoom, the way those users get there.
  - When the requested width is below the window's minimum, `ui_set_viewport` (in the renderer,
    `uiAutomation.ts` `setViewport`) sets the window to its minimum size, then
    `webFrame.setZoomFactor(minimumWidth / requestedWidth)`.
  - The CSS viewport is then the requested width. The zoom persists with no CDP session, unlike
    `Emulation.setDeviceMetricsOverride`, which ends when its session detaches.
  - It returns `{ requested, actual, zoomFactor, cssWidth, emulated, reason? }`.
  - **The person's own zoom is kept.** When no narrow zoom is active, it reads `getZoomFactor()`
    and keeps it. A second narrow call doesn't overwrite the kept value.
  - **The factor** is computed from the measured width: `kept × innerWidth at the kept factor /
requestedWidth`. The spike's 1023 px at 1.6 gave 639, not 640.
  - Any later `ui_set_viewport` at or above the minimum, and `reset: true`, restore the kept
    factor, not 1.
  - **Screenshots** at that zoom show the narrow layout, at a higher `devicePixelRatio`: the
    spike measured 2 to 3.2. `getViewport` reports both.
- **Callers:** `responsive` uses it for narrow widths. `responsiveSweep`'s `finally` restores the
  zoom as well as the window size.
- **Spike on released 2.8.0 (2026-11-11):**
  - `require('electron').webFrame.setZoomFactor` is reachable from the renderer;
  - at factor 1.6, `innerWidth` went from 1023 to 639, and restoring the factor gave 1023 again;
  - if a later Vortex hides `webFrame`, `ui_set_viewport` returns `emulated: false` with the
    reason, and the narrow width is reported "not tested".
- **Window-size matrix for the proof:** 640x720, 800x720, then 1280x720 to restore. Widths are
  asserted within 2 px, since fractional scaling rounds.

**Issue 3: `install` with an unquoted path containing spaces.** PR #3 (`e9b7e70`, `9f7fed5`,
already in this branch).

**Issue 4: snapshot refs go stale while an install dialog is open.**

- **How refs work today.** Each snapshot starts a new ref generation and clears the table
  (`uiAutomation.ts`: `beginRefGeneration`). `install`'s dialog watchers snapshot concurrently,
  so a ref the agent holds dies. Elements that left the DOM are already refused (`!isConnected`).
- **Reusing a ref per element is unsafe:** virtualised rows are recycled in place.
- **The fix:**
  - a `WeakMap<Element, { ref, role, name }>` kept across generations;
  - resolving a ref checks that the element is connected **and** that its role and accessible
    name still match the fingerprint taken when the ref was issued;
  - a mismatch is refused with "The element for ref <r> now shows something else; take a new
    snapshot";
  - ref strings are still never reused.
- **The contract changes,** in `harness/AGENTS.md` ("Refs expire on the next snapshot"), the
  `ui_snapshot` tool description in `mcp-tools.md`, and `KNOWLEDGE.md` where it mentions refs:
  a ref now stays valid while its element is connected and unchanged.

**Issue 5: `gap list --json` shows nothing at the top level.**

- **Reproduced on the base:** the values sit under `.fields`.
- **Fix:** `gap list --json`, `knowledge list --json` and `knowledge search --json` flatten the
  fields into each entry and drop `fields` (no backward compatibility, per the repository rules).
  - Gaps: `command`, `needed`, `happened`, `workaround`, `blocked`, `kit`, `seen`, `count`,
    `status`, `issue`.
  - Lessons: `area`, `symptom`, `cause`, `remedy`, `scope`, `evidence`, `vortex`, `seen`,
    `notes`, `issue`.
- **Proof:** a test asserts the field values.

**Issue 6: `share` creates issues, but issues are disabled.**

- **Fix:** `knowledge share` and `gap share` check `gh repo view doodlum/vortex-doodlebot --json
hasIssuesEnabled` first, before any search or create.
- **When issues are off:** they print the Markdown and "Issues are disabled on
  doodlum/vortex-doodlebot; the owner can enable them, or share this text another way", create
  nothing, and exit 2.
- **Prerequisite:** `gh` installed and authenticated, and the network.

Each kit gap is closed with `doodlebot gap close <id> --by <commit>` once its fix lands.

## 5. Alternatives considered

- **Keep `.vortex-src` beside the new model.** Rejected: the owner's goal is "vortex/worktree
  only", and two ways to the same build is what made PRs invisible.
- **`CLAUDE.local.md`** for the EGM folder. Rejected (4.4).
- **Design commits on the feature branch, with a cherry-picked `pr/<topic>`.** Rejected: the
  PR's head would be a branch the session never checked out.
- **File times for staleness.** Rejected (4.6).
- **Stable refs without a fingerprint.** Rejected: recycled rows (4.8).
- **Close the narrow-viewport gap as wontfix.** Rejected: zoom and display scaling reach those
  widths.

## 6. Implementation plan and file boundary

Each step updates its own tests, manuals and site pages and runs `pnpm run docs:generate`, so
`pnpm run ci` passes after every step. The `.vortex-src` ban is added last.

1. **Checkout resolution** (4.1):
   - `harness/src/config.ts` (`resolveTarget`) and `cli.ts` (every `.vortex-src` /
     `vortexSourceDir` use: the help text, `source`, `build`, `pr-preflight`, `up`);
   - `cliArgs.ts` (`clone` in `PATH_FLAGS`, `stale-ok` and `add-upstream` in `BOOLEAN_FLAGS`);
   - `source.ts`, `doctor.ts`, `inventory.ts`, `checkCommand.ts`, `qaCatalog.ts`, `ownVortex.ts`;
   - `evidence.ts` (pass `--dev-dir`, not the variable) and `evidence.test.ts`, the measure skill;
   - tests: `config.test.ts`, `configRelativeDevDir.test.ts`, `source.test.ts`,
     `ownVortex.test.ts`, `inventory.test.ts`, `checkCommand.test.ts`, `qaCatalog.test.ts`.
2. **`source` prepares a checkout** (4.2, 4.3): `source.ts`, its test, the source skill.
3. **Build record and stale refusal** (4.6): `vortexBuild.ts`, `productionMode.ts`,
   `evidence.ts` (shared identity), `bootstrap.ts`, `instance.ts`, and their tests.
4. **EGM resource** (4.4): `plugins/doodlebot/resources/egm.md`, the `AGENTS.md` pointer,
   `egmResources.test.ts`.
5. **Designs and PRs** (4.5):
   - `prPush.ts` (remove `pr-branch` and the cherry-pick, keep the temp worktree, add
     `design-branch`), `prPreflight.ts`, `commands.ts`, `cli.ts`;
   - tests: `prPush.test.ts`, `prPreflight.test.ts`;
   - the pr and fix skills.
6. **`/doodlebot:prototype`** (4.7):
   - `plugins/doodlebot/skills/prototype/SKILL.md`;
   - `plugins.test.ts` (9 commands), `scripts/docs.cjs` `COMMAND_GROUPS`, both manifests and
     the marketplaces.
7. **Issues 2, 4, 5, 6** (4.8):
   - `src/uiAutomation.ts` `setViewport` (renderer zoom) and `responsive.ts`;
   - `src/uiAutomation.ts` and `src/uiAutomation.test.ts`, `src/mcpServer.ts` (the tool
     description);
   - `entryStore.ts`, `gapCommand.ts`, `knowledgeCommand.ts` and their tests;
   - a FOMOD fixture generator, `doodlebot fixture fomod --out <zip>` (a `fomod/ModuleConfig.xml`
     with one step, so `install` opens its dialog), in `fixtureCommand.ts` with its test;
   - `share.ts`, `share.test.ts`.
8. **Every remaining `.vortex-src` mention:**
   - the skills try, setup, qa, pr, investigate and fix;
   - `harness/AGENTS.md`, `harness/TESTING.md`, `harness/PULL-REQUESTS.md`,
     `harness/reference/cli.md`, `ARCHITECTURE.md`, `KNOWLEDGE.md`;
   - `docs/troubleshooting.md`, `docs/reference/configuration.md`,
     `docs/concepts/how-it-works.md`, `docs/concepts/one-test-vortex.md`,
     `docs/guides/{benchmark,fix-a-bug,design-a-feature,pull-requests,source-development,use-cases}.md`;
   - `docs/get-started/{install,set-up}.md`;
   - `scripts/documentation-map.json`.

   Then the ban in `plugins.test.ts` and `companion.test.ts`, which exempts `designs/*.md`,
   `.gitignore`, and the `check`/`clean` code that recognises the old clone.

**QA catalogue:** no entry guards doodlebot's own files. The catalogue guards Vortex source, and
this change doesn't touch Vortex.

## 7. Acceptance criteria

| Id                              | Criterion                                                                                                                          | Proof                                                                                                                                                                                                                                    | Negative control                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `checkout-from-cwd`             | Run from a Vortex checkout or a worktree of it, commands use it                                                                    | Unit test with a temp repo and `git worktree add`; live: `doodlebot check` and `up` from a worktree of the owner's Vortex clone                                                                                                          | From a non-Vortex folder, `build` refuses with the advice                                                 |
| `dev-dir-env-ignored`           | A leftover `VORTEX_AI_DEV_DIR` doesn't redirect a session in a checkout; `evidence run --runtime` still reaches its source runtime | Unit tests, including an evidence-runtime child                                                                                                                                                                                          | With `--dev-dir`, the named checkout is used                                                              |
| `git-status-clean`              | After `source` and `build`, the checkout's `git status --porcelain` is empty                                                       | Live in a worktree                                                                                                                                                                                                                       | A raw `pnpm run build` in the same worktree, observed once: `git status` shows the rewritten `etc/` files |
| `upstream-refused-if-elsewhere` | `source` refuses when `upstream` isn't Nexus-Mods/Vortex, and changes nothing                                                      | Unit test                                                                                                                                                                                                                                | A correct `upstream` passes                                                                               |
| `exclude-shared`                | After `source`, files under `.doodlebot/` stay out of `git add -A` in every worktree of the checkout                               | Unit test: two worktrees, `git add -A`, `git diff --cached --name-only` has no `.doodlebot/`                                                                                                                                             | Without the exclude, they are staged                                                                      |
| `stale-build-refused`           | `up` refuses a build whose record doesn't match the checkout, naming a changed file                                                | Unit tests: an edit after the build; a `git switch` (times rewritten, identity changed); `--stale-ok`. Live: build, edit a tracked file, `up` refuses, build, `up` succeeds                                                              | A matching record launches; no record warns                                                               |
| `pr-from-session-branch`        | `pr` pushes the session's branch and opens the PR from it; refuses `proto/*` and a `docs/designs/` file in the diff                | Unit tests with injected git and gh. Live (needs the owner's go-ahead to open a draft PR in doodlum/Vortex): reported "not tested" until run                                                                                             | A clean feature branch passes                                                                             |
| `design-branch`                 | `design-branch` commits the draft on `designs/<topic>` without switching the session's checkout, and prints the SHA link           | Unit test with a temp repo and worktree                                                                                                                                                                                                  | The session's branch and status are unchanged                                                             |
| `prototype-clean-tree`          | `prototype` refuses a dirty tree and a branch other than a new `proto/*` or the upstream default                                   | Skill text test plus the CLI's `source --branch` refusal test                                                                                                                                                                            | A clean fresh worktree proceeds                                                                           |
| `prototype-loop`                | `prototype` builds, runs and ends with a summary and the brainstorm lines                                                          | Live round on the 2.8 source in a worktree: idea "show the mod count in the Mods toolbar"; screenshot; summary written                                                                                                                   | —                                                                                                         |
| `viewport-narrow`               | `ui_set_viewport` 640x720 gives a renderer `innerWidth` of 640 (zoom), and a normal size restores zoom 1                           | Live on 2.8.0, sandbox, matrix 640x720, 800x720, then 1280x720 to restore: `innerWidth` read with `eval` after each                                                                                                                      | The base kit (`a4fcfa5`) on the same build: 640 leaves `innerWidth` at about 1023                         |
| `refs-stable`                   | A held ref survives a concurrent snapshot while its element is unchanged; a recycled element is refused                            | jsdom tests: two generations; a row whose name changes. Live on 2.8.0: `install` of a `doodlebot fixture fomod` archive in the background (its dialog stays open), snapshot, a second snapshot, click the held ref, check the DOM target | The base kit (`a4fcfa5`) on the same 2.8.0 build gives "Stale or unknown ref"                             |
| `gap-json`                      | `gap list --json` has each field at the top level                                                                                  | Unit test asserting `command` and `status` values                                                                                                                                                                                        | The base shows them only under `fields`                                                                   |
| `share-issues-disabled`         | With issues disabled, `share` creates nothing, prints the text and the reason, and exits 2                                         | Unit test with injected gh; live `gh repo view --json hasIssuesEnabled` (false today)                                                                                                                                                    | With issues enabled, it proceeds as today                                                                 |
| `no-vortex-src`                 | No code, skill or doc outside the exemptions names `.vortex-src` or `VORTEX_AI_SOURCE_DIR`                                         | The ban test                                                                                                                                                                                                                             | A planted mention fails the test                                                                          |

**Live gate prerequisites:**

- a Vortex checkout of the owner's fork, with a new worktree for the live checks;
- about 10 GB free and some minutes for install and build;
- the owner's own Vortex closed;
- the owner's goal of 2026-11-11 is the authorization to add a worktree to their Vortex clone for
  the live checks. The worktree is removed afterwards.
- `gh` authenticated for the `share` check.

**Gates:** `pnpm run ci`; `doodlebot test core --release 2.8.0`; the live rows above.

## 8. Open questions

1. **Live, needs the owner:** does the desktop app bind a draft PR opened from a worktree
   session into doodlum/Vortex? And one into Nexus-Mods/Vortex? Until it's run, the report says
   "not tested".

## 9. Review

Iteration 1 (2026-11-11), each reviewer "agree with changes":

- **EGM Zoom Out:** precedence of `VORTEX_AI_DEV_DIR`; staleness by file times; committing the
  design without switching; stable refs specified at the wrong level; the viewport's need.
- **EGM Implementation Readiness:** the full file list; CI green per step; the `.gitignore` entry
  and existing `design/*` tags; the `resolveTarget` signature and the flag lists; the facts
  behind issues 2, 4, 5 and 6.
- **Vortex runtime:** live proofs for refs and the viewport; `git status` clean after `source`;
  authorization for remotes and the exclude; prototype safety; contracts; prerequisites.

All are addressed above.
