from __future__ import annotations

import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

from koharu_model_tools import DinoV2Exporter, EfficientNetExporter


def _install_fake_export_dependencies(monkeypatch) -> list[tuple[str, str]]:
    calls: list[tuple[str, str]] = []

    class Model:
        def state_dict(self):
            return {"backbone.linear_head.weight": [1, 2, 3]}

    def load(repository, model_name, *, layers):
        calls.append((repository, model_name))
        return Model()

    torch = ModuleType("torch")
    torch.hub = SimpleNamespace(load=load)

    models = ModuleType("torchvision.models")

    def efficientnet(*, weights):
        return Model()

    models.efficientnet_b0 = efficientnet
    torchvision = ModuleType("torchvision")
    torchvision.models = models

    safetensors = ModuleType("safetensors")
    safetensors_torch = ModuleType("safetensors.torch")

    def save_file(weights, path):
        Path(path).write_text(repr(weights), encoding="utf-8")

    safetensors_torch.save_file = save_file
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "torchvision", torchvision)
    monkeypatch.setitem(sys.modules, "torchvision.models", models)
    monkeypatch.setitem(sys.modules, "safetensors", safetensors)
    monkeypatch.setitem(sys.modules, "safetensors.torch", safetensors_torch)
    return calls


def test_exporter_package_is_lightweight():
    assert "torch" not in sys.modules
    assert "torchvision" not in sys.modules


def test_efficientnet_exporter_returns_generated_artifacts(tmp_path, monkeypatch):
    _install_fake_export_dependencies(monkeypatch)
    destination = tmp_path / "models"

    outputs = EfficientNetExporter(("efficientnet_b0",)).export(destination)

    assert outputs == (destination / "efficientnet-b0.safetensors",)
    assert outputs[0].is_file()


def test_dinov2_exporter_uses_configured_repository_and_normalizes_keys(
    tmp_path, monkeypatch
):
    calls = _install_fake_export_dependencies(monkeypatch)
    destination = tmp_path / "dinov2"

    outputs = DinoV2Exporter(("small",), repository="example/dinov2@rev").export(
        destination
    )

    assert calls == [("example/dinov2@rev", "dinov2_vits14_lc")]
    assert outputs == (destination / "dinov2_vits14.safetensors",)
    assert outputs[0].read_text(encoding="utf-8") == "{'weight': [1, 2, 3]}"


@pytest.mark.parametrize(
    ("exporter", "argument"),
    [
        (EfficientNetExporter(("other",)), "model_names"),
        (DinoV2Exporter(("other",)), "model_sizes"),
    ],
)
def test_exporters_reject_unknown_models(tmp_path, exporter, argument):
    with pytest.raises(ValueError, match="Unsupported"):
        exporter.export(tmp_path / argument)
