# Knowledge: search before, record after

Doodlebot learns from verified work through two stores:

- **Shared:** `<workspace>/KNOWLEDGE.md` holds reviewed lessons that ship with doodlebot.
  Never edit it from a skill. It changes only through a doodlebot pull request, and an edit in
  the workspace would make `/doodlebot:update` refuse.
- **Local:** `~/.doodlebot/knowledge.md` holds lessons verified on this machine. It is written
  only by `doodlebot knowledge add`. It survives updates and re-setup, and Claude Code and
  Codex share it.

## Before you act

1. Search both stores for the symptom or area:

   ```powershell
   doodlebot knowledge search <two or three words from the symptom>
   ```

2. Treat every match, local or shared, as a lead and not a fact:
   - recheck its cause against the current source and what you observe;
   - say in your report which lesson you used and whether it still held.

## After you verify something

Record a lesson only when all of these are true:

- you confirmed the cause, for example from the source, a control, or a reproduction that
  stops when the cause is removed;
- it would have saved real time;
- it is not already in either store.

A hunch, a one-off flake or an unexplained workaround belongs in the run report, not here.

```powershell
doodlebot knowledge add --title "<short symptom>" --area <area> --symptom "<what you saw>" --cause "<confirmed cause>" --remedy "<what to do>" --scope "<where it applies: commands, Vortex versions, games>" --evidence "<run report, test or source line>" --vortex <version>
```

- Never put credentials, tokens, account names or private paths in a lesson. The command
  refuses text that looks like a token.
- If a local lesson turns out wrong, remove it with `doodlebot knowledge remove <id>`; the
  ids come from `doodlebot knowledge list`.
- Tell the person what you recorded, with its id.

## Sharing a lesson

When a local lesson has held more than once, offer to share it. The person can open a doodlebot
pull request that adds the lesson to `KNOWLEDGE.md`, with its evidence. Do this only when they
ask: a shared lesson is reviewed before it reaches everyone.
