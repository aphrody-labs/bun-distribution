# SPDX-License-Identifier: Apache-2.0
"""Certificate publication must preserve permissions and reject foreign stores."""

import importlib.util
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "certificate_owner",
    pathlib.Path(__file__).with_name("certbot-shenron-container.py"),
)
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


class CertificatePublicationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = pathlib.Path(self.directory.name)
        self.source = self.root / "source"
        self.target = self.root / "target"
        self.lineage = self.source / "live/dragonballfr.com"
        self.lineage.mkdir(parents=True)
        archive = self.source / "archive/dragonballfr.com"
        archive.mkdir(parents=True)
        for name in ("cert", "chain", "fullchain", "privkey"):
            path = archive / (name + "3.pem")
            path.write_bytes((name + "-fixture").encode())
            path.chmod(0o600 if name == "privkey" else 0o644)
            (self.lineage / (name + ".pem")).symlink_to(path)
        self.addCleanup(patch.stopall)
        patch.object(owner, "SOURCE", self.source).start()
        patch.object(owner, "TARGET", self.target).start()
        patch.object(owner.os, "geteuid", return_value=0).start()
        patch.dict(os.environ, RENEWED_LINEAGE=str(self.lineage)).start()
        self.command = patch.object(owner, "command").start()

    def test_private_key_permissions_and_atomic_live_links_are_preserved(self):
        owner.main()
        published = self.target / "live/dragonballfr.com/privkey.pem"
        self.assertEqual(published.read_bytes(), b"privkey-fixture")
        self.assertEqual(published.stat().st_mode & 0o777, 0o600)
        self.assertTrue(published.resolve().is_relative_to(self.target / "archive"))
        self.assertEqual(
            self.command.call_args.args[0],
            ["docker", "exec", "aphrody-gateway-1", "nginx", "-s", "reload"],
        )

    def test_archive_escape_is_rejected_without_gateway_reload(self):
        private = self.root / "unrelated-credential"
        private.write_bytes(b"unrelated-fixture")
        link = self.lineage / "cert.pem"
        link.unlink()
        link.symlink_to(private)
        with self.assertRaisesRegex(RuntimeError, "escapes"):
            owner.main()
        self.assertFalse(self.target.exists())
        self.assertFalse(
            any("docker" in call.args[0] for call in self.command.call_args_list)
        )

    def test_another_profile_lineage_is_ignored(self):
        with patch.dict(
            os.environ, RENEWED_LINEAGE=str(self.source / "live/example.org")
        ):
            owner.main()
        self.command.assert_not_called()
        self.assertFalse(self.target.exists())


if __name__ == "__main__":
    unittest.main()
