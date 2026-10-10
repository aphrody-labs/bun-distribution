# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Unit tests for Whisper Large v3 Turbo STT with Silero VAD."""

from __future__ import annotations

import numpy as np
import pytest

from aphrody.audio.whisper_transcribe import (
    AudioTranscriber,
    TranscriptionResult,
    WordTimestamp,
)


@pytest.fixture
def synthetic_speech_audio() -> np.ndarray:
    """Generate a clean synthetic wav array (16kHz float32)."""
    sr = 16000
    duration = 1.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    # 440Hz tone
    return (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)


def test_transcribe_result_structure():
    """Verify dataclasses serialization and attributes."""
    word = WordTimestamp(word="hello", start=0.1, end=0.5, probability=0.98)
    d = word.to_dict()
    assert d["word"] == "hello"
    assert d["start"] == 0.1
    assert d["end"] == 0.5

    result = TranscriptionResult(
        text="hello world",
        language="en",
        language_probability=0.99,
        duration=1.0,
        backend="faster-whisper",
        device="cuda",
    )
    res_dict = result.to_dict()
    assert res_dict["text"] == "hello world"
    assert res_dict["language"] == "en"
    assert res_dict["backend"] == "faster-whisper"


def test_vad_filters_pure_tone(synthetic_speech_audio):
    """Silero VAD should detect no speech on a pure sinusoidal tone."""
    # Silero VAD ships with faster-whisper; the whisper.cpp fallback has no VAD.
    pytest.importorskip("faster_whisper", reason="requires the 'voice' extra")
    transcriber = AudioTranscriber(device="auto", use_vad=True)
    res = transcriber.transcribe(synthetic_speech_audio)
    # Pure tone contains no human speech, so VAD suppresses it
    assert res.text.strip() == ""
    assert len(res.segments) == 0


def test_transcribe_jfk_file():
    """Verify end-to-end transcription on real audio file if present."""
    import os

    audio_path = "jfk.wav"
    if not os.path.exists(audio_path):
        pytest.skip("jfk.wav not found for live audio test")

    transcriber = AudioTranscriber(device="auto", use_vad=True)
    res = transcriber.transcribe(audio_path, language="en", word_timestamps=True)

    assert "fellow Americans" in res.text
    assert res.language == "en"
    assert len(res.segments) > 0
    # Ensure word-level timestamps were recorded
    first_seg = res.segments[0]
    assert len(first_seg.words) > 0
    first_word = first_seg.words[0]
    assert hasattr(first_word, "word")
    assert hasattr(first_word, "start")
    assert hasattr(first_word, "end")
