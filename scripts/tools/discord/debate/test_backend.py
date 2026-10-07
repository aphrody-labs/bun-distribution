# SPDX-License-Identifier: Apache-2.0
"""Protocol and canonical dataset compatibility checks, using synthetic text only."""

import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location(
    "debate_backend", pathlib.Path(__file__).with_name("backend.py")
)
backend = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backend)


class BridgeTests(unittest.TestCase):
    def test_json_and_sse_rpc(self):
        message = {"id": 2, "result": {"ok": True}}
        self.assertEqual(backend.decode_rpc(json.dumps(message)), message)
        self.assertEqual(
            backend.decode_rpc("data: \n\ndata: " + json.dumps(message) + "\n\n"),
            message,
        )

    def test_invalid_response_fails_closed(self):
        with self.assertRaises(ValueError):
            backend.decode_rpc("data: \n\n")

    def test_unowned_tool_rejected_before_credentials(self):
        with self.assertRaisesRegex(ValueError, "outside debate scope"):
            backend.call("aphrody_shenron_rag_ingest", {})

    def test_native_training_reader_accepts_approved_rollout(self):
        from aphrody_train.dataset import extract

        rows = [
            {"item": {"type": "session_meta", "payload": {"id": "synthetic-debate"}}},
            {
                "item": {
                    "type": "history_item",
                    "message": {
                        "role": "user",
                        "parts": [{"text": "Question synthétique"}],
                    },
                }
            },
            {
                "item": {
                    "type": "history_item",
                    "message": {
                        "role": "model",
                        "parts": [{"text": "Réponse synthétique [S1]"}],
                    },
                }
            },
            {
                "item": {
                    "type": "event",
                    "msg": {
                        "type": "turn_complete",
                        "last_agent_message": "Réponse synthétique [S1]",
                    },
                }
            },
        ]
        with tempfile.TemporaryDirectory() as stage:
            path = pathlib.Path(stage) / "rollout.jsonl"
            path.write_text("\n".join(json.dumps(row) for row in rows))
            turns, preferences = extract(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0]["messages"][-1]["role"], "model")
        self.assertEqual(preferences, [])


if __name__ == "__main__":
    unittest.main()
