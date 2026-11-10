# Use real games and baselines

This page shows how to prepare a baseline profile for the sandbox, a real game copy or a source
build with `/doodlebot:baseline`, and how to start the test Vortex with it.

## Before you begin

- [Set up doodlebot](../get-started/set-up.md).
- For a real game: install it, finish its updates, close the game and its launcher, and make a
  copy of the game folder that doodlebot may change. Use a test machine or a QA-only Windows
  account if you can.
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

| Game                 | Flag                            | Notes                                                                                      |
| -------------------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| The sandbox          | `--sandbox`                     | A disposable game with real install, enable, deploy and purge; not playable                |
| The Bethesda sandbox | `--bethesda-sandbox`            | A fake Fallout 4 with plugins and a private Documents and LocalAppData; source builds only |
| A real game          | `--game <id> --game-path <dir>` | Use a copy of the game folder                                                              |
| No game              | `--no-game`                     | Only the global Vortex UI                                                                  |

## Keep a real game safe

- A separate Vortex profile does not protect the game folder: deployment writes to the game path
  you give. Point `--game-path` at a copy.
- Game support can also write the Windows account's Documents and AppData folders, for example a
  game's settings and plugin list. Back those folders up before you start a real game, and
  restore them afterward, or use a test machine or QA-only Windows account.
- `--isolate-user-folders` redirects those folders for Vortex source builds only.

## What's next

- [Drive Vortex and get a report](drive-vortex.md) with the new baseline.
- [Sign in to Nexus Mods](sign-in.md) for collections.
