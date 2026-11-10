# Use real games and baselines

This page shows how to prepare a baseline profile for the sandbox, a real game copy or a source
build with `/doodlebot:baseline`, and how to start the test Vortex with it.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md).
- For a real game: install it, finish its updates, close the game and its launcher, and make a
  registered copy of the game folder that doodlebot may change ("Keep a real game safe" below).
  Use a test machine or a QA-only Windows account if you can.
- For a source build: [Work on Vortex source](source-development.md).

## What a baseline is

A **baseline** is a saved, clean Vortex profile for one combination of target, game and game
path. Doodlebot creates it on the first start, by managing the game and quitting cleanly, and
reuses it afterward. Each combination has its own baseline, so an unrelated profile is never
reused.

| Start                | What happens                                                  |
| -------------------- | ------------------------------------------------------------- |
| First start          | A blank profile manages the game, quits cleanly, and is saved |
| Later start          | The working profile reopens with its mods and settings        |
| `--fresh`            | The working profile is replaced with a copy of the baseline   |
| `--rebuild-snapshot` | The baseline is created again; the saved login is kept        |

## Create or refresh a baseline

1. Run `/doodlebot:baseline` with the game you want:

   | Game             | Example                                                   | The agent runs                                                              |
   | ---------------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
   | The sandbox      | `/doodlebot:baseline sandbox`                             | `doodlebot up --installed --sandbox --rebuild-snapshot`                     |
   | A real game copy | `/doodlebot:baseline fallout4 at D:\GameCopies\Fallout 4` | `doodlebot up --installed --game <id> --game-path <dir> --rebuild-snapshot` |
   | A source build   | `/doodlebot:baseline sandbox on my source build`          | `doodlebot up --dev-dir <checkout> --sandbox --rebuild-snapshot`            |

2. The agent waits for the baseline to be saved, then runs `doodlebot down`, so no Vortex is
   left running.

The expected result: the agent reports the baseline it created. `/doodlebot:status` and
`doodlebot doctor` report whether the sandbox baseline is present.

## Start Vortex with a game

Run `/doodlebot:start` and name the target and game, for example:

```text
/doodlebot:start the released Vortex with fallout4 at D:\GameCopies\Fallout 4
```

The games you can name:

| Game                 | Flag                            | Notes                                                                           |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| The sandbox          | `--sandbox`                     | A disposable game with real install, enable, deploy and purge; not playable     |
| The Bethesda sandbox | `--bethesda-sandbox`            | A fake Fallout 4 with plugins; its Fallout 4 folders are backed up and restored |
| A real game          | `--game <id> --game-path <dir>` | A registered copy of the game folder                                            |
| No game              | `--no-game`                     | Only the global Vortex UI                                                       |

## Keep a real game safe

Doodlebot manages a real game folder only when it is a registered copy. A store install, such as
a folder under `steamapps\common`, is never used: a start with it, or with `--game` and no
`--game-path`, is refused.

- Make a copy of the Steam install and register it:

  ```powershell
  doodlebot game copy fallout4 --to D:\GameCopies
  ```

  The copy goes to `D:\GameCopies\fallout4`. Copies are listed in `~/.doodlebot/content.json`.

- Register a copy you already have with `doodlebot game register <gameId> <dir>`.

Game support also writes the Windows account's Documents and AppData folders, for example a
game's settings and plugin list (`Documents\My Games\<game>` and `%LOCALAPPDATA%\<game>`).
Doodlebot protects them for every game it knows, and for the Bethesda sandbox, which uses your
real Fallout 4 folders on any Vortex build:

- Before Vortex starts, it backs both folders up into the profile cache. It refuses to start
  while the game itself runs, or when the backup cannot be made.
- `doodlebot down` puts them back after Vortex has closed, and checks every restored file.
- A file changed outside the run, such as a save you made meanwhile, stops the restore. Doodlebot
  lists the files and restores nothing.
- If Vortex crashed or was closed without `down`, nothing is restored automatically and the next
  start is refused. Run `doodlebot game restore <gameId>` to see the changed files, then choose:
  `--all` restores them all, `--keep` keeps them all, and `--file <path>` restores the ones you
  name.

## What's next

- [Drive Vortex and get a report](drive-vortex.md) with the new baseline.
- [Sign in to Nexus Mods](sign-in.md) for collections.
