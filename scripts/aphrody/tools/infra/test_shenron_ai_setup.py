# SPDX-License-Identifier: Apache-2.0
import importlib.util
import pathlib
import unittest
import urllib.parse

spec = importlib.util.spec_from_file_location(
    "setup", pathlib.Path(__file__).with_name("shenron-ai-setup.py")
)
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class ComputeEnvironmentTest(unittest.TestCase):
    def environment(self):
        return {
            "DATABASE_URL": "postgresql://shenron:fixture-only@127.0.0.1:5432/shenron_site?sslmode=disable",
            "APHRODY_AI_HTTP_TOKEN": "fixture-only-" * 4,
        }

    def test_preserves_auth_and_isolates_schema(self):
        source = self.environment()
        values = setup.compute_environment(source)
        url = urllib.parse.urlsplit(values["APHRODY_MCP_DATABASE_URL"])
        self.assertEqual(url.password, "fixture-only")
        self.assertEqual(
            urllib.parse.parse_qs(url.query)["options"],
            ["-c search_path=shenron_compute,public"],
        )
        self.assertEqual(
            values["APHRODY_SHENRON_API_TOKEN"], source["APHRODY_AI_HTTP_TOKEN"]
        )
        self.assertEqual(values["APHRODY_AI_CHAT_BASE_URL"], "http://127.0.0.1:8799/v1")

    def test_refuses_conflicting_or_missing_credentials(self):
        for extra in (
            {"APHRODY_AI_HTTP_TOKEN": ""},
            {"APHRODY_SHENRON_API_TOKEN": "different-fixture-" * 4},
        ):
            with self.assertRaises(ValueError):
                setup.compute_environment(self.environment() | extra)

    def test_refuses_foreign_database(self):
        for url in (
            "postgresql://u:p@remote:5432/shenron_site",
            "postgresql://u:p@127.0.0.1:5432/aphrody",
            "http://127.0.0.1:5432/shenron_site",
        ):
            with self.assertRaises(ValueError):
                setup.compute_environment(self.environment() | {"DATABASE_URL": url})


if __name__ == "__main__":
    unittest.main()
