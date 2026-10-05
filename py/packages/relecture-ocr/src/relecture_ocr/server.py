# SPDX-License-Identifier: Apache-2.0
"""Loopback HTTP service for cached, Japanese OCR second reads."""

from __future__ import annotations

import hashlib
import json
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from typing import Any


@dataclass(frozen=True)
class AppConfig:
    """Runtime paths and bind address for the local OCR service."""

    port: int = 8791
    cache: Path = Path.home() / ".cache" / "relecture-ocr"
    scans_root: Path = Path.home() / "shenron" / "apps" / "site" / "public"

    @classmethod
    def from_environment(cls) -> AppConfig:
        """Read supported configuration overrides from the process environment."""
        return cls(
            port=int(os.environ.get("RELECTURE_OCR_PORT", "8791")),
            cache=Path(
                os.environ.get(
                    "RELECTURE_OCR_CACHE", Path.home() / ".cache" / "relecture-ocr"
                )
            ),
            scans_root=Path(
                os.environ.get(
                    "RELECTURE_OCR_RACINE",
                    Path.home() / "shenron" / "apps" / "site" / "public",
                )
            ),
        )


class OcrService:
    """Load RapidOCR once, serialize inference, and cache results by image hash."""

    def __init__(
        self,
        config: AppConfig,
        engine_factory: Callable[[], Any] | None = None,
    ) -> None:
        self.config = config
        self.config.cache.mkdir(parents=True, exist_ok=True)
        self._engine_factory = engine_factory or self._create_engine
        self._engine: Any | None = None
        self._engine_lock = Lock()
        self._inference_lock = Lock()

    @staticmethod
    def _create_engine() -> Any:
        from rapidocr import RapidOCR

        return RapidOCR()

    def _get_engine(self) -> Any:
        if self._engine is None:
            with self._engine_lock:
                if self._engine is None:
                    self._engine = self._engine_factory()
        return self._engine

    @staticmethod
    def _fingerprint(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as image:
            for block in iter(lambda: image.read(1 << 20), b""):
                digest.update(block)
        return digest.hexdigest()

    def read_image(self, path: Path) -> dict[str, Any]:
        """Run OCR once per file content and serve later requests from disk cache."""
        cache_file = self.config.cache / f"{self._fingerprint(path)}.json"
        if cache_file.exists():
            try:
                cached = json.loads(cache_file.read_text(encoding="utf-8"))
                cached["cache"] = True
                return cached
            except (ValueError, OSError):
                pass

        engine = self._get_engine()
        started = time.perf_counter()
        with self._inference_lock:
            result = engine(str(path))
        elapsed = round(time.perf_counter() - started, 2)

        regions: list[dict[str, Any]] = []
        if result is not None and result.txts:
            boxes = (
                result.boxes if result.boxes is not None else [None] * len(result.txts)
            )
            for text, score, box in zip(result.txts, result.scores, boxes, strict=True):
                regions.append(
                    {
                        "texte": text,
                        "score": round(float(score), 3),
                        "boite": [[int(x), int(y)] for x, y in box]
                        if box is not None
                        else None,
                    }
                )

        response = {
            "regions": regions,
            "texte": "\n".join(region["texte"] for region in regions),
            "secondes": elapsed,
            "cache": False,
        }
        try:
            cache_file.write_text(
                json.dumps(response, ensure_ascii=False), encoding="utf-8"
            )
        except OSError:
            pass
        return response

    def cache_entries(self) -> int:
        return sum(1 for _ in self.config.cache.glob("*.json"))

    def loaded(self) -> bool:
        return self._engine is not None


def _handler_for(service: OcrService) -> type[BaseHTTPRequestHandler]:
    class OcrRequestHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def _respond(self, status: int, payload: dict[str, Any]) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path.split("?")[0] != "/sante":
                self._respond(404, {"erreur": "route inconnue"})
                return
            self._respond(
                200,
                {
                    "ok": True,
                    "cache": service.cache_entries(),
                    "charge": service.loaded(),
                },
            )

        def do_POST(self) -> None:
            if self.path.split("?")[0] != "/lire":
                self._respond(404, {"erreur": "route inconnue"})
                return
            try:
                length = int(self.headers.get("Content-Length") or 0)
                request = json.loads(self.rfile.read(length) or b"{}")
            except (ValueError, OSError):
                self._respond(400, {"erreur": "corps illisible"})
                return

            raw_path = request.get("image")
            if not isinstance(raw_path, str) or not raw_path:
                self._respond(400, {"erreur": "champ image manquant"})
                return
            try:
                image = Path(raw_path).resolve()
            except OSError:
                self._respond(400, {"erreur": "chemin invalide"})
                return

            scans_root = service.config.scans_root.resolve()
            if not image.is_relative_to(scans_root):
                self._respond(403, {"erreur": "chemin hors du dossier des scans"})
                return
            if not image.is_file():
                self._respond(404, {"erreur": "scan introuvable"})
                return

            try:
                self._respond(200, service.read_image(image))
            except Exception as exc:  # noqa: BLE001 - convert inference failures to HTTP errors
                self._respond(500, {"erreur": f"{type(exc).__name__}: {exc}"})

        def log_message(self, format: str, *args: Any) -> None:
            """Silence request logs; systemd receives service lifecycle messages."""

    return OcrRequestHandler


def main() -> None:
    """Start the service on loopback; scans and cache never leave the host."""
    config = AppConfig.from_environment()
    service = OcrService(config)
    print(
        f"relecture-ocr sur 127.0.0.1:{config.port}, scans sous {config.scans_root}, cache {config.cache}",
        flush=True,
    )
    server = ThreadingHTTPServer(("127.0.0.1", config.port), _handler_for(service))
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
