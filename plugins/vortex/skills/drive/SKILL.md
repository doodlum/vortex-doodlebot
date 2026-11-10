---
name: drive
description: "Vortex: Drive the test Vortex through its UI (look, click, type, install, deploy, screenshot) and, for a scenario, return a run report; use to check a Vortex flow, reproduce a UI bug or demo a change."
argument-hint: "<what to do in Vortex, e.g. install this mod, deploy, and report anything odd>"
---

# Drive Vortex

You control the isolated test Vortex through the `doodlebot` CLI, which exposes every MCP
tool of doodlebot's Vortex extension. You never touch the person's own Vortex.

## Before you begin

1. Run `doodlebot version --json`. It prints `{version, commit, dirty, workspace}`.
   - If `doodlebot` is not found, stop and tell the person: "doodlebot is not set up on
     this machine yet. Run `/doodlebot:setup` first."
   - `<workspace>` below is its `workspace`.
2. Compare its `version` with this plugin's version, `version` in
   `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
   `<plugin root>/.codex-plugin/plugin.json` (Codex; three folders above this `SKILL.md`).
   If they differ, say so and suggest `/doodlebot:update`, then continue.
3. `<shim>` is the absolute path of the `doodlebot` command: on Windows the first line
   ending in `.cmd` that `where.exe doodlebot` prints (never PowerShell's `where`, which is
   `Where-Object`); elsewhere `command -v doodlebot`.
4. For anything beyond a simple look, search `<workspace>/KNOWLEDGE.md` for the area and
   check what you find against what you observe. `<workspace>/harness/AGENTS.md` is the full
   manual.

## Act directly, or delegate and report

- **A short interactive task** ("what's on the Mods page?", "click Deploy"): do it yourself
  with the loop below and answer in chat.
- **A scenario, or when the person asks for a report** ("install this mod, deploy, and
  report anything odd"): run the report procedure below.
  - **Claude Code:** delegate it to the subagent `vortex:vortex-driver` (a low-cost model).
    Give it a complete brief: the scenario in the person's words, the target and game flags,
    whether to reuse a running instance (the rule below), `<workspace>`, `<shim>`, the run
    folder, and what counts as done. Wait for it, then check its report exists and read it.
  - **Codex** (plugins ship no agents): run the same procedure inline yourself.

Answer a dialog only when the scenario needs it, and record every one you answer.

## Get an instance

1. Run `doodlebot status` with the scenario's target and game flags.
2. If it reports MCP `answering`, run `doodlebot call automation_status`. **Reuse** the
   instance only when its `userDataDir` lies under the configured cache
   (`VORTEX_AI_CACHE_DIR`, or `<workspace>/harness/.cache` by default); never restart it
   then. Otherwise it belongs to another cache: tell the person and stop.
3. If nothing is answering, start one in the background (see "Commands that block"):
   `doodlebot up --installed --sandbox` unless the scenario needs another target or game
   (`/doodlebot:start` lists the flags). The sandbox game needs no account and deploys into
   a disposable folder.
4. `doodlebot tools --json` lists every live tool and its input schema when you need one.
5. When you started the instance yourself and the task is done, run `doodlebot down`.
   Leave an instance you reused running.

## The loop

1. `doodlebot snapshot` shows what is on screen, with a `ref` per element
   (`--selector <css>` scopes it).
2. Act on a ref: `doodlebot click --ref <ref>`, `doodlebot fill --ref <ref> --value <text>`,
   `doodlebot press --key Escape`, or a tool with `doodlebot call <tool> --args-file <file>`
   (a JSON file avoids shell quoting).
3. Wait for the result (`doodlebot call ui_wait_for --args-file <file>`; check `matched`).
4. Snapshot again.

**Refs die on the next snapshot.** Vortex's tables are virtualized and recycle rows, so a
reused ref can act on the wrong mod. After anything that re-renders, snapshot again.

## Rules that save time

- **Check dialogs first** when a click seems to do nothing: `doodlebot call ui_active_dialogs`.
  A modal is the most common blocker; `doodlebot press --key Escape` usually closes it.
- **Filter, don't scroll.** Virtualized rows are absent until the list is narrowed; use the
  search box.
- **Hover cannot trigger CSS `:hover`.** For controls hidden until hover (game tiles), click
  with `requireActionable: false` through `doodlebot call ui_click`.
- **Keys never reach an OS dialog.** Native file pickers and menus are out of reach: install
  archives with `doodlebot install <archive>` and use `vortex_dispatch` for actions.
- **No archive given?** Make one: `doodlebot fixture mod --out <run folder>/probe.zip` writes
  a mod with one file, `textures/automation-probe.txt`; in the sandbox it deploys to
  `<gamePath>/Data/textures/`. Install it with `doodlebot install <run folder>/probe.zip`.
- **Deploy** with `doodlebot deploy` and the instance's target and game flags (for the
  sandbox, `doodlebot deploy --installed --sandbox`); it refuses while an install is running.
- **Installing a Nexus collection** needs `/doodlebot:login` first. Run
  `doodlebot collection <url>` in the background (see "Commands that block") and poll
  `doodlebot call collection_install_state` until it finishes.
- **Find dialogs by their own text.** A full snapshot of a big Mods page stops at its node
  limit before a modal, and dialog text is cut at 400 characters with buttons run together
  ("LaterInstall Now"). Scope the snapshot to the dialog (`--selector`) to get button refs.
- **State and screen can disagree.** `doodlebot call vortex_query` says what Vortex
  believes; the snapshot says what it shows. A pending render or an active filter explains
  most differences.
- **Collections: ask where the install is.** `doodlebot call collection_install_state`
  gives the install driver's step, the session's members and open collection dialogs. Poll
  it rather than guessing from dialogs. Real collections need `/doodlebot:login`.
- **Diagnostics in the renderer:** `doodlebot eval --expr "<js>"` works in the test Vortex
  only. It is for looking; never rely on it for a result.
- **Scripts:** a repeatable multi-step action belongs in one `doodlebot script <file.mts>`
  that imports the kit through `VORTEX_AI_KIT` (see `<workspace>/harness/AGENTS.md`), for
  example to click inside a dialog with `clickInsideDialog` from
  `<workspace>/harness/src/uiDriver.ts`.
- **PowerShell:** quote comma lists (`--viewports "1024x720,1280x720"`).
- **One driver per renderer.** Do not drive the instance from two sessions at once.

## Commands that block

`doodlebot up`, `setup`, `test` and `install` can outlive your tool's timeout or wait on a
dialog. On Windows, a Vortex launched from a command whose output is captured can keep that
capture open, so the command never returns. So:

1. Run them in the background with output to a log in `<workspace>/harness/.artifacts/runs/`
   (create it first):

   ```powershell
   $log = "<workspace>/harness/.artifacts/runs/<UTC time>-<command>.log"
   $p = Start-Process -FilePath <shim> -ArgumentList <args> -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru
   ```

   ```bash
   nohup <shim> <args> > <workspace>/harness/.artifacts/runs/<UTC time>-<command>.log 2>&1 &
   ```

2. Note the pid (print `$p.Id` in the same call, or `echo $!` in Bash; the shell does not
   keep `$p` between calls) and check every 10 seconds whether it still runs
   (`Get-Process -Id <pid>`, `kill -0 <pid>`). A command is done when its process has exited
   and its log has its success line: `Vortex is up in` for `up`; for `setup`, `Ready:` (or,
   with `--oauth`, the line ending `Setup complete.`, or with `--no-wait` also
   `Initial setup: click Log in`). A cold
   start launches Vortex up to three times on the same port, so `doodlebot status` answering
   is only a liveness hint, never completion. Read the log, and the exit code when you can.
3. For a command that may raise a dialog (for example installing an archive that is already
   installed), poll `doodlebot call ui_active_dialogs` every few seconds while it runs.
   When a dialog appears:
   1. read its text;
   2. take `doodlebot snapshot` (scoped to the dialog) to get the button's ref;
   3. answer with `doodlebot click --ref <ref>`, choosing the button the scenario needs.

   While `install` runs, its own dialog and FOMOD watchers take snapshots, and each one
   makes your refs stale (`Stale or unknown ref`). Take the scoped snapshot and click in
   the same shell call, and on a stale ref simply snapshot and click again.

   `install` gives up after 300 seconds, so answer before then. When you answer with
   **Cancel**, `install` exits 1 with `McpError: canceled by user`: that is the expected
   end of a cancelled install, not a failure of the scenario. Record the exit and check the
   mods with `vortex_query`.

4. Login is `/doodlebot:login`; never type credentials.

## The report procedure

1. **Run folder.** Create `<workspace>/harness/.artifacts/runs/<UTC time>-<slug>/`
   (`<UTC time>` like `20261110T142233Z`, `<slug>` a few words of the scenario). The report
   is `report.md` in it.
2. **Start.** Get an instance (above). Record the start time (ISO), the `target:` line if
   you started it, and from `doodlebot call automation_status` the `vortexVersion`,
   `nodeEnv`, `userDataDir` and renderer lifetime ID.
3. **Carry out the scenario** with the loop, one step at a time, noting each action and what
   you observed. Answer a dialog only when the scenario needs it; note its title, the
   button and why. Take `doodlebot screenshot --label <step>` at the important moments and
   copy each screenshot it reports from the artifacts folder into the run folder.
4. **Check the result independently** of the tool that acted: state through
   `doodlebot call vortex_query`, files on disk (for the sandbox, deployed files under its
   game folder's `Data`), the UI through a snapshot.
5. **Read errors last, before writing:**
   - the renderer console from sequence 0: `doodlebot call ui_read_console` with
     `{"since": 0}` in an args file (keep the errors and warnings);
   - Vortex's log: `doodlebot log --level warn --since <start time>`;
   - notifications: `doodlebot call vortex_query` with
     `{"path": ["session", "notifications", "notifications"]}`.
6. **Write the report** with the template below, then summarize it in chat in a few lines
   with its path.
7. **Stop** with `doodlebot down` only if you started the instance.

Outcomes: **Worked** (everything the scenario asked happened, nothing logged errors),
**Worked with errors** (it happened, but errors or warnings appeared), **Blocked** (a
prerequisite was missing: login, game, network, a person), **Failed** (Vortex did not do
what the scenario asked).

### Run report template

```markdown
# Run report: <scenario in a few words>

## Outcome

Worked | Worked with errors | Blocked | Failed: <one sentence>.

## Scenario and target

- Scenario: <the person's words>
- Target: <installed or dev>, <executable or checkout>, Vortex <vortexVersion> (<nodeEnv>)
- Game: <sandbox, Bethesda sandbox or game id and folder>; cache <cache folder>
- Instance: started for this run | reused (userDataDir <path>)
- Time: <start> to <end> (UTC)

## Steps

1. <action> → <what you observed>

## Dialogs and prompts answered

| Title | Button | Why |
| ----- | ------ | --- |

(or "None".)

## Errors and warnings

- Console: <errors and warnings from ui_read_console, or "none">
- Vortex log: <doodlebot log --level warn entries, or "none">
- Notifications: <title and message of each, or "none">

## Evidence

- <path of each screenshot copied into the run folder, logs, query output>

## Not checked

- <what the scenario implied but you did not verify, and why>
```

## Don't destroy the person's setup

The harness answers Vortex's "Purge files from different instance?" with **Cancel**; leave
it that way. Deploy only into disposable game folders: the sandbox, or a copy of a real game
the person made for testing. A copied game does not isolate writes to Documents or
LocalAppData.

## When it goes wrong

Read the error: they are written to be actionable.

| Symptom                       | Cause and fix                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| No `ui_*` write tools         | Vortex started without the MCP token; restart it with `doodlebot up`                              |
| HTTP 403                      | The client's token differs from the launch token; restart with `doodlebot up`                     |
| "did not become ready"        | The renderer never loaded extensions; read `vortex.log` under `automation_status`'s `userDataDir` |
| A snapshot looks empty        | See `<workspace>/KNOWLEDGE.md`, "Three ways a snapshot can silently go blank"                     |
| The game never activates      | A modal is blocking; the error names it                                                           |
| "A harness Vortex is running" | Another test Vortex runs; `/doodlebot:stop` it first                                              |
