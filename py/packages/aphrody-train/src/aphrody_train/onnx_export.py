# SPDX-License-Identifier: Apache-2.0
"""Export the transformer of a trained model to ONNX and run it with ONNX Runtime.

The graph keeps the layout the Rust ORT loaders read (``onnx/model.onnx`` next to the
tokenizer files, inputs ``input_ids``/``attention_mask``/``token_type_ids``, one output),
exported by ``torch.onnx`` so the training stack does not depend on optimum-onnx.
"""

import json
from pathlib import Path
from typing import Any

INPUT_NAMES = ("input_ids", "attention_mask", "token_type_ids")
EXPORT_PROBE = ["onnx export probe", "a second and longer onnx export probe sentence"]


def export(transformer: Any, tokenizer: Any, onnx_path: Path, output_name: str) -> None:
    """Write the first output of ``transformer`` as a single-file ONNX graph.

    ``onnx_path`` is ``<model_dir>/onnx/model.onnx``; ``<model_dir>`` holds the saved tokenizer.
    """
    import torch

    sample = tokenizer(EXPORT_PROBE, padding=True, return_tensors="pt")
    names = [name for name in INPUT_NAMES if name in sample]

    class Graph(torch.nn.Module):
        def __init__(self, inner: Any) -> None:
            super().__init__()
            self.inner = inner

        def forward(
            self, input_ids: Any, attention_mask: Any, token_type_ids: Any = None
        ) -> Any:
            inputs = {"input_ids": input_ids, "attention_mask": attention_mask}
            if token_type_ids is not None:
                inputs["token_type_ids"] = token_type_ids
            return self.inner(**inputs, return_dict=True)[0]

    axes = {name: {0: "batch", 1: "sequence"} for name in names}
    axes[output_name] = (
        {0: "batch", 1: "sequence"}
        if output_name == "last_hidden_state"
        else {0: "batch"}
    )
    onnx_path.parent.mkdir(parents=True, exist_ok=True)
    graph = Graph(transformer.to("cpu").eval())
    with torch.no_grad():
        torch.onnx.export(
            graph,
            tuple(sample[name] for name in names),
            str(onnx_path),
            input_names=names,
            output_names=[output_name],
            dynamic_axes=axes,
            opset_version=18,
            dynamo=True,
            verbose=False,
            external_data=False,
        )
    # transformers 5 no longer writes this file; the Rust tokenizer loader requires it.
    special_tokens = onnx_path.parent.parent / "special_tokens_map.json"
    if not special_tokens.is_file():
        special_tokens.write_text(
            json.dumps(tokenizer.special_tokens_map, indent=2) + "\n", encoding="utf-8"
        )


def run(
    onnx_path: Path, tokenizer: Any, *texts: list[str]
) -> tuple[Any, dict[str, Any]]:
    """Tokenize ``texts`` (one list, or two for pairs); return the ONNX output and its int64 feeds."""
    import numpy as np
    import onnxruntime as ort

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    encoded = tokenizer(*texts, padding=True, truncation=True, return_tensors="np")
    feeds = {
        node.name: np.asarray(encoded[node.name], dtype=np.int64)
        for node in session.get_inputs()
    }
    return session.run(None, feeds)[0], feeds
