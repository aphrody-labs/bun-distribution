# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Unit tests and validation suite for DoclingExtractor and Granite Docling 258M."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path
from types import ModuleType

import pytest

from aphrody.document import docling_extractor
from aphrody.document.docling_extractor import (
    DoclingExtractor,
    DocumentBlock,
    ExtractionPageResult,
)

integration_only = pytest.mark.skipif(
    os.environ.get("APHRODY_RUN_INTEGRATION_TESTS") != "1",
    reason="set APHRODY_RUN_INTEGRATION_TESTS=1 to run local model integration tests",
)


@pytest.fixture(autouse=True)
def isolate_unit_runtime(request, monkeypatch, tmp_path):
    """Unit checks never use host models, runners, optional renderers or GPU tools."""
    if request.node.get_closest_marker("integration"):
        return
    monkeypatch.setenv("APHRODY_HOME", str(tmp_path / "state"))
    monkeypatch.delenv("APHRODY_LLAMA_MTMD_CLI", raising=False)
    monkeypatch.setattr(docling_extractor.shutil, "which", lambda command: None)
    monkeypatch.setitem(sys.modules, "docling_core", None)


@pytest.fixture
def configured_extractor(tmp_path):
    weights = tmp_path / "weights.gguf"
    mmproj = tmp_path / "mmproj.gguf"
    runner = tmp_path / "llama-mtmd-cli"
    for path in (weights, mmproj, runner):
        path.write_text("test fixture", encoding="utf-8")
    runner.chmod(0o700)
    return DoclingExtractor(weights, mmproj, runner, device="cpu")


def _pil() -> tuple[ModuleType, ModuleType]:
    """Return PIL's Image and ImageDraw modules, skipping when Pillow is absent."""
    image = pytest.importorskip("PIL.Image", reason="requires the 'docling' extra")
    draw = pytest.importorskip("PIL.ImageDraw", reason="requires the 'docling' extra")
    return image, draw


def create_test_image(path: Path) -> None:
    """Create a synthetic test image with text lines."""
    image_mod, draw_mod = _pil()
    img = image_mod.new("RGB", (600, 300), color="white")
    draw = draw_mod.Draw(img)
    draw.text((30, 30), "APHRODY OCR PIPELINE", fill="black")
    draw.text((30, 80), "Granite Docling 258M Validation", fill="black")
    draw.text((30, 130), "High fidelity layout preservation", fill="black")
    img.save(path)


def create_test_pdf(path: Path) -> None:
    """Create a synthetic test PDF."""
    image_mod, draw_mod = _pil()
    img = image_mod.new("RGB", (600, 300), color="white")
    draw = draw_mod.Draw(img)
    draw.text((30, 30), "Docling PDF Document", fill="black")
    draw.text((30, 80), "Page 1 Header", fill="black")
    img.save(path, "PDF", resolution=100.0)


def test_extractor_initialization_and_device_detection(monkeypatch) -> None:
    """Test extractor initialization and hardware detection."""
    monkeypatch.setitem(sys.modules, "torch", None)
    monkeypatch.setitem(sys.modules, "onnxruntime", None)
    calls = []

    def fake_run(argv, **kwargs):
        calls.append((argv, kwargs))
        return subprocess.CompletedProcess(argv, 1)

    monkeypatch.setattr(subprocess, "run", fake_run)
    extractor = DoclingExtractor(device="auto")
    assert extractor.device == "cpu"
    assert extractor.gpu_layers == 0
    assert calls[0][0] == ["nvidia-smi"]
    assert calls[0][1]["timeout"] == 5
    assert DoclingExtractor(device="cuda").gpu_layers == 99


def test_extractor_model_presence(configured_extractor) -> None:
    """Verify that Granite Docling weights and mmproj are present on disk."""
    assert configured_extractor.verify_model_present()
    configured_extractor.mmproj_path.unlink()
    assert not configured_extractor.verify_model_present()


def test_model_presence_does_not_imply_runtime_readiness(configured_extractor):
    assert configured_extractor.verify_runtime_ready()
    configured_extractor.runner_bin.unlink()
    assert configured_extractor.verify_model_present()
    assert not configured_extractor.verify_runtime_ready()


@pytest.mark.parametrize(
    "platform,runner_name",
    [("linux", "llama-mtmd-cli"), ("win32", "llama-mtmd-cli.exe")],
)
def test_managed_runner_and_models_respect_dynamic_home(
    monkeypatch, tmp_path, platform, runner_name
):
    monkeypatch.setattr(docling_extractor.sys, "platform", platform)
    home = tmp_path / "custom-home"
    monkeypatch.setenv("APHRODY_HOME", str(home))
    extractor = DoclingExtractor(device="cpu")
    assert extractor.weights_path.is_relative_to(home / "models")
    assert extractor.mmproj_path.is_relative_to(home / "models")
    assert extractor.runner_bin == home / "runtimes" / "llama-b10549" / runner_name


def test_runner_override_and_explicit_precedence(monkeypatch, tmp_path):
    env_runner = tmp_path / "configured-runner"
    monkeypatch.setenv("APHRODY_LLAMA_MTMD_CLI", str(env_runner))
    assert DoclingExtractor(device="cpu").runner_bin == env_runner
    explicit = tmp_path / "explicit-runner"
    assert DoclingExtractor(runner_bin=explicit, device="cpu").runner_bin == explicit


def test_runner_path_lookup(monkeypatch, tmp_path):
    runner = tmp_path / "bin" / "llama-mtmd-cli"
    monkeypatch.setattr(docling_extractor.shutil, "which", lambda command: str(runner))
    assert DoclingExtractor(device="cpu").runner_bin == runner
    assert (
        DoclingExtractor(runner_bin="custom-command", device="cpu").runner_bin == runner
    )


def test_missing_explicit_relative_path_does_not_fall_back_to_path(
    monkeypatch, tmp_path
):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        docling_extractor.shutil,
        "which",
        lambda command: str(tmp_path / "unrelated"),
    )
    extractor = DoclingExtractor(runner_bin="./missing-runner", device="cpu")
    assert extractor.runner_bin == Path("missing-runner")
    assert not extractor.verify_runtime_ready()


def test_managed_runner_precedes_path(monkeypatch, tmp_path):
    runner = docling_extractor._default_runner_path()
    runner.parent.mkdir(parents=True)
    runner.write_text("fixture")
    monkeypatch.setattr(
        docling_extractor.shutil,
        "which",
        lambda command: str(tmp_path / "other"),
    )
    assert DoclingExtractor(device="cpu").runner_bin == runner.resolve()


def test_missing_runner_error_does_not_start_process(
    configured_extractor, monkeypatch, tmp_path
):
    image = tmp_path / "image.png"
    image.write_bytes(b"fixture")
    configured_extractor.runner_bin.unlink()

    def unexpected_run(*args, **kwargs):
        pytest.fail("missing runner started inference")

    monkeypatch.setattr(subprocess, "run", unexpected_run)
    with pytest.raises(FileNotFoundError, match="Multimodal runner binary not found"):
        configured_extractor.extract_image(image)


def test_missing_model_error_does_not_start_process(
    configured_extractor, monkeypatch, tmp_path
):
    image = tmp_path / "image.png"
    image.write_bytes(b"fixture")
    configured_extractor.mmproj_path.unlink()

    def unexpected_run(*args, **kwargs):
        pytest.fail("missing model started inference")

    monkeypatch.setattr(subprocess, "run", unexpected_run)
    with pytest.raises(FileNotFoundError, match="Granite Docling model not found"):
        configured_extractor.extract_image(image)


def test_nonexecutable_runner_is_not_ready(configured_extractor, monkeypatch, tmp_path):
    monkeypatch.setattr(docling_extractor.sys, "platform", "linux")
    monkeypatch.setattr(docling_extractor.os, "access", lambda path, mode: False)
    assert not configured_extractor.verify_runtime_ready()
    image = tmp_path / "image.png"
    image.write_bytes(b"fixture")
    with pytest.raises(PermissionError, match="not executable"):
        configured_extractor.extract_image(image)


def test_runner_failure_is_reported(configured_extractor, monkeypatch, tmp_path):
    image = tmp_path / "image.png"
    image.write_bytes(b"fixture")
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda argv, **kwargs: subprocess.CompletedProcess(
            argv, 7, "", "inference failed"
        ),
    )
    with pytest.raises(RuntimeError, match="Runner exited with code 7"):
        configured_extractor.extract_image(image)


def test_image_extraction_uses_resolved_runtime(
    configured_extractor, monkeypatch, tmp_path
):
    image = tmp_path / "image.png"
    image.write_bytes(b"fixture")
    calls = []

    def fake_run(argv, **kwargs):
        calls.append((argv, kwargs))
        return subprocess.CompletedProcess(
            argv, 0, "<doctag><text>Readable document</text></doctag>", ""
        )

    monkeypatch.setattr(subprocess, "run", fake_run)
    result = configured_extractor.extract_image(image, page_index=2)
    assert result.has_text
    assert result.page_index == 2
    assert result.markdown == "Readable document"
    assert calls[0][0][0] == str(configured_extractor.runner_bin)
    assert calls[0][1]["encoding"] == "utf-8"


def test_doctags_block_parsing() -> None:
    """Test parsing raw DocTags into DocumentBlock entities."""
    raw_sample = (
        "<doctag>"
        "<section_header_level_1><loc_10><loc_20><loc_100><loc_40>TITLE SECTION</section_header_level_1>\n"
        "<text><loc_10><loc_50><loc_200><loc_80>Body paragraph text</text>\n"
        "<list_item><loc_10><loc_90><loc_150><loc_110>First list bullet</list_item>\n"
        "<formula><loc_10><loc_120><loc_150><loc_140>E = mc^2</formula>\n"
        "<page_footer><loc_10><loc_480><loc_50><loc_490>1</page_footer>\n"
        "</doctag>"
    )
    blocks = DoclingExtractor.parse_doctags_blocks(raw_sample)
    assert len(blocks) == 5

    assert blocks[0].tag == "section_header_level_1"
    assert blocks[0].text == "TITLE SECTION"
    assert blocks[0].level == 1
    assert blocks[0].bbox is not None
    assert len(blocks[0].bbox) == 4

    assert blocks[1].tag == "text"
    assert blocks[1].text == "Body paragraph text"

    assert blocks[2].tag == "list_item"
    assert blocks[2].text == "First list bullet"

    assert blocks[3].tag == "formula"
    assert blocks[3].text == "E = mc^2"

    assert blocks[4].tag == "page_footer"


def test_render_to_markdown_and_docling_core_integration() -> None:
    """Test DocTags rendering to high-fidelity Markdown with headings, tables, formulas."""
    raw_sample = (
        "<doctag>"
        "<section_header_level_2><loc_10><loc_20><loc_100><loc_40>Overview</section_header_level_2>\n"
        "<text><loc_10><loc_50><loc_200><loc_80>Docling parses structured elements.</text>\n"
        "<otsl><loc_10><loc_90><loc_300><loc_150>"
        "<ched><loc_10><loc_90><loc_50><loc_110>Col 1</ched>"
        "<ched><loc_50><loc_90><loc_100><loc_110>Col 2</ched>"
        "<nl>"
        "<fcel><loc_10><loc_110><loc_50><loc_130>A</fcel>"
        "<fcel><loc_50><loc_110><loc_100><loc_130>B</fcel>"
        "</otsl>\n"
        "<formula><loc_10><loc_160><loc_150><loc_180>\\int_0^1 x dx = 0.5</formula>\n"
        "</doctag>"
    )
    blocks = DoclingExtractor.parse_doctags_blocks(raw_sample)
    md = DoclingExtractor.render_to_markdown(raw_sample, blocks)

    assert "Overview" in md
    assert "Docling parses structured elements." in md
    # Formula check
    assert "\\int_0^1 x dx = 0.5" in md or "$$" in md


def test_build_docling_json() -> None:
    """Test generation of Docling-compatible JSON schema."""
    page = ExtractionPageResult(
        page_index=0,
        markdown="# Title\n\nContent",
        raw_doctags="<doctag><text>Content</text></doctag>",
        blocks=[DocumentBlock(tag="text", text="Content")],
        has_text=True,
        tables_count=0,
        formulas_count=0,
        elapsed_ms=50,
    )
    json_data = DoclingExtractor.build_docling_json("test_doc", [page])
    assert isinstance(json_data, dict)
    assert "name" in json_data
    assert json_data["name"] == "test_doc"


@pytest.mark.integration
@integration_only
def test_live_granite_docling_extraction() -> None:
    """End-to-end live test: extract a generated image with real model weights."""
    extractor = DoclingExtractor(max_tokens=256)
    assert extractor.verify_runtime_ready(), (
        "Granite Docling models and executable runner required"
    )

    with tempfile.TemporaryDirectory(prefix="docling_test_") as tmp_dir:
        img_path = Path(tmp_dir) / "test.png"
        create_test_image(img_path)

        res = extractor.extract_image(img_path)
        assert res.has_text
        assert res.elapsed_ms > 0
        assert len(res.blocks) > 0
        assert "<doctag>" in res.raw_doctags
        assert len(res.markdown) > 0
        print(
            f"\n[E2E Image Test] Extracted in {res.elapsed_ms}ms, device: {extractor.device}"
        )
        print(f"[E2E Markdown Output]:\n{res.markdown}")


@pytest.mark.integration
@integration_only
def test_live_pdf_extraction() -> None:
    """End-to-end live test: extract a generated PDF document."""
    extractor = DoclingExtractor(max_tokens=256)
    assert extractor.verify_runtime_ready(), (
        "Granite Docling models and executable runner required"
    )

    with tempfile.TemporaryDirectory(prefix="docling_pdf_test_") as tmp_dir:
        pdf_path = Path(tmp_dir) / "test.pdf"
        create_test_pdf(pdf_path)

        doc_res = extractor.extract_document(pdf_path)
        assert len(doc_res.pages) == 1
        assert doc_res.total_elapsed_ms > 0
        assert doc_res.backend == "granite-docling-258m-gguf"
        assert len(doc_res.markdown) > 0
        assert isinstance(doc_res.json_data, dict)
        print(
            f"\n[E2E PDF Test] Extracted in {doc_res.total_elapsed_ms}ms, device: {extractor.device}"
        )
