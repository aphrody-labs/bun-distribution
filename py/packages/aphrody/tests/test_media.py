# SPDX-License-Identifier: Apache-2.0
"""Tests for video and music generation logic and fallbacks."""

from __future__ import annotations

import shutil
import subprocess
from unittest import mock

import pytest

from aphrody.media import MusicGenerator, VideoGenerator

MP4_HEADER = b"\x00\x00\x00\x18ftypisom\x00\x00\x00\x00"


def test_video_generator_dry_run_fallback(tmp_path) -> None:
    pytest.importorskip("PIL", reason="requires the 'images' extra")
    if not shutil.which("ffmpeg"):
        pytest.skip("requires FFmpeg for MP4 encoding")
    vg = VideoGenerator()
    out = tmp_path / "test_video.mp4"

    saved = vg.generate_video(
        "a cute cat playing piano", out=out, duration_seconds=1, dry_run=True
    )

    assert saved == out
    assert out.exists()
    assert out.stat().st_size > 0
    assert out.read_bytes()[4:8] == b"ftyp"
    if ffprobe := shutil.which("ffprobe"):
        result = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "default=noprint_wrappers=1",
                str(out),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        assert "codec_name=h264" in result.stdout


def test_video_fallback_requires_encoder_without_creating_mp4(tmp_path) -> None:
    pytest.importorskip("PIL", reason="requires the 'images' extra")
    out = tmp_path / "test_video.mp4"
    with (
        mock.patch("aphrody.media.shutil.which", return_value=None),
        pytest.raises(RuntimeError, match="FFmpeg is required"),
    ):
        VideoGenerator().generate_video(
            "a cat", out=out, duration_seconds=1, dry_run=True
        )
    assert not out.exists()


def test_video_generator_api_success(tmp_path) -> None:
    mock_result = mock.Mock()
    mock_result.generated_videos = [mock.Mock(video=mock.Mock(image_bytes=MP4_HEADER))]

    class MockOperation:
        done = True
        result = mock_result

    with (
        mock.patch("aphrody.auth.credentials.load_google_credentials"),
        mock.patch("google.genai.Client") as mock_client_class,
    ):
        mock_client = mock_client_class.return_value
        mock_client.models.generate_videos.return_value = MockOperation()

        vg = VideoGenerator()
        out = tmp_path / "test_video.mp4"
        saved = vg.generate_video("a cute cat", out=out, dry_run=False)

        assert saved == out
        assert out.exists()
        assert out.read_bytes() == MP4_HEADER


def test_video_generator_api_failure_does_not_replace_or_create_video(
    tmp_path,
) -> None:
    with (
        mock.patch("aphrody.auth.credentials.load_google_credentials"),
        mock.patch("google.genai.Client") as client_class,
    ):
        client_class.return_value.models.generate_videos.side_effect = RuntimeError(
            "API unavailable"
        )
        vg = VideoGenerator()
        existing = tmp_path / "existing.mp4"
        existing.write_bytes(b"original video")
        with pytest.raises(RuntimeError, match="no new video was saved"):
            vg.generate_video("a cat", out=existing)
        assert existing.read_bytes() == b"original video"

        missing = tmp_path / "missing.mp4"
        with pytest.raises(RuntimeError, match="no new video was saved"):
            vg.generate_video("a cat", out=missing)
        assert not missing.exists()
        assert not list(tmp_path.glob("*.tmp"))


def test_video_generator_rejects_non_mp4_api_payload(tmp_path) -> None:
    operation = mock.Mock(done=True, error=None)
    operation.result.generated_videos = [
        mock.Mock(video=mock.Mock(image_bytes=b"not a video"))
    ]
    out = tmp_path / "invalid.mp4"
    with (
        mock.patch("aphrody.auth.credentials.load_google_credentials"),
        mock.patch("google.genai.Client") as client_class,
    ):
        client_class.return_value.models.generate_videos.return_value = operation
        with pytest.raises(RuntimeError, match="no new video was saved"):
            VideoGenerator().generate_video("a cat", out=out)
    assert not out.exists()


def test_video_generator_atomic_write_preserves_existing_file(tmp_path) -> None:
    operation = mock.Mock(done=True, error=None)
    operation.result.generated_videos = [
        mock.Mock(video=mock.Mock(image_bytes=MP4_HEADER))
    ]
    out = tmp_path / "existing.mp4"
    out.write_bytes(b"original video")
    with (
        mock.patch("aphrody.auth.credentials.load_google_credentials"),
        mock.patch("google.genai.Client") as client_class,
        mock.patch("aphrody.media.os.replace", side_effect=OSError("write blocked")),
    ):
        client_class.return_value.models.generate_videos.return_value = operation
        with pytest.raises(RuntimeError, match="no new video was saved"):
            VideoGenerator().generate_video("a cat", out=out)
    assert out.read_bytes() == b"original video"
    assert not list(tmp_path.glob("*.tmp"))


def test_music_generator_dry_run_fallback(tmp_path) -> None:
    pytest.importorskip("scipy", reason="requires the 'to3d' extra")
    mg = MusicGenerator()
    out = tmp_path / "test_music.wav"

    saved = mg.generate_music(
        "lofi beats to study to", out=out, duration_seconds=2, dry_run=True
    )

    assert saved == out
    assert out.exists()
    assert out.stat().st_size > 44  # WAV header is 44 bytes


def test_music_generator_api_success(tmp_path) -> None:
    class MockInlineData:
        mime_type = "audio/wav"
        data = b"WAV_DATA"

    class MockPart:
        inline_data = MockInlineData()

    class MockContent:
        parts = (MockPart(),)

    class MockCandidate:
        content = MockContent()

    class MockResponse:
        candidates = (MockCandidate(),)

    with (
        mock.patch("aphrody.auth.credentials.load_google_credentials"),
        mock.patch("google.genai.Client") as mock_client_class,
    ):
        mock_client = mock_client_class.return_value
        mock_client.models.generate_content.return_value = MockResponse()

        mg = MusicGenerator()
        out = tmp_path / "test_music.wav"
        saved = mg.generate_music("lofi beats", out=out, dry_run=False)

        assert saved == out
        assert out.exists()
        assert out.read_bytes() == b"WAV_DATA"
