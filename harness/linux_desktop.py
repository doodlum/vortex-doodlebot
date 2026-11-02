#!/usr/bin/env python3
"""Guest-local Wayland input through the consenting XDG RemoteDesktop portal.

JSON lines in/out. No TCP listener, arbitrary command execution or token export.
Requires Python dbus and GI bindings only when starting a real portal session.
"""

import argparse
from collections import deque
import json
import math
import os
from pathlib import Path
import signal
import stat
import sys
import uuid


class PrivateCache:
    """One private cache holder; dir-relative operations protect rotating credentials."""

    def __init__(self, directory):
        import fcntl

        directory = Path(directory)
        if not directory.is_absolute():
            raise ValueError("Desktop cache must be an absolute guest path")
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.lock_fd = None
        try:
            info = os.fstat(self.directory_fd)
            if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
                raise ValueError("Desktop cache must be owned by this user with mode 0700")
            self.lock_fd = self._open("session.lock", os.O_CREAT | os.O_RDWR)
            fcntl.flock(self.lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            self.close()
            raise

    def _open(self, name, flags):
        fd = os.open(name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600,
                     dir_fd=self.directory_fd)
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid()
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600):
            os.close(fd)
            raise ValueError("Desktop cache files must be owned regular files with mode 0600")
        return fd

    def consume(self):
        try:
            fd = self._open("restore.json", os.O_RDONLY)
        except FileNotFoundError:
            return None
        with os.fdopen(fd, "rb") as source:
            data = source.read(8193)
        if len(data) > 8192:
            raise ValueError("Invalid desktop restore data")
        try:
            saved = json.loads(data)
            token = saved["restore_token"]
            if (not isinstance(saved, dict) or set(saved) != {"restore_token"}
                    or not isinstance(token, str) or not 1 <= len(token) <= 4096):
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise ValueError("Invalid desktop restore data") from None
        # Restore tokens are single-use. Only the next successful Start can replace it.
        os.unlink("restore.json", dir_fd=self.directory_fd)
        return token

    def save(self, token):
        if not isinstance(token, str) or not 1 <= len(token) <= 4096:
            raise ValueError("Invalid desktop restore token returned by portal")
        name = "restore-" + uuid.uuid4().hex + ".tmp"
        fd = self._open(name, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        try:
            with os.fdopen(fd, "w") as target:
                json.dump({"restore_token": token}, target)
                target.flush()
                os.fsync(target.fileno())
            os.replace(name, "restore.json", src_dir_fd=self.directory_fd,
                       dst_dir_fd=self.directory_fd)
            os.fsync(self.directory_fd)
        finally:
            try:
                os.unlink(name, dir_fd=self.directory_fd)
            except FileNotFoundError:
                pass

    def close(self):
        if self.lock_fd is not None:
            os.close(self.lock_fd)
            self.lock_fd = None
        if self.directory_fd is not None:
            os.close(self.directory_fd)
            self.directory_fd = None


def desktop_lock(runtime_directory=None):
    """Independent of the selectable token cache, shared by this desktop user."""
    runtime = Path(runtime_directory or os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"))
    fd = os.open(runtime, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise ValueError("Desktop runtime directory must be owned with mode 0700")
    finally:
        os.close(fd)
    return PrivateCache(runtime/"doodlebot-desktop")


def integer(value, minimum, maximum):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError("Integer outside supported bounds")
    return value


class InputCommands:
    def __init__(self, notify):
        self.notify = notify
        self.devices = 0

    def _keys(self, keys):
        held = []
        failure = None
        try:
            for key in keys:
                held.append(key)
                self.notify("NotifyKeyboardKeysym", key, 1)
        except Exception as error:
            failure = error
        finally:
            for key in reversed(held):
                try:
                    self.notify("NotifyKeyboardKeysym", key, 0)
                except Exception as error:
                    failure = failure or error
        if failure:
            raise RuntimeError("Portal keyboard event failed") from None

    def text_steps(self, command):
        if not self.devices & 1:
            raise ValueError("Required desktop device permission is absent")
        text = command.get("text")
        method = command.get("method", "keysyms")
        if method not in ("keysyms", "compose"):
            raise ValueError("Unsupported text input method")
        if not isinstance(text, str) or not 1 <= len(text) <= 4096 or any(0xd800 <= ord(c) <= 0xdfff for c in text):
            raise ValueError("Text needs one to 4096 Unicode characters")
        return [(lambda c=character: self._character(c, method),
                 100 if method == "compose" and ord(character) > 127 else 0)
                for character in text]

    def _character(self, character, method):
        code = ord(character)
        if method == "compose" and code > 127:
            # GTK/IBus needs its event loop to commit before the next character.
            self._keys([0xffe3, 0xffe1, ord('U')])
            for digit in format(code, 'x'):
                self._keys([ord(digit)])
            self._keys([0xff0d])
            return
        key = {9: 0xff09, 10: 0xff0d}.get(code, code if code <= 255 else 0x01000000 | code)
        self._keys([key])

    def execute(self, command):
        if not isinstance(command, dict) or not isinstance(command.get("action"), str):
            raise ValueError("Expected an action object")
        action = command["action"]
        required = {"move": 2, "click": 2, "scroll": 2, "key": 1, "chord": 1, "text": 1}
        if action not in required:
            raise ValueError("Unsupported input action")
        if not self.devices & required[action]:
            raise ValueError("Required desktop device permission is absent")
        if action == "move":
            dx, dy = command.get("dx"), command.get("dy")
            for value in [dx, dy]:
                if type(value) not in (int, float) or not math.isfinite(value) or not -8192 <= value <= 8192:
                    raise ValueError("Motion outside supported bounds")
            self.notify("NotifyPointerMotion", float(dx), float(dy))
        elif action == "click":
            button = integer(command.get("button", 272), 272, 274)
            try:
                self.notify("NotifyPointerButton", button, 1)
            finally:
                self.notify("NotifyPointerButton", button, 0)
        elif action == "scroll":
            axis = integer(command.get("axis", 0), 0, 1)
            steps = integer(command.get("steps"), -100, 100)
            self.notify("NotifyPointerAxisDiscrete", axis, steps)
        elif action == "key":
            self._keys([integer(command.get("keysym"), 0, 0x1fffffff)])
        elif action == "chord":
            keys = command.get("keysyms")
            if not isinstance(keys, list) or not 1 <= len(keys) <= 8:
                raise ValueError("A chord needs one to eight keysyms")
            keys = [integer(key, 0, 0x1fffffff) for key in keys]
            if len(set(keys)) != len(keys):
                raise ValueError("Chord keysyms must be distinct")
            self._keys(keys)
        elif action == "text":
            for perform, _ in self.text_steps(command):
                perform()
        return {"action": action, "sent": True}


class JsonLines:
    """Unbuffered input avoids GLib losing a second line already read by TextIO."""

    def __init__(self, accept):
        self.accept = accept
        self.buffer = b""

    def feed(self, data, eof=False):
        self.buffer += data
        while b"\n" in self.buffer:
            line, self.buffer = self.buffer.split(b"\n", 1)
            self._line(line)
        if len(self.buffer) > 16384:
            raise ValueError("Desktop command exceeds 16384 bytes")
        if eof and self.buffer:
            self._line(self.buffer)
            self.buffer = b""

    def _line(self, line):
        if len(line) > 16384:
            raise ValueError("Desktop command exceeds 16384 bytes")
        if line.strip():
            try:
                value = json.loads(line)
            except (ValueError, UnicodeError):
                raise ValueError("Invalid JSON command") from None
            self.accept(value)


class CommandQueue:
    """Shutdown is control state and never consumes an input slot."""

    def __init__(self):
        self.commands = deque()
        self.draining = False

    def append(self, command):
        if self.draining or len(self.commands) >= 32:
            raise ValueError("Desktop input queue is full or draining")
        self.commands.append(command)

    def finish(self):
        self.draining = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--cache-dir", type=Path)
    args = parser.parse_args()
    if not args.owner.strip() or len(args.owner) > 200:
        parser.error("A named owner is required")

    def report(**values):
        print(json.dumps(values), flush=True)

    if sys.platform != "linux":
        report(error="Desktop portal control requires Linux")
        return 1
    try:
        import dbus
        from dbus.mainloop.glib import DBusGMainLoop
        from gi.repository import GLib, GLibUnix
    except ImportError:
        report(error="Install the guest Python dbus and GI bindings (Ubuntu: python3-dbus python3-gi)")
        return 1

    directory = args.cache_dir or Path(os.environ.get("XDG_CACHE_HOME", str(Path.home()/".cache")))/"doodlebot"/"desktop"
    cache = None
    exclusion = None
    loop = GLib.MainLoop()
    session = None
    pending = set()
    receivers = []
    closing = False
    exit_code = 0
    queued = CommandQueue()
    active = None
    timer = None
    os.environ.setdefault("DBUS_SESSION_BUS_ADDRESS", f"unix:path=/run/user/{os.getuid()}/bus")

    def close(*_, failed=False, remote=True):
        nonlocal closing, exit_code, active, timer
        if closing:
            return False
        closing = True
        exit_code = 1 if failed else exit_code
        commands.devices = 0
        queued.commands.clear()
        active = None
        if timer is not None:
            GLib.source_remove(timer)
            timer = None
        for handle in list(pending):
            try:
                dbus.Interface(bus.get_object("org.freedesktop.portal.Desktop", handle),
                               "org.freedesktop.portal.Request").Close(timeout=5)
            except dbus.DBusException:
                pass
        if session and remote:
            try:
                dbus.Interface(bus.get_object("org.freedesktop.portal.Desktop", session),
                               "org.freedesktop.portal.Session").Close(timeout=5)
            except dbus.DBusException:
                pass
        loop.quit()
        report(stage="closed")
        return False

    def fail(reason):
        report(error=reason)
        close(failed=True)

    def notify(method, *values):
        getattr(portal, method)(dbus.ObjectPath(session), {}, *values, timeout=5)

    commands = InputCommands(notify)

    def pump():
        nonlocal active, timer
        timer = None
        if closing:
            return False
        if active is None:
            if not queued.commands:
                if queued.draining:
                    return close()
                return False
            value = queued.commands.popleft()
            try:
                if value["action"] == "text":
                    steps = commands.text_steps(value)
                else:
                    steps = [(lambda: commands.execute(value), 0)]
                active = (value["action"], iter(steps))
            except (ValueError, RuntimeError, dbus.DBusException):
                report(error="Desktop command refused or failed")
        delay = 0
        if active is not None:
            try:
                perform, delay = next(active[1])
                perform()
            except StopIteration:
                report(action=active[0], sent=True)
                active = None
            except (ValueError, RuntimeError, dbus.DBusException):
                report(error="Desktop command refused or failed")
                active = None
        if active is not None or queued.commands:
            timer = GLib.timeout_add(delay, pump) if delay else GLib.idle_add(pump)
        elif queued.draining:
            return close()
        return False

    def enqueue(value):
        nonlocal timer
        queued.append(value)
        if timer is None and active is None:
            timer = GLib.idle_add(pump)

    def drain():
        nonlocal timer
        queued.finish()
        if timer is None and active is None:
            timer = GLib.idle_add(pump)

    def accept(value):
        if closing:
            return
        try:
            if not isinstance(value, dict):
                raise ValueError("Expected an action object")
            action = value.get("action")
            if not isinstance(action, str):
                raise ValueError("Expected a named action")
            if action == "close":
                if not commands.devices:
                    close()
                else:
                    drain()
            elif action == "status":
                report(stage="approved" if commands.devices else "pending",
                       keyboard=bool(commands.devices & 1), pointer=bool(commands.devices & 2))
            else:
                if not commands.devices:
                    raise ValueError("Desktop consent is pending")
                enqueue(value)
        except (ValueError, RuntimeError, dbus.DBusException):
            # Input may contain secrets. Never echo it or exception argument values.
            report(error="Desktop command refused or failed")

    lines = JsonLines(accept)

    def readable(fd, condition):
        try:
            received = 0
            while not closing:
                try:
                    data = os.read(fd, 4096)
                except BlockingIOError:
                    return True
                if not data:
                    lines.feed(b"", eof=True)
                    if commands.devices:
                        drain()
                    else:
                        close()
                    return False
                lines.feed(data)
                received += len(data)
                if received >= 65536:
                    return True
        except (ValueError, OSError):
            fail("Invalid desktop command stream")
        return not closing

    def request(method, arguments, options, done):
        token = "doodlebot_" + uuid.uuid4().hex
        handle = "/org/freedesktop/portal/desktop/request/" + bus.get_unique_name()[1:].replace(".", "_") + "/" + token
        pending.add(handle)

        def response(code, result):
            pending.discard(handle)
            if closing:
                return
            if int(code) != 0:
                fail("Desktop consent cancelled, denied or unavailable")
                return
            try:
                done(result)
            except Exception:
                fail("Desktop portal setup failed")

        receivers.append(bus.add_signal_receiver(response, "Response", "org.freedesktop.portal.Request", path=handle))
        actual = method(*arguments, {**options, "handle_token": token}, timeout=10)
        if str(actual) != handle:
            raise RuntimeError("Unexpected portal request identity")

    try:
        exclusion = desktop_lock()
        cache = PrivateCache(directory)
        DBusGMainLoop(set_as_default=True)
        bus = dbus.SessionBus()
        proxy = bus.get_object("org.freedesktop.portal.Desktop", "/org/freedesktop/portal/desktop")
        portal = dbus.Interface(proxy, "org.freedesktop.portal.RemoteDesktop")
        properties = dbus.Interface(proxy, "org.freedesktop.DBus.Properties")
        version = int(properties.Get("org.freedesktop.portal.RemoteDesktop", "version", timeout=5))
        restored = False

        def started(result):
            commands.devices = int(result.get("devices", 0))
            if not commands.devices & 3:
                fail("No desktop input device was granted")
                return
            persisted = bool(result.get("restore_token"))
            if persisted:
                cache.save(str(result["restore_token"]))
            report(stage="approved", owner=args.owner, keyboard=bool(commands.devices & 1),
                   pointer=bool(commands.devices & 2), restore_attempted=restored, token_saved=persisted)

        def selected(_):
            report(stage="starting", restore_attempted=restored)
            request(portal.Start, [dbus.ObjectPath(session), ""], {}, started)

        def created(result):
            nonlocal session, restored
            session = str(result["session_handle"])
            receivers.append(bus.add_signal_receiver(lambda: close(failed=True, remote=False),
                             "Closed", "org.freedesktop.portal.Session", path=session))
            options = {"types": dbus.UInt32(3)}
            if version >= 2:
                options["persist_mode"] = dbus.UInt32(2)
                token = cache.consume()
                if token:
                    options["restore_token"] = token
                    restored = True
            request(portal.SelectDevices, [dbus.ObjectPath(session)], options, selected)

        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            GLibUnix.signal_add(GLib.PRIORITY_DEFAULT, signum, close)
        os.set_blocking(sys.stdin.fileno(), False)
        GLib.io_add_watch(sys.stdin.fileno(), GLib.IO_IN | GLib.IO_HUP | GLib.IO_ERR, readable)
        request(portal.CreateSession, [], {"session_handle_token": "doodlebot_" + uuid.uuid4().hex}, created)
        report(stage="request-created", owner=args.owner)
        loop.run()
    except Exception:
        report(error="Desktop session could not start; check the guest desktop bus, portal and private cache")
        close(failed=True)
    finally:
        if not closing:
            close()
        if cache:
            cache.close()
        if exclusion:
            exclusion.close()
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
