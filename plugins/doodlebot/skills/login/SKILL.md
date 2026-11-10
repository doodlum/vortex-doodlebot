---
name: login
description: "Doodlebot: Sign the test Vortex in to Nexus Mods once and cache the login; use before working with Nexus collections, never for local checks."
argument-hint: "[--installed | --dev-dir <checkout>]"
---

# Sign in to Nexus Mods

Collections need a Nexus Mods login (OAuth). Local checks, the sandbox game, builds and
benchmarks do not: say so and stop if the person's task needs no account. The person signs
in themselves in their browser. Never ask for a password, API key or token, and never put
one in chat or a file.

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
   ending in `.cmd` that `where.exe doodlebot` prints (never PowerShell's `where`);
   elsewhere `command -v doodlebot`.

## Steps

The login is one file per target, `~/.doodlebot/login/oauth-<target>.json`, outside the
workspace. The default cache uses it directly; every other cache is signed out, and nothing
copies it. Run these commands without `--cache-dir`. `<target>` below is `--installed` (the
released Vortex)
unless the person works on a source build, then `--dev-dir <checkout>`. Use the same
`<target>` on every command, `setup` and `save-login` included.

1. Run `doodlebot status <target>`. If it reports MCP `answering`, a test Vortex is
   running: ask whether to stop it. On a yes run `doodlebot down`; on a no, stop here.
2. Start the login profile **in the background** with a log, because it launches Vortex
   (for a source build, replace `'--installed'` with `'--dev-dir','<checkout>'`):

   ```powershell
   New-Item -ItemType Directory -Force <workspace>/harness/.artifacts/runs | Out-Null
   $log = "<workspace>/harness/.artifacts/runs/<UTC time>-login.log"
   $p = Start-Process -FilePath <shim> -ArgumentList 'setup','--oauth','--installed','--no-wait' -RedirectStandardOutput $log -RedirectStandardError "$log.err" -NoNewWindow -PassThru
   $p.Id
   ```

   In Bash: `nohup <shim> setup --oauth <target> --no-wait > <log> 2>&1 & echo $!`. The
   command is `doodlebot setup --oauth <target> --no-wait`.

3. Wait for that process to exit, checking every 10 seconds whether its pid still runs
   (`Get-Process -Id <pid>` in PowerShell, `kill -0 <pid>` in Bash; the shell does not keep
   `$p` between calls). With `--no-wait` it exits once the profile is ready, and an exit
   with code 0 is success; a cold start launches Vortex up to three times on the same port,
   so `doodlebot status` answering is only a liveness hint. Then read the log:
   - `Existing OAuth login cached and present after a fresh restore. Setup complete.`: the
     person is already signed in and nothing needs a click. Go to step 6.
   - `Initial setup: click Log in in the isolated Vortex and complete the browser flow.`:
     continue with step 4.
   - Neither line (an error): show the log's last lines and its `.err` file, and stop.
4. Tell the person: "A test Vortex window is open. Click **Log in** in it and finish signing
   in to Nexus Mods in your browser (password, two-factor code, captcha). Tell me when
   you are done."
5. When they say so, run `doodlebot auth-status <target>`. It prints booleans only.
   Continue when it shows OAuth credentials present; otherwise ask them to finish and check
   again. Then run `doodlebot save-login <target>`. It caches the credentials and checks
   that a restored profile still has them.
6. Run `doodlebot status <target>`; if MCP is still `answering`, run `doodlebot down`.

## Finish

Tell the person the login is saved for this target in `~/.doodlebot/login`, where every
workspace on the machine uses it and updates keep it. There is no backup of it: a lost,
revoked or expired login means running `/doodlebot:login` again, and a password change or
Nexus outage is something only they can fix. Never click Log out in a test Vortex of the
default cache unless the person asked: it signs them out everywhere.
