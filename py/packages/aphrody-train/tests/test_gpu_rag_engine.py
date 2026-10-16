# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import sys
from types import ModuleType

from aphrody_train import MultimodalDoc
from aphrody_train.multimodal_rag import GpuRagEngine


def _install_mock_ml_stack(monkeypatch):
    import numpy as np

    fake_torch = ModuleType("torch")
    fake_torch.cuda = ModuleType("torch.cuda")
    fake_torch.cuda.is_available = lambda: True
    fake_torch.cuda.get_device_name = lambda _=0: "NVIDIA GeForce RTX 4070"

    class FakeDeviceProperties:
        total_memory = 12 * 1024 * 1024 * 1024

    fake_torch.cuda.get_device_properties = lambda _=0: FakeDeviceProperties()

    fake_st = ModuleType("sentence_transformers")

    class FakeSentenceTransformer:
        def __init__(self, model_name_or_path: str, device: str = "cpu"):
            self.model_name = model_name_or_path
            self.device = device

        def encode(
            self,
            texts,
            batch_size: int = 32,
            show_progress_bar: bool = False,
            normalize_embeddings: bool = True,
            convert_to_numpy: bool = True,
        ):
            vecs = []
            for t in texts:
                val = float(len(t) % 10 + 1)
                vec = np.array([val, 1.0, 0.5], dtype=np.float32)
                if normalize_embeddings:
                    vec = vec / np.linalg.norm(vec)
                vecs.append(vec)
            return np.array(vecs)

    class FakeCrossEncoder:
        def __init__(self, model_name_or_path: str, device: str = "cpu"):
            self.model_name = model_name_or_path
            self.device = device

        def predict(self, pairs):
            return [0.95 - (i * 0.1) for i in range(len(pairs))]

    fake_st.SentenceTransformer = FakeSentenceTransformer
    fake_st.CrossEncoder = FakeCrossEncoder

    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "torch.cuda", fake_torch.cuda)
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake_st)


def test_gpu_rag_engine_lifecycle(monkeypatch):
    _install_mock_ml_stack(monkeypatch)

    engine = GpuRagEngine(
        embed_model_path="intfloat/multilingual-e5-small",
        rerank_model_path="BAAI/bge-reranker-base",
        device="cuda",
    )
    assert engine.has_cuda is True
    assert engine.device == "cuda"

    docs = [
        MultimodalDoc("1", "Kamehameha", "Energy beam wave", kind="technique"),
        MultimodalDoc("2", "Genkidama", "Spirit bomb gathering", kind="technique"),
        MultimodalDoc("3", "Super Saiyan", "Golden transformation", kind="form"),
    ]

    engine.index_corpus(docs, batch_size=2)
    assert engine.corpus_embeddings is not None
    assert len(engine.corpus_embeddings) == 3

    results = engine.search("Kamehameha", top_k=2, rerank=True)
    assert len(results) == 2
    assert results[0]["id"] in {"1", "2", "3"}
    assert "score" in results[0]

    bench = engine.run_benchmark_loop(
        ["Kamehameha", "Genkidama"], iterations=2, top_k=2
    )
    assert bench["total_queries"] == 4
    assert bench["qps"] > 0
    assert bench["latency_p50_ms"] >= 0
