# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Jan (janhq/jan) local AI runtime integration for Gemma 4.

Provides native model manifests, configuration managers, and an OpenAI-compatible
Jan bridge proxy for seamless execution of Gemma 4 inside Jan Desktop and Server.
"""

from __future__ import annotations

import dataclasses
import json
import os
from pathlib import Path
from typing import Any

from aphrody.gemma4.models import get_model_config


@dataclasses.dataclass(frozen=True)
class JanModelManifest:
    """Model manifest conforming to Jan Cortex/Nitro specification."""

    id: str
    name: str
    version: str = "1.0.0"
    format: str = "gguf"
    engine: str = "nitro"
    description: str = ""
    author: str = "Google DeepMind & Aphrody"
    license: str = "Apache-2.0"
    context_length: int = 131072
    quantization: str = "Q4_K_M"
    filename: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Convert manifest to Jan model.json structure."""
        return {
            "id": self.id,
            "name": self.name,
            "version": self.version,
            "format": self.format,
            "engine": self.engine,
            "description": self.description,
            "author": self.author,
            "license": self.license,
            "parameters": {
                "ctx_len": self.context_length,
                "temperature": 0.7,
                "top_p": 0.95,
                "top_k": 40,
                "frequency_penalty": 0.0,
                "presence_penalty": 0.0,
                "stop": ["<end_of_turn>", "<eos>"],
            },
            "prompt_template": "<start_of_turn>user\n{prompt}<end_of_turn>\n<start_of_turn>model\n",
            "system_template": "<start_of_turn>system\n{system_message}<end_of_turn>\n",
            "files": [
                {
                    "name": self.filename
                    or f"{self.id}-{self.quantization.lower()}.gguf",
                    "type": "gguf",
                    "quantization": self.quantization,
                }
            ],
            "metadata": {
                "multimodal": True,
                "vision": True,
                "audio": True,
                "tool_calling": True,
            },
        }


def generate_jan_manifest(
    model_id: str = "gemma4-e2b",
    quantization: str = "Q4_K_M",
    engine: str = "nitro",
) -> JanModelManifest:
    """Create a Jan model manifest for a specific Gemma 4 variant."""
    cfg = get_model_config(model_id)
    desc = (
        f"Google DeepMind {cfg.name} multimodal model with native vision, "
        f"audio conformer, and 128k context window."
    )
    return JanModelManifest(
        id=cfg.name,
        name=f"Gemma 4 {cfg.name.split('-')[-1].upper()}",
        description=desc,
        context_length=131072,
        quantization=quantization,
        engine=engine,
        filename=f"{cfg.name}-{quantization.lower()}.gguf",
    )


class JanConfigManager:
    """Manages Jan model installation, directory structures, and model indices."""

    def __init__(self, jan_home: str | Path | None = None):
        if jan_home is not None:
            self.jan_home = Path(jan_home)
        else:
            env_home = os.environ.get("JAN_HOME")
            if env_home:
                self.jan_home = Path(env_home)
            else:
                self.jan_home = Path.home() / ".jan"
        self.models_dir = self.jan_home / "models"

    def install_manifest(
        self,
        model_id: str = "gemma4-e2b",
        quantization: str = "Q4_K_M",
    ) -> Path:
        """Install or update model.json in Jan models folder."""
        manifest = generate_jan_manifest(model_id, quantization=quantization)
        target_dir = self.models_dir / manifest.id
        target_dir.mkdir(parents=True, exist_ok=True)

        manifest_path = target_dir / "model.json"
        with manifest_path.open("w", encoding="utf-8") as f:
            json.dump(manifest.to_dict(), f, indent=2)

        self._update_models_index()
        return manifest_path

    def install_all_gemma4_manifests(self, quantization: str = "Q4_K_M") -> list[Path]:
        """Install manifests for all 4 Gemma 4 models."""
        distinct_models = ["gemma4-e2b", "gemma4-e4b", "gemma4-26b-a4b", "gemma4-31b"]
        installed = []
        for model_id in distinct_models:
            installed.append(self.install_manifest(model_id, quantization=quantization))
        return installed

    def _update_models_index(self) -> None:
        """Refresh models.json index in Jan models root."""
        self.models_dir.mkdir(parents=True, exist_ok=True)
        index_file = self.models_dir / "models.json"

        manifests: list[dict[str, Any]] = []
        for model_folder in self.models_dir.iterdir():
            if model_folder.is_dir():
                m_file = model_folder / "model.json"
                if m_file.is_file():
                    try:
                        with m_file.open("r", encoding="utf-8") as f:
                            manifests.append(json.load(f))
                    except Exception:
                        continue

        with index_file.open("w", encoding="utf-8") as f:
            json.dump(manifests, f, indent=2)

    def list_installed_models(self) -> list[str]:
        """List model IDs currently installed in Jan."""
        if not self.models_dir.exists():
            return []
        installed = []
        for model_folder in self.models_dir.iterdir():
            if model_folder.is_dir() and (model_folder / "model.json").is_file():
                installed.append(model_folder.name)
        return sorted(installed)


class JanBridgeServer:
    """Proxy bridge between Jan UI and Aphrody Gemma 4 inference engine."""

    def __init__(self, port: int = 1337):
        self.port = port

    def translate_jan_request(self, jan_payload: dict[str, Any]) -> dict[str, Any]:
        """Translate Jan chat completion payload into Gemma 4 multimodal request."""
        model = jan_payload.get("model", "gemma4-e2b")
        messages = jan_payload.get("messages", [])
        temperature = jan_payload.get("temperature", 0.7)
        stream = jan_payload.get("stream", False)

        prompt_parts: list[str] = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            prompt_parts.append(f"<start_of_turn>{role}\n{content}<end_of_turn>\n")

        prompt_parts.append("<start_of_turn>model\n")
        formatted_prompt = "".join(prompt_parts)

        return {
            "model": model,
            "prompt": formatted_prompt,
            "temperature": temperature,
            "stream": stream,
        }

    def format_sse_chunk(self, content_delta: str, model: str = "gemma4-e2b") -> str:
        """Format streaming Server-Sent Event chunk for Jan client."""
        chunk = {
            "id": "chatcmpl-jan-gemma4",
            "object": "chat.completion.chunk",
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": {"content": content_delta},
                    "finish_reason": None,
                }
            ],
        }
        return f"data: {json.dumps(chunk)}\n\n"
