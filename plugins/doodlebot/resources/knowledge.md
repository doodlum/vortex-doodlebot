# Knowledge: search before, record after

Doodlebot learns from verified work. Three kinds of learning go to three places, and only the
owner turns any of them into a change that others get:

| Kind          | Example                                                            | Where it goes                                      |
| ------------- | ------------------------------------------------------------------ | -------------------------------------------------- |
| Vortex lesson | "Collection review stays open after Resume; close it first"        | `doodlebot knowledge add`, only with a known cause |
| Kit gap       | No tool reads the Downloads queue; `install` can't answer a dialog | `doodlebot gap add`                                |
| Test gap      | A touched Vortex area no QA catalogue entry guards                 | A proposed catalogue entry in the QA report        |

The stores:

- **Shared:** `<workspace>/KNOWLEDGE.md` holds reviewed lessons that ship with doodlebot.
  Never edit it from a skill. It changes only through a doodlebot pull request, and an edit in
  the workspace would make `/doodlebot:setup --update` refuse.
- **Local:** `~/.doodlebot/knowledge.md` (lessons) and `~/.doodlebot/gaps.md` (kit gaps) hold
  what was found on this machine. Only the knowledge and gap commands below write them.
  They survive updates and re-setup, and Claude Code and Codex share them.

## Before you act

1. Search both lesson stores for the symptom or area:

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
- it is not already in either store;
- it is about Vortex, not about the kit (a kit limitation is a gap, below).

A hunch, a one-off flake or an unexplained workaround belongs in the run report, not here.

```powershell
doodlebot knowledge add --title "<short symptom>" --area <area> --symptom "<what you saw>" --cause "<confirmed cause>" --remedy "<what to do>" --scope "<where it applies: commands, Vortex versions, games>" --evidence "<run report, test or source line>" --vortex <version>
```

- `--vortex` is required: every lesson says which Vortex version it was confirmed on.
- Evidence from someone else, such as a user's `vortex.log` or report, goes in
  `--third-party "<text>"`, never in the other fields. It is left out when the lesson is shared.
- Never put credentials, tokens, account names, private paths or stack traces in a lesson. The
  command refuses text that looks like a token or a stack trace.
- Tell the person what you recorded, with its id.

## When a lesson does not hold

- Say so in your report's Learned section.
- Remove a local lesson (`doodlebot knowledge remove <id>`) only when it fails on the same
  Vortex version and within its recorded Scope.
- Otherwise append a note and leave removal to the owner:

  ```powershell
  doodlebot knowledge note <id> "does not hold on <version> (<date>, <report>)"
  ```

- For a shared `KNOWLEDGE.md` entry, offer the doodlebot pull request that corrects or removes
  it. Shared lessons change only through doodlebot pull requests.

The ids come from `doodlebot knowledge list`.

## Kit gaps

A kit gap is something the kit should have done for the task and didn't: a missing tool, a
dialog `install` can't answer, a game inventory missed, a check that passed while the scenario
failed. A Vortex bug is not a gap (it is an issue report), and neither is something setup
reports as missing (that is the inventory's `next` command).

1. **Never patch the workspace in the middle of a task.** That would make `/doodlebot:setup --update`
   refuse and mix a kit change into Vortex work. Finish or stop the task first.
2. **Look for the same gap** (same command, same title), closed ones included, and reuse its
   title:

   ```powershell
   doodlebot gap list --json
   ```

3. **Record it:**

   ```powershell
   doodlebot gap add --title "<short title>" --command "<the command that hit it>" --needed "<what was needed>" --happened "<what happened>" --workaround "<what you did instead, or none>" --blocked yes|no
   ```

   - The same command and title counts it again instead of adding a second gap.
   - A gap the owner rejected (wontfix) is not recorded again; the command says so.
   - A gap that was fixed is re-opened only when this kit already contains the fix. Otherwise the
     command says which commit fixed it and to run `/doodlebot:setup --update`.

4. **A gap changes the outcome.** A criterion that needed a workaround is "passed with
   workaround: <x>", never a plain pass. Name a workaround that bypasses the UI (for example
   `vortex_dispatch` or `eval` instead of a click) as such. When a check passed but the scenario
   failed, the result is the scenario's failure, and the check is recorded as a gap.
5. **Offer the fix:** report the gap in the Learned section and offer "fix this gap in
   doodlebot". The owner fixes it on a branch with a test, then closes it:
   `doodlebot gap close <id> --by <commit>`. A gap the owner rejects is closed with
   `doodlebot gap close <id> --wontfix`, so it is not raised again.

A limitation of the kit itself (for example "a captured `up` never returns on Windows") is
recorded only as a gap, with its workaround, and never also as a lesson.

## Test gaps

When the QA report lists touched files that no catalogue entry guards, propose an entry for the
area in the report (what it guards, how it runs, what passing means). The owner decides whether
it is added to the catalogue.

## The Learned section

Every report ends with a **Learned** section: the lessons recorded or noted (with ids), the gaps
recorded (with ids and the outcome they changed), the proposed catalogue entries, or "nothing".

## Sharing a lesson or a gap

Nothing leaves the machine unless the person asks. When a local lesson has held more than once,
or a gap matters to others, offer to share it as a GitHub issue on doodlebot's repository:

1. Print the text. It is redacted (paths, user, machine and Nexus names) and leaves out
   third-party data. Nothing is published:

   ```powershell
   doodlebot knowledge share <id>
   ```

   (`doodlebot gap share <id>` for a gap.)

2. Show the printed text to the person and ask them to confirm: it goes to a public repository.
   Include third-party data only if they confirm that part separately
   (`--include-third-party`).
3. After they confirm, publish exactly that text:

   ```powershell
   doodlebot knowledge share <id> --yes
   ```

   An open issue with the same title gets the text as a comment instead. The issue link is
   recorded, and a second share of the same id is refused.

4. Without `gh`, `doodlebot knowledge share <id> --print` gives the text to paste into a new
   issue by hand.
