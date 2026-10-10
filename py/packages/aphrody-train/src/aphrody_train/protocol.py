# SPDX-License-Identifier: Apache-2.0
"""JSONL protocol emitter for aphrody-train."""

import json
import sys
import time
from typing import Any


class TrainEmitter:
    """Emits streaming NDJSON events to stdout with immediate flushing."""

    def __init__(self, job_id: str):
        self.job_id = job_id
        self._start_time = time.time()

    def _emit(self, event_type: str, data: dict[str, Any]) -> None:
        event = {
            "type": event_type,
            "job_id": self.job_id,
            "ts": time.time(),
            **data,
        }
        sys.stdout.write(json.dumps(event) + "\n")
        sys.stdout.flush()

    def start(
        self,
        kind: str,
        total_steps: int,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        """Emit the job start event."""
        self._emit(
            "start",
            {
                "kind": kind,
                "total_steps": total_steps,
                "metadata": metadata or {},
            },
        )

    def progress(
        self, step: int, total_steps: int, loss: float, lr: float = 0.0
    ) -> None:
        """Emit a training progress event with elapsed time."""
        elapsed = time.time() - self._start_time
        self._emit(
            "progress",
            {
                "step": step,
                "total_steps": total_steps,
                "loss": round(loss, 6),
                "lr": lr,
                "elapsed_secs": round(elapsed, 2),
            },
        )

    def eval(
        self,
        step: int,
        metrics: dict[str, float],
        delta: dict[str, float] | None = None,
    ) -> None:
        """Emit evaluation metrics and their deltas."""
        self._emit(
            "eval",
            {
                "step": step,
                "metrics": metrics,
                "delta": delta or {},
            },
        )

    def checkpoint(self, step: int, path: str) -> None:
        """Emit a saved checkpoint location."""
        self._emit(
            "checkpoint",
            {
                "step": step,
                "path": path,
            },
        )

    def artifact(self, role: str, path: str, sha256: str, size_bytes: int) -> None:
        """Emit a produced artifact with its digest and size."""
        self._emit(
            "artifact",
            {
                "role": role,
                "path": path,
                "sha256": sha256,
                "bytes": size_bytes,
            },
        )

    def done(self, summary: str = "", stats: dict[str, Any] | None = None) -> None:
        """Emit the completion event with total duration.

        ``stats`` is an additive field (gate counts, strategies); consumers
        that do not know it ignore it.
        """
        duration = time.time() - self._start_time
        data: dict[str, Any] = {
            "duration_secs": round(duration, 2),
            "summary": summary,
        }
        if stats is not None:
            data["stats"] = stats
        self._emit("done", data)

    def error(self, message: str, code: int = 1) -> None:
        """Emit a terminal error event."""
        self._emit(
            "error",
            {
                "message": message,
                "code": code,
            },
        )
