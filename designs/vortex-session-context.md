# A Vortex session knows doodlebot can prove the change

- **Author:** Claude (Opus 5.5), for doodlum
- **Status:** Draft, iteration 1 (2026-11-11). Not reviewed, not approved.
- **Target:** doodlebot
- **Builds on:** `designs/vortex-checkout.md` (sessions run in a Vortex checkout or worktree).
- **Evidence:** the hook spike of 2026-11-11 (below), and the proposal and its three reviews in
  `harness/.artifacts/egm/chat-context-proposal.md`.

## 1. Overview

A person can already brainstorm an idea and implement it in a Vortex session, with or without
EGM. What is missing is the last step: **proving the idea works on a real Vortex**, beyond a
design that reads well and code that compiles. Doodlebot can do that (`/doodlebot:try`,
`/doodlebot:qa --design`, `/doodlebot:qa <branch>`), but a session knows it only from skill
descriptions. A session that never mentions doodlebot finishes with "implemented, unit tests
pass", and nobody runs the change.

After this change, the doodlebot plugin carries one `SessionStart` hook. In a Vortex checkout or
worktree it gives the session a short note, before the first prompt:

- this is a Vortex checkout, and doodlebot is set up at `<workspace>`;
- a Vortex change is not done until doodlebot has shown it working on a real Vortex, with the
  command for each case;
- acceptance criteria, in a design or a plan, are written as things doodlebot can observe, with
  the references that say what it can observe.

Outside a Vortex checkout the hook prints nothing. It writes nothing anywhere.

## 2. Use cases

| #   | Ask                                         | Today                                              | After                                                                                                                   |
| --- | ------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| U14 | "Implement this" in a Vortex session        | Code, unit tests, "done"                           | Code, unit tests, then the session offers `/doodlebot:try` to see it, or runs it when the person asked for verification |
| U15 | `/egm:egm-brainstorm <idea>`, typed cold    | Criteria written with no idea what can be observed | Criteria written as observations doodlebot can make, using `cli.md` and `mcp-tools.md`                                  |
| U16 | "Is this branch good?" after implementation | The session reviews the diff                       | The session points at `/doodlebot:qa <branch>` (base build, then branch build, fresh profile)                           |
| U17 | Any session in a non-Vortex folder          | Nothing                                            | Nothing: the hook stays silent                                                                                          |

## 3. Goals and non-goals

**Goals**

1. Installing or updating the plugin is the whole setup in Claude Code: no settings file is
   edited. Codex needs the person to trust the hook once per update; `setup --check` says so.
2. In a Vortex checkout or worktree, every new, resumed, cleared or compacted session gets the
   note; in any other folder, none.
3. The note costs well under 2,000 characters and under 300 ms.
4. Nothing reaches a Vortex commit: the hook reads, prints and exits.

**Non-goals**

- Making EGM run without its typed lines. The artifact line and the runtime-review line stay as
  `plugins/doodlebot/resources/egm.md` prints them.
- Context for subagents. No `SubagentStart` hook: EGM's Goldfish reviewers must see only what
  they are given (the spike showed `SubagentStart` context reaches every subagent).
- Forcing verification. The note tells the session; the person still decides what runs.
- A `doodlebot context` command, a per-step EGM hook, a fallback skill or a marker file (all
  dropped from the proposal after its review).

## 4. Design

### 4.1 The hook

`plugins/doodlebot/hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/session-note.cjs\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

No matcher, so it runs for `startup`, `resume`, `clear` and `compact`; a compacted session gets
the note back. The Codex manifest (`.codex-plugin/plugin.json`) names the same file if Codex
does not pick up `hooks/hooks.json` by default (verified at build time, 4.5).

### 4.2 `session-note.cjs`

Plain CommonJS with no dependencies, so it runs without the workspace's `node_modules`:

1. Read the hook input from stdin (strip a BOM) and take `cwd`. On a parse error, exit 0
   silently.
2. Walk up from `cwd` to the folder holding `.git` (a directory, or a worktree's `.git` file).
   Act only when that folder's `package.json` is named `@vortex/monorepo`, the same test as
   `vortexCheckoutOf`. Otherwise exit 0 with no output.
3. Read the workspace from `~/.doodlebot/workspace.json` (4.3). Missing or pointing at a
   folder that no longer exists: print one line, "This is a Vortex checkout; doodlebot is
   installed but not set up on this machine: run /doodlebot:setup", and exit 0.
4. Print the note (4.4) as
   `{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}` and exit 0.

It never spawns a process: `doodlebot version --json` took 5.2 s on this machine.

### 4.3 `~/.doodlebot/workspace.json`

`doodlebot link` (which `/doodlebot:setup` runs) writes `{"workspace": "<absolute root>"}`
beside the shims' target, the same root the shims run. `doodlebot version --json` keeps
reporting it as today. A second workspace that runs `link` takes over, as the shims already do.

### 4.4 The note

Fixed text with two values filled in, `<workspace>` and `<plugin>` (`CLAUDE_PLUGIN_ROOT`):

> This session is in a Vortex checkout, and the doodlebot companion is set up (workspace
> `<workspace>`). Doodlebot runs Vortex for real, in an isolated test instance, and proves
> changes on it.
>
> - A Vortex change is not finished when it compiles and its unit tests pass. Before saying it
>   works, offer to show it working: `/doodlebot:try` to see it in a test Vortex,
>   `/doodlebot:qa <branch>` to compare it with its base, `/doodlebot:qa --design <design>` to
>   check a design's acceptance criteria with negative controls.
> - Write acceptance criteria, in a design or a plan, as things that can be observed on a
>   running Vortex. What doodlebot can observe: `<workspace>/harness/reference/cli.md` and
>   `<workspace>/harness/reference/mcp-tools.md`. Known traps: `<workspace>/KNOWLEDGE.md`.
> - For a feature's EGM design, follow `<plugin>/resources/egm.md`.
> - Never start a test Vortex yourself outside these commands; the person's own Vortex must
>   keep running.

### 4.5 What changes elsewhere

- **`/doodlebot:setup --check`** (`doctor`): one line saying whether `workspace.json` names
  this workspace, and, when Codex is present, that the hook needs trusting after each update.
- **Docs:** `docs/` gets a short "What a Vortex session knows" section on the install page,
  including the restart after install or update, and the Codex trust step. `harness/AGENTS.md`
  names the hook under the plugin's components.
- **`egm.md`:** unchanged.

## 5. Acceptance criteria

1. **Silent outside Vortex.** Unit test: the script, given a `cwd` in a non-Vortex git repo and
   in a folder with no repo, prints nothing and exits 0.
2. **Note in a checkout and a worktree.** Unit test: given a temporary repo whose
   `package.json` is `@vortex/monorepo`, and a linked worktree of it, the script prints valid
   JSON whose `additionalContext` contains the workspace path and `/doodlebot:try`, under 2,000
   characters.
3. **Not set up.** Unit test: with no `workspace.json`, one line naming `/doodlebot:setup`.
4. **Fast.** Unit test: the script finishes in under 300 ms on the checkout case.
5. **`link` writes the record.** Unit test in `linkCommand.test.ts`.
6. **Installed as a plugin, live.** After `/plugin marketplace update doodlebot` and a restart
   of Claude desktop, a new session in a Vortex checkout and a new desktop worktree session of
   it each quote the note when asked; a session in this repository does not. The subagent of
   one of them does not see it.
7. **The point of it, live.** In a fresh Vortex worktree session, "add a tooltip to the mods
   toolbar's Deploy button" (no mention of doodlebot) ends with the session offering
   `/doodlebot:try` or `/doodlebot:qa` before calling the change finished.
8. **Nothing written.** After 6 and 7, `git status --porcelain` in the checkout and the worktree
   shows only the session's own code change.
9. **Codex.** With doodlebot installed in Codex and the hook trusted, a new session in a Vortex
   checkout quotes the note. If it is not installed, the report says "not tested" and why.

## 6. Spike evidence (2026-11-11)

A throwaway `hooks/hooks.json` in the installed plugin, on Claude desktop:

- Before restarting the app: nothing ran. The app reads plugin hooks at start.
- After restarting: `SessionStart` ran on `startup`, `resume` and `compact`, with `cwd` the
  session's folder and `CLAUDE_PLUGIN_ROOT` set; its `additionalContext` reached the session.
  `SubagentStart` ran for a general-purpose subagent and its context reached that subagent.
- A `cmd /c echo` hook wrote nothing, so the hook command is not run by `cmd`; `node` was on the
  PATH.
- Not covered: a desktop worktree session, delivery through a real plugin update, Codex.

## 7. Risks

- **The note is ignored.** It is context, not a rule; criterion 7 checks it changes behaviour.
  If it does not, the stronger lever is `/doodlebot:try` being offered in the skills' own
  descriptions, not a louder note.
- **Codex trust.** Every update that changes the script asks again; keeping the script stable
  keeps this rare.
- **Stale workspace record.** A deleted workspace gives the "not set up" line, which is the
  right step.
