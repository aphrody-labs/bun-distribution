from __future__ import annotations

import json
import sys
from pathlib import Path
from types import ModuleType

import pytest

from aphrody_embedding_fixtures import (
    EmbeddingFixtureGenerator,
    RerankFixtureGenerator,
)


def _install_fake_models(monkeypatch) -> None:
    torch = ModuleType("torch")
    torch.__version__ = "test-torch"
    torch.set_num_threads = lambda count: None

    transformers = ModuleType("transformers")
    transformers.__version__ = "test-transformers"

    sentence_transformers = ModuleType("sentence_transformers")
    sentence_transformers.__version__ = "test-sentence-transformers"

    class SentenceTransformer:
        max_seq_length = 8

        def __init__(self, model_id, *, revision, device):
            self.model_id = model_id

        def encode(self, texts, *, batch_size, convert_to_numpy):
            return [[0.25, 0.75] for _ in texts]

    class CrossEncoder:
        activation_fn = object()

        def __init__(self, model_id, *, revision, device):
            self.model_id = model_id

        def predict(self, pairs, *, batch_size, convert_to_numpy):
            return [0.4 for _ in pairs]

    sentence_transformers.SentenceTransformer = SentenceTransformer
    sentence_transformers.CrossEncoder = CrossEncoder
    monkeypatch.setitem(sys.modules, "torch", torch)
    monkeypatch.setitem(sys.modules, "transformers", transformers)
    monkeypatch.setitem(sys.modules, "sentence_transformers", sentence_transformers)


def test_embedding_generator_writes_pinned_cases_atomically(tmp_path, monkeypatch):
    _install_fake_models(monkeypatch)
    destination = tmp_path / "nested" / "reference.json"

    result = EmbeddingFixtureGenerator(destination, num_threads=2).generate()

    document = json.loads(result.read_text(encoding="utf-8"))
    assert result == destination
    assert len(document["cases"]) == 5
    assert document["cases"][0]["embeddings"][0] == [0.25, 0.75]
    assert document["produced_by"]["torch"] == "test-torch"
    assert list(destination.parent.iterdir()) == [destination]


def test_rerank_generator_writes_scores_and_model_metadata(tmp_path, monkeypatch):
    _install_fake_models(monkeypatch)
    destination = tmp_path / "rerank.json"

    result = RerankFixtureGenerator(destination).generate()

    document = json.loads(result.read_text(encoding="utf-8"))
    assert result == destination
    assert len(document["cases"]) == 2
    assert document["cases"][0]["scores"] == [0.4, 0.4, 0.4]
    assert document["cases"][0]["activation"] == "object"


def test_cli_requires_an_explicit_destination(monkeypatch, tmp_path):
    from aphrody_embedding_fixtures import generate_reference

    invoked: list[tuple[Path, int]] = []

    class Generator:
        def __init__(self, path, threads):
            invoked.append((path, threads))

        def generate(self):
            return self

        def __str__(self):
            return str(destination)

    destination = tmp_path / "reference.json"
    monkeypatch.setattr(generate_reference, "EmbeddingFixtureGenerator", Generator)

    generate_reference.main([str(destination), "--threads", "2"])

    assert invoked == [(destination, 2)]


@pytest.mark.parametrize(
    "generator", [EmbeddingFixtureGenerator, RerankFixtureGenerator]
)
def test_generators_reject_nonpositive_thread_counts(generator, tmp_path):
    with pytest.raises(ValueError, match="num_threads must be positive"):
        generator(tmp_path / "fixture.json", num_threads=0)
