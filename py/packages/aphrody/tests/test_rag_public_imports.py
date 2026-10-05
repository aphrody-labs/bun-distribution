# SPDX-License-Identifier: Apache-2.0
"""Native math and layout APIs must not require optional graph providers."""

import subprocess
import sys


def test_public_math_and_layout_import_without_graph_providers():
    subprocess.run(
        [
            sys.executable,
            "-c",
            """
import sys
class BlockGraphs:
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'networkx', 'sklearn', 'umap'}:
            raise ModuleNotFoundError('optional graph provider was imported')
sys.meta_path.insert(0, BlockGraphs())
import aphrody.rag as api
from aphrody.rag import math
assert api.cosine_similarity is math.cosine_similarity
assert api.cosine_similarity([1, 0], [1, 0]) == 1
assert api.reciprocal_rank_fusion([[7]])[0][0] == 7
assert 'GraphExtractor' in dir(api)
assert 'aphrody.rag.graph_extractor' not in sys.modules
assert 'aphrody.rag.raptor' not in sys.modules
from aphrody.rag import LayoutChunker, LayoutElement
from aphrody.rag.layout_chunker import LayoutChunker as DirectChunker
assert LayoutChunker is DirectChunker
assert api.LayoutChunker is LayoutChunker
assert api.LayoutElement is LayoutElement
try:
    api.unknown_provider
except AttributeError:
    pass
else:
    raise AssertionError('unknown export did not raise AttributeError')
assert 'aphrody.rag.graph_extractor' not in sys.modules
assert 'aphrody.rag.raptor' not in sys.modules
""",
        ],
        check=True,
    )
