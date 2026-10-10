"""Download DINOv2 linear-classifier weights and save them as safetensors."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

MODEL_SIZES = ("small", "base", "large", "giant")


def normalize_key(key: str) -> str:
    """Remove prefixes added by the upstream linear classifier wrapper."""
    key = key.removeprefix("backbone.")
    if key.startswith("linear_head."):
        key = key.removeprefix("linear_head.")
    return key


@dataclass(frozen=True, slots=True)
class DinoV2Exporter:
    """Export configured DINOv2 linear-classifier checkpoints."""

    model_sizes: tuple[str, ...] = MODEL_SIZES
    repository: str = "facebookresearch/dinov2"

    def export(self, output_dir: Path) -> tuple[Path, ...]:
        """Download selected weights and return the created safetensors files."""
        unsupported = set(self.model_sizes).difference(MODEL_SIZES)
        if unsupported:
            raise ValueError(f"Unsupported DINOv2 model sizes: {sorted(unsupported)}")

        import torch
        from safetensors.torch import save_file

        output_dir.mkdir(parents=True, exist_ok=True)
        outputs = []
        for model_size in self.model_sizes:
            letter = model_size[0]
            model = torch.hub.load(
                self.repository,
                f"dinov2_vit{letter}14_lc",
                layers=1,
            )
            weights = {
                normalize_key(key): value for key, value in model.state_dict().items()
            }
            destination = output_dir / f"dinov2_vit{letter}14.safetensors"
            save_file(weights, str(destination))
            outputs.append(destination)
        return tuple(outputs)


def export_models(output_dir: Path, model_sizes: tuple[str, ...] = MODEL_SIZES) -> None:
    """Compatibility wrapper for the object-oriented exporter."""
    for destination in DinoV2Exporter(model_sizes).export(output_dir):
        print(f"wrote {destination}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path.cwd())
    parser.add_argument("--model-size", choices=MODEL_SIZES, action="append")
    args = parser.parse_args(argv)
    export_models(args.output_dir, tuple(args.model_size or MODEL_SIZES))


if __name__ == "__main__":
    main()
