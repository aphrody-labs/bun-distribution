# SPDX-License-Identifier: Apache-2.0
import io
import json
import sys

from aphrody_train.protocol import TrainEmitter


def test_protocol_emits_jsonl():
    buf = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = buf
    try:
        emitter = TrainEmitter("test-job")
        emitter.start("dry_run", 10, {"foo": "bar"})
        emitter.progress(1, 10, 1.25)
        emitter.eval(1, {"recall@5": 0.85})
        emitter.artifact("model", "/tmp/model.onnx", "abc", 100)
        emitter.done("all good")
    finally:
        sys.stdout = old_stdout

    lines = [json.loads(line) for line in buf.getvalue().strip().split("\n")]
    assert len(lines) == 5
    assert lines[0]["type"] == "start"
    assert lines[0]["job_id"] == "test-job"
    assert lines[1]["type"] == "progress"
    assert lines[1]["step"] == 1
    assert lines[2]["type"] == "eval"
    assert lines[2]["metrics"]["recall@5"] == 0.85
    assert lines[3]["type"] == "artifact"
    assert lines[4]["type"] == "done"
