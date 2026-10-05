#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""CLI script to run Whisper Large v3 Turbo audio speech-to-text with Silero VAD.

Usage:
    python tools/ai/scripts/run-whisper-stt.py <audio_file> [--lang fr|en|ja] [--device cuda|cpu|auto] [--no-vad] [--json]
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from aphrody.audio.whisper_transcribe import AudioTranscriber

# Reconfigure stdout/stderr to UTF-8 on Windows
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Whisper Large v3 Turbo STT with Silero VAD & Word Timestamps"
    )
    parser.add_argument(
        "audio", type=str, help="Path to input audio file (wav, mp3, etc.)"
    )
    parser.add_argument(
        "--lang",
        type=str,
        default=None,
        help="Language code ('fr', 'en', 'ja') or auto-detect if omitted",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="auto",
        choices=["cuda", "cpu", "auto"],
        help="Device to use for inference (default: auto)",
    )
    parser.add_argument(
        "--no-vad",
        action="store_true",
        help="Disable Silero VAD silence filtering",
    )
    parser.add_argument(
        "--no-words",
        action="store_true",
        help="Disable word-level timestamps",
    )
    parser.add_argument(
        "--backend",
        type=str,
        default="faster-whisper",
        choices=["faster-whisper", "whisper.cpp"],
        help="Inference engine backend",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output structured JSON instead of human-readable text",
    )

    args = parser.parse_args()

    audio_path = Path(args.audio)
    if not audio_path.exists():
        print(f"Error: audio file not found: {args.audio}", file=sys.stderr)
        sys.exit(1)

    t0 = time.time()
    transcriber = AudioTranscriber(
        device=args.device,
        use_vad=not args.no_vad,
    )

    result = transcriber.transcribe(
        audio=audio_path,
        language=args.lang,
        word_timestamps=not args.no_words,
        backend_override=args.backend,
    )
    elapsed = time.time() - t0

    if args.json:
        data = result.to_dict()
        data["elapsed_seconds"] = round(elapsed, 3)
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        print(
            f"\n[Whisper Large v3 Turbo] Backend: {result.backend} | Device: {result.device}"
        )
        print(
            f"Detected/Forced Language: {result.language} (Confidence: {result.language_probability:.2%})"
        )
        print(
            f"Audio Duration: {result.duration:.2f}s | Processing Time: {elapsed:.2f}s"
        )
        print("=" * 60)
        print(f"Transcription:\n{result.text}\n")
        print("=" * 60)
        print("Segments & Word Timestamps:")
        for seg in result.segments:
            print(f"[{seg.start:06.2f} -> {seg.end:06.2f}] {seg.text}")
            if seg.words:
                words_str = " | ".join(
                    f"{w.word} ({w.start:.2f}-{w.end:.2f}s)" for w in seg.words
                )
                print(f"   └─ {words_str}")


if __name__ == "__main__":
    main()
