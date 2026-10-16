# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""CLI commands for DeepMind Gemma 4 family models."""

from __future__ import annotations

import json
from pathlib import Path

from aphrody.gemma4 import (
    Gemma4Benchmark,
    Gemma4Client,
    Gemma4DPOTrainer,
    Gemma4Evaluator,
    Gemma4Server,
    Gemma4SFTTrainer,
    LoRAConfig,
    list_models,
)
from aphrody.gemma4.service import describe_model, sample_summary
from aphrody_cli.utils import _emit


class Gemma4Commands:
    """DeepMind Gemma 4 CLI suite (E2B, E4B, 26B/A4B MoE, 31B).

    Commands for listing models, inspecting architectures, running benchmarks,
    evaluations, fine-tuning (LoRA, SFT, DPO), interacting across runtimes,
    and launching OpenAI-compatible API servers.
    """

    def models(self) -> None:
        """List all models in the Gemma 4 family with key specifications."""
        models_data = list_models()
        _emit(models_data)

    def inspect(self, model: str = "gemma4-e2b") -> None:
        """Inspect the detailed architecture and specifications of a Gemma 4 model.

        Args:
            model: Model identifier or alias (e.g. 'gemma4-e2b', 'gemma4-e4b',
                   'gemma4-26b-a4b', 'gemma4-31b').
        """
        _emit(describe_model(model))

    def chat(
        self,
        prompt: str,
        model: str = "gemma4-e2b",
        backend: str = "local",
        temperature: float = 0.7,
    ) -> None:
        """Execute a chat turn with a Gemma 4 model.

        Args:
            prompt: Text prompt to send to the model.
            model: Gemma 4 variant ('gemma4-e2b', 'gemma4-e4b', 'gemma4-26b-a4b', 'gemma4-31b').
            backend: Execution backend ('local', 'gemini_web', 'antigravity').
            temperature: Sampling temperature.
        """
        client = Gemma4Client(model=model, backend=backend)
        reply = client.chat(prompt, temperature=temperature)
        _emit(reply)

    def sample(
        self,
        prompt: str,
        model: str = "gemma4-e2b",
        images: int = 0,
        audio_secs: float = 0.0,
    ) -> None:
        """Run a multimodal sample generation measuring token allocations and latency.

        Args:
            prompt: Text prompt or instructions.
            model: Gemma 4 variant.
            images: Legacy image count; nonzero values require real media and are rejected.
            audio_secs: Legacy audio duration; nonzero values require real media and are rejected.
        """
        _emit(sample_summary(prompt, model, images, audio_secs))

    def bench(self, model: str = "gemma4-e2b") -> None:
        """Run comprehensive inference, throughput, TTFT, and memory benchmark.

        Args:
            model: Gemma 4 model identifier.
        """
        runner = Gemma4Benchmark(model_id=model)
        report = runner.run_full()
        _emit(report.to_dict())

    def eval(self, model: str = "gemma4-e2b", dataset: str | None = None) -> None:
        """Run task evaluation (Exact Match, BLEU, ROUGE, Perplexity) on a dataset.

        Args:
            model: Target model identifier.
            dataset: Optional path to JSONL dataset with 'prediction' and 'reference'.
        """
        evaluator = Gemma4Evaluator(model_id=model)
        rows = []
        if dataset and Path(dataset).is_file():
            with Path(dataset).open(encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        rows.append(json.loads(line))
        else:
            # Default smoke dataset
            rows = [
                {
                    "prediction": "Quantum computers use qubits",
                    "reference": "Quantum computers use qubits",
                },
                {
                    "prediction": "Gemma 4 is fast",
                    "reference": "Gemma 4 is extremely fast and efficient",
                },
            ]
        summary = evaluator.evaluate_dataset(rows)
        _emit(summary.to_dict())

    def train(
        self,
        model: str = "gemma4-e2b",
        dataset: str | None = None,
        rank: int = 8,
        epochs: int = 3,
        output: str = "adapter.json",
    ) -> None:
        """Fine-tune a Gemma 4 model with LoRA / SFT on an instruction dataset.

        Args:
            model: Target model identifier.
            dataset: Path to JSONL dataset with 'prompt' and 'response'.
            rank: LoRA rank dimension.
            epochs: Number of training epochs.
            output: Path to save the trained adapter configuration.
        """
        lora_cfg = LoRAConfig(rank=rank)
        trainer = Gemma4SFTTrainer(model_id=model, lora_config=lora_cfg)

        data = []
        if dataset and Path(dataset).is_file():
            with Path(dataset).open(encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        data.append(json.loads(line))
        else:
            data = [
                {"prompt": "Hello", "response": "Hello, how can I help you today?"},
                {"prompt": "Calculate 2+2", "response": "2 + 2 = 4"},
            ]

        res = trainer.train(data, epochs=epochs)
        trainer.lora_model.save_adapter(output)
        _emit(
            {
                "model": model,
                "epochs": res.epochs,
                "steps": res.steps,
                "initial_loss": res.initial_loss,
                "final_loss": res.final_loss,
                "trainable_params": res.trainable_params,
                "adapter_saved": output,
            }
        )

    def dpo(
        self,
        model: str = "gemma4-e2b",
        pairs: str | None = None,
        beta: float = 0.1,
    ) -> None:
        """Run Direct Preference Optimization (DPO) alignment on preference pairs.

        Args:
            model: Target model identifier.
            pairs: Path to JSONL dataset with 'prompt', 'chosen', 'rejected'.
            beta: Reference model reward margin scale.
        """
        trainer = Gemma4DPOTrainer(model_id=model, beta=beta)
        pair_data = []
        if pairs and Path(pairs).is_file():
            with Path(pairs).open(encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        pair_data.append(json.loads(line))
        else:
            pair_data = [
                {
                    "prompt": "Explain gravity",
                    "chosen": "Gravity is the fundamental interaction attracting masses.",
                    "rejected": "Things just fall down.",
                }
            ]
        res = trainer.train_pairs(pair_data)
        _emit(res)

    def serve(self, host: str = "127.0.0.1", port: int = 8080) -> None:
        """Launch the OpenAI-compatible HTTP & SSE API server for Gemma 4.

        Args:
            host: Server bind host (default: 127.0.0.1).
            port: Server bind port (default: 8080).
        """
        _emit({"serving": "gemma4", "host": host, "port": port})
        server = Gemma4Server(host=host, port=port)
        server.start(blocking=True)

    def tune_multimodal(
        self,
        dataset: str | None = None,
        model: str = "gemma4-e2b",
        rank: int = 16,
        alpha: float = 32.0,
        epochs: int = 3,
        qlora: bool = False,
        output_dir: str = "checkpoints/gemma4_lora",
    ) -> None:
        """Run multimodal fine-tuning (vision + audio + text) for Gemma 4.

        Args:
            dataset: Path to multimodal JSONL dataset.
            model: Gemma 4 variant.
            rank: LoRA decomposition rank.
            alpha: LoRA scaling factor.
            epochs: Training epochs count.
            qlora: Whether to use QLoRA 4-bit quantization mode.
            output_dir: Output directory for adapter weights and metadata.
        """
        from aphrody.gemma4 import (
            Gemma4MultimodalSFTTrainer,
            MultimodalDataset,
            MultimodalLoRAConfig,
            MultimodalMessage,
            MultimodalSample,
        )

        if dataset and Path(dataset).is_file():
            ds = MultimodalDataset.from_jsonl(dataset)
        else:
            sample = MultimodalSample(
                id="sample_mm_0",
                messages=[
                    MultimodalMessage(
                        role="user",
                        content="Describe what is in this image.",
                        images=["sample.png"],
                    ),
                    MultimodalMessage(
                        role="assistant",
                        content="A clean 2026 Gemma 4 multimodal workspace.",
                        thought="Analyzing image features with SigLIP vision tower...",
                    ),
                ],
            )
            ds = MultimodalDataset([sample])

        cfg = MultimodalLoRAConfig(
            rank=rank,
            alpha=alpha,
            use_qlora_4bit=qlora,
            tune_vision_projection=True,
            tune_audio_projection=True,
        )
        trainer = Gemma4MultimodalSFTTrainer(model_id=model, lora_config=cfg)
        res = trainer.train(ds, epochs=epochs, output_dir=output_dir)
        _emit(
            {
                "model": res.model,
                "epochs": res.epochs,
                "steps": res.steps,
                "initial_loss": res.initial_loss,
                "final_loss": res.final_loss,
                "samples_count": res.samples_count,
                "trainable_params": res.trainable_params,
                "vram_used_gb": res.vram_used_gb,
                "adapter_checkpoint": res.adapter_checkpoint_path,
            }
        )

    def export_gguf(
        self,
        model: str = "gemma4-e2b",
        output: str = "dist/gemma4-e2b-q4_k_m.gguf",
        quant: str = "Q4_K_M",
    ) -> None:
        """Export Gemma 4 weights and metadata to GGUF format for Jan/Ollama.

        Args:
            model: Model identifier.
            output: Destination file path.
            quant: Quantization type ('Q4_K_M', 'Q5_K_M', 'Q8_0', 'F16').
        """
        from aphrody.gemma4 import Gemma4Exporter

        exporter = Gemma4Exporter(model_id=model)
        meta = exporter.export_jan_gguf(output, quantization=quant)
        _emit(
            {
                "model": model,
                "quantization": quant,
                "output": output,
                "architecture": meta.get("general.architecture"),
                "context_length": meta.get("gemma4.context_length"),
            }
        )

    def jan_manifest(
        self,
        model: str = "gemma4-e2b",
        quant: str = "Q4_K_M",
    ) -> None:
        """Generate Jan model manifest (model.json) for Gemma 4.

        Args:
            model: Gemma 4 model variant.
            quant: Quantization variant.
        """
        from aphrody.gemma4 import generate_jan_manifest

        manifest = generate_jan_manifest(model, quantization=quant)
        _emit(manifest.to_dict())

    def jan_install(
        self,
        model: str = "gemma4-e2b",
        quant: str = "Q4_K_M",
        jan_home: str | None = None,
    ) -> None:
        """Install Gemma 4 model manifest into local Jan configuration.

        Args:
            model: Model identifier or 'all'.
            quant: Quantization variant.
            jan_home: Custom path to Jan configuration directory.
        """
        from aphrody.gemma4 import JanConfigManager

        mgr = JanConfigManager(jan_home=jan_home)
        if model == "all":
            paths = mgr.install_all_gemma4_manifests(quantization=quant)
            _emit({"installed_count": len(paths), "paths": [str(p) for p in paths]})
        else:
            path = mgr.install_manifest(model, quantization=quant)
            _emit({"installed_model": model, "manifest_path": str(path)})

    def jan_bridge(self, port: int = 1337) -> None:
        """Run Jan proxy bridge server.

        Args:
            port: Local port to bind Jan bridge proxy.
        """
        from aphrody.gemma4 import JanBridgeServer

        bridge = JanBridgeServer(port=port)
        _emit({"jan_bridge": "active", "port": bridge.port})
