---
name: setup
description: "Doodlebot: Install or repair the doodlebot workspace, its doodlebot command and a sandbox baseline on this machine; use once per machine, or when another command says doodlebot is not set up."
argument-hint: "[folder] [--ref <tag or branch>] [--bin-dir <folder>]"
disable-model-invocation: true
---

# Set up doodlebot

This command takes a machine with Git, Node, pnpm and a released Vortex to a working
companion. It clones doodlebot into a **workspace** folder, installs it, builds the Vortex
extension, puts a `doodlebot` command on the PATH and prepares a sandbox baseline. The
person never types a terminal command; you run everything and tell them what happened.

Rules:

- Never install Node, Git or Vortex, and never run a Vortex installer. Ask before enabling
  pnpm through corepack.
- Never ask for a password, API key or token. Signing in to Nexus Mods is `/doodlebot:login`.
- Repair only what is missing. A second run on a set-up machine changes nothing.
- Leave no Vortex running when you finish.

## Inputs

- **Folder** `<workspace>`: the first argument (the workspace folder). Without one, use the `workspace` that
  `doodlebot version --json` reports if that command already works (confirm it with the
  person); otherwise ask, offering `%USERPROFILE%\doodlebot` on Windows (`~/doodlebot`
  elsewhere) or an existing doodlebot checkout.
- **`--ref <tag or branch>`**: what to check out in a new clone. The default is
  `v<plugin version>`, where the plugin version is `version` in
  `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` (Claude Code) or
  `<plugin root>/.codex-plugin/plugin.json` (Codex; the plugin root is three folders above
  this `SKILL.md`). If that tag does not exist, fall back to `main`.
- **`--bin-dir <folder>`**: where `link` writes the shim. Without it, `link` picks a folder
  on the PATH.
- The cache is whatever `VORTEX_AI_CACHE_DIR` selects (by default `<workspace>/harness/.cache`).
  Do not set it yourself.

## The shim path `<shim>`

`<shim>` is the absolute path of the `doodlebot` command you run:

- with `--bin-dir`: `<bin-dir>/doodlebot.cmd` on Windows, `<bin-dir>/doodlebot` elsewhere;
- otherwise, on Windows, the first line ending in `.cmd` that `where.exe doodlebot` prints
  (never PowerShell's `where`, which is `Where-Object`); elsewhere `command -v doodlebot`;
- once `link` has run, the path it printed on its `shim: <path>` line. From then on, call
  doodlebot only through that absolute path, so nothing depends on the shell's PATH.

## 1. Check whether it is already set up

It is already set up when **all** of these hold:

1. `<workspace>/node_modules/.modules.yaml` exists;
2. `<workspace>/dist/index.js` exists;
3. `<shim> version --json` reports `workspace` equal to `<workspace>` (compare real paths,
   case-insensitively on Windows, without a trailing separator);
4. `<shim> doctor --installed --sandbox` (that is, `doodlebot doctor --installed --sandbox`)
   lists the advisory check `Sandbox baseline` with a detail line that starts with `present`.

When all hold, run nothing else except the lease-store offer in step 8 if doctor lists
`Legacy lease store`. Tell the person "doodlebot is already set up", summarize the doctor
report in plain words, and finish with the report in "Finish".

## 2. Set up or repair, in this order

Skip each step whose result already exists, and say which you skipped.

1. **Prerequisites.** Run `git --version`, `node --version` and `pnpm --version`.
   - Git missing: tell the person to install Git for Windows (or their system's Git) and stop.
   - Node missing or older than 20.19: tell them to install Node 20.19 or later and stop.
   - pnpm missing or not 9.15.0: ask "May I enable pnpm 9.15.0 with corepack?" On yes, run
     `corepack enable`, then `corepack prepare pnpm@9.15.0 --activate`, and check
     `pnpm --version` again. On no, stop and say pnpm 9.15.0 is required.
2. **Folder.** Settle `<workspace>` (see Inputs). If it exists, is not empty and has no `.git`,
   ask for another folder.
3. **Clone** (skip when `<workspace>/.git` exists; never change the ref of an existing checkout):
   1. `git clone https://github.com/doodlum/vortex-doodlebot.git <workspace>`
   2. Check out the ref:
      - a tag: `git -C <workspace> rev-parse --verify --quiet refs/tags/<ref>` succeeds, then
        `git -C <workspace> checkout --detach <ref>`;
      - otherwise a branch: `git -C <workspace> rev-parse --verify --quiet refs/remotes/origin/<ref>`
        succeeds, then `git -C <workspace> checkout --detach origin/<ref>`;
      - otherwise, when the ref was the default `v<plugin version>`, use the branch `main`;
        when the person named it, stop with "No tag or branch <ref> on origin."
4. **Dependencies** (skip when `<workspace>/node_modules/.modules.yaml` exists):
   `pnpm -C <workspace> install --frozen-lockfile`. Allow up to 10 minutes.
5. **Build** (skip when `<workspace>/dist/index.js` exists): `pnpm -C <workspace> run build`.
6. **Shim** (skip when `<shim> version --json` already reports `<workspace>`):
   `node <workspace>/bin/doodlebot.cjs link`, adding `--bin-dir <bin-dir>` when given. Read its
   `shim: <path>` line (that is now `<shim>`) and its `on PATH: yes|no` line. When it says
   `on PATH: no`, tell the person: "Add `<folder of the shim>` to your PATH, then open a new
   terminal or restart your agent, so later commands find `doodlebot`." Keep going with
   `<shim>` meanwhile.
7. **Version.** `<shim> version` (`doodlebot version`) must print `at <workspace>`.
8. **Doctor.** `<shim> doctor --installed --sandbox`.
   - If the `Vortex` check fails because no Vortex is installed, tell the person to install
     the released Vortex from Nexus Mods (https://www.nexusmods.com/site/mods/1) or its
     GitHub releases, or to set `VORTEX_AI_EXE` to an extracted `Vortex.exe`, then run
     `/doodlebot:setup` again. Stop.
   - If doctor lists `Legacy lease store` with a path (an older doodlebot's
     `~/.vortex-ai/leases`, which nothing reads any more), ask: "An old doodlebot left a
     lease folder at `<path>`. Nothing uses it. Delete it?" Delete it only on a yes
     (`Remove-Item -Recurse -Force <path>` or `rm -rf <path>`); otherwise leave it and
     mention it in the report.
9. **Baseline** (skip when doctor's `Sandbox baseline` detail starts with `present`): run
   `<shim> setup --installed --sandbox` (`doodlebot setup --installed --sandbox`) **in the
   background** with a log, as in "Commands that launch Vortex" below. Wait until the
   process exits, then read the log. It must end without an error. If it refused because
   "A harness Vortex is running", tell the person a test Vortex is already running and ask
   whether to stop it with `/doodlebot:stop`.
10. **Stop.** `<shim> down` (`doodlebot down`). It must print `Vortex exited cleanly.` or
    `Nothing is running.`.

Then run `<shim> doctor --installed --sandbox` once more: `Sandbox baseline` must now be
`present`.

## Commands that launch Vortex

`setup` starts Vortex. On Windows a Vortex launched from a command whose output is captured
can keep that capture open, so the command never returns. Run it in the background with its
output in a log under `<workspace>/harness/.artifacts/runs/` (create that folder first):

PowerShell:

```powershell
New-Item -ItemType Directory -Force <workspace>/harness/.artifacts/runs | Out-Null
$log = "<workspace>/harness/.artifacts/runs/<UTC time>-setup.log"
$p = Start-Process -FilePath <shim> -ArgumentList 'setup','--installed','--sandbox' -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru
```

Bash:

```bash
mkdir -p <workspace>/harness/.artifacts/runs
nohup <shim> setup --installed --sandbox > <workspace>/harness/.artifacts/runs/<UTC time>-setup.log 2>&1 &
```

Check every 15 seconds whether the process has exited (`$p.HasExited`, or `kill -0 <pid>`),
reading the log as you go. A first setup can take several minutes. If it exits with an
error, show the person the last lines of the log and its `.err` file, and stop.

## Finish

Tell the person, in a few lines:

- the workspace folder and the doodlebot version (from `<shim> version`);
- where the `doodlebot` command is and whether it is on the PATH (and what to add if not);
- which Vortex was found, from doctor's `Vortex` check;
- that the sandbox baseline is ready and no test Vortex is running;
- anything you skipped, left alone (such as the legacy lease store) or could not do.

Then suggest what to try next: `/vortex:drive` to drive the test Vortex and get a report,
and `/doodlebot:login` only if they will work with Nexus collections (local checks need no
account).
