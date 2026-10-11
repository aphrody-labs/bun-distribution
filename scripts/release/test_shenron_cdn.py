# SPDX-License-Identifier: Apache-2.0
"""CDN staging must preserve old chunks and refuse protected or changed bodies."""

import importlib.util
import json
import os
import pathlib
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "cdn_stage", pathlib.Path(__file__).with_name("stage-shenron-cdn.py")
)
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)
seal_spec = importlib.util.spec_from_file_location(
    "cdn_seal", pathlib.Path(__file__).with_name("seal-shenron-docker-release.py")
)
seal = importlib.util.module_from_spec(seal_spec)
seal_spec.loader.exec_module(seal)


class CdnStageTests(unittest.TestCase):
    @unittest.skipIf(os.name == "nt", "POSIX permissions require the Linux factory")
    def test_private_umask_keeps_public_trees_traversable(self):
        with tempfile.TemporaryDirectory() as directory:
            base = pathlib.Path(directory)
            base.chmod(0o700)
            previous_umask = os.umask(0o077)
            try:
                release, artifact, previous = self.setup_tree(base)
                before = stage.digest(previous / "cdn/_next/static/old.js")
                receipt = stage.stage(release, artifact, previous)
                for relative in receipt["files"]:
                    path = release / relative
                    self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)
                    for parent in path.parents:
                        if parent == release:
                            break
                        self.assertEqual(stat.S_IMODE(parent.stat().st_mode), 0o755)
                self.assertEqual(stat.S_IMODE(base.stat().st_mode), 0o700)
                self.assertEqual(stat.S_IMODE(release.stat().st_mode), 0o700)
                self.assertEqual(stat.S_IMODE(artifact.stat().st_mode), 0o700)
                self.assertEqual(
                    before, stage.digest(previous / "cdn/_next/static/old.js")
                )
            finally:
                os.umask(previous_umask)

    def setup_tree(self, base):
        release = base / ("docker-" + "a" * 40)
        release.mkdir()
        (release / "compose.yaml").write_text(
            json.dumps({"services": {"gateway": {"volumes": []}}})
        )
        artifact = base / "artifact"
        (artifact / "site").mkdir(parents=True)
        (artifact / "site/robots.txt").write_text("User-agent: *")
        (artifact / "_next/static").mkdir(parents=True)
        (artifact / "_next/static/new.js").write_text("export default 1")
        previous = base / ("docker-" + "b" * 40)
        (previous / "cdn/_next/static").mkdir(parents=True)
        old = previous / "cdn/_next/static/old.js"
        old.write_text("export default 0")
        (previous / "release.json").write_text(
            json.dumps({"files": {"cdn/_next/static/old.js": stage.digest(old)}})
        )
        return release, artifact, previous

    def test_old_chunks_survive_and_mount_is_readonly(self):
        with tempfile.TemporaryDirectory() as directory:
            release, artifact, previous = self.setup_tree(pathlib.Path(directory))
            receipt = stage.stage(release, artifact, previous)
            self.assertEqual(
                (release / "cdn/_next/static/old.js").read_text(), "export default 0"
            )
            self.assertEqual(
                (release / "public/robots.txt").read_text(), "User-agent: *"
            )
            volume = json.loads((release / "compose.yaml").read_text())["services"][
                "gateway"
            ]["volumes"][0]
            self.assertEqual(volume["target"], "/srv/shenron-cdn/_next")
            self.assertTrue(volume["read_only"])
            self.assertFalse(receipt["activated"])
            for relative, sha in receipt["files"].items():
                self.assertEqual(stage.digest(release / relative), sha)

    def test_modified_previous_chunk_refused_before_write(self):
        with tempfile.TemporaryDirectory() as directory:
            release, artifact, previous = self.setup_tree(pathlib.Path(directory))
            (previous / "cdn/_next/static/old.js").write_text("changed")
            with self.assertRaises(ValueError):
                stage.stage(release, artifact, previous)
            self.assertFalse((release / "public").exists())

    def test_immutable_collision_refused_before_write(self):
        with tempfile.TemporaryDirectory() as directory:
            release, artifact, previous = self.setup_tree(pathlib.Path(directory))
            (artifact / "_next/static/old.js").write_text("different")
            with self.assertRaises(ValueError):
                stage.stage(release, artifact, previous)
            self.assertFalse((release / "public").exists())

    def test_secret_and_sealed_destination_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            release, artifact, _previous = self.setup_tree(pathlib.Path(directory))
            (artifact / "site/backup.sqlite").write_text("protected")
            with self.assertRaises(ValueError):
                stage.stage(release, artifact)
            (artifact / "site/backup.sqlite").unlink()
            (release / "release.json").write_text("{}")
            with self.assertRaises(ValueError):
                stage.stage(release, artifact)

    def test_seal_includes_exact_staged_chunk_digests(self):
        with tempfile.TemporaryDirectory() as directory:
            release, artifact, previous = self.setup_tree(pathlib.Path(directory))
            receipt = stage.stage(release, artifact, previous)
            (release / "deploy.env").write_text("# public config")
            vfs = pathlib.Path(directory) / "public-vfs"
            vfs.write_text("public")
            args = [
                "seal",
                str(release),
                "--commit",
                "a" * 40,
                "--image-id",
                "sha256:" + "c" * 64,
                "--public-vfs",
                str(vfs),
            ]
            with patch.object(sys, "argv", args):
                seal.main()
            manifest = json.loads((release / "release.json").read_text())
            for relative, sha in receipt["files"].items():
                self.assertEqual(manifest["files"][relative], sha)

    def test_seal_rejects_cdn_files_outside_static_subtree(self):
        with tempfile.TemporaryDirectory() as directory:
            release, _artifact, _previous = self.setup_tree(pathlib.Path(directory))
            (release / "cdn").mkdir()
            (release / "cdn/private.txt").write_text("not an allowed chunk")
            (release / "deploy.env").write_text("# public config")
            vfs = pathlib.Path(directory) / "public-vfs"
            vfs.write_text("public")
            args = [
                "seal",
                str(release),
                "--commit",
                "a" * 40,
                "--image-id",
                "sha256:" + "c" * 64,
                "--public-vfs",
                str(vfs),
            ]
            with patch.object(sys, "argv", args), self.assertRaises(SystemExit):
                seal.main()
            self.assertFalse((release / "release.json").exists())


if __name__ == "__main__":
    unittest.main()
