#!/usr/bin/env python3
"""Safety checks for the RG release pruning CLI."""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("prune-vps-releases.py")


class PruneVpsReleasesTest(unittest.TestCase):
    def test_dry_run_keeps_every_release(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "releases"
            root.mkdir()
            releases = []
            for number in range(5):
                sha = f"{number + 1:040x}"
                release = root / sha
                release.mkdir()
                (release / "RELEASE_SHA").write_text(sha + "\n")
                (release / "release.json").write_text(
                    json.dumps(
                        {
                            "schemaVersion": 1,
                            "repository": "rg",
                            "commit": sha,
                        }
                    )
                )
                (release / "SHA256SUMS").write_text("fixture\n")
                releases.append(release)
            (root.parent / "current").symlink_to(releases[-1], target_is_directory=True)

            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--root", str(root), "--max-delete", "1"],
                capture_output=True,
                text=True,
                check=True,
            )

            self.assertIn("WOULD_DELETE", result.stdout)
            self.assertIn("mode=dry-run", result.stdout)
            self.assertTrue(all(release.is_dir() for release in releases))

    def test_apply_rejects_fixture_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--root",
                    directory,
                    "--apply",
                    "--max-delete",
                    "1",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("--apply requires /home/ubuntu/apps/rg/releases", result.stderr)


if __name__ == "__main__":
    unittest.main()
