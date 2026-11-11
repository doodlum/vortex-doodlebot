# Use cases

This page walks through each thing people ask doodlebot to do, with the command to use and
what you get back. Each walkthrough is short; the linked guide has the details.

Open your agent in the doodlebot workspace. Every command's report ends with a **Learned**
section (U11).

| #   | You ask                                       | Command                                     |
| --- | --------------------------------------------- | ------------------------------------------- |
| U0  | "Set up doodlebot" / "What can I test here?"  | `/doodlebot:setup`                          |
| U1  | "Try X in Vortex" / "Does X work?"            | `/doodlebot:try`                            |
| U2  | "Find out why this is broken"                 | `/doodlebot:investigate`                    |
| U3  | "Fix it"                                      | `/doodlebot:fix`                            |
| U4  | "Build this feature" / "Change how X works"   | EGM, then `/doodlebot:qa --design`          |
| U5  | "Review / QA this PR"                         | `/doodlebot:qa <PR>`                        |
| U6  | "Is it faster?"                               | `/doodlebot:measure`                        |
| U7  | "Test it with a real game or collection"      | Any of the above; the agent chooses content |
| U8  | "Check the new release or nightly"            | `/doodlebot:qa --release <version>`         |
| U9  | "Ship it"                                     | `/doodlebot:pr`                             |
| U10 | "Improve doodlebot itself"                    | Edits in the workspace, `pnpm run ci`       |
| U11 | "The kit couldn't do that" / "That was wrong" | The Learned section of every report         |
| U12 | "Work on Vortex in this checkout"             | Open the agent there, `/doodlebot:source`   |
| U13 | "Prototype this idea"                         | `/doodlebot:prototype <idea>`               |

## U0: Set up doodlebot, or see what you can test

1. Run `/doodlebot:setup`. It clones the workspace, installs and builds it, and puts the
   `doodlebot` command on your PATH.
2. Later, run `/doodlebot:setup --check` at any time. It changes nothing.

You get a status table: each item is ready, missing with the exact command that fixes it, or
blocked with the reason. It covers the workspace, Vortex builds, game copies, sandboxes, the
Nexus login, EGM, the Vortex checkout you are in, pending restores, open kit gaps and disk use. See
[Set up doodlebot](../get-started/set-up.md).

## U1: Try something in Vortex

1. Describe it: `/doodlebot:try install this mod, deploy, and report anything odd`.
2. Name the build when it matters ("on 2.8.0", "on my build").

The agent chooses the content, starts an isolated test Vortex, runs the scenario, reads the
console, the log and the notifications, and stops it. You get a run report: the outcome, the
steps, the errors and warnings, screenshots, what it was **tested against** and what it did not
check. See [Try things in Vortex](try-vortex.md).

## U2: Find out why something is broken

1. Give the agent a description, an issue link or a user's `vortex.log`:
   `/doodlebot:investigate <the report>`.
2. The agent reads it, checks what doodlebot already knows, fetches the user's Vortex release,
   reproduces the problem on it, and narrows it down in the Vortex source.

You get an issue report: reproduced or not, and on which version; the cause with file and line;
how confident it is; and a proposed fix. No code is changed. A different version is reported as
"not reproduced on the user's version", never as "not reproduced".

## U3: Fix it

1. Run `/doodlebot:fix <issue report or bug>`. Without an issue report, the agent investigates
   first (U2), and continues only when the bug is reproduced.
2. The agent cuts a branch from upstream, fixes the bug, writes a regression test **in the
   Vortex branch**, and checks that the test fails without the fix (the revert control).
3. It repeats your scenario on the fixed build.

You get a branch with the fix and its test, and before and after run reports. No design is
needed unless you ask for one. See [Fix a Vortex bug](fix-a-bug.md).

## U4: Build a feature

Open the agent in your Vortex checkout (U12). You type the EGM commands; the agent gives you
each line to paste, with `EGM artifact directory: .doodlebot/egm` on its own line.

1. `/doodlebot:setup --check`, then `/doodlebot:source`.
2. `/egm:egm-brainstorm <the idea>`, then `/egm:egm-draft`. The draft stays in `.doodlebot/egm`;
   the agent commits each revision to the sibling branch `designs/<topic>` in your fork with
   `doodlebot design-branch`, never to the feature branch.
3. `/egm:egm-review <draft>`, then the `/egm:egm-review-loop` line the agent gives you, with
   doodlebot's runtime reviewer.
4. You approve the design: the approved revision is its `designs/<topic>` commit.
5. `/doodlebot:source --branch feat/<topic>`. The agent implements it and writes its tests in
   the branch; `/doodlebot:try` shows it working.
6. `/doodlebot:qa --design <draft>` checks every acceptance criterion with its negative control.
7. `/doodlebot:pr` (U9).

You get an EGM design with its review reports, then a branch checked from a fresh profile. See
[Design a feature with EGM](design-a-feature.md).

## U5: Review or QA a pull request

1. Run `/doodlebot:qa <PR number or link>`.
2. Building a pull request runs its code, so the agent asks for your go-ahead first.
3. It builds the base, then the pull request, and runs each claim and the QA catalogue entries
   the change touches on both, from a fresh profile.

You get a QA report: each claim proved, not proved by this PR, or not tested; each catalogue
entry pass, regression, fixed, failing on both or not tested; and the changed files nothing
guards. Nothing is posted to the pull request unless you say so.

## U6: Is it faster?

1. Run `/doodlebot:measure --a <build> --b <build> --check <check>`, for example a release
   against your branch built for production.
2. The agent runs the check on each build in turn, at least three times each, on a quiet
   machine.

You get a benchmark report: medians and ranges, and with two builds a verdict (Faster, Slower,
No clear difference, or Blocked). See [Measure and compare performance](benchmark.md).

## U7: Test with a real game or collection

There is no separate command. `try`, `fix`, `qa` and `measure` choose content themselves from
what this machine has: a sandbox before a game copy, the smallest copy first, an offline
collection before a Nexus one. Name content only to override that ("use my Skyrim copy").
Every report says what was used and why; a need nothing meets is "not tested", with the command
that would meet it. See [Use real games and baselines](games-and-baselines.md).

## U8: Check a new release or nightly

1. Run `/doodlebot:qa --release <version>`.
2. The agent fetches the official release, checks its published digest, runs
   `doodlebot test core` and the quick catalogue checks that need no account.

You get pass or fail per check, and what changed since the previous release you tested, or "no
previous result".

## U9: Ship it

1. After U3 or U4, run `/doodlebot:pr` in the session on the work branch.
2. The agent runs the preflight and writes the description from the run reports and the design
   (linked at its approved commit), ending with the doodlebot footer. A `proto/*` branch is
   refused.
3. On your go-ahead it pushes the session's branch to your own fork only, asks whether the pull
   request goes to your fork or to Nexus-Mods/Vortex, and opens it from that branch, a draft
   unless you say otherwise. In the Claude desktop app it binds the pull request to the session.
   It reads CI and says why it is red.

A pull request is opened only after your real scenario passed on the change. See
[Open a pull request](pull-requests.md).

## U10: Improve doodlebot itself

- **A fix:** edit the workspace on a branch, then `pnpm run ci`, and `doodlebot test core` when
  the change touches launching or driving Vortex.
- **A feature:** the U4 walk, with the design saved in the doodlebot repository's `designs/`
  folder.

See [Contribute](../contributing.md).

## U11: What doodlebot learned

Nothing to type: it happens during every other use case. Each report ends with **Learned**:

- a lesson, recorded on this machine only when its cause was confirmed, or a note that a lesson
  did not hold;
- a kit gap: something doodlebot should have done and didn't. The agent records it instead of
  changing doodlebot mid-task, and offers to fix it afterwards (U10);
- a proposed QA catalogue entry for an area nothing tests.

You decide what becomes a change for everyone. See [What doodlebot learns](../concepts/knowledge.md).

## U12: Work on Vortex in this checkout

1. Open your agent in your Vortex checkout, or in a worktree of it: a Claude desktop session
   with **Worktree** on, a Codex app chat with **Worktree** selected, or `git worktree add` for
   either CLI. With no checkout yet, ask for one: the agent runs
   `doodlebot source --clone <dir>` into a folder you name, and you open your agent there.
2. Run `/doodlebot:source`. It installs and builds that checkout.

Every command that builds or changes Vortex then uses the session's checkout, and
`doodlebot up` runs its build. Outside a checkout those commands refuse and say how to get one.
See [Work on Vortex source](source-development.md).

## U13: Prototype an idea

1. Start a worktree of your checkout: in the Claude desktop app, a new session with
   **Worktree** on; in the Codex app, a new chat with **Worktree** selected (it starts on a
   detached HEAD). Run `/doodlebot:prototype <idea>` there; the agent cuts `proto/<idea>` from
   upstream.
2. The agent refuses your main checkout, or a tree with changes in it.
3. Each round it changes the code, rebuilds, runs the build in a test Vortex, shows you
   screenshots at several window sizes, and asks what to change. Nothing is reviewed or
   approved.

You get a summary of what was tried, with links to each round's run report, and the
`/egm:egm-brainstorm` lines that start the design from it (U4). The prototype is never shipped:
`/doodlebot:pr` refuses `proto/*`. See [Prototype an idea](prototype.md).
