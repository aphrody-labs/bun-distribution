from __future__ import annotations

import builtins
import importlib

from aphrody_train import MultimodalDoc


def test_public_document_object_formats_embedding_text():
    doc = MultimodalDoc(
        "doc-1",
        "Dragon Ball",
        "A manga series.",
        image_ref="1-15.jpg",
        entity="Akira Toriyama",
    )

    assert doc.to_embedding_text() == (
        "title: Dragon Ball | plate: 1-15.jpg | entity: Akira Toriyama "
        "| text: A manga series."
    )


def test_multimodal_module_import_does_not_eagerly_load_numpy(monkeypatch):
    from aphrody_train import multimodal_rag

    original_import = builtins.__import__

    def reject_numpy(name, *args, **kwargs):
        if name == "numpy":
            raise AssertionError("numpy must load only when the RAG engine starts")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", reject_numpy)
    importlib.reload(multimodal_rag)

    assert multimodal_rag.GpuRagEngine
