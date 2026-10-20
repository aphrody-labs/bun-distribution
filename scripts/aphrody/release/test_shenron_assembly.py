# SPDX-License-Identifier: Apache-2.0
"""Reject Compose private environment expansion before any release file is written."""

import argparse
import importlib.util
import io
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "assembly", pathlib.Path(__file__).with_name("assemble-shenron-docker-release.py")
)
assembly = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assembly)


class AssemblyPrivacyTests(unittest.TestCase):
    def test_release_includes_canonical_cdn_vfs_vhost(self):
        owner = pathlib.Path(__file__).resolve().parents[3]
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            nginx, public = root / "nginx", root / "public"
            nginx.mkdir()
            public.mkdir()

            assembly.copy_nginx_assets(owner, nginx, public)

            source = owner / "infra/config/host/nginx/shenron/cdn.dragonballfr.com.conf"
            bundled = nginx / source.name
            self.assertTrue(bundled.is_file())
            self.assertEqual(bundled.read_bytes(), source.read_bytes())
            self.assertIn(
                b"/api/v1/vfs/file?path=$shenron_vfs_asset_path",
                bundled.read_bytes(),
            )
            self.assertTrue((public / "50x.html").is_file())

    def test_shenron_memory_limits_include_observed_oom_headroom(self):
        self.assertEqual(assembly.MEMORY_LIMITS["bot"], "640m")
        self.assertEqual(assembly.MEMORY_LIMITS["site"], "1024m")

    def test_embedded_native_modules_use_a_private_cache_without_relaxing_tmp(self):
        service = {"user": "1234:5678", "tmpfs": ["/tmp:rw,noexec,nosuid,size=64m"]}
        assembly.configure_native_cache(service)
        self.assertEqual(service["environment"]["TMPDIR"], "/var/cache/shenron-native")
        self.assertEqual(service["tmpfs"][0], "/tmp:rw,noexec,nosuid,size=64m")
        self.assertIn("uid=1234,gid=5678,mode=0700", service["tmpfs"][1])
        self.assertIn("rw,exec,nosuid,nodev", service["tmpfs"][1])

    def test_native_cache_rejects_root_and_named_users(self):
        for user in ("0:0", "root", "ubuntu"):
            with self.subTest(user=user), self.assertRaises(ValueError):
                assembly.configure_native_cache({"user": user})

    def test_expanded_private_environment_never_creates_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            release = root / "release"
            args = argparse.Namespace(
                release=release,
                app_compose=root / "source.yaml",
                image_id="sha256:" + "a" * 64,
                gateway_image_id="sha256:" + "b" * 64,
                public_vfs=root / "vfs",
                state_image_id=None,
                chat_image_id=None,
                model_path=None,
                adapter_path=None,
            )
            config = {
                "services": {
                    "site": {
                        "env_file": ["/private/site.env"],
                        "environment": {"DATABASE_URL": "private-fixture-do-not-print"},
                    },
                    "bot": {"env_file": ["/private/bot.env"], "environment": {}},
                }
            }
            result = subprocess.CompletedProcess([], 0, stdout=json.dumps(config))
            with (
                patch.object(argparse.ArgumentParser, "parse_args", return_value=args),
                patch.object(assembly.subprocess, "run", return_value=result) as run,
                patch("sys.stderr", new_callable=io.StringIO) as stderr,
            ):
                with self.assertRaises(SystemExit):
                    assembly.main()
                self.assertNotIn("private-fixture-do-not-print", stderr.getvalue())
            self.assertFalse(release.exists())
            command = run.call_args.args[0]
            for flag in (
                "--no-env-resolution",
                "--no-interpolate",
                "--no-path-resolution",
            ):
                self.assertIn(flag, command)

    def test_missing_env_file_never_creates_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            args = argparse.Namespace(
                release=root / "release",
                app_compose=root / "source.yaml",
                image_id="image",
                gateway_image_id="gateway",
                public_vfs=root / "vfs",
                state_image_id=None,
                chat_image_id=None,
                model_path=None,
                adapter_path=None,
            )
            result = subprocess.CompletedProcess(
                [],
                0,
                stdout=json.dumps(
                    {
                        "services": {
                            "site": {"environment": {}},
                            "bot": {"environment": {}},
                        }
                    }
                ),
            )
            with (
                patch.object(argparse.ArgumentParser, "parse_args", return_value=args),
                patch.object(assembly.subprocess, "run", return_value=result),
                patch("sys.stderr", new_callable=io.StringIO),
                self.assertRaises(SystemExit),
            ):
                assembly.main()
            self.assertFalse(args.release.exists())


if __name__ == "__main__":
    unittest.main()
