# SPDX-License-Identifier: Apache-2.0
from pathlib import Path

from aphrody.google_runtime import runtime


def test_runtime_defaults_to_aphrody(monkeypatch) -> None:
    monkeypatch.delenv("APHRODY_VERTEX_PROJECT", raising=False)
    monkeypatch.delenv("GOOGLE_CLOUD_PROJECT", raising=False)
    assert runtime().project == "aphrody"


def test_runtime_honors_rgfr_and_home(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "rgfr")
    monkeypatch.setenv("APHRODY_HOME", str(tmp_path))
    assert runtime().project == "rgfr"
    assert runtime().home == tmp_path
