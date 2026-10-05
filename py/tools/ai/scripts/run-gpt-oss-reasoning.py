#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""CLI script to run reasoning with gpt-oss-20b-mxfp4 using OpenAI Harmony protocol."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

import httpx

from aphrody.inference.harmony_reasoning import (
    DEFAULT_GPT_OSS_GGUF_PATH,
    DEFAULT_MIN_P,
    DEFAULT_TEMPERATURE,
    DEFAULT_TOP_P,
    HarmonyRunner,
)


def main() -> int:
    """Execute the CLI reasoning interface."""
    import contextlib

    for stream in (sys.stdout, sys.stderr):
        with contextlib.suppress(AttributeError, ValueError):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(
        description="Run reasoning query with gpt-oss-20b-mxfp4 via OpenAI Harmony protocol"
    )
    parser.add_argument(
        "prompt",
        nargs="?",
        default="Un fermier a 17 moutons. Tous meurent sauf 9. Combien de moutons lui reste-t-il ?",
        help="Prompt to run reasoning on",
    )
    parser.add_argument(
        "--backend",
        choices=["openai", "cli", "server"],
        default="openai",
        help="Backend to use: openai (remote/local OpenAI API), cli (llama-cli direct), server (start llama-server)",
    )
    parser.add_argument(
        "--base-url",
        default="http://127.0.0.1:8080/v1",
        help="Base URL for OpenAI-compatible endpoint",
    )
    parser.add_argument(
        "--model-path",
        default=str(DEFAULT_GPT_OSS_GGUF_PATH),
        help="Path to GGUF model file",
    )
    parser.add_argument(
        "--temperature",
        type=float,
        default=DEFAULT_TEMPERATURE,
        help=f"Sampling temperature (default: {DEFAULT_TEMPERATURE})",
    )
    parser.add_argument(
        "--top-p",
        type=float,
        default=DEFAULT_TOP_P,
        help=f"Top-p sampling (default: {DEFAULT_TOP_P})",
    )
    parser.add_argument(
        "--min-p",
        type=float,
        default=DEFAULT_MIN_P,
        help=f"Min-p sampling (default: {DEFAULT_MIN_P})",
    )
    parser.add_argument(
        "--system",
        default=None,
        help="Optional system prompt",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw JSON with channels split",
    )

    args = parser.parse_args()

    runner = HarmonyRunner(
        model_path=args.model_path,
        base_url=args.base_url,
    )

    try:
        if args.backend == "cli":
            print(
                f"[*] Executing via llama-cli on model: {args.model_path}",
                file=sys.stderr,
            )
            result = runner.run_cli_inference(
                args.prompt,
                system_instruction=args.system,
                temperature=args.temperature,
                top_p=args.top_p,
                min_p=args.min_p,
            )
        elif args.backend == "openai":
            print(f"[*] Querying OpenAI endpoint: {args.base_url}", file=sys.stderr)
            result = runner.run_openai_inference(
                args.prompt,
                system_instruction=args.system,
                temperature=args.temperature,
                top_p=args.top_p,
                min_p=args.min_p,
            )
        else:
            print("Starting llama-server mode...", file=sys.stderr)
            proc = runner.spawn_server()
            print(
                f"llama-server spawned with PID {proc.pid}. Press Ctrl+C to terminate.",
                file=sys.stderr,
            )
            proc.wait()
            return 0
    except (
        OSError,
        ValueError,
        RuntimeError,
        subprocess.SubprocessError,
        httpx.HTTPError,
    ) as exc:
        print(f"[!] Inference error: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
    else:
        print("\n=== [HARMONY CHAIN OF THOUGHT (ANALYSIS)] ===")
        print(result.analysis if result.analysis else "(No explicit analysis channel)")
        if result.commentary:
            print("\n=== [HARMONY COMMENTARY] ===")
            print(result.commentary)
        print("\n=== [HARMONY FINAL RESPONSE] ===")
        print(result.final if result.final else result.raw)

    return 0


if __name__ == "__main__":
    sys.exit(main())
