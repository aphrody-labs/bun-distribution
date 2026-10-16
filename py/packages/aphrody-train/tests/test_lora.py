# SPDX-License-Identifier: Apache-2.0
"""LoRA input guards reject unsafe or incomplete data before model output exists."""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from click.testing import CliRunner

from aphrody_train.lora import (
    load_examples,
    main,
    resolve_converter_python,
    run_lora_job,
    train,
    validate_converter,
)
from aphrody_train.protocol import TrainEmitter


def prepared(tmp_path, prompt="Name one planet.", answer="Mars is a planet."):
    source = tmp_path / "prepared"
    source.mkdir()
    row = {
        "session": "synthetic",
        "prompt": prompt,
        "messages": [
            {"role": "user", "parts": [{"text": prompt}]},
            {"role": "model", "parts": [{"text": answer}]},
        ],
    }
    (source / "rollouts.jsonl").write_text(json.dumps(row) + "\n", encoding="utf-8")
    gold = tmp_path / "gold.jsonl"
    gold.write_text('{"q":"untouched gold query"}\n', encoding="utf-8")
    return source, gold


def test_prepared_rollouts_recheck_gold_and_redact_secrets(tmp_path):
    source, gold = prepared(tmp_path, answer="Use token=private-value in this demo.")
    examples = load_examples(source, gold)
    assert examples == [("Name one planet.", "Use [REDACTED_SECRET] in this demo.")]
    gold.write_text('{"q":"Name one planet."}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="overlaps untouched gold"):
        load_examples(source, gold)


def test_missing_converter_fails_before_creating_output(tmp_path, monkeypatch):
    source, gold = prepared(tmp_path)
    model = tmp_path / "model"
    model.mkdir()
    (model / "config.json").write_text("{}", encoding="utf-8")
    monkeypatch.delenv("APHRODY_LLAMA_CPP_CONVERTER", raising=False)
    output = tmp_path / "output"
    result = CliRunner().invoke(
        main,
        [
            "--rollout-dir",
            str(source),
            "--gold-file",
            str(gold),
            "--base-model",
            str(model),
            "--output-dir",
            str(output),
            "--steps",
            "1",
        ],
    )
    assert result.exit_code != 0
    events = [
        json.loads(line) for line in result.output.splitlines() if line.startswith("{")
    ]
    assert [event["type"] for event in events] == ["start", "error"]
    assert not output.exists()
    with pytest.raises(ValueError, match="APHRODY_LLAMA_CPP_CONVERTER"):
        validate_converter(tmp_path / "missing.py")


def test_completed_run_is_never_overwritten_or_loaded(tmp_path):
    output = tmp_path / "finished"
    output.mkdir()
    artifact = output / "adapter.gguf"
    artifact.write_bytes(b"existing verified adapter")
    with pytest.raises(ValueError, match="completed training output"):
        train(
            tmp_path,
            tmp_path / "gold",
            tmp_path,
            tmp_path,
            output,
            1,
            TrainEmitter("probe"),
            "nf4",
        )
    assert artifact.read_bytes() == b"existing verified adapter"


def test_embedded_bun_never_launches_itself_as_the_converter_python(
    tmp_path, monkeypatch
):
    qualified_python = Path(sys.executable)
    bun = tmp_path / "bun.exe"
    bun.touch()
    monkeypatch.setattr(sys, "executable", str(bun))
    monkeypatch.delenv("APHRODY_LORA_CONVERTER_PYTHON", raising=False)
    with pytest.raises(ValueError, match="absolute qualified CPython executable"):
        resolve_converter_python()
    monkeypatch.setenv("APHRODY_LORA_CONVERTER_PYTHON", str(qualified_python))
    assert resolve_converter_python() == qualified_python
    monkeypatch.setenv("APHRODY_LORA_CONVERTER_PYTHON", str(bun))
    assert resolve_converter_python(qualified_python) == qualified_python
    with pytest.raises(ValueError, match="absolute qualified CPython executable"):
        resolve_converter_python(tmp_path / "missing-python.exe")


def test_invalid_quantization_fails_before_dataset_or_model_loading(tmp_path):
    with pytest.raises(ValueError, match="quantization must be"):
        train(
            tmp_path,
            tmp_path / "gold",
            tmp_path,
            tmp_path,
            tmp_path / "out",
            1,
            TrainEmitter("probe"),
            "unqualified",
        )
    result = CliRunner().invoke(main, ["--quantization", "unqualified"])
    assert result.exit_code != 0


def test_native_json_job_preserves_gold_guard_and_emits_no_fake_artifact(
    tmp_path, capsys
):
    source, gold = prepared(tmp_path)
    gold.write_text('{"q":"Name one planet."}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="overlaps untouched gold"):
        run_lora_job(
            {
                "job_id": "native-guard",
                "rollout_dir": str(source),
                "gold_file": str(gold),
                "base_model": str(tmp_path / "base"),
                "converter": str(tmp_path / "convert_lora_to_gguf.py"),
                "output_dir": str(tmp_path / "output"),
                "quantization": "nf4",
                "steps": 1,
            }
        )
    events = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert [event["type"] for event in events] == ["start", "error"]
    assert not (tmp_path / "output").exists()
    with pytest.raises(ValueError, match="absolute rollout_dir"):
        run_lora_job({"rollout_dir": "relative"})


@pytest.mark.parametrize(
    "quantization,cuda_available", [("none", True), ("nf4", True), ("nf4", False)]
)
def test_precision_selection_preserves_bf16_and_prepares_nf4_adapter(
    tmp_path, monkeypatch, quantization, cuda_available
):
    """Exercise loader/trainer contracts without allocating a tensor or reporting training."""
    source, gold = prepared(tmp_path)
    base = tmp_path / "base"
    base.mkdir()
    (base / "config.json").write_text("{}", encoding="utf-8")
    converter = tmp_path / "llama" / "convert_lora_to_gguf.py"
    converter.parent.mkdir()
    converter.touch()
    for package in ("gguf-py/gguf", "conversion"):
        directory = converter.parent / package
        directory.mkdir(parents=True)
        (directory / "__init__.py").touch()
    observed = {}
    model = SimpleNamespace(config=SimpleNamespace(use_cache=True))

    def load_model(_path, **kwargs):
        observed["loader"] = kwargs
        return model

    def prepare_model(value, **kwargs):
        observed["prepare"] = kwargs
        return value

    def trainer_config(**kwargs):
        observed["trainer"] = kwargs
        return kwargs

    def stop_before_training(**_kwargs):
        raise RuntimeError("contract inspected before any GPU training")

    modules = {
        "torch": SimpleNamespace(
            cuda=SimpleNamespace(
                is_available=lambda: cuda_available, is_bf16_supported=lambda: True
            ),
            bfloat16="bf16",
            float16="fp16",
            float32="fp32",
        ),
        "datasets": SimpleNamespace(
            Dataset=SimpleNamespace(from_list=lambda rows: rows)
        ),
        "peft": SimpleNamespace(
            LoraConfig=lambda **kwargs: kwargs,
            prepare_model_for_kbit_training=prepare_model,
        ),
        "safetensors.torch": SimpleNamespace(load_file=lambda _path: {}),
        "transformers": SimpleNamespace(
            AutoModelForCausalLM=SimpleNamespace(from_pretrained=load_model),
            AutoTokenizer=SimpleNamespace(
                from_pretrained=lambda *_args, **_kwargs: SimpleNamespace(
                    apply_chat_template=lambda *_args, **_kwargs: "prepared prompt"
                )
            ),
            BitsAndBytesConfig=lambda **kwargs: kwargs,
        ),
        "trl": SimpleNamespace(
            SFTConfig=trainer_config, SFTTrainer=stop_before_training
        ),
        "bitsandbytes": SimpleNamespace(),
    }
    for name, module in modules.items():
        monkeypatch.setitem(sys.modules, name, module)
    if not cuda_available:
        with pytest.raises(RuntimeError, match="requires a qualified CUDA GPU"):
            train(
                source,
                gold,
                base,
                converter,
                tmp_path / "out",
                1,
                TrainEmitter("contract"),
                quantization,
            )
        assert "loader" not in observed
        assert not (tmp_path / "out").exists()
        return
    with pytest.raises(RuntimeError, match="before any GPU training"):
        train(
            source,
            gold,
            base,
            converter,
            tmp_path / "out",
            1,
            TrainEmitter("contract"),
            quantization,
        )
    assert observed["loader"]["dtype"] == "bf16"
    assert observed["loader"]["local_files_only"] is True
    assert observed["trainer"]["bf16"] is True
    assert observed["trainer"]["fp16"] is False
    if quantization == "nf4":
        assert observed["loader"]["quantization_config"] == {
            "load_in_4bit": True,
            "bnb_4bit_quant_type": "nf4",
            "bnb_4bit_use_double_quant": True,
            "bnb_4bit_compute_dtype": "bf16",
        }
        assert observed["prepare"] == {"use_gradient_checkpointing": True}
        assert observed["trainer"]["optim"] == "paged_adamw_8bit"
        assert model.config.use_cache is False
    else:
        assert "quantization_config" not in observed["loader"]
        assert "prepare" not in observed
        assert "optim" not in observed["trainer"]
    assert not (tmp_path / "out" / "adapter.gguf").exists()
