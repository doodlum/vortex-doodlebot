# Use real games and baselines

This page shows how doodlebot uses baselines, game copies and sandboxes, how to refresh a
baseline, and how to keep a real game safe. `/doodlebot:try` chooses the game itself; you name
one only to override it.

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

## Refresh a baseline

The first `/doodlebot:try` on a build and game creates its baseline. To create it again, ask
for it:

```text
/doodlebot:try refresh the baseline for the sandbox on 2.8.0
```

The agent runs `doodlebot up <build> <game> --rebuild-snapshot`, then `doodlebot down`.
`/doodlebot:setup --check` and `doodlebot inventory` show each baseline, with the build and game
it was made for, and a stale one with the command that rebuilds it.

## Name a game

`/doodlebot:try` picks the cheapest content that meets the scenario. To use a particular game,
name it, for example:

```text
/doodlebot:try install this mod with my Fallout 4 copy on 2.8.0
```

The games doodlebot can use:

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

- Choose a folder for copies once; `/doodlebot:setup --check` asks for it and stores it:

  ```powershell
  doodlebot game folder D:\GameCopies
  ```

- Make a copy of the Steam install and register it:

  ```powershell
  doodlebot game copy fallout4
  ```

  The copy goes to `D:\GameCopies\fallout4` (`--to <folder>` overrides the stored folder once).
  It records the game's version, such as `1.10.984.0`. Copies are listed in
  `~/.doodlebot/content.json`.

- Doodlebot keeps one copy per game version. Running `game copy` again reuses the registered copy
  of the same version, and says so. Pass `--new` to make a second copy anyway; it goes to
  `D:\GameCopies\fallout4-2`. After a game update, `game copy` makes a copy of the new version.
- Register a copy you already have with `doodlebot game register <gameId> <dir>`.

Game support also writes the Windows account's Documents and AppData folders, for example a
game's settings and plugin list (`Documents\My Games\<game>` and `%LOCALAPPDATA%\<game>`), and
some games keep saves and settings in `%APPDATA%\<game>` (Stardew Valley uses
`%APPDATA%\StardewValley`). Doodlebot protects them for every game it knows, and for the
Bethesda sandbox, which uses your real Fallout 4 folders on any Vortex build:

- Before Vortex starts, it backs these folders up into the profile cache. It refuses to start
  while the game itself runs, when the backup cannot be made, or for a game it has no folder
  list for. This holds inside the profile cache too, and a Steam install is refused there as
  anywhere.
- `doodlebot down` puts back, after Vortex has closed, only the files Vortex itself writes:
  the plugin list (`plugins.txt`, `loadorder.txt`, `DLCList.txt`), the game's `.ini` files and
  the `.ini.base` and `.ini.baked` copies Vortex keeps beside them, and only those changed
  during the run. It checks every restored file.
- Every other changed file is kept as it is and listed for you, a save above all, even one
  made during the run: you may have played your own copy of the game while the test ran.
  The next start is refused until you decide with `doodlebot game restore <gameId>`.
- If Vortex crashed or was closed without `down`, nothing is restored automatically and the next
  start is refused. Run `doodlebot game restore <gameId>` to see the changed files, then choose:
  `--all` restores them all, `--keep` keeps them all, and `--file <path>` restores the ones you
  name.
- If the backup itself is gone, doodlebot says so. Check the folders, then run
  `doodlebot game restore <gameId> --keep` to keep them as they are.
- These protections, and the checks for your own Vortex and for the game running, work on
  Windows only. On another system the start goes ahead with a warning; close your own Vortex
  and the game yourself.

### Put game copies on a Dev Drive

A game copy is as large as the game. On Windows 11, a Dev Drive (formatted with ReFS) makes a
copy share the unchanged files with the original, so a copy costs only the files that change.
To use one:

1. Create a Dev Drive in Windows Settings, under System, Storage, Disks and volumes. This is
   your own disk setting; doodlebot does not create it.
2. Make your copies there: `doodlebot game copy <gameId> --to <folder on the Dev Drive>`.

## See what you can test against

`doodlebot inventory` lists everything doodlebot can use on this computer, and whether each item
is ready:

- builds: registered releases, the installed Vortex and your source checkout;
- games: registered copies, and Steam installs, which are listed as not usable until copied;
- baselines in the profile cache, with the build and game they were made for;
- the sandbox and the Bethesda sandbox, which are always ready;
- collections: the offline ones doodlebot builds, and Nexus collections, which need a login;
- the Nexus login, in `~/.doodlebot/login` for the main test Vortex (other caches have none).

Every item that is not ready shows the command that makes it ready, for example
`next: doodlebot game copy skyrimse`. A Steam install whose game already has a registered copy
says "a copy is registered" instead. Add `--json` for the full list in JSON. The command only
reads; it never starts Vortex.

## Free disk space

Game copies, old runs and caches can take a lot of space. `doodlebot clean` lists what it would
delete, and deletes it only when you add `--yes`:

- in run, QA and benchmark folders older than 30 days, every file of 1 MB or more; each
  `report.md` and the small files stay;
- baselines and caches not used for 30 days;
- releases that `~/.doodlebot/content.json` no longer names;
- the Vortex clone that earlier versions kept inside the workspace, which nothing uses now,
  whatever its age.

Use `--older-than <days>` for another age, and `--dry-run` to list only. `clean` never deletes a
registered game copy, the Nexus login, a backup waiting to be restored, or the cache or checkout
of the test Vortex while it runs.

```powershell
doodlebot clean --older-than 14
doodlebot clean --older-than 14 --yes
```

## What's next

- [Try things in Vortex](try-vortex.md) with the new baseline.
- [Sign in to Nexus Mods](sign-in.md) for collections.
