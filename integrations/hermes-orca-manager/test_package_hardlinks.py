import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('package_hardlinks', Path(__file__).with_name('separate-package-hardlinks.py'))
ownership = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ownership)


class PackageHardlinkTests(unittest.TestCase):
    def test_detachment_does_not_change_another_cache_or_payload_inode(self):
        with tempfile.TemporaryDirectory() as directory:
            original = Path(directory) / 'original'
            selected = Path(directory) / 'selected'
            original.write_bytes(b'package-fixture')
            original.chmod(0o644)
            os.link(original, selected)
            before = original.stat()
            ownership.separate_inode(selected, os.getuid(), os.getgid())
            self.assertEqual(original.stat().st_ino, before.st_ino)
            self.assertNotEqual(selected.stat().st_ino, before.st_ino)
            self.assertEqual(selected.read_bytes(), original.read_bytes())
            self.assertEqual(selected.stat().st_mode, original.stat().st_mode)
            self.assertEqual(original.stat().st_uid, before.st_uid)

    def test_symlinks_are_refused_without_touching_the_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            link = Path(directory) / 'link'
            link.symlink_to('/not-a-package')
            with self.assertRaises(ValueError):
                ownership.separate_inode(link, os.getuid(), os.getgid())
            self.assertTrue(link.is_symlink())


if __name__ == '__main__':
    unittest.main()
