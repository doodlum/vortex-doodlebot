---
name: setup
description: "Doodlebot: Install, repair, check, sign in or update doodlebot on this machine (modes: setup, --check, --login, --update [<ref>]); use once per machine, to see what this machine can test, or when another command says doodlebot is not set up."
argument-hint: "[--check | --login [--dev-dir <checkout>] | --update [<ref>]] [folder] [--ref <tag or branch>] [--bin-dir <folder>]"
disable-model-invocation: true
---

# Set up doodlebot

One command with four modes. Each ends with the status table from `--check`, and nothing
launches Vortex or signs in unless that mode says so.

| Mode                     | Does                                                                |
| ------------------------ | ------------------------------------------------------------------- |
| `setup`                  | Clone the workspace, install, build, `link`, then `--check`         |
| `setup --check`          | Read only: one status table, each gap with its exact next step      |
| `setup --login`          | Sign the test Vortex in to Nexus Mods once; the person logs in      |
| `setup --update [<ref>]` | Move the workspace to the plugin's version (or `<ref>`) and rebuild |

Rules:

- Never install Node, Git or Vortex, and never run a Vortex installer. Ask before enabling
  pnpm through corepack.
- Never ask for a password, API key or token, and never put one in chat or a file. The person
  signs in themselves, in their browser (`--login`).
- Repair only what is missing. A second run on a set-up machine changes nothing.
- Leave no Vortex running when you finish.

Before any mode, try `doodlebot version --json` in the normal tool environment. If lookup or
execution fails, follow [Command preflight](${CLAUDE_PLUGIN_ROOT}/resources/command-preflight.md)
before deciding what needs repair. An inaccessible command does not mean setup is missing.

## The plugin version and the shim

- The **plugin version** is `version` in `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`
  (Claude Code) or `<plugin root>/.codex-plugin/plugin.json` (Codex; the plugin root is three
  folders above this `SKILL.md`).
- `<shim>` is the absolute path of the `doodlebot` command: with `--bin-dir`,
  `<bin-dir>/doodlebot.cmd` on Windows (`<bin-dir>/doodlebot` elsewhere); otherwise on Windows
  the first line ending in `.cmd` that `where.exe doodlebot` prints (never PowerShell's
  `where`, which is `Where-Object`), elsewhere `command -v doodlebot`; once `link` has run, the
  path on its `shim: <path>` line. If discovery fails, use the preflight above; keep any
  absolute route it verified instead of repeating the failing lookup. Call doodlebot only
  through that route from then on.
- `<workspace>` is the `workspace` that `<shim> version --json` reports.

## Mode `setup`: install or repair

**Folder.** The first argument; without one, the `workspace` of a working
`doodlebot version --json` (confirm it with the person); otherwise ask, offering
`%USERPROFILE%\doodlebot` on Windows (`~/doodlebot` elsewhere) or an existing doodlebot checkout.
**Ref:** `--ref`, default `v<plugin version>`, falling back to `main` when that tag is absent.

Skip each step whose result already exists, and say which you skipped.

1. **Prerequisites.** `git --version`, `node --version`, `pnpm --version`.
   - Git missing: tell the person to install Git and stop.
   - Node missing or older than 20.19: tell them to install Node 20.19 or later and stop.
   - pnpm missing or not 9.15.0: ask "May I enable pnpm 9.15.0 with corepack?" On yes,
     `corepack enable`, then `corepack prepare pnpm@9.15.0 --activate`; on no, stop.
2. **Folder.** If it exists, is not empty and has no `.git`, ask for another.
3. **Clone** (skip when `<workspace>/.git` exists; never change the ref of an existing checkout):
   `git clone https://github.com/doodlum/vortex-doodlebot.git <workspace>`, then
   - a tag: `git -C <workspace> rev-parse --verify --quiet refs/tags/<ref>` succeeds, then
     `git -C <workspace> checkout --detach <ref>`;
   - a branch: `git -C <workspace> rev-parse --verify --quiet refs/remotes/origin/<ref>`
     succeeds, then `git -C <workspace> checkout --detach origin/<ref>`;
   - neither: use `main` for the default ref; for a ref the person named, stop with
     "No tag or branch <ref> on origin."
4. **Dependencies** (skip when `<workspace>/node_modules/.modules.yaml` exists):
   `pnpm -C <workspace> install --frozen-lockfile`. Allow up to 10 minutes.
5. **Build** (skip when `<workspace>/dist/index.js` exists): `pnpm -C <workspace> run build`.
6. **Shim** (skip when `<shim> version --json` already reports `<workspace>` **and**
   `~/.doodlebot/workspace.json` records it; a shim from an older doodlebot works but never wrote
   that record, and without it the SessionStart hook says doodlebot is not set up):
   `node <workspace>/bin/doodlebot.cjs link` (with `--bin-dir <bin-dir>` when given; when only
   the record is missing, `--bin-dir` is the folder `<shim>` is in, so the shim stays put). Read its
   `shim:` and `on PATH: yes|no` lines. On `no`, tell the person to add the shim's folder to
   their PATH and restart their agent; keep going with `<shim>`.
7. **Verify in the normal environment.** Follow the preflight's "Setup completion":
   `doodlebot version --json` and the absolute command route must report `<workspace>`.
   If install or link used host approval, repeat verification without that escalation.
   Report a blocked normal environment explicitly; host-only success is not unconditional
   setup success. Do not reinstall or relink merely because the sandbox cannot read it.
8. Run the `--check` mode below.

## Mode `--check`: what this machine can test

Read only. Run `doodlebot check` (add `--json` when you need to parse it). It prints one row per
item, each `ready`, `MISSING` or `BLOCKED` with its `next:` step, or `advisory`/`info`:

- the workspace: version, commit, local changes;
- `doctor` for the installed Vortex and the sandbox: Vortex, the extension, the sandbox
  baseline, 7-Zip (for `doodlebot release get`), the login folder's privacy, a running test
  Vortex, an old `Legacy lease store`;
- EGM at user scope, from the user's Claude Code settings and installed-plugins list (a
  project-scope install alone is missing: a session in a Vortex checkout would not have it);
- the session's Vortex checkout, when the session is in one: remotes (a fork as `origin`,
  Nexus-Mods/Vortex as `upstream`), branch, and whether it is built;
- `doodlebot inventory`: builds, games (a Steam install is never usable; a registered copy
  is), snapshots, sandboxes, collections;
- the Nexus login;
- the game-copy folder, and pending user-folder restores with `doodlebot game restore <gameId>`;
- the open kit gaps (`doodlebot gap list`) and local lessons that `KNOWLEDGE.md` now holds;
- disk use: `<workspace>/harness/.artifacts`, `<workspace>/harness/.cache`,
  `~/.doodlebot/releases`, each registered
  game copy, and free space, with a warning below 10 GB that names `doodlebot clean`.

Show the table to the person grouped as printed, then act only on these, each with their yes:

1. **Copy folder** (asked once). When the `copy folder` row is MISSING, ask: "Where should
   doodlebot put game copies? A folder on a drive with room, outside the workspace." Run
   `doodlebot game folder <dir>` with their answer. If they decline, leave it; `game copy`
   then needs `--to`.
2. **Pending restore.** Explain that every launch refuses until it is settled. Run
   `doodlebot game restore <gameId>`: it lists the changed files; the person chooses
   `--all`, `--keep` or `--file <path>`.
3. **Local lesson in `KNOWLEDGE.md`.** Offer `doodlebot knowledge remove <id>`; run it only on a yes.
4. **Low disk.** Run `doodlebot clean --dry-run` and show what it would delete; run
   `doodlebot clean --yes` only after the person agrees.
5. **Legacy lease store** (`~/.vortex-ai/leases`, from an older doodlebot; nothing reads it):
   offer to delete it, and do so only on a yes.
6. **A running test Vortex** that another session started from another checkout: never stop it.

Everything else MISSING is reported with its next step, not done: an unprepared or unbuilt
checkout is prepared by the first `/doodlebot:try` on the source build (or `fix`, `qa`,
`prototype`), which runs "Prepare this checkout" (`${CLAUDE_PLUGIN_ROOT}/resources/checkout.md`);
offer to run that procedure now if the person wants it ready. The login is `--login`, a game
copy is `doodlebot game copy <gameId>` (it copies gigabytes; ask first). A sandbox baseline is
built by the first `/doodlebot:try`.

**No checkout yet.** When the `this checkout` row says the session is not in a Vortex checkout
and the person wants to work on Vortex's code, ask which folder to clone into (there is no
default; it must be outside `<workspace>`). On an answer, run `doodlebot source --clone <dir>`
in the background with its output in `<workspace>/harness/.artifacts/runs/<UTC time>-clone.log`
(it finds the person's fork, or clones Nexus-Mods/Vortex alone), then tell them: "Open Claude
in <dir>. The first `/doodlebot:try` on your build (or `fix`, `qa`, `prototype`) prepares it."

## Mode `--login`: sign in to Nexus Mods

Collections and Nexus checks need a login; local checks, builds and benchmarks do not. The
login is one file, `~/.doodlebot/login/oauth-<target>.json`, outside the workspace, used
directly by the default cache and never copied. `<target>` is `--installed` unless the person
names a source build (`--dev-dir <checkout>`); use it on every command below.

1. `doodlebot status <target>`. If MCP is `answering`, a test Vortex runs: see "A running test
   Vortex" below. Stop here unless this session started it and the person says yes to
   stopping it.
2. Run `doodlebot setup --oauth <target> --no-wait` **in the background** with a log (see
   "Commands that launch Vortex"). Wait for the process to exit, then read the log:
   - `Existing OAuth login cached and present after a fresh restore. Setup complete.`:
     already signed in; go to step 5.
   - `Initial setup: click Log in in the isolated Vortex and complete the browser flow.`:
     go on.
   - Neither: show the log's last lines and its `.err` file, and stop.
3. Tell the person: "A test Vortex window is open. Click **Log in** in it and finish signing in
   to Nexus Mods in your browser. Tell me when you are done."
4. Then `doodlebot auth-status <target>` (booleans only). When it shows OAuth credentials, run
   `doodlebot save-login <target>`; otherwise ask them to finish and check again.
5. `doodlebot status <target>`; if MCP still answers, `doodlebot down`: the Vortex of step 2,
   which this session started.

There is no backup of the login: a lost, revoked or expired one means `--login` again. Never
click Log out in a test Vortex of the default cache unless the person asked; it signs them out
everywhere.

## Mode `--update [<ref>]`: match the plugin

1. `doodlebot version --json`. An equal `version` alone does not make it up to date: the
   version is not bumped on every merge, so a workspace many commits behind the plugin can carry
   the same number. Find the **plugin commit**: in Claude Code, `gitCommitSha` of the
   `doodlebot@doodlebot` entry in `~/.claude/plugins/installed_plugins.json`; otherwise (Codex,
   or no such field) the commit of tag `v<plugin version>` on origin,
   `git -C <workspace> ls-remote origin refs/tags/v<plugin version>^{}` (falling back to
   `refs/tags/v<plugin version>` for a lightweight tag). When no ref was named, `version`
   equals the plugin version and `commit` equals the plugin commit, say it is up to date, go to
   step 4's record check, and stop. With no plugin commit found, say so and go on as if it
   differed. When `dirty` is true, the update refuses: ask the person to commit or remove the
   local changes, and stop.
2. `doodlebot status`. If MCP is `answering`, a test Vortex runs: see "A running test Vortex"
   below. Stop here unless this session started it and the person says yes to stopping it.
3. `doodlebot update --ref <ref>` (default `v<plugin version>`), in the background with a log
   if your tool times out sooner than 10 minutes. It fetches, checks out detached, installs and
   builds. Read the result:
   - `No tag or branch v<plugin version> on origin.` with the default ref: retry with
     `doodlebot update --ref main`. If the result's `commit` then differs from the plugin
     commit, report both: `main` has moved past the installed plugin, or the plugin needs
     `/plugin marketplace update doodlebot`.
   - `A harness Vortex is running; run doodlebot down before updating.`: back to step 2.
   - `The workspace has local changes; commit or remove them before updating.`: step 1.
4. `doodlebot version --json` again; report the old and new version and commit. If they still
   differ from the plugin's, the plugin itself may need `/plugin marketplace update doodlebot`.
   **Record check:** when `~/.doodlebot/workspace.json` is missing or names no workspace, run
   `<shim> link --bin-dir <the folder <shim> is in>` (an update from an older doodlebot runs
   that version's `update`, which does not write the record), and tell the person a new
   session in a Vortex checkout now gets doodlebot's note.
5. Run the `--check` mode: an update brings new `KNOWLEDGE.md` entries and catalogue entries.

## A running test Vortex

Run `doodlebot down` only for a test Vortex **this session started**. Read the instance record
`~/.doodlebot/instance.json` (`pid`, `cacheDir`, `startedAt`, and `sourceDir` for a source
build or `exe` for a release): it is this session's only when its `sourceDir` or `exe` is the
build this session launched and its `startedAt` is after this session's own launch. Otherwise
another session started it: never stop it, even with the person's yes. Stop and report its
pid, cache and build, and ask the person to stop it from the session that started it, as
`/doodlebot:try`'s "Start and stop" says.

## Commands that launch Vortex

On Windows a Vortex launched from a command whose output is captured can keep that capture
open, so the command never returns. Run it in the background with a log under
`<workspace>/harness/.artifacts/runs/` (create the folder first):

```powershell
$log = "<workspace>/harness/.artifacts/runs/<UTC time>-login.log"
$p = Start-Process -FilePath <shim> -ArgumentList (<prefix-args> + @('setup','--oauth','--installed','--no-wait')) -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru
$p.Id
```

In Bash: `nohup <shim> <prefix-args> <args> > <log> 2>&1 & echo $!`. Check every 10 seconds whether the pid
still runs (`Get-Process -Id <pid>`, `kill -0 <pid>`). It is done when the process has exited
and the log has its success line. A cold start launches Vortex up to three times on the same
port, so `doodlebot status` answering is only a liveness hint.

## Finish

Tell the person, in a few lines: the mode run, the workspace and version, the status table's
MISSING and BLOCKED rows with their next steps, and what you did with their yes. Suggest what
to try next: `/doodlebot:try` to see Vortex do something (in a Vortex checkout it prepares the
checkout on the way), `/doodlebot:fix` or `/doodlebot:prototype` to work on Vortex's code,
`--login` only for Nexus collections.
