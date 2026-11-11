# Open a pull request

This page shows how to have the agent check a Vortex branch and open its pull request with
`/doodlebot:pr`. The pull request is opened from the branch your session is on, so the Claude
desktop app can show it, with its CI status, beside the session. The Codex app shows its checks
in the review pane.

## Before you begin

- Open the agent in the Vortex checkout or worktree that holds the change, on a committed work
  branch. A `proto/*` prototype branch is never shipped: start `feat/<topic>` from upstream
  after an approved design, and port the prototype's changes there.
- Make sure the change was tested in the scenario it addresses. For a bug fix, the reported
  scenario was reproduced on the base and passes on the fix; see
  [Fix a Vortex bug](fix-a-bug.md#test-the-reported-scenario). Without that, the agent does not
  prepare a pull request, draft included.
- For a feature or a refactor, have the approved design; see [Design a feature with EGM](design-a-feature.md).
- Stop the test Vortex (`doodlebot down`). The checks below refuse to change a checkout that
  a running test Vortex uses.

## Prepare the pull request

1. Run:

   ```text
   /doodlebot:pr
   ```

2. The agent checks your branch. It refuses a `proto/*` branch. The design, if there is one, is
   committed on this branch and goes into the pull request
   ([Design with EGM](../concepts/design-first.md#designs-travel-with-the-code)).

3. The agent runs `doodlebot pr-preflight` on your branch. It compares the committed branch with
   its merge base and reports PASS, WARN, FAIL or SKIP for each check:

   | Check                    | What it reports                                                             |
   | ------------------------ | --------------------------------------------------------------------------- |
   | Size                     | WARN over 400 changed lines or 10 files                                     |
   | Callers outside the diff | Uses of each changed export, member or helper outside the changed lines     |
   | Readers of changed state | Readers of each class field whose assignment changed                        |
   | Dispatchers of reducers  | Each changed reducer's action creator and its uses                          |
   | Revert check             | Whether the tests fail with the fix reverted, which shows they test the fix |
   | Measurements in comments | Timing or size figures in added comments                                    |
   | Branch                   | FAIL on a `proto/*` prototype branch                                        |

   The agent gives each meaningful warning a disposition.

4. The agent writes the description with these sections, in this order:

   - **Problem**: the trigger, the user-visible result, the affected scope and the cause, with
     the issue link.
   - **Change**: the resulting behavior and the relevant decisions. With a design, its Overview
     and acceptance criteria verbatim, and "Design approved by <owner> on <date>", naming the
     design file the pull request carries; "None" for a bug fix.
   - **Behaviour changes**: what users and extension authors can observe.
   - **Evidence**: revision and platform, the before and after run reports, the regression
     test and its control, each acceptance criterion with its negative control (with a design),
     the QA catalogue entries the change touches, performance if relevant, and CI.
   - **Review**: the independent review and its findings.
   - **Not covered**: related work left out.

   Every description ends with the footer
   `Written with [doodlebot](https://github.com/doodlum/vortex-doodlebot).`

   The title follows Conventional Commits, such as `fix(collections): ...`, in under about 72
   characters.

5. The agent shows you the title and description. It never pushes a branch or opens a pull
   request unless you ask it to.

6. When you ask, it pushes your branch with `doodlebot push-branch`. That pushes only to your
   own fork, and refuses when your `origin` would push anywhere else (a push URL or
   `pushInsteadOf` rule pointing elsewhere); see
   [Working with your fork](source-development.md#working-with-your-fork-and-worktrees). If you
   have no fork yet, the agent offers to make one.

7. The agent asks whether the pull request goes to your fork or to Nexus-Mods/Vortex, and opens
   it from your branch with `gh pr create`, as a draft unless you say otherwise. A pull request
   inside your fork lets you review the change there before it goes upstream.

   Either way, the pull request's base is Nexus-Mods/Vortex's default branch name, normally
   `master`, in your fork as well as upstream. It is never your fork's own default branch, which
   can be another branch with work of its own (doodlum/Vortex's default branch is `linux`).

8. In the Claude desktop app, the agent binds the pull request to the session if the app did not
   pick it up. Whether the app can show a pull request opened against Nexus-Mods/Vortex from
   your fork is not yet established; the agent reports what happened. See
   [In the Claude desktop app](#in-the-claude-desktop-app).

9. The agent runs `doodlebot pr-checks <number>` to report the pull request's CI checks, with
   failed jobs expanded to their failed steps. When CI is red, it says why: a test failure, an
   upload or infrastructure failure, or a known failure on the base.

The expected result: a preflight report, a description ready to post, and, once the pull request
exists, its check status.

## In the Claude desktop app

- The app needs `gh` installed and signed in (`gh auth login`).
- Once the pull request is open, it shows in the session details panel's **Changes** card, with
  its CI status. If it does not, the agent binds it to the session.
- The card's ⋮ menu has **Auto-fix** and **Merge when ready**. Merge when ready makes a squash
  merge, unless the repository uses a merge queue.

Source: [Claude Code desktop](https://code.claude.com/docs/en/desktop).

## In the Codex app

- A Codex app worktree starts on a detached HEAD, and `doodlebot push-branch` refuses one. Cut a
  branch before you ask for the pull request: the app's **Create branch here**, or
  `git switch -c <name>`, keeps the commits you made. `doodlebot source --branch <name>` starts
  from upstream instead, so use it only before you commit.
- The agent pushes the branch and opens the pull request with `gh`, as above. The Codex
  documentation does not say whether the app opens pull requests itself.
- The app's review pane stages, commits and pushes. A pull request's summary shows its
  description, comments and checks; **Fix** in Checks attaches a failing check to a chat.
- Auto-fix, following a pull request's CI, and auto-merge per task are not documented for the
  Codex app. Ask the agent for `doodlebot pr-checks <number>` to read CI.

Source: [Codex code review](https://learn.chatgpt.com/docs/code-review?surface=app).

## What's next

- Have the change checked independently with `/doodlebot:qa`; see
  [Try things in Vortex](try-vortex.md#check-a-change-a-pull-request-or-a-release).
- [Evidence and the QA catalogue](../concepts/evidence.md).
