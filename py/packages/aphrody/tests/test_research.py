# SPDX-License-Identifier: Apache-2.0
"""Tests for Deep Research agentic grounded search loops."""

from __future__ import annotations

from unittest import mock

import pytest

from aphrody.research import DeepResearcher


def test_researcher_dry_run_preview(tmp_path) -> None:
    dr = DeepResearcher()
    out = tmp_path / "test_report.md"

    saved = dr.conduct_research("GCP architecture", depth=1, out=out, dry_run=True)

    assert saved == out
    assert out.exists()
    content = out.read_text(encoding="utf-8")
    assert "Research preview: GCP architecture" in content
    assert "No research or source verification was performed" in content
    assert "Bibliography" not in content


def test_researcher_api_success(tmp_path) -> None:
    class MockWeb:
        title = "GCP Cloud Computing"
        uri = "https://cloud.google.com"

    class MockGroundingChunk:
        web = MockWeb()

    class MockGroundingMetadata:
        grounding_chunks = (MockGroundingChunk(),)

    class MockCandidate:
        content = mock.Mock()
        grounding_metadata = MockGroundingMetadata()

    class MockResponse:
        candidates = (MockCandidate(),)
        text = "This is synthesized research text."

    with (
        mock.patch("aphrody.auth.credentials.load_google_credentials"),
        mock.patch("google.genai.Client") as mock_client_class,
    ):
        mock_client = mock_client_class.return_value
        mock_client.models.generate_content.return_value = MockResponse()

        dr = DeepResearcher()
        out = tmp_path / "test_report.md"
        saved = dr.conduct_research("Vertex AI Search", depth=1, out=out, dry_run=False)

        assert saved == out
        assert out.exists()
        content = out.read_text(encoding="utf-8")
        assert "This is synthesized research text." in content
        assert "[GCP Cloud Computing](https://cloud.google.com)" in content


def test_research_failure_does_not_create_report(tmp_path) -> None:
    out = tmp_path / "report.md"
    with (
        mock.patch("aphrody.auth.credentials.load_google_credentials"),
        mock.patch("google.genai.Client") as client_class,
    ):
        client_class.return_value.models.generate_content.side_effect = RuntimeError(
            "API unavailable"
        )
        with pytest.raises(RuntimeError, match="no new report was saved"):
            DeepResearcher().conduct_research("test topic", depth=1, out=out)
    assert not out.exists()


def test_empty_research_response_does_not_create_report(tmp_path) -> None:
    out = tmp_path / "report.md"
    with (
        mock.patch("aphrody.auth.credentials.load_google_credentials"),
        mock.patch("google.genai.Client") as client_class,
    ):
        client_class.return_value.models.generate_content.return_value = mock.Mock(
            text="", candidates=[]
        )
        with pytest.raises(RuntimeError, match="no new report was saved"):
            DeepResearcher().conduct_research("test topic", depth=1, out=out)
    assert not out.exists()


def test_ungrounded_research_does_not_create_report(tmp_path) -> None:
    out = tmp_path / "report.md"
    with (
        mock.patch("aphrody.auth.credentials.load_google_credentials"),
        mock.patch("google.genai.Client") as client_class,
    ):
        client_class.return_value.models.generate_content.return_value = mock.Mock(
            text="A plausible but ungrounded claim.", candidates=[]
        )
        with pytest.raises(RuntimeError, match="no new report was saved"):
            DeepResearcher().conduct_research("test topic", depth=1, out=out)
    assert not out.exists()
