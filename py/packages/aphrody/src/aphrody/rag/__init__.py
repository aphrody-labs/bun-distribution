# SPDX-License-Identifier: Apache-2.0

"""RAG Unified Pipeline API.

Bridges layout-based document chunking, RAPTOR recursive clustering/indexing,
and GraphRAG entity/relationship extraction.
"""

import inspect
import logging
import sys
from collections.abc import Callable
from importlib import import_module
from typing import TYPE_CHECKING, Any

from aphrody.rag.math import (
    cosine_similarity,
    reciprocal_rank_fusion,
    top_k_cosine_similarity,
)

if TYPE_CHECKING:
    from aphrody.rag.graph_extractor import GraphExtractor
    from aphrody.rag.layout_chunker import LayoutChunker, LayoutElement
    from aphrody.rag.raptor import (
        RecursiveAbstractiveProcessing4TreeOrganizedRetrieval,
    )

logger = logging.getLogger(__name__)

__all__ = [
    "GraphExtractor",
    "LayoutChunker",
    "LayoutElement",
    "RAGPipeline",
    "RecursiveAbstractiveProcessing4TreeOrganizedRetrieval",
    "cosine_similarity",
    "reciprocal_rank_fusion",
    "top_k_cosine_similarity",
]


_LAZY_EXPORTS = {
    "GraphExtractor": ("aphrody.rag.graph_extractor", "GraphExtractor"),
    "LayoutChunker": ("aphrody.rag.layout_chunker", "LayoutChunker"),
    "LayoutElement": ("aphrody.rag.layout_chunker", "LayoutElement"),
    "RecursiveAbstractiveProcessing4TreeOrganizedRetrieval": (
        "aphrody.rag.raptor",
        "RecursiveAbstractiveProcessing4TreeOrganizedRetrieval",
    ),
    "nx": ("networkx", None),
}


def __getattr__(name: str) -> Any:
    """Load optional providers only when their public API is requested."""
    if name not in _LAZY_EXPORTS:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module, attribute = _LAZY_EXPORTS[name]
    provider = import_module(module)
    value = getattr(provider, attribute) if attribute is not None else provider
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(_LAZY_EXPORTS))


class RAGPipeline:
    """Unified pipeline integrating Layout parsing, RAPTOR clustering, and GraphRAG extraction."""

    def __init__(
        self,
        llm_chat_fn: Callable[[str, list[dict[str, str]], dict[str, Any]], Any],
        embed_fn: Callable[[list[str]], Any],
        chunk_token_num: int = 512,
        overlap_token_num: int = 64,
        max_cluster: int = 5,
        raptor_tree_builder: str = "raptor",
        raptor_clustering_method: str = "gmm",
        graph_entity_types: list[str] | None = None,
        language: str = "English",
    ):
        self.llm_chat_fn = llm_chat_fn
        self.embed_fn = embed_fn
        self.language = language

        api = sys.modules[__name__]
        self.chunker = api.LayoutChunker(
            chunk_token_num=chunk_token_num, overlap_token_num=overlap_token_num
        )

        raptor_prompt = (
            "Write a concise summary of the following texts. "
            "Do not include introductory or concluding phrases.\n\n"
            "Texts:\n{cluster_content}\n\nSummary:"
        )
        self.raptor_builder = api.RecursiveAbstractiveProcessing4TreeOrganizedRetrieval(
            max_cluster=max_cluster,
            llm_chat_fn=llm_chat_fn,
            embed_fn=embed_fn,
            prompt=raptor_prompt,
            max_token=chunk_token_num,
            tree_builder=raptor_tree_builder,
            clustering_method=raptor_clustering_method,
        )

        self.graph_extractor = api.GraphExtractor(
            llm_chat_fn=llm_chat_fn,
            entity_types=graph_entity_types,
            language=language,
        )

    async def process_document(
        self,
        file_path: str,
        binary_data: bytes | None = None,
        doc_id: str = "doc",
        build_raptor_tree: bool = True,
        build_graph: bool = True,
    ) -> dict[str, Any]:
        """Process document end-to-end.

        1. Layout parsing and chunking.
        2. RAPTOR tree-building (clustering & abstractive summarization of layers).
        3. GraphRAG entity/relationship extraction.
        """
        logger.info("Parsing and chunking document: %s", file_path)

        layout_chunks = self.chunker.chunk_document(file_path, binary_data)
        original_texts = [c["content"] for c in layout_chunks]

        embeddings = []
        if original_texts:
            if inspect.iscoroutinefunction(self.embed_fn):
                embeddings = await self.embed_fn(original_texts)
            else:
                embeddings = self.embed_fn(original_texts)

        raptor_chunks = []
        for text, embd in zip(original_texts, embeddings, strict=False):
            raptor_chunks.append((text, embd))

        final_chunks = list(raptor_chunks)
        layers = []
        if build_raptor_tree and len(raptor_chunks) > 1:
            logger.info("Building RAPTOR tree structure...")
            res_chunks, res_layers = await self.raptor_builder(raptor_chunks)
            if res_chunks:
                final_chunks = res_chunks
                layers = res_layers

        graph = None
        if build_graph and original_texts:
            logger.info("Extracting GraphRAG entity relationship network...")
            graph = await self.graph_extractor.extract_graph(
                original_texts, doc_id=doc_id
            )

        output_chunks = []
        for idx, (text, embd) in enumerate(final_chunks[: len(original_texts)]):
            layout_info = layout_chunks[idx]
            output_chunks.append(
                {
                    "id": f"{doc_id}_chunk_{idx}",
                    "content": text,
                    "embedding": embd,
                    "type": "original",
                    "layout_types": layout_info["layout_types"],
                    "heading_context": layout_info["heading_context"],
                }
            )

        for idx, (text, embd) in enumerate(final_chunks[len(original_texts) :]):
            output_chunks.append(
                {
                    "id": f"{doc_id}_raptor_summary_{idx}",
                    "content": text,
                    "embedding": embd,
                    "type": "summary",
                    "layout_types": ["summary"],
                    "heading_context": "",
                }
            )

        return {
            "chunks": output_chunks,
            "raptor_layers": layers,
            "graph": graph,
        }
