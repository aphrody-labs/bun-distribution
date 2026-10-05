# YOLO Python Package (`yolo`)

Package Python officiel du runtime polyglotte YOLO — Accélération native en Rust via PyO3 et gestion par Astral `uv`.

## Installation

```bash
uv pip install -e packages/python
```

## Utilisation

```python
from yolo import DataBatch, analyze_batch, parallel_sum_squares, parallel_summary

# 1. Traitement par lot avec validation Pydantic et export Polars
batch = DataBatch(batch_name="lot-01", values=[1.0, 2.0, 3.0, 4.0])
df = batch.to_polars()
stats = analyze_batch(batch)

# 2. Calcul vectorisé direct en Rust Rayon SIMD sans GIL
sum_sq = parallel_sum_squares([1.0, 2.0, 3.0, 4.0])
sum_val, mean, min_val, max_val = parallel_summary([1.0, 2.0, 3.0, 4.0])
```
