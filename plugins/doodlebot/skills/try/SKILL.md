---
name: try
description: "Doodlebot: Try something in a test Vortex (look, click, install, deploy, a collection) on a release, the installed Vortex or a source build, choosing the content itself, and return a run report; use for 'does X work?' or to see a change working."
argument-hint: "<what to do in Vortex> [on <release version | installed | my build>] [with <content>] [fresh]"
---

# Try it in Vortex

You start an isolated test Vortex, carry out the scenario through the `doodlebot` CLI (which
exposes every MCP tool of doodlebot's Vortex extension), stop it, and write a run report. You
never touch the person's own Vortex. Other commands (`investigate`, `fix`, `qa`) use this
skill's sections "Choose the build and content", "Start and stop", "The loop", "Rules that
save time", "Commands that block" and "The report procedure".

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:setup --update`, then continue.
3. `<shim>` is the absolute path of the `doodlebot` command: on Windows the first line
   ending in `.cmd` that `where.exe doodlebot` prints (never PowerShell's `where`, which is
   `Where-Object`); elsewhere `command -v doodlebot`.
4. Search what doodlebot knows: `doodlebot knowledge search <area words>` (both
   `<workspace>/KNOWLEDGE.md` and this machine's lessons). Treat every match as a lead to
   recheck, as `${CLAUDE_PLUGIN_ROOT}/resources/knowledge.md` says, and note in the report
   which you used and whether it held. `<workspace>/harness/AGENTS.md` is the full manual.

## Act directly, or delegate

- **A short look** ("what's on the Mods page?"): do it yourself with the loop below on a
  running test Vortex of this session, and answer in chat.
- **A scenario, or a report:** run "The report procedure".
  - **Claude Code:** delegate it to the subagent `doodlebot:vortex-driver` (Sonnet). Give it a
    complete brief: the scenario in the person's words, the build and game flags and why they
    were chosen (below), `<workspace>`, `<shim>`, the run folder, whether it starts and stops
    the instance, and what counts as done. Wait for it, check its report exists, and read it.
    **Record the kit gaps it proposes:** the driver cannot. For each proposed gap in its
    Learned section, `doodlebot gap list --json` (reuse a matching title), then
    `doodlebot gap add --title <t> --command <c> --needed <x> --happened <x> --workaround <x> --blocked yes|no --json`,
    and write each returned id into the report's Learned section under "Kit gaps".
  - **Codex** (plugins ship no agents): run the procedure inline yourself.

## Choose the build and content

**The build.** What the person named; otherwise the installed Vortex, or the newest registered
release when none is installed.

| The person says           | Flags                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| a release, "2.8.0"        | `--release 2.8.0` (first `doodlebot release get 2.8.0` if missing) |
| the installed Vortex      | `--installed`                                                      |
| an executable             | `--exe <path to Vortex.exe>`                                       |
| my build, the source      | `--dev-dir <workspace>/.vortex-src` (or their checkout)            |
| as users see it (timings) | add `--production` to a source build built with `--production`     |

`doodlebot release get <version>` downloads only official releases, checks the published
SHA-256 and never runs the installer. A release without a published digest is **blocked**.

**The content** (design 4.5). Write down what the scenario **needs**, as kinds: `sandbox` (the
fake game), `sandbox:fallout4` (the fake Fallout 4: plugins, LOOT, masters), `game` (any game
the kit may manage), `game:<id>` (a registered copy of that game), `collection`,
`collection:offline`, `collection:nexus`, `login`. Then let doodlebot choose; **read its
choice, do not re-derive it**:

- a QA catalogue entry: its `content` in `doodlebot qa list --json`;
- any other scenario: `doodlebot inventory --need <need> [--need <need>...] --json`.

Both print `{met, chosen: [{need, id, label, flag, why}], unmet: [{need, next, reason}]}`. The
choice is the cheapest ready item per need: a sandbox before a registered game copy (the
smallest copy first), an offline collection before a Nexus one. Run with each `chosen[].flag`
(`--sandbox`, `--bethesda-sandbox`, `--game <id> --game-path <copy>`) and put each `why` in
the report's "Tested against" line. An `unmet` need makes that part **not tested**, with its
`next` command; never substitute something else silently, and never use a store install
(`store:<id>` is never usable). A named override from the person ("use my Skyrim copy") wins
over the choice, recorded as their choice.

## Start and stop

Only one test Vortex runs on the machine. It uses its own profile.

1. `doodlebot status` with the chosen flags.
2. If MCP is `answering`, run `doodlebot call automation_status`. **Reuse** it only when its
   `userDataDir` lies under this cache (`VORTEX_AI_CACHE_DIR`, by default
   `<workspace>/harness/.cache`) and it is the build you chose. Otherwise it belongs to another
   session or build: never run `doodlebot down` on an instance another session started from
   another checkout. Wait, or tell the person, and stop.
3. Otherwise start it **in the background** ("Commands that block"):
   `doodlebot up <build flags> <game flags>`, adding `--fresh` when the person asked for a
   clean profile or the run must not inherit earlier state, and `--rebuild-snapshot` when they
   asked to refresh the baseline. A launch refused with "A harness Vortex of another build is
   running from <checkout>" or "Your own Vortex is running" is reported as is: the kit never
   closes the person's Vortex, and neither do you.
4. Read the `up` log's `target:` line: it must be the build you chose.
5. **Stop** with `doodlebot down` when the run is done, if you started the instance. It prints
   which checkout it stops and restores a game copy's user folders. `Vortex exited cleanly.` or
   `Nothing is running.` is fine; an instance that did not exit is reported, never killed.

## The loop

1. `doodlebot snapshot` shows the screen with a `ref` per element (`--selector <css>` scopes it).
2. Act on a ref: `doodlebot click --ref <ref>`, `doodlebot fill --ref <ref> --value <text>`,
   `doodlebot press --key Escape`, or `doodlebot call <tool> --args-file <file>` (a JSON file
   avoids shell quoting). `doodlebot tools --json` lists every tool and its schema.
3. Wait for the result (`doodlebot call ui_wait_for --args-file <file>`; check `matched`).
4. Snapshot again. **Refs die on the next snapshot**: Vortex's tables recycle rows, so a reused
   ref can act on the wrong mod.

## Rules that save time

- **Check dialogs first** when a click seems to do nothing: `doodlebot call ui_active_dialogs`.
- **Filter, don't scroll.** Virtualized rows are absent until the list is narrowed.
- **Hover cannot trigger CSS `:hover`.** Click hidden controls with `requireActionable: false`
  through `doodlebot call ui_click`.
- **Keys never reach an OS dialog.** Install archives with `doodlebot install <archive>`.
- **No archive given?** `doodlebot fixture mod --out <run folder>/probe.zip` writes a one-file
  mod (`textures/automation-probe.txt`); in the sandbox it deploys to `<gamePath>/Data/textures/`.
- **Deploy** with `doodlebot deploy` and the instance's flags (sandbox:
  `doodlebot deploy --installed --sandbox`); it refuses while an install runs.
- **A Nexus collection** needs the `login` need. Run `doodlebot collection <url>` in the
  background and poll `doodlebot call collection_install_state` (the driver's step, the
  session's members, open collection dialogs).
- **Find dialogs by their own text**, with a snapshot scoped to the dialog: a full snapshot of
  a big Mods page stops at its node limit, and dialog text is cut at 400 characters.
- **State and screen can disagree.** `doodlebot call vortex_query` says what Vortex believes;
  the snapshot says what it shows.
- **Diagnostics:** `doodlebot eval --expr "<js>"` works in the test Vortex only, for looking;
  never rely on it for a result.
- **Scripts:** a repeatable multi-step action belongs in one `doodlebot script <file.mts>` that
  imports the kit through `VORTEX_AI_KIT` (see `<workspace>/harness/AGENTS.md`).
- **Log out only when the scenario says so.** Logging out of the default cache spends the
  person's one shared login. A scenario that logs out "ends the login": run it only after the
  person's go-ahead, and end its report with `/doodlebot:setup --login`.
- **Don't destroy the person's setup.** Deploy only into the sandbox or a registered copy; the
  harness answers "Purge files from different instance?" with Cancel.
- **One driver per renderer.** Do not drive the instance from two sessions at once.

## Commands that block

`doodlebot up`, `setup`, `test`, `install` and `collection` can outlive your tool's timeout or
wait on a dialog, and on Windows a captured `up` may never return. So:

1. Run them in the background with a log in `<workspace>/harness/.artifacts/runs/`:

   ```powershell
   $log = "<workspace>/harness/.artifacts/runs/<UTC time>-<command>.log"
   $p = Start-Process -FilePath <shim> -ArgumentList <args> -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru
   $p.Id
   ```

   In Bash: `nohup <shim> <args> > <log> 2>&1 & echo $!`.

2. Check every 10 seconds whether the pid still runs (`Get-Process -Id <pid>`,
   `kill -0 <pid>`). A command is done when its process has exited and its log has its success
   line: `Vortex is up in` for `up`. A cold start launches Vortex up to three times on the same
   port, so `doodlebot status` answering is only a liveness hint, never completion.
3. For a command that may raise a dialog, poll `doodlebot call ui_active_dialogs` while it
   runs. When one appears, read its text, take a scoped `doodlebot snapshot` and answer with
   `doodlebot click --ref <ref>` in the same shell call (an install's own watchers make refs
   stale; on `Stale or unknown ref`, snapshot and click again). `install` gives up after 300
   seconds; a **Cancel** answer ends it with exit 1 and `McpError: canceled by user`, which is
   the expected end of a cancelled install.

## The report procedure

1. **Run folder.** `<workspace>/harness/.artifacts/runs/<UTC time>-<slug>/` (`<UTC time>` like
   `20261110T142233Z`). The report is `report.md` in it.
2. **Choose** the build and content (above) and **start** the instance. Record the start time,
   the `target:` line, and from `doodlebot call automation_status` the `vortexVersion`,
   `nodeEnv`, `userDataDir` and renderer lifetime ID. A `vortexVersion` that differs from the
   requested release is reported as a mismatch.
3. **Carry out the scenario** with the loop, one step at a time, noting each action and what
   you observed. Answer a dialog only when the scenario needs it; note its title, the button
   and why. Take `doodlebot screenshot --label <step>` at the important moments and copy each
   into the run folder.
4. **Check the result independently** of the tool that acted: state through
   `doodlebot call vortex_query`, files on disk (sandbox: deployed files under its game
   folder's `Data`), the UI through a snapshot. A tool returning success is not an observation.
5. **Read errors last:**
   - the renderer console from sequence 0: `doodlebot call ui_read_console --args-file <file>`
     with `{"since":0,"levels":["error","warn"],"limit":500}` in the file. The console keeps only
     its newest 500 entries of every level, so the read is **truncated** when it returns 500
     entries or its `lastSeq` is above 500 (entries up to `lastSeq` minus 500 are lost). Say so
     under "Errors and warnings", with the `lastSeq`, and never write "none" for a truncated read;
   - Vortex's log (`doodlebot log --level warn --since <start time>`);
   - notifications (`doodlebot call vortex_query` with
     `{"path": ["session", "notifications", "notifications"]}`).
6. **Stop** with `doodlebot down` if you started the instance.
7. **Write the report** with the template below, then summarize it in chat with its path.

Outcomes: **Worked**; **Worked with errors** (errors or warnings appeared); **Passed with
workaround: <x>** (a step needed a workaround, named; one that bypasses the UI, such as
`vortex_dispatch` or `eval` instead of a click, says so); **Blocked** (a prerequisite was
missing: login, game, network, a person); **Not tested** (no content met a need); **Failed**
(Vortex did not do what the scenario asked). When a check passed but the scenario failed, the
outcome is Failed, and the check is a kit gap.

### Run report template

```markdown
# Run report: <scenario in a few words>

## Outcome

Worked | Worked with errors | Passed with workaround: <x> | Blocked | Not tested | Failed: <one sentence>.

## Tested against

- Build: <release 2.8.0 | installed | source <checkout> at <head>>, Vortex <vortexVersion> (<nodeEnv>)
- Content: <sandbox | copy of <game> at <path> | offline collection | ...>
- Why: <the need each item met, and why it was the cheapest; or "the person's choice">

## Scenario and target

- Scenario: <the person's words>
- Flags: <the up flags>; cache <cache folder>
- Instance: started for this run | reused (userDataDir <path>)
- Time: <start> to <end> (UTC)

## Steps

1. <action> → <what you observed>

## Dialogs and prompts answered

| Title | Button | Why |
| ----- | ------ | --- |

(or "None".)

## Errors and warnings

- Console: <errors and warnings from ui_read_console, or "none">; truncated: <no | yes, lastSeq N>
- Vortex log: <doodlebot log --level warn entries, or "none">
- Notifications: <title and message of each, or "none">

## Evidence

- <each screenshot copied into the run folder, logs, query output>

## Not checked

- <what the scenario implied but you did not verify, and why; each unmet need with its next command>

## Learned

- Lessons: <recorded with knowledge add, noted as not holding, or removed, with ids>
- Kit gaps: <recorded with gap add, with ids and the outcome they changed>
- Catalogue entries proposed: <area, guards, run, pass>
- (or "nothing")
```

The Learned section follows `${CLAUDE_PLUGIN_ROOT}/resources/knowledge.md`: a lesson only with a
confirmed cause (`doodlebot knowledge add ... --vortex <version>`), a kit gap for anything the
kit should have done and didn't (`doodlebot gap list --json`, then `doodlebot gap add`). Never
patch the doodlebot workspace in the middle of the task; offer "fix this gap in doodlebot"
afterwards.

## When it goes wrong

| Symptom                              | Cause and fix                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| No `ui_*` write tools                | Vortex started without the MCP token; restart it with `doodlebot up`                              |
| HTTP 403                             | The client's token differs from the launch token; restart with `doodlebot up`                     |
| "did not become ready"               | The renderer never loaded extensions; read `vortex.log` under `automation_status`'s `userDataDir` |
| A snapshot looks empty               | See `<workspace>/KNOWLEDGE.md`, "Three ways a snapshot can silently go blank"                     |
| "A harness Vortex is running"        | Another test Vortex runs; stop it only if this session started it                                 |
| "A pending restore" refuses a launch | Run `/doodlebot:setup --check`; it names `doodlebot game restore <gameId>`                        |
