# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""OpenAI Harmony protocol implementation and reasoning engine for gpt-oss-20b-mxfp4.

This module implements the OpenAI Harmony multi-channel protocol:
- `<|start|><|channel|>analysis<|message|>` : Internal Chain-of-Thought (reasoning)
- `<|start|><|channel|>commentary<|message|>` : Tool-use commentary or intermediate notes
- `<|start|><|channel|>final<|message|>` : Clean final user-facing response

Recommended hyper-parameters for gpt-oss-20b reasoning:
- temperature: 0.6
- top_p: 0.95
- min_p: 0.05
"""

from __future__ import annotations

import re
import subprocess
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from aphrody import _paths
from aphrody.inference.transport import CompletionTransport

# Default model path in Aphrody models store
DEFAULT_GPT_OSS_GGUF_PATH = (
    Path.home()
    / ".aphrody"
    / "models"
    / "hf"
    / "unsloth"
    / "gpt-oss-20b-GGUF"
    / "d449b42d93e1c2c7bda5312f5c25c8fb91dfa9b4"
    / "gpt-oss-20b-Q4_K_M.gguf"
)

# Default llama runtime directory
DEFAULT_LLAMA_SERVER_PATH = (
    _paths.state_dir() / "runtimes" / "llama-b10549" / "llama-server"
)
DEFAULT_LLAMA_CLI_PATH = _paths.state_dir() / "runtimes" / "llama-b10549" / "llama-cli"

# Recommended sampling parameters
DEFAULT_TEMPERATURE = 0.6
DEFAULT_TOP_P = 0.95
DEFAULT_MIN_P = 0.05


@dataclass
class HarmonyReasoningResult:
    """Structured extraction of channels from an OpenAI Harmony completion."""

    analysis: str = ""
    commentary: str = ""
    final: str = ""
    raw: str = ""
    channels: dict[str, str] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Convert result to dictionary representation."""
        return {
            "analysis": self.analysis,
            "commentary": self.commentary,
            "final": self.final,
            "channels": self.channels,
            "raw": self.raw,
            "metadata": self.metadata,
        }


class HarmonyParser:
    """Parser for OpenAI Harmony protocol channel streams and raw text."""

    CHANNEL_START_PATTERN = re.compile(
        r"<\|start\|><\|channel\|>([a-zA-Z0-9_\-]+)<\|message\|>"
    )
    CHANNEL_END_TOKEN = "<|end|>"

    @classmethod
    def format_prompt(
        cls,
        user_message: str,
        system_instruction: str | None = None,
        history: list[Mapping[str, str]] | None = None,
    ) -> str:
        """Format messages into OpenAI Harmony template prompt if sending raw text."""
        parts: list[str] = []
        if system_instruction:
            parts.append(
                f"<|start|><|channel|>system<|message|>\n{system_instruction.strip()}<|end|>"
            )

        if history:
            for item in history:
                role = item.get("role", "user")
                content = item.get("content", "")
                parts.append(
                    f"<|start|><|channel|>{role}<|message|>\n{content.strip()}<|end|>"
                )

        parts.append(
            f"<|start|><|channel|>user<|message|>\n{user_message.strip()}<|end|>"
        )
        parts.append("<|start|><|channel|>analysis<|message|>\n")
        return "\n".join(parts)

    @classmethod
    def parse(cls, text: str) -> HarmonyReasoningResult:
        """Parse raw generated text into structured channel segments.

        Supports standard Harmony channel markers:
        - <|start|><|channel|>analysis<|message|>
        - <|start|><|channel|>commentary<|message|>
        - <|start|><|channel|>final<|message|>
        As well as fallback thinking tags (e.g. <think>...</think>, <thought>...</thought>).
        """
        raw = text
        channels: dict[str, list[str]] = {}

        matches = list(cls.CHANNEL_START_PATTERN.finditer(text))
        if matches:
            for i, match in enumerate(matches):
                chan_name = match.group(1).strip()
                content_start = match.end()
                content_end = (
                    matches[i + 1].start() if i + 1 < len(matches) else len(text)
                )

                chunk = text[content_start:content_end]
                # Strip closing marker if present
                if cls.CHANNEL_END_TOKEN in chunk:
                    chunk = chunk.split(cls.CHANNEL_END_TOKEN)[0]

                chunk = chunk.strip()
                if chan_name not in channels:
                    channels[chan_name] = []
                channels[chan_name].append(chunk)

            merged = {k: "\n\n".join(v).strip() for k, v in channels.items()}
            return HarmonyReasoningResult(
                analysis=merged.get("analysis", ""),
                commentary=merged.get("commentary", ""),
                final=merged.get("final", ""),
                raw=raw,
                channels=merged,
            )

        # Fallback 1: check standard reasoning/think tags
        think_match = re.search(
            r"<(?:think|thought|analysis)>(.*?)</(?:think|thought|analysis)>",
            text,
            flags=re.DOTALL | re.IGNORECASE,
        )
        if think_match:
            analysis = think_match.group(1).strip()
            final = re.sub(
                r"<(?:think|thought|analysis)>.*?</(?:think|thought|analysis)>",
                "",
                text,
                flags=re.DOTALL | re.IGNORECASE,
            ).strip()
            return HarmonyReasoningResult(
                analysis=analysis,
                commentary="",
                final=final,
                raw=raw,
                channels={"analysis": analysis, "final": final},
            )

        # Fallback 2: Plain output without explicit tags
        return HarmonyReasoningResult(
            analysis="",
            commentary="",
            final=text.strip(),
            raw=raw,
            channels={"final": text.strip()},
        )


class OpenAICompatibleReasoningClient:
    """Client for querying OpenAI-compatible endpoints with Harmony channel parsing."""

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8080/v1",
        api_key: str = "no-key",
        model: str = "gpt-oss-20b",
        timeout: float = 120.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def generate(
        self,
        prompt: str,
        *,
        system_instruction: str | None = None,
        temperature: float = DEFAULT_TEMPERATURE,
        top_p: float = DEFAULT_TOP_P,
        min_p: float | None = DEFAULT_MIN_P,
        max_tokens: int = 4096,
        extra_body: dict[str, Any] | None = None,
        history: Sequence[dict[str, str]] | None = None,
    ) -> HarmonyReasoningResult:
        """Call /chat/completions and parse the Harmony protocol response."""
        messages: list[dict[str, str]] = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})
        messages.extend(history or ())
        messages.append({"role": "user", "content": prompt})

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
            "max_tokens": max_tokens,
        }
        if min_p is not None:
            payload["min_p"] = min_p
        if extra_body:
            payload.update(extra_body)

        data = self.transport().complete(payload)
        return self.parse_response(data)

    def transport(self) -> CompletionTransport:
        return CompletionTransport(self.base_url, self.api_key, self.timeout)

    @staticmethod
    def parse_response(data: dict[str, Any]) -> HarmonyReasoningResult:
        """Share provider response parsing with every inference adapter."""
        choices = data.get("choices")
        if (
            not isinstance(choices, list)
            or not choices
            or not isinstance(choices[0], dict)
        ):
            raise ValueError("Inference response has no choices")
        message = choices[0].get("message")
        if not isinstance(message, dict) or not isinstance(message.get("content"), str):
            raise ValueError("Inference response has no text message content")
        content = message["content"]
        reasoning_content = (
            message.get("reasoning_content") or message.get("reasoning") or ""
        )
        if not isinstance(reasoning_content, str):
            raise ValueError("Invalid provider reasoning content")

        # If server already split reasoning_content vs content (OpenAI o-series or llama.cpp style)
        if reasoning_content and content:
            return HarmonyReasoningResult(
                analysis=reasoning_content.strip(),
                commentary="",
                final=content.strip(),
                raw=f"<|start|><|channel|>analysis<|message|>\n{reasoning_content}\n<|start|><|channel|>final<|message|>\n{content}",
                channels={
                    "analysis": reasoning_content.strip(),
                    "final": content.strip(),
                },
                metadata=data.get("usage", {}),
            )

        # Otherwise parse full content through HarmonyParser
        result = HarmonyParser.parse(content)
        result.metadata = data.get("usage", {})
        return result


class HarmonyRunner:
    """Runner for gpt-oss-20b execution either via llama-server, llama-cli, or remote endpoint."""

    def __init__(
        self,
        model_path: str | Path | None = None,
        server_binary: str | Path | None = None,
        cli_binary: str | Path | None = None,
        base_url: str = "http://127.0.0.1:8080/v1",
    ) -> None:
        self.model_path = Path(model_path or DEFAULT_GPT_OSS_GGUF_PATH)
        self.server_binary = (
            Path(server_binary)
            if server_binary
            else _paths.resolve_runtime_binary(
                "llama-server",
                "APHRODY_LLAMA_SERVER_BIN",
                "runtimes/llama-b10549/llama-server",
            )
        )
        self.cli_binary = (
            Path(cli_binary)
            if cli_binary
            else _paths.resolve_runtime_binary(
                "llama-cli", "APHRODY_LLAMA_CLI_BIN", "runtimes/llama-b10549/llama-cli"
            )
        )
        self.base_url = base_url

    def run_cli_inference(
        self,
        prompt: str,
        *,
        system_instruction: str | None = None,
        temperature: float = DEFAULT_TEMPERATURE,
        top_p: float = DEFAULT_TOP_P,
        min_p: float = DEFAULT_MIN_P,
        max_tokens: int = 1024,
        gpu_layers: int = 99,
        ctx_size: int = 4096,
        threads: int = 8,
    ) -> HarmonyReasoningResult:
        """Run one-shot inference using llama-cli directly against the GGUF model."""
        if not self.cli_binary.is_file():
            raise FileNotFoundError(f"llama-cli binary not found at {self.cli_binary}")
        if not self.model_path.is_file():
            raise FileNotFoundError(f"GGUF model not found at {self.model_path}")

        full_prompt = HarmonyParser.format_prompt(
            user_message=prompt,
            system_instruction=system_instruction,
        )

        cmd = [
            str(self.cli_binary),
            "-m",
            str(self.model_path),
            "-p",
            full_prompt,
            "-ngl",
            str(gpu_layers),
            "-c",
            str(ctx_size),
            "-t",
            str(threads),
            "--temp",
            str(temperature),
            "--top-p",
            str(top_p),
            "--min-p",
            str(min_p),
            "-n",
            str(max_tokens),
            "--no-display-prompt",
        ]

        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )

        output = proc.stdout
        # Parse output through Harmony parser
        result = HarmonyParser.parse(output)
        result.metadata["returncode"] = proc.returncode
        return result

    def run_openai_inference(
        self,
        prompt: str,
        *,
        system_instruction: str | None = None,
        temperature: float = DEFAULT_TEMPERATURE,
        top_p: float = DEFAULT_TOP_P,
        min_p: float = DEFAULT_MIN_P,
        max_tokens: int = 2048,
    ) -> HarmonyReasoningResult:
        """Run inference using an active OpenAI-compatible endpoint."""
        client = OpenAICompatibleReasoningClient(base_url=self.base_url)
        return client.generate(
            prompt,
            system_instruction=system_instruction,
            temperature=temperature,
            top_p=top_p,
            min_p=min_p,
            max_tokens=max_tokens,
        )

    def spawn_server(
        self,
        host: str = "127.0.0.1",
        port: int = 8080,
        gpu_layers: int = 99,
        ctx_size: int = 8192,
        threads: int = 8,
    ) -> subprocess.Popen:
        """Spawn llama-server serving the gpt-oss-20b model."""
        if not self.server_binary.is_file():
            raise FileNotFoundError(
                f"llama-server binary not found at {self.server_binary}"
            )
        if not self.model_path.is_file():
            raise FileNotFoundError(f"GGUF model not found at {self.model_path}")

        cmd = [
            str(self.server_binary),
            "-m",
            str(self.model_path),
            "--host",
            host,
            "--port",
            str(port),
            "-ngl",
            str(gpu_layers),
            "-c",
            str(ctx_size),
            "-t",
            str(threads),
            "--temp",
            str(DEFAULT_TEMPERATURE),
            "--top-p",
            str(DEFAULT_TOP_P),
            "--min-p",
            str(DEFAULT_MIN_P),
        ]
        return subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )


def run_harmony_reasoning(
    prompt: str,
    *,
    system_instruction: str | None = None,
    backend: str = "openai",
    base_url: str = "http://127.0.0.1:8080/v1",
    model_path: str | Path | None = None,
    temperature: float = DEFAULT_TEMPERATURE,
    top_p: float = DEFAULT_TOP_P,
    min_p: float = DEFAULT_MIN_P,
) -> HarmonyReasoningResult:
    """Convenience helper to run harmony reasoning query."""
    runner = HarmonyRunner(
        model_path=model_path,
        base_url=base_url,
    )
    if backend == "cli":
        return runner.run_cli_inference(
            prompt,
            system_instruction=system_instruction,
            temperature=temperature,
            top_p=top_p,
            min_p=min_p,
        )
    return runner.run_openai_inference(
        prompt,
        system_instruction=system_instruction,
        temperature=temperature,
        top_p=top_p,
        min_p=min_p,
    )
