# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Speech-to-Text transcription module using Whisper Large v3 Turbo & Silero VAD.

Provides high-performance GPU-accelerated (faster-whisper/CTranslate2) or
whisper.cpp transcription with:
- Native Silero VAD integration (silence elimination, anti-hallucination)
- Word-level timestamps (`word_timestamps=True`)
- Multi-lingual forced or auto-detected language support (FR, EN, JA, etc.)
- Transparent fallback mechanisms (GPU FP16 -> CPU int8 -> whisper.cpp binary)
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from aphrody import _paths

logger = logging.getLogger(__name__)


# Register nvidia CUDA DLL directories if present in site-packages
def _setup_cuda_dll_paths() -> None:
    """Ensure CUDA 12 runtime DLLs (cublas, cudnn, nvrtc) are accessible on Windows."""
    if sys.platform != "win32":
        return

    # Check current interpreter's site-packages and common aphrody virtualenvs
    search_roots = [sys.prefix]
    voice_venv = os.path.join(
        os.path.expanduser("~"), ".aphrody", "runtimes", "voice-venv"
    )
    if os.path.isdir(voice_venv) and voice_venv not in search_roots:
        search_roots.append(voice_venv)

    for root in search_roots:
        site_packages = os.path.join(root, "Lib", "site-packages")
        nvidia_dirs = [
            os.path.join(site_packages, "nvidia", "cublas", "bin"),
            os.path.join(site_packages, "nvidia", "cudnn", "bin"),
            os.path.join(site_packages, "nvidia", "cuda_nvrtc", "bin"),
        ]
        for d in nvidia_dirs:
            if os.path.isdir(d):
                with contextlib.suppress(AttributeError, OSError):
                    os.add_dll_directory(d)
                if d not in os.environ.get("PATH", ""):
                    os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


_setup_cuda_dll_paths()

# Default GGML model location in .aphrody
DEFAULT_GGML_LARGE_V3_TURBO = os.path.join(
    os.path.expanduser("~"),
    ".aphrody",
    "models",
    "hf",
    "ggerganov",
    "whisper.cpp",
    "5359861c739e955e79d9a303bcbc70fb988958b1",
    "ggml-large-v3-turbo-q8_0.bin",
)

DEFAULT_WHISPER_CPP_BIN = str(_paths.state_dir() / "runtimes/whisper-b4938/whisper-cli")

DEFAULT_CT2_TURBO_MODEL = "deepdml/faster-whisper-large-v3-turbo-ct2"


@dataclass
class WordTimestamp:
    """Word-level alignment timestamp."""

    word: str
    start: float
    end: float
    probability: float

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable dict with times rounded to ms."""
        return {
            "word": self.word,
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "probability": round(self.probability, 3),
        }


@dataclass
class TranscriptionSegment:
    """A segment of transcribed audio."""

    id: int
    start: float
    end: float
    text: str
    words: list[WordTimestamp] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable dict, including word timestamps."""
        return {
            "id": self.id,
            "start": round(self.start, 3),
            "end": round(self.end, 3),
            "text": self.text,
            "words": [w.to_dict() for w in self.words],
        }


@dataclass
class TranscriptionResult:
    """Complete result of an audio transcription."""

    text: str
    language: str
    language_probability: float
    duration: float
    segments: list[TranscriptionSegment] = field(default_factory=list)
    backend: str = "faster-whisper"
    device: str = "cuda"

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-serializable dict, including every segment."""
        return {
            "text": self.text,
            "language": self.language,
            "language_probability": round(self.language_probability, 3),
            "duration": round(self.duration, 3),
            "backend": self.backend,
            "device": self.device,
            "segments": [s.to_dict() for s in self.segments],
        }


class AudioTranscriber:
    """High-performance audio transcriber with Whisper Large v3 Turbo & Silero VAD.

    Supports faster-whisper (CTranslate2 GPU FP16 / CPU int8) and whisper.cpp binary backend.
    """

    def __init__(
        self,
        model_name_or_path: str = DEFAULT_CT2_TURBO_MODEL,
        device: str = "auto",
        compute_type: str = "auto",
        use_vad: bool = True,
        whisper_cpp_bin: str | None = None,
        whisper_cpp_model: str | None = None,
    ) -> None:
        """Initialize the transcriber.

        Args:
            model_name_or_path: Hugging Face repo ID or local path to CTranslate2 model.
            device: 'cuda', 'cpu', or 'auto' (detects CUDA availability).
            compute_type: 'float16', 'int8', 'default', or 'auto'.
            use_vad: Whether to enable Silero VAD speech filtering.
            whisper_cpp_bin: Path to whisper-cli executable.
            whisper_cpp_model: Path to GGML model binary.
        """
        self.model_name_or_path = model_name_or_path
        self.use_vad = use_vad
        self.whisper_cpp_bin = whisper_cpp_bin or str(
            _paths.resolve_runtime_binary(
                "whisper-cli",
                "APHRODY_WHISPER_CPP_BIN",
                "runtimes/whisper-b4938/whisper-cli",
            )
        )
        self.whisper_cpp_model = whisper_cpp_model or DEFAULT_GGML_LARGE_V3_TURBO

        # Resolve device
        if device == "auto":
            try:
                import ctranslate2

                device = "cuda" if ctranslate2.get_cuda_device_count() > 0 else "cpu"
            except Exception:
                device = "cpu"

        # Resolve compute_type
        if compute_type == "auto":
            compute_type = "float16" if device == "cuda" else "int8"

        self.device = device
        self.compute_type = compute_type
        self._ct2_model = None
        self._backend = "faster-whisper"

    def _load_ct2(self) -> Any:
        """Lazy loader for faster-whisper WhisperModel."""
        if self._ct2_model is None:
            try:
                from faster_whisper import WhisperModel

                logger.info(
                    f"Loading faster-whisper model '{self.model_name_or_path}' on {self.device} ({self.compute_type})..."
                )
                self._ct2_model = WhisperModel(
                    self.model_name_or_path,
                    device=self.device,
                    compute_type=self.compute_type,
                )
            except Exception as exc:
                if self.device == "cuda":
                    logger.warning(
                        f"Failed to load on CUDA ({exc}), falling back to CPU int8..."
                    )
                    from faster_whisper import WhisperModel

                    self.device = "cpu"
                    self.compute_type = "int8"
                    self._ct2_model = WhisperModel(
                        self.model_name_or_path,
                        device="cpu",
                        compute_type="int8",
                    )
                else:
                    raise exc
        return self._ct2_model

    def transcribe(
        self,
        audio: str | Path | np.ndarray,
        language: str | None = None,
        word_timestamps: bool = True,
        beam_size: int = 5,
        vad_filter: bool | None = None,
        vad_parameters: dict[str, Any] | None = None,
        backend_override: str | None = None,
    ) -> TranscriptionResult:
        """Transcribe audio file or raw PCM float32 waveform.

        Args:
            audio: File path (wav, mp3, flac) or numpy 1D float32 audio array (16kHz).
            language: Language code ('fr', 'en', 'ja', etc.) or None for auto-detect.
            word_timestamps: Whether to extract word-level timestamps.
            beam_size: Beam search width (1 for greedy decoding, 5 for higher quality).
            vad_filter: Enable or disable Silero VAD (defaults to self.use_vad).
            vad_parameters: Optional dictionary of Silero VAD parameters (e.g. min_silence_duration_ms).
            backend_override: Force 'faster-whisper' or 'whisper.cpp'.

        Returns:
            A populated TranscriptionResult instance.
        """
        use_vad = self.use_vad if vad_filter is None else vad_filter
        backend = backend_override or self._backend

        if backend == "faster-whisper":
            try:
                return self._transcribe_faster_whisper(
                    audio=audio,
                    language=language,
                    word_timestamps=word_timestamps,
                    beam_size=beam_size,
                    vad_filter=use_vad,
                    vad_parameters=vad_parameters,
                )
            except Exception as exc:
                logger.warning(
                    f"faster-whisper transcription error: {exc}. Trying whisper.cpp fallback..."
                )
                if os.path.exists(self.whisper_cpp_bin) and os.path.exists(
                    self.whisper_cpp_model
                ):
                    return self._transcribe_whisper_cpp(
                        audio=audio,
                        language=language,
                        word_timestamps=word_timestamps,
                    )
                raise exc

        elif backend == "whisper.cpp":
            return self._transcribe_whisper_cpp(
                audio=audio,
                language=language,
                word_timestamps=word_timestamps,
            )
        else:
            raise ValueError(f"Unknown transcription backend: {backend}")

    def _transcribe_faster_whisper(
        self,
        audio: str | Path | np.ndarray,
        language: str | None,
        word_timestamps: bool,
        beam_size: int,
        vad_filter: bool,
        vad_parameters: dict[str, Any] | None,
    ) -> TranscriptionResult:
        """Internal faster-whisper inference."""
        model = self._load_ct2()

        # Input audio normalization if numpy
        audio_input: np.ndarray | str
        if isinstance(audio, np.ndarray):
            audio_input = audio.astype(np.float32)
            duration = float(len(audio_input) / 16000.0)
        else:
            audio_input = str(Path(audio).resolve())
            duration = 0.0

        v_params = vad_parameters or dict(min_silence_duration_ms=100)
        segments_gen, info = model.transcribe(
            audio_input,
            language=language,
            word_timestamps=word_timestamps,
            beam_size=beam_size,
            vad_filter=vad_filter,
            vad_parameters=v_params if vad_filter else None,
        )

        segments: list[TranscriptionSegment] = []
        full_texts: list[str] = []

        for seg in segments_gen:
            words: list[WordTimestamp] = []
            if seg.words:
                for w in seg.words:
                    words.append(
                        WordTimestamp(
                            word=w.word,
                            start=float(w.start),
                            end=float(w.end),
                            probability=float(w.probability),
                        )
                    )
            full_texts.append(seg.text)
            segments.append(
                TranscriptionSegment(
                    id=seg.id,
                    start=float(seg.start),
                    end=float(seg.end),
                    text=seg.text,
                    words=words,
                )
            )

        full_text = " ".join(t.strip() for t in full_texts if t.strip())
        final_duration = (
            duration if duration > 0 else (segments[-1].end if segments else 0.0)
        )

        return TranscriptionResult(
            text=full_text,
            language=info.language,
            language_probability=float(info.language_probability),
            duration=final_duration,
            segments=segments,
            backend="faster-whisper",
            device=self.device,
        )

    def _transcribe_whisper_cpp(
        self,
        audio: str | Path | np.ndarray,
        language: str | None,
        word_timestamps: bool,
    ) -> TranscriptionResult:
        """Internal whisper.cpp binary invocation."""
        import tempfile

        temp_wav: str | None = None
        if isinstance(audio, np.ndarray):
            import soundfile as sf

            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                temp_wav = f.name
            sf.write(temp_wav, audio.astype(np.float32), 16000)
            audio_path = temp_wav
        else:
            audio_path = str(Path(audio).resolve())

        output_json_base = audio_path + "_res"
        cmd = [
            self.whisper_cpp_bin,
            "-m",
            self.whisper_cpp_model,
            "-f",
            audio_path,
            "-l",
            language or "auto",
            "-oj",
            "-of",
            output_json_base,
            "-np",
        ]
        if word_timestamps:
            cmd.append("-sow")

        try:
            res = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True,
                encoding="utf-8",
                errors="replace",
            )
            json_file = output_json_base + ".json"
            if not os.path.exists(json_file):
                raise RuntimeError(f"whisper-cli failed to output json: {res.stderr}")

            with open(json_file, encoding="utf-8") as jf:
                data = json.load(jf)

            detected_lang = data.get("result", {}).get("language", language or "en")
            raw_segments = data.get("transcription", [])
            segments: list[TranscriptionSegment] = []
            full_texts: list[str] = []

            for idx, s in enumerate(raw_segments):
                txt = s.get("text", "")
                t_from = s.get("offsets", {}).get("from", 0) / 1000.0
                t_to = s.get("offsets", {}).get("to", 0) / 1000.0
                full_texts.append(txt)
                segments.append(
                    TranscriptionSegment(
                        id=idx,
                        start=t_from,
                        end=t_to,
                        text=txt,
                    )
                )

            # Cleanup json output
            with contextlib.suppress(OSError):
                os.remove(json_file)

            full_text = " ".join(t.strip() for t in full_texts if t.strip())
            return TranscriptionResult(
                text=full_text,
                language=detected_lang,
                language_probability=1.0,
                duration=segments[-1].end if segments else 0.0,
                segments=segments,
                backend="whisper.cpp",
                device="cpu",
            )
        finally:
            if temp_wav and os.path.exists(temp_wav):
                with contextlib.suppress(OSError):
                    os.remove(temp_wav)


def transcribe_audio(
    audio: str | Path | np.ndarray,
    language: str | None = None,
    device: str = "auto",
    word_timestamps: bool = True,
    vad: bool = True,
) -> TranscriptionResult:
    """Convenience functional helper to transcribe an audio source.

    Args:
        audio: Audio file path or numpy waveform array.
        language: Forced language ('fr', 'en', 'ja', etc.) or auto.
        device: 'cuda', 'cpu', or 'auto'.
        word_timestamps: Whether to extract word-level timestamps.
        vad: Enable Silero VAD silence filtering.

    Returns:
        The transcription result object.
    """
    transcriber = AudioTranscriber(device=device, use_vad=vad)
    return transcriber.transcribe(
        audio=audio,
        language=language,
        word_timestamps=word_timestamps,
    )
