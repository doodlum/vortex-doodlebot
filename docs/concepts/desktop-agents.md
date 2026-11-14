# Desktop coding agents

Doodlebot has one local Windows runtime and two plugin adapters. Use Codex with local
execution or a local session in Claude Desktop's **Code** tab. Installing the plugin does
not install its runtime, grant host permissions or sign the test Vortex into Nexus Mods.

## Contract

| Concern               | Codex app or CLI                                                                  | Claude Desktop local Code session                                                    |
| --------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Plugin                | `.codex-plugin/plugin.json`; skills from `skills/`                                | `.claude-plugin/plugin.json`; skills and bundled driver/reviewer agents              |
| Install and refresh   | Codex marketplace commands or Plugins; start a new chat after installation        | Claude plugin manager at user scope; restart after installing or updating            |
| Session hook          | Trust in Settings > Hooks or `/hooks`; changed scripts need review again          | Plugin hooks load when the coding session starts                                     |
| Runtime               | Verify the absolute shim or Node entry-point route in the actual tool environment | Verify the same route in the actual tool environment                                 |
| Permissions           | Use the host's approval flow when the sandbox cannot execute the runtime          | Use Claude's tool permissions; unattended sessions cannot answer interactive prompts |
| Driver                | Follow the skill inline; no Claude-specific agent names are dispatched            | Delegate as the skill specifies, with the full command route and instance ownership  |
| EGM prerequisite      | Read `codex plugin list --json`; unavailable is advisory                          | Read Claude user settings and plugin scopes; disabled or project-only is not ready   |
| Reports and isolation | Same evidence templates, report folders and one test Vortex at a time             | Same evidence templates, report folders and one test Vortex at a time                |

Do not use a cloud or WSL session to drive this Windows runtime. Claude's ordinary Chat or
Cowork tabs do not provide this Code-plugin workflow. A visible Windows desktop and access
to the isolated profile, game copy and loopback endpoints are required.

## Acceptance checks

1. The plugin appears in the intended agent's picker. The other agent's installed-plugin
   record is not evidence that it is installed here.
2. A trusted SessionStart hook produces a short note in a Vortex checkout or linked worktree,
   and produces nothing outside one. An untrusted hook does not prove setup is missing.
3. The read-only version probe reports the intended workspace. If PATH or sandbox access
   fails, use the dependency-free discovery probe and retain the exact error. Report a
   successful host-only probe as such; do not reinstall a working runtime to evade a sandbox.
4. A background command with paths containing spaces preserves its arguments, writes a log,
   and leaves the helper window hidden. Observe process exit and the command's success line;
   an answering endpoint alone is not launch completion.
5. `doodlebot check` checks EGM for the active agent. `CLAUDECODE` identifies Claude Code;
   otherwise `CODEX_THREAD_ID` identifies Codex. With neither marker it uses Claude's settings,
   so inspect Codex explicitly. EGM is optional outside design work.
6. A beta release such as `2.11.0-beta.4` registers under that exact identity after download
   verification even if its Windows resource says `2.11.0.0`. A different numeric release
   or explicitly different beta resource remains refused.
7. A runtime exercise starts through the calling skill, verifies the target and instance
   ownership, observes UI/state/files independently, and stops only its own test Vortex.
   The person's own Vortex and another session's instance are left alone.

## Audit evidence and limits

The November 2026 audit found and corrected prerelease registration, Codex EGM attribution,
and disabled Claude EGM readiness. Shared checkout messages now address either coding agent;
Windows background templates use hidden helpers. The shutdown test's fake record now uses its
allocated MCP port instead of probing the default port of a potentially real instance.
Command preflight retains separate states
for missing, inaccessible and failing commands.

Automated coverage: `releaseFetch.test.ts`, `checkCommand.test.ts`, `plugins.test.ts`,
`commandProbe.test.ts`, `sessionNote.test.ts` and `backgroundCommands.test.ts` under
`harness/src/`. Hook tests execute the shared stdin/stdout protocol in temporary repositories,
including a linked worktree. Background tests execute the documented PowerShell templates
with a harmless Node entry point and paths containing spaces. These tests do not prove either
desktop app's picker or trust UI was clicked, nor that a Vortex installation workflow passed.

The real `release get 2.11.0-beta.4` download was verified and registered on Windows after the
fix; neither the installer nor Vortex was run. Codex's installed-plugin JSON schema and a
hidden PowerShell batch launch were inspected locally. Claude CLI was not on PATH, so
Claude Desktop installation and UI checks remain manual. Run the acceptance checks in each
updated desktop app before claiming a complete desktop session has passed.

## Sources

- [OpenAI: plugin packaging](https://learn.chatgpt.com/docs/build-plugins)
- [OpenAI: hook compatibility and trust](https://learn.chatgpt.com/docs/hooks)
- [Anthropic: Claude Desktop plugins and local sessions](https://code.claude.com/docs/en/desktop)
- [Anthropic: plugin manifests](https://code.claude.com/docs/en/plugins-reference)

The shared hook uses the documented `CLAUDE_PLUGIN_ROOT` compatibility variable provided
by Codex as well as Claude. No separate host-specific hook or Vortex source patch is needed.
