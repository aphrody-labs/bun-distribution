"""Export pretrained EfficientNet models for Koharu as safetensors."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

MODEL_NAMES = tuple(f"efficientnet_b{index}" for index in range(5))


@dataclass(frozen=True, slots=True)
class EfficientNetExporter:
    """Export configured EfficientNet checkpoints to a directory."""

    model_names: tuple[str, ...] = MODEL_NAMES

    def export(self, output_dir: Path) -> tuple[Path, ...]:
        """Download selected weights and return the created safetensors files."""
        unsupported = set(self.model_names).difference(MODEL_NAMES)
        if unsupported:
            raise ValueError(f"Unsupported EfficientNet models: {sorted(unsupported)}")

        import torchvision.models
        from safetensors.torch import save_file

        output_dir.mkdir(parents=True, exist_ok=True)
        outputs = []
        for model_name in self.model_names:
            model = getattr(torchvision.models, model_name)(weights="DEFAULT")
            destination = output_dir / f"{model_name.replace('_', '-')}.safetensors"
            save_file(model.state_dict(), str(destination))
            outputs.append(destination)
        return tuple(outputs)


def export_models(output_dir: Path, model_names: tuple[str, ...] = MODEL_NAMES) -> None:
    """Compatibility wrapper for the object-oriented exporter."""
    for destination in EfficientNetExporter(model_names).export(output_dir):
        print(f"wrote {destination}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path.cwd())
    parser.add_argument(
        "--model", dest="model_names", choices=MODEL_NAMES, action="append"
    )
    args = parser.parse_args(argv)
    export_models(args.output_dir, tuple(args.model_names or MODEL_NAMES))


if __name__ == "__main__":
    main()
