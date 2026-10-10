# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Video and music generation module with keyless Vertex AI calls and robust offline fallbacks."""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from aphrody.auth import credentials as _credentials
from aphrody.errors import ApiError
from aphrody.vertex import resolve_location, resolve_project

logger = logging.getLogger(__name__)


class VideoGenerator:
    """Generates videos from prompts using Vertex AI Veo, with a robust offline fallback."""

    def __init__(
        self,
        *,
        project: str | None = None,
        location: str | None = None,
    ) -> None:
        """Initialize the Video Generator.

        Args:
            project: Google Cloud project id override.
            location: Google Cloud region override.
        """
        self.project = resolve_project(project)
        self.location = resolve_location(location)

    def generate_video(
        self,
        prompt: str,
        out: str | Path = "video.mp4",
        aspect_ratio: str = "16:9",
        duration_seconds: int = 5,
        model: str = "veo-2.0-generate-001",
        dry_run: bool = False,
    ) -> Path:
        """Generate a video and save to disk.

        Args:
            prompt: Text description of the video.
            out: Destination path.
            aspect_ratio: Ratios such as '16:9', '1:1', '4:3', etc.
            duration_seconds: Duration in seconds (typically 5 or 6).
            model: Veo model id override.
            dry_run: If True, skip API call and directly generate offline fallback.

        Returns:
            The Path where the video was saved.
        """
        out_path = Path(out)
        out_path.parent.mkdir(parents=True, exist_ok=True)

        if dry_run:
            logger.info("Dry-run requested. Generating synthetic fallback video...")
            return self._generate_fallback(
                prompt, out_path, aspect_ratio, duration_seconds
            )

        try:
            from google import genai

            creds = _credentials.load_google_credentials()
            client = genai.Client(
                vertexai=True,
                project=self.project,
                location=self.location,
                credentials=creds,
            )

            logger.info(f"Submitting video generation to {model}...")
            operation = client.models.generate_videos(
                model=model,
                prompt=prompt,
                config={
                    "aspect_ratio": aspect_ratio,
                    "duration_seconds": duration_seconds,
                    "person_generation": "DONT_ALLOW",
                },
            )

            # Polling Veo long running operation
            timeout = 300
            start_time = time.time()
            while not operation.done:
                if time.time() - start_time > timeout:
                    raise ApiError(
                        408, "Veo video generation operation timed out after 5 minutes."
                    )
                time.sleep(5)
                operation = client.operations.get(operation)

            if getattr(operation, "error", None):
                raise ApiError(500, f"Veo API returned error: {operation.error}")

            # Extract video bytes
            videos = getattr(operation.result, "generated_videos", [])
            if not videos:
                raise ApiError(500, "Veo API did not return any videos in the result.")

            video_bytes = getattr(videos[0].video, "image_bytes", None)
            if not video_bytes:
                raise ApiError(500, "Veo API result did not contain valid video bytes.")
            if out_path.suffix.lower() != ".mp4":
                raise ValueError("Veo output must use a .mp4 suffix")
            if (
                not isinstance(video_bytes, bytes)
                or len(video_bytes) < 12
                or video_bytes[4:8] != b"ftyp"
            ):
                raise ApiError(500, "Veo API result is not an MP4 container.")

            staging_path = None
            try:
                with tempfile.NamedTemporaryFile(
                    mode="wb",
                    prefix=f".{out_path.stem}-",
                    suffix=".tmp",
                    dir=out_path.parent,
                    delete=False,
                ) as stream:
                    staging_path = Path(stream.name)
                    stream.write(video_bytes)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(staging_path, out_path)
            except BaseException:
                if staging_path is not None:
                    staging_path.unlink(missing_ok=True)
                raise
            logger.info(f"Successfully saved generated video to: {out_path}")
            return out_path

        except Exception as exc:
            logger.warning("Veo video generation failed: %s", type(exc).__name__)
            raise RuntimeError(
                "Veo video generation failed; no new video was saved"
            ) from exc

    def _generate_fallback(
        self, prompt: str, out_path: Path, aspect_ratio: str, duration: int
    ) -> Path:
        """Create an animated GIF or encode a real MP4 with FFmpeg."""
        from PIL import Image, ImageDraw

        suffix = out_path.suffix.lower()
        if suffix not in {".mp4", ".gif"}:
            raise ValueError("offline video output must have a .mp4 or .gif suffix")
        if duration < 1 or duration > 30:
            raise ValueError("offline video duration must be between 1 and 30 seconds")
        ffmpeg = (shutil.which("ffmpeg") or "") if suffix == ".mp4" else ""
        if suffix == ".mp4" and not ffmpeg:
            raise RuntimeError("FFmpeg is required to encode offline MP4 video")

        width, height = 480, 270
        if aspect_ratio == "1:1":
            width, height = 360, 360
        elif aspect_ratio == "4:3":
            width, height = 400, 300

        num_frames = duration * 10  # 10 fps

        def draw_frame(i: int):
            img = Image.new("RGB", (width, height), color=(20, 24, 33))
            draw = ImageDraw.Draw(img)

            # Simple bouncing sphere representation
            x = int(width / 2 + (width / 3) * (i / num_frames * 2 - 1) ** 2)
            y = int(height / 2 + (height / 4) * (1 - (i % 10 - 5) ** 2 / 25))
            r = 30
            # Drawn using HSL tail colors
            draw.ellipse(
                (x - r, y - r, x + r, y + r),
                fill=(244, 67, 54),
                outline=(255, 255, 255),
            )

            # Draw progress and title
            draw.text((10, 10), f"Video: {prompt[:30]}...", fill=(200, 200, 200))
            draw.text(
                (10, height - 20),
                f"Frame {i + 1}/{num_frames} ({aspect_ratio})",
                fill=(100, 100, 100),
            )

            return img

        if suffix == ".gif":
            frames = [draw_frame(i) for i in range(num_frames)]
            frames[0].save(
                out_path,
                save_all=True,
                append_images=frames[1:],
                duration=100,
                loop=0,
                format="GIF",
            )
        else:
            with tempfile.TemporaryDirectory(prefix="aphrody-video-") as scratch:
                raw_path = Path(scratch) / "frames.rgb"
                encoded_path = Path(scratch) / "video.mp4"
                with raw_path.open("wb") as stream:
                    for i in range(num_frames):
                        stream.write(draw_frame(i).tobytes())
                result = subprocess.run(
                    [
                        ffmpeg,
                        "-v",
                        "error",
                        "-nostdin",
                        "-f",
                        "rawvideo",
                        "-pixel_format",
                        "rgb24",
                        "-video_size",
                        f"{width}x{height}",
                        "-framerate",
                        "10",
                        "-i",
                        str(raw_path),
                        "-c:v",
                        "libx264",
                        "-pix_fmt",
                        "yuv420p",
                        "-f",
                        "mp4",
                        str(encoded_path),
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if result.returncode != 0 or not encoded_path.is_file():
                    raise RuntimeError(
                        f"FFmpeg could not encode MP4: {result.stderr.strip() or result.returncode}"
                    )
                with encoded_path.open("rb") as encoded_stream:
                    header = encoded_stream.read(12)
                if len(header) < 12 or header[4:8] != b"ftyp":
                    raise RuntimeError("FFmpeg output is not an MP4 file")
                os.replace(encoded_path, out_path)
        logger.info(f"Fallback animation saved to: {out_path}")
        return out_path


class MusicGenerator:
    """Generates audio/music tracks from prompts, with a robust NumPy/SciPy offline synthesizer."""

    def __init__(
        self,
        *,
        project: str | None = None,
        location: str | None = None,
    ) -> None:
        """Initialize the Music Generator."""
        self.project = resolve_project(project)
        self.location = resolve_location(location)

    def generate_music(
        self,
        prompt: str,
        out: str | Path = "music.wav",
        duration_seconds: int = 10,
        model: str = "audio-generation",
        dry_run: bool = False,
    ) -> Path:
        """Generate a music/audio track.

        Args:
            prompt: Text description of the audio/music style.
            out: Destination path.
            duration_seconds: Target duration.
            model: Audio generation model override.
            dry_run: If True, directly generate synthesized wave fallback.

        Returns:
            The Path to the generated audio file.
        """
        out_path = Path(out)
        out_path.parent.mkdir(parents=True, exist_ok=True)

        if dry_run:
            logger.info("Dry-run requested. Synthesizing offline fallback melody...")
            return self._generate_fallback(prompt, out_path, duration_seconds)

        try:
            from google import genai

            creds = _credentials.load_google_credentials()
            client = genai.Client(
                vertexai=True,
                project=self.project,
                location=self.location,
                credentials=creds,
            )

            logger.info(f"Requesting audio generation from {model}...")
            # We call the Vertex audio generation model if supported
            # (Otherwise it raises an exception which triggers the robust fallback)
            res = client.models.generate_content(
                model=model,
                contents=prompt,
                config={
                    "response_modalities": ["AUDIO"],
                    "speech_config": {
                        "voice_config": {
                            "prebuilt_voice_config": {"voice_name": "Puck"}
                        }
                    },
                },
            )

            # Extract audio parts
            audio_data = None
            if res.candidates:
                for cand in res.candidates:
                    if cand.content and cand.content.parts:
                        for part in cand.content.parts:
                            if (
                                hasattr(part, "inline_data") and part.inline_data
                            ) and "audio" in (part.inline_data.mime_type or ""):
                                audio_data = part.inline_data.data
                                break

            if not audio_data:
                raise ApiError(500, "No audio data returned in response.")

            out_path.write_bytes(audio_data)
            logger.info(f"Saved generated audio to: {out_path}")
            return out_path

        except Exception as exc:
            logger.warning(
                f"Audio API call failed ({exc}). Synthesizing offline fallback WAV..."
            )
            return self._generate_fallback(prompt, out_path, duration_seconds)

    def _generate_fallback(self, prompt: str, out_path: Path, duration: int) -> Path:
        """Generate a synthesized multi-tone WAV melody using NumPy and SciPy."""
        import numpy as np
        from scipy.io import wavfile

        sample_rate = 22050
        t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)

        # Base drone tone (A3 = 220 Hz)
        y = 0.4 * np.sin(2 * np.pi * 220 * t)

        # Simple melody sweep based on characters in the prompt to make it 'editable' and prompt-dependent
        seed_value = sum(ord(c) for c in prompt) % 8
        notes = [220, 247.5, 275, 293.3, 330, 366.6, 396, 440]
        base_freq = notes[seed_value]

        # Add arpeggiator / repeating tones
        note_duration = 0.5  # half second note duration
        note_samples = int(sample_rate * note_duration)
        melody = np.zeros_like(t)

        for i in range(0, len(t), note_samples):
            step = (i // note_samples) % 4
            # Generate different harmonic notes
            freq = base_freq * (1 + 0.25 * step)
            chunk_t = t[i : i + note_samples] - (i / sample_rate)
            # Add simple attack-decay envelope to sound like notes
            envelope = np.exp(-3 * chunk_t[: len(chunk_t)])
            melody[i : i + note_samples] = (
                0.3 * np.sin(2 * np.pi * freq * chunk_t) * envelope
            )

        # Mix drone + melody
        audio_mixed = y + melody
        # Normalize to 16-bit range
        audio_mixed = audio_mixed / np.max(np.abs(audio_mixed))
        audio_int16 = (audio_mixed * 32767).astype(np.int16)

        # Write WAV file
        wavfile.write(out_path, sample_rate, audio_int16)
        logger.info(f"Synthesized melody WAV saved to: {out_path}")
        return out_path
