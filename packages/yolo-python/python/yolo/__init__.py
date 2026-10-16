"""
Package Python officiel YOLO - Accélération native en Rust (PyO3 + uv).
"""

from typing import final

import polars as pl
from pydantic import BaseModel, Field

from yolo._yolo_native import parallel_sum_squares, parallel_summary

__all__ = ["DataBatch", "analyze_batch", "parallel_sum_squares", "parallel_summary"]


@final
class DataBatch(BaseModel):
    batch_name: str = Field(..., description="Nom du lot d'échantillons")
    values: list[float] = Field(default_factory=list, description="Vecteur de valeurs f64")

    def to_polars(self) -> pl.DataFrame:
        """Exporte le lot en DataFrame Polars zéro-copie Arrow."""
        return pl.DataFrame({"values": self.values})


def analyze_batch(batch: DataBatch) -> dict[str, float]:
    if not batch.values:
        return {"sum": 0.0, "mean": 0.0, "min": 0.0, "max": 0.0, "sum_sq": 0.0, "count": 0.0}

    # Calculs Rust natifs via yolo-core (sans GIL via py.detach)
    sum_sq = parallel_sum_squares(batch.values)
    s, m, mn, mx = parallel_summary(batch.values)

    return {
        "sum": s,
        "mean": m,
        "min": mn,
        "max": mx,
        "sum_sq": sum_sq,
        "count": float(len(batch.values)),
    }
