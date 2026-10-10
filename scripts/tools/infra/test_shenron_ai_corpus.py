# SPDX-License-Identifier: Apache-2.0
import importlib.util
import json
import pathlib
import unittest

spec = importlib.util.spec_from_file_location(
    "corpus", pathlib.Path(__file__).with_name("shenron-ai-corpus.py")
)
corpus = importlib.util.module_from_spec(spec)
spec.loader.exec_module(corpus)


class EditorialQualificationTest(unittest.TestCase):
    def row(self, url="/wiki/characters/goku"):
        return (
            7,
            "Goku",
            url,
            "Known existing passage\n\\.\nkept intact",
            "wiki",
            "fr",
            "wiki:goku",
            "goku",
        )

    def test_preserves_passage_and_lineage(self):
        result = corpus.qualify(self.row())
        self.assertEqual(result[1], "shenron:7")
        self.assertEqual(result[3], "https://dragonballfr.com/wiki/characters/goku")
        self.assertEqual(result[4], self.row()[3])
        self.assertEqual(json.loads(result[5])["originSourceId"], "wiki:goku")

    def test_refuses_fandom_and_credentials(self):
        for url in (
            "https://dragonball.fandom.com/wiki/Goku",
            "https://fandom.com/x",
            "https://u:p@dragonballfr.com/x",
            "file:///private/source",
        ):
            with self.assertRaises(ValueError):
                corpus.qualify(self.row(url))

    def test_refuses_empty_or_oversized_source(self):
        for content in ("", "  ", "a" * (512 * 1024 + 1)):
            row = list(self.row())
            row[3] = content
            with self.assertRaises(ValueError):
                corpus.qualify(row)


if __name__ == "__main__":
    unittest.main()
