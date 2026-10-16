# SPDX-License-Identifier: Apache-2.0
"""Stream the pinned private depot into the dedicated GPU model volume."""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path
from urllib.request import Request, urlopen

WEIGHT_BYTES = 10_246_621_918
WEIGHT_SHA256 = "2db5482b20d746879bb3ef79b5203e9075a2e2b98f54ec7c2f281c1477ddc550"
FILES = (
    "config.json",
    "generation_config.json",
    "processor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "chat_template.jinja",
    "README.md",
    ".gitattributes",
    "model.safetensors",
)


def download(root: Path, token_path: Path) -> None:
    if not root.is_absolute() or not token_path.is_absolute():
        raise ValueError("absolute protected paths required")
    token = token_path.read_text().strip()
    if len(token) != 64 or any(c not in "0123456789abcdef" for c in token):
        raise ValueError("protected depot token malformed")
    root.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        target = root / name
        expected = WEIGHT_BYTES if name == "model.safetensors" else 40_000_000
        partial = target.with_name(name + ".partial")
        digest = hashlib.sha256()
        received = 0
        request = Request(
            "http://10.200.77.1:8182/" + name,
            headers={"Authorization": "Bearer " + token},
        )
        with urlopen(request, timeout=120) as response, partial.open("wb") as output:
            while chunk := response.read(4 * 1024 * 1024):
                received += len(chunk)
                if received > expected:
                    raise RuntimeError("artifact exceeds declared size budget")
                digest.update(chunk)
                output.write(chunk)
        if name == "model.safetensors" and (
            received != WEIGHT_BYTES or digest.hexdigest() != WEIGHT_SHA256
        ):
            raise RuntimeError("pinned model integrity check failed")
        partial.replace(target)
        print(
            json.dumps({"file": name, "bytes": received, "sha256": digest.hexdigest()}),
            flush=True,
        )


if __name__ == "__main__":
    download(Path(sys.argv[1]), Path(sys.argv[2]))
