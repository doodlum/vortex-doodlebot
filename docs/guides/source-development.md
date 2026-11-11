# Work on Vortex source

This page shows how to work in your own Vortex checkout: open Claude in it, let the commands
prepare it, work on a branch of it, and run your build in the test Vortex.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md).
- Have Vortex's own build prerequisites. The first build takes longer than doodlebot's setup.
- A GitHub fork of Vortex is needed only to push your work. Without one, you can still build,
  try and test Vortex.
- Make sure no test Vortex is running (`doodlebot down` stops one your session started).

You do not need Vortex source to drive a released Vortex, add a regression test for doodlebot's
suite, or measure a release.

## Open Claude in your checkout

Doodlebot works in the Vortex checkout your Claude session is opened in, or in a worktree of it.
The same holds for the Claude desktop app, the Codex app and the Codex CLI: open the session in
the checkout's folder.
That is the session's checkout: commands that build or change Vortex use it, and `doodlebot up`
runs its build. Doodlebot's own workspace stays where setup put it.

If you have no checkout yet, run `/doodlebot:setup --check` and ask for one: the agent asks for
a folder of your choosing (never inside the doodlebot workspace) and runs
`doodlebot source --clone <dir>`. Then open Claude in that folder.

Outside a checkout, commands that need Vortex's source refuse with:

```text
Open Claude in a Vortex checkout or worktree (or clone one with `doodlebot source --clone <dir>`).
```

## Prepare the checkout

You do not run anything to prepare it. The first command that needs your build
(`/doodlebot:try` on your source build, `/doodlebot:fix`, `/doodlebot:qa` or
`/doodlebot:prototype`) checks whether the checkout is ready and, when it is not, prepares it on
the way:

1. The command finds the session's checkout.
2. The agent runs `doodlebot source`. It checks the remotes: `upstream` must be
   Nexus-Mods/Vortex, and if it points anywhere else, `source` stops and changes nothing.
3. If `upstream` is missing, or doodlebot's `.doodlebot/` folder or the Claude desktop app's
   `.claude/worktrees/` folder is not yet kept out of Git, the agent asks you once: "May I add
   Nexus-Mods/Vortex as `upstream`, and add `.doodlebot/` and `.claude/worktrees/` to this
   checkout's shared `info/exclude`?" On a yes it runs
   `doodlebot source --add-upstream --exclude`. The exclude file is shared by every worktree of
   the checkout, so nothing doodlebot writes in any of them reaches a commit, and the desktop
   app's worktrees inside the checkout do not show in its `git status`.
4. `source` installs Vortex's dependencies with its pinned pnpm and builds the checkout. The
   build puts back the `etc/` files it rewrites, so `git status` stays clean.

5. `/doodlebot:fix` and `/doodlebot:prototype` make a branch for the work, for example
   `doodlebot source --branch fix-download-panel`.

The expected result: a built checkout on a new branch. A checkout that is already built is left
as it is.

To work in a different checkout than the session's, name it; the agent passes it to every
command with `--dev-dir <path>`.

## Working with your fork and worktrees

### Fork or no fork

- The Nexus Mods repository is always the remote `upstream`.
- If you have a fork of Vortex on GitHub, `source` clones it as `origin`.
- If you have no fork, `source` clones Nexus-Mods/Vortex alone. Building, trying and testing
  work the same. To push a fix later, make a fork: `gh repo fork Nexus-Mods/Vortex --remote`
  adds it as `origin`. `/doodlebot:pr` offers this when it is needed.
- If your fork has another name, set `VORTEX_AI_VORTEX_REPO=<owner>/<repo>`.

### Branches start from upstream

Every work branch starts from upstream's main branch, never from your fork's own main branch,
which may hold other work. `doodlebot source --branch <name>` fetches upstream and creates the
branch there.

### Doodlebot pushes only to your fork

Before any push, doodlebot checks with GitHub that `origin` is your own fork of Vortex. It
refuses to push to Nexus-Mods/Vortex itself or to someone else's fork, even if you are allowed
to push there. An organisation's fork is accepted only when you set it in
`VORTEX_AI_VORTEX_REPO` and can push to it. Doodlebot pushes two kinds of branch there: the
branch your session is on, which a pull request is opened from (`doodlebot push-branch`), and a
design's sibling branch `designs/<topic>` (`doodlebot design-branch`).

### Several branches at once

You can keep several branches built side by side, each in its own worktree, and use one agent
session per branch. Each worktree needs its own install and build, which the first command
that needs it does. Commands in that session then use the worktree; no flag is needed. How you make the worktree depends on your agent.

#### Claude desktop app

1. Before you start the session, turn on **Worktree** in the row under the prompt. It is off by
   default.
2. The app makes the worktree in `<checkout>/.claude/worktrees/`, inside your checkout.
   `doodlebot source --exclude` keeps that folder out of the checkout's `git status` and
   commits. Settings → Code → **Worktree location** moves it elsewhere.
3. Settings → Code → **Branch prefix** is put in front of every worktree branch the app makes.
   Which commit the worktree starts from is not documented: cut your work branch from upstream
   with `doodlebot source --branch <name>`.
4. Run your command in the new session; it prepares the worktree first.

Gitignored files are copied into a new worktree only when they are listed in
`.worktreeinclude`. Source: [Claude Code desktop](https://code.claude.com/docs/en/desktop).

#### Claude Code CLI

1. Make a worktree: `git -C <checkout> worktree add <dir> <branch>`.
2. Start `claude` in `<dir>` and run your command there; it prepares the worktree first.

#### Codex app

1. Select **Worktree** under the composer, and pick the branch it is based on.
2. The worktree starts on a **detached HEAD**, in `$CODEX_HOME/worktrees` (Settings →
   Worktrees → **Worktree root** changes it), outside your checkout.
3. Run your doodlebot skill (type `$` or `@` to pick it); it prepares the worktree first. Cut a
   branch before you commit:
   `doodlebot source --branch <name>` cuts it from upstream. The app's **Create branch here**
   also makes one, with a suggested `codex/` prefix, on the commit the worktree is on.

The app honours `.worktreeinclude` too. Source:
[Codex worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees).

#### Codex CLI

1. Make a worktree: `git -C <checkout> worktree add <dir> <branch>`.
2. Start `codex` in `<dir>` and run your doodlebot skill there; it prepares the worktree first.

#### One test Vortex

Each worktree is a full Vortex build of several GB. Editing, building and unit tests run in
parallel. Only one test Vortex runs at a time on the machine, whichever app or CLI started it,
so starting one while another session's runs is refused. Wait for the other session to finish;
never stop its Vortex.

## Run your build

- `/doodlebot:try <scenario> on my source build` starts the session's build with
  `doodlebot up --sandbox`.
- `doodlebot build` records what it built in the checkout's Git folder (never in your working
  tree). If the checkout changed since, `doodlebot up` refuses and names a changed file; rebuild,
  or pass `--stale-ok` to run the old build on purpose.
- A source build runs in development mode, with React's slower development build. For timings
  that reflect users, the agent builds with `doodlebot build --checkout <dir> --production` and
  starts with `--production`. It then confirms that Vortex reports production mode.
- Keep source-build checks apart from released-build checks: development instrumentation and
  React's mode change timings.

## One running Vortex per checkout

While the test Vortex runs from a checkout, commands that would change or record that checkout
refuse:

```text
A harness Vortex is running from C:\dev\Vortex (pid 1234); run `doodlebot down` before building it.
```

Stop that test Vortex with `doodlebot down` if your session started it, then repeat the command.
Stop it before you switch the checkout to another branch as well.

## Your clone from an older doodlebot

Earlier versions of doodlebot kept a Vortex clone inside the workspace. It is still a Vortex
checkout, with your branches and worktrees: open Claude in it, or in one of its worktrees, and
doodlebot works there. `doodlebot check` lists it as "Your Vortex clone from an older doodlebot
(<path>, <n> worktrees): open Claude in it or one of its worktrees". Doodlebot never deletes it;
`doodlebot clean` leaves it alone.

## Features and refactors start with a design

Before you write code for a new feature or a refactor, write and approve a design with EGM ([Design a feature with EGM](design-a-feature.md)).
A bug fix needs no design; use [`/doodlebot:fix`](fix-a-bug.md).

When someone else checks your change, stop your test Vortex first. They start with
`/doodlebot:qa`, which begins from `doodlebot up --fresh` with the same target, so they do not
inherit your profile.

## What's next

- [Fix a Vortex bug](fix-a-bug.md).
- [Measure and compare performance](benchmark.md) between a release and your branch.
