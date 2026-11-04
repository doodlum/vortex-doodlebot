# Run native Vortex in a Linux VM

This branch adds experimental SSH source deployment and command forwarding. The normal
harness runs inside the guest, alongside native Vortex, with private profiles, owner leases,
MCP readiness and clean shutdown checks. Select a Vortex revision that supports Linux.

## Prerequisites

Prepare an x86-64 Linux VM with a logged-in desktop, SSH, Git, Python 3, compatible Node
(see `package.json`) and pnpm 9.15.0. Budget 100 GB for source and native dependencies.
Check `df -h /`: expanding a virtual disk does not necessarily grow its root partition.
Follow the selected Vortex revision's Linux build guide for native prerequisites.
Revisions that bundle the native Framework Mono C# installer runtime prepare it
automatically and do not need a system .NET SDK or Mono installation. Keep the
bundled assets with the selected Vortex build.

For an older revision that explicitly requires .NET 9, Microsoft's
[user-level installer](https://learn.microsoft.com/en-us/dotnet/core/install/linux-scripted-manual)
is an option when distro packages are unavailable. Verify `dotnet --list-sdks`,
export its installation directory as `DOTNET_ROOT`, and add it to `PATH`. That
revision may also need `DOTNET_ROOT` in the guest-local `harness/.env` for SSH launches.

The real-app viewport fixtures need desktop space for windows up to 1600×900.
Use a 1920×1080 guest display at 100% scaling for the core suite; a smaller Wayland
desktop can constrain the requested size. Change this in the guest's display settings.

Confirm that a guest login shell resolves `node` and `pnpm`, plus any additional
tools required by the selected Vortex revision. Set up SSH key
authentication and verify the guest fingerprint interactively first:

```powershell
ssh dev@your-vm-ip 'uname -srm'
```

The transport requires a trusted host key and noninteractive authentication. Use an SSH config
alias for custom ports, IPv6 or identities. Keep passwords and private keys out of commands
and repository files.

## Deploy source

From your local doodlebot checkout:

```powershell
pnpm run ai -- vm inspect --host dev@your-vm-ip --directory /home/dev/doodlebot-linux --owner linux-vm
pnpm run ai -- vm deploy --host dev@your-vm-ip --directory /home/dev/doodlebot-linux --owner linux-vm
```

`inspect` reports the host, disk, memory, tool locations and sessions. Its successful exit is
not a readiness certification; inspect missing tools in the output.

`deploy` requires a **new directory with an existing parent**. It transfers a Git bundle of
HEAD and a binary patch of tracked working changes, including staged additions and deletions.
The bundle includes reachable committed history, including any files committed in the past;
ignoring a file now does not remove it from that history.
Include required untracked source explicitly with repeated `--include relative/file.ts`.
Ignored files cannot be included; additions beneath hidden directories must be staged first.
No commit, push or published branch is required. Review tracked changes before transfer.

The guest has a detached HEAD plus the local diff. An archive SHA-256 is checked before
extraction and recorded in `.git/doodlebot-deployment-sha256`. This detects transfer corruption;
it is not a signed build identity. Ignored credentials, caches, host dependencies, build output
and `.vortex-src` are not copied. Existing destinations are refused, so live checkouts cannot
be overwritten. Failed directories/uploads remain for inspection; use a new destination
after resolving the failure.

## Prepare the guest runtime

Connect to the VM and install Linux dependencies:

```bash
cd ~/doodlebot-linux
pnpm install --frozen-lockfile
export VORTEX_AI_OWNER=linux-vm
pnpm run build
```

Use `--exe /absolute/native/executable` for a native installation. For source development,
configure `VORTEX_AI_VORTEX_REPO=owner/repository`, prepare the managed `.vortex-src`, select
the intended branch under the normal checkout lease, and build it:

```bash
pnpm run ai -- source --owner linux-vm
```

Follow that revision's own build prerequisites. Windows dependencies/output cannot be reused.
For SSH access to a logged-in Wayland desktop, configure guest-local `harness/.env`:

```dotenv
VORTEX_AI_OZONE_PLATFORM=wayland
WAYLAND_DISPLAY=wayland-0
XDG_RUNTIME_DIR=/run/user/1000
DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
```

Use the actual guest user ID and session socket names. `VORTEX_AI_OZONE_PLATFORM` accepts
`wayland` or `x11` on Linux; X11 also needs the session's `DISPLAY` and `XAUTHORITY`.
Tools launched by Vortex inherit its display environment. If a game or tool uses X11 in
a Wayland desktop, include those Xwayland values too. On a systemd desktop, inspect them with:

```bash
systemctl --user show-environment | grep -E '^(DISPLAY|XAUTHORITY|WAYLAND_DISPLAY|XDG_RUNTIME_DIR)='
```

Copy the required returned values into the guest-local `harness/.env`, then restart Vortex.
The authority filename can change after a new desktop login; use the current session's path.
SSH does not create a desktop. Keep Electron sandboxing enabled and diagnose distribution
sandbox restrictions separately.

## Run and verify

After preparing the native build:

```powershell
pnpm run ai -- vm run --host dev@your-vm-ip --directory /home/dev/doodlebot-linux --owner linux-vm -- doctor --no-game
pnpm run ai -- vm run --host dev@your-vm-ip --directory /home/dev/doodlebot-linux --owner linux-vm -- up --no-game --slot auto
pnpm run ai -- vm run --host dev@your-vm-ip --directory /home/dev/doodlebot-linux --owner linux-vm -- tools --json --slot auto
pnpm run ai -- vm run --host dev@your-vm-ip --directory /home/dev/doodlebot-linux --owner linux-vm -- snapshot --slot auto
pnpm run ai -- vm run --host dev@your-vm-ip --directory /home/dev/doodlebot-linux --owner linux-vm -- down --slot auto
```

The tail after `--` goes to the guest harness. The outer owner supplies the guest's default;
an inner `--owner` overrides it. Keep owner, slot and runtime flags consistent. Profiles,
logs and screenshots stay in the guest. MCP/CDP stay on guest loopback; use an explicit SSH
loopback tunnel if a local client needs them. Guest command/SSH exit codes propagate.

`--no-game` opens an isolated profile without registering an installed game. These test
profiles disable automatic startup discovery. Steam can still list a game under **New games
detected** before Vortex knows its local path. Use **Refresh scan** on the Games page before
**Add game**, or supply the game and its actual guest install directory when starting:

```bash
pnpm run ai -- up --owner linux-vm --slot auto --game stardewvalley --game-path '/actual/SteamLibrary/steamapps/common/Stardew Valley'
```

For known games, omit `--game-path` to search native/XDG Steam, Snap, Flatpak and
legacy Steam locations, then their `libraryfolders.vdf` entries. Directory aliases are
deduplicated. A candidate needs both its app manifest and expected executable; a leftover
game folder after uninstall does not count. Use an explicit path for other layouts.
An explicit path is marked as Steam only when it matches that game's actual installed
manifest. Copies and standalone Wine installations receive no store identity, allowing
Vortex to resolve their own Wine prefixes instead of requiring a Steam Proton prefix.
Setup preserves an existing store when it only repairs the executable at the same path.

The path must contain a supported executable file, not a directory with that name.
On Linux, Stardew accepts its native launcher `StardewValley` or executable
`Stardew Valley`, as well as `Stardew Valley.exe` for a Windows install under Proton.
Windows hosts require the Windows filename. An invalid explicit path fails even if another
installed copy is discoverable. Keep this game/path configuration on subsequent lifecycle commands.

For a Windows install on Linux, setup records the Windows executable so Play uses that file
instead of the game's native Linux default. Starting a cached profile repairs a missing
override when that Windows file exists. An explicit executable override remains in effect;
a native-only installation receives no Windows override. These path checks do not prove
a game starts: verify the discovered path and executable with the live tools, then observe
the intended native or Proton game process and window separately.

To use Nexus features, run `setup --oauth` in the guest with the same owner, slot and target.
Complete the browser login once. Doodlebot automatically saves refresh credentials in its
private, gitignored cache. `save-login` captures the current profile after a completed login;
`up --fresh` verifies restoration but resets other profile contents to that captured baseline.
`auth-status` reports presence flags only. A cached login that the service refuses requires a
new browser login. The source deployment command deliberately excludes login caches.

Deployment proves transfer only. Launch requires MCP readiness. Inspect live schemas, state
and UI before driving the app; verify a snapshot and clean shutdown. Run the account-free
core suite in the guest separately to establish install/deploy/purge behavior. This transport
does not establish compatibility for all games or Windows-specific fixtures.

After SSH interruption, remote processes may continue. Reconnect and inspect guest processes
and leases before retrying; local SSH exit does not prove guest shutdown.

## Control the Wayland desktop

Use `vm desktop` for native dialogs, desktop menus and game windows outside Vortex's
page. Vortex's own interface remains available through its normal automation tools.
This command sends input; it does not capture the desktop or log in to a graphical
session. Inspect a current desktop screenshot through your VM software before sending
pointer actions.

The guest needs a logged-in desktop with the XDG RemoteDesktop portal and Python's
dbus and GI bindings. On Ubuntu, install the bindings with:

```bash
sudo apt install python3-dbus python3-gi
```

Deploy the current doodlebot source, then open a session from the host:

```powershell
pnpm run ai -- vm desktop --host dev@your-vm-ip --directory /home/dev/doodlebot-linux --owner linux-vm
```

Approve the desktop's keyboard and mouse permission dialog. Wait for an output line
with `"stage": "approved"`, then check its `keyboard` and `pointer` flags. The desktop
can grant either device independently. Paste one JSON command per line into the
running session. For example, check the connection, open the overview with Super,
close it with Escape, then stop the session:

```json
{"action":"status"}
{"action":"key","keysym":65515}
{"action":"key","keysym":65307}
{"action":"close"}
```

Wait for each response before continuing. JSON input is also suitable for a process
that waits for approval before writing commands to stdin. `status` and `close` work
while approval is pending. Other input is refused until its device is granted.

| Action   | Fields                    | Effect                                                                                                             |
| -------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `move`   | `dx`, `dy`                | Relative pointer motion; each finite offset is limited to ±8192.                                                   |
| `click`  | optional `button`         | Press/release Linux button 272 (left, default), 273 (right) or 274 (middle).                                       |
| `scroll` | `steps`, optional `axis`  | Discrete scroll, ±100 steps; axis 0 is vertical, 1 horizontal.                                                     |
| `key`    | `keysym`                  | Press/release an X11 keysym through the Wayland portal.                                                            |
| `chord`  | `keysyms`                 | Hold one to eight distinct keysyms in order, then release in reverse order.                                        |
| `text`   | `text`, optional `method` | Send up to 4096 characters using `keysyms` (default) or GTK/IBus `compose`; newline sends Enter and tab sends Tab. |

Focus and keyboard layout affect the resulting input. A successful `sent` response
means the portal accepted the events; verify their visible result. A failed input
response does not certify that earlier events in the command had no effect.

For non-ASCII text in a GTK/IBus field, use an explicit composition command:

```json
{ "action": "text", "method": "compose", "text": "Doodlebot éλ" }
```

This uses the Linux Ctrl+Shift+U input method and gives each composed character
100ms to commit. Applications without that input method need their own supported
text entry route. Default `keysyms` mode can silently drop characters absent from
the current keyboard layout. With manually supplied shifted chords, use the shifted
keysym, such as uppercase `U` with Ctrl+Shift. Verify the resulting text before
submitting a dialog.

Input runs in order, with at most 32 waiting commands. Text yields between
characters. `close` and EOF finish accepted commands before closing; Ctrl+C or a
termination signal cancels queued input after the current step. The host forwards
stdin through Node, preserving Unicode instead of native SSH's Windows console encoding.

Portal version 2 can retain consent and return a rotating, single-use restore token.
Doodlebot stores it only in a guest-local private directory, defaulting to
`$XDG_CACHE_HOME/doodlebot/desktop` or `~/.cache/doodlebot/desktop`. The directory must
be owned by the guest user with mode `0700`; its regular cache files use `0600`.
`--desktop-cache-dir /absolute/private/guest/path` selects another cache. Do not
include tokens in source transfers, reports or screenshots. The same guest account
can reuse its cache across doodlebot checkouts; simultaneous sessions are refused.
Exclusion also uses a separate lock in the guest user's private runtime directory
(`$XDG_RUNTIME_DIR`, normally `/run/user/<uid>`). Selecting another token cache does
not permit a second controller for that desktop.

Closing and reconnecting can restore consent without another prompt. An older portal,
revoked grant or unavailable desktop can require approval again. No token value is
printed. Removing the guest's `restore.json` discards the saved local token; it does
not revoke an active desktop session. Stop active sharing through the desktop's
sharing indicator, the `close` command, EOF or Ctrl+C. After a transport failure,
inspect the guest process before retrying. The next connection may need renewed consent.

## Transport tests

```powershell
pnpm exec vitest run harness/src/linuxVm.test.ts harness/src/cliArgs.test.ts
pnpm exec vitest run harness/src/gameSetup.test.ts
```

These require kit dependencies and Git, no VM/account. They cover argument forwarding,
option/path boundaries, backend selection, and binary edits/deletions reconstructed from a
bundle. They do not prove a real Linux Vortex launch; retain VM evidence separately.
The game lookup fixtures additionally cover Linux Steam layouts, XDG settings, directory
aliases, alternate libraries, native and Proton executable files, missing manifests,
directory impostors and refusal to fall back from an invalid explicit path. They need no
installed game and do not prove a native or Proton game launch.

Check the desktop controller separately inside Linux:

```bash
python3 -m unittest discover -s harness -p linux_desktop_test.py -v
```

These tests use temporary files and inert input callbacks. They cover private cache
ownership/modes, linked paths, overlapping sessions, token rotation, input bounds,
modifier release, full-queue shutdown and fragmented JSON lines. They need Python 3, without dbus/GI,
a running desktop, Vortex or an account. They do not prove real portal consent,
reconnection or visible input. Verify those separately using the session procedure above.
