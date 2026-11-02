"""Pure guest tests: python3 -m unittest discover -s harness -p linux_desktop_test.py."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest

from linux_desktop import CommandQueue, InputCommands, JsonLines, PrivateCache, desktop_lock


class InputTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.commands = InputCommands(lambda *args: self.calls.append(args))

    def test_permission_is_required_before_any_event(self):
        with self.assertRaises(ValueError):
            self.commands.execute({'action': 'key', 'keysym': 65})
        self.commands.devices = 1
        with self.assertRaises(ValueError):
            self.commands.execute({'action': 'click'})
        self.assertEqual(self.calls, [])

    def test_invalid_complete_chord_cannot_press_a_modifier(self):
        self.commands.devices = 1
        for keys in [[65507, True], [65507, -1], [65507, 65507]]:
            with self.assertRaises(ValueError):
                self.commands.execute({'action': 'chord', 'keysyms': keys})
        self.assertEqual(self.calls, [])

    def test_partial_chord_failure_releases_every_attempted_key(self):
        def notify(method, key, state):
            self.calls.append((method, key, state))
            if key == 65:
                raise RuntimeError('inert transport failure')
        self.commands.notify = notify
        self.commands.devices = 1
        with self.assertRaises(RuntimeError):
            self.commands.execute({'action': 'chord', 'keysyms': [65507, 65]})
        self.assertEqual([(key, state) for _, key, state in self.calls],
                         [(65507, 1), (65, 1), (65, 0), (65507, 0)])

    def test_pointer_rejects_coercion_nonfinite_and_excessive_values(self):
        self.commands.devices = 2
        for value in [True, '1', float('nan'), float('inf'), 8193]:
            with self.assertRaises(ValueError):
                self.commands.execute({'action': 'move', 'dx': value, 'dy': 0})
        self.assertEqual(self.calls, [])

    def test_batched_and_fragmented_utf8_lines_are_not_lost(self):
        accepted = []
        stream = JsonLines(accepted.append)
        stream.feed(b'{"action":"text","text":"\xc3')
        stream.feed(b'\xa9"}\r\n{"action":"status"}\n{"action":"close"}', eof=True)
        self.assertEqual(accepted, [{'action':'text','text':'é'}, {'action':'status'}, {'action':'close'}])

    def test_input_is_bounded_without_echoing_payload(self):
        stream = JsonLines(lambda _: None)
        with self.assertRaisesRegex(ValueError, 'exceeds'):
            stream.feed(b'x' * 16385)
        with self.assertRaisesRegex(ValueError, '^Invalid JSON command$'):
            JsonLines(lambda _: None).feed(b'{"private value"\n')

    def test_full_queue_can_finish_without_losing_accepted_input(self):
        queue = CommandQueue()
        for number in range(32):
            queue.append({'action':'key', 'keysym':number})
        queue.finish()
        self.assertTrue(queue.draining)
        self.assertEqual([queue.commands.popleft()['keysym'] for _ in range(32)], list(range(32)))
        self.assertFalse(queue.commands)
        with self.assertRaises(ValueError):
            queue.append({'action':'key','keysym':33})

    def test_queue_overflow_preserves_the_accepted_order(self):
        queue = CommandQueue()
        for number in range(32):
            queue.append(number)
        with self.assertRaises(ValueError):
            queue.append(32)
        queue.finish()
        queue.finish()
        self.assertEqual(list(queue.commands), list(range(32)))

    def test_unicode_text_and_keys_are_released(self):
        self.commands.devices = 1
        result = self.commands.execute({'action':'text', 'text':'éλ\n'})
        self.assertEqual(result, {'action':'text','sent':True})
        self.assertEqual([(key, state) for _, key, state in self.calls],
                         [(233,1),(233,0),(0x010003bb,1),(0x010003bb,0),(0xff0d,1),(0xff0d,0)])

    def test_compose_is_explicit_and_releases_its_modifiers(self):
        self.commands.devices = 1
        self.commands.execute({'action':'text','text':'λ','method':'compose'})
        self.assertEqual([(key, state) for _, key, state in self.calls],
                         [(0xffe3,1),(0xffe1,1),(85,1),(85,0),(0xffe1,0),(0xffe3,0),
                          (51,1),(51,0),(98,1),(98,0),(98,1),(98,0),(0xff0d,1),(0xff0d,0)])


@unittest.skipUnless(sys.platform == 'linux', 'Linux file ownership, no-follow and flock contract')
class CacheTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)/'private'
        self.cache = PrivateCache(self.directory)

    def tearDown(self):
        self.cache.close()
        self.temporary.cleanup()

    def test_rotation_consumes_once_and_preserves_private_modes(self):
        self.assertIsNone(self.cache.consume())
        self.cache.save('inert-first-token')
        self.assertEqual(self.cache.consume(), 'inert-first-token')
        self.assertIsNone(self.cache.consume())
        self.cache.save('inert-second-token')
        self.assertEqual((self.directory/'restore.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.cache.consume(), 'inert-second-token')

    def test_same_user_cannot_overlap_a_live_session(self):
        with self.assertRaises(BlockingIOError):
            PrivateCache(self.directory)
        self.cache.close()
        self.cache = PrivateCache(self.directory)

    def test_token_symlinks_and_hardlinks_are_refused(self):
        outside = Path(self.temporary.name)/'outside'
        outside.write_text(json.dumps({'restore_token':'inert-token'}))
        outside.chmod(0o600)
        token = self.directory/'restore.json'
        token.symlink_to(outside)
        with self.assertRaises(OSError):
            self.cache.consume()
        token.unlink()
        os.link(outside, token)
        with self.assertRaises(ValueError):
            self.cache.consume()
        self.assertTrue(outside.exists())

    def test_permissions_fifo_and_oversized_data_fail_closed(self):
        token = self.directory/'restore.json'
        token.write_text('{}')
        token.chmod(0o644)
        with self.assertRaises(ValueError):
            self.cache.consume()
        token.unlink()
        os.mkfifo(token, 0o600)
        with self.assertRaises(ValueError):
            self.cache.consume()
        token.unlink()
        token.write_bytes(b'x' * 8193)
        token.chmod(0o600)
        with self.assertRaisesRegex(ValueError, '^Invalid desktop restore data$'):
            self.cache.consume()

    def test_directory_symlink_or_public_cache_is_refused(self):
        self.cache.close()
        self.directory.chmod(0o755)
        with self.assertRaises(ValueError):
            PrivateCache(self.directory)
        self.directory.chmod(0o700)
        alias = Path(self.temporary.name)/'alias'
        alias.symlink_to(self.directory)
        with self.assertRaises(OSError):
            PrivateCache(alias)

    def test_desktop_lock_excludes_different_credential_caches(self):
        runtime = Path(self.temporary.name)/'runtime'
        runtime.mkdir(mode=0o700)
        other_cache = PrivateCache(Path(self.temporary.name)/'other-cache')
        first = desktop_lock(runtime)
        try:
            with self.assertRaises(BlockingIOError):
                desktop_lock(runtime)
        finally:
            first.close()
            other_cache.close()
        replacement = desktop_lock(runtime)
        replacement.close()


if __name__ == '__main__':
    unittest.main()
