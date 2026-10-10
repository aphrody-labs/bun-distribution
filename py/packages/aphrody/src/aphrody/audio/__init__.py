# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Audio transcription and speech processing module for aphrody."""

from __future__ import annotations

from aphrody.audio.whisper_transcribe import (
    AudioTranscriber,
    TranscriptionResult,
    WordTimestamp,
    transcribe_audio,
)

__all__ = [
    "AudioTranscriber",
    "TranscriptionResult",
    "WordTimestamp",
    "transcribe_audio",
]
