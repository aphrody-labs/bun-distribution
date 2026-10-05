# SPDX-License-Identifier: Apache-2.0
"""Behavioral tests for the loopback OCR service without model downloads."""

from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

from relecture_ocr.server import AppConfig, OcrService, _handler_for


class FakeEngine:
    def __init__(self) -> None:
        self.calls = 0

    def __call__(self, _path: str) -> SimpleNamespace:
        self.calls += 1
        return SimpleNamespace(
            txts=["かな"],
            scores=[0.9749],
            boxes=[[[1.2, 2.8], [3.1, 4.9]]],
        )


def test_read_image_caches_by_content_and_rounds_regions() -> None:
    with TemporaryDirectory() as temporary:
        root = Path(temporary)
        image = root / "scan.png"
        duplicate = root / "duplicate.png"
        image.write_bytes(b"same scan")
        duplicate.write_bytes(b"same scan")
        engine = FakeEngine()
        service = OcrService(
            AppConfig(cache=root / "cache", scans_root=root),
            engine_factory=lambda: engine,
        )

        first = service.read_image(image)
        second = service.read_image(duplicate)

        assert first == {
            "regions": [{"texte": "かな", "score": 0.975, "boite": [[1, 2], [3, 4]]}],
            "texte": "かな",
            "secondes": first["secondes"],
            "cache": False,
        }
        assert second["cache"] is True
        assert engine.calls == 1
        assert service.cache_entries() == 1


def test_loopback_endpoint_reports_health_and_rejects_paths_outside_scans() -> None:
    with TemporaryDirectory() as temporary:
        root = Path(temporary)
        scans = root / "scans"
        scans.mkdir()
        outside = root / "private.png"
        outside.write_bytes(b"private")
        service = OcrService(
            AppConfig(cache=root / "cache", scans_root=scans), engine_factory=FakeEngine
        )
        server = ThreadingHTTPServer(("127.0.0.1", 0), _handler_for(service))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        base_url = f"http://127.0.0.1:{server.server_port}"

        try:
            with urllib.request.urlopen(f"{base_url}/sante", timeout=2) as response:
                assert json.loads(response.read()) == {
                    "ok": True,
                    "cache": 0,
                    "charge": False,
                }

            request = urllib.request.Request(
                f"{base_url}/lire",
                data=json.dumps({"image": str(outside)}).encode(),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                urllib.request.urlopen(request, timeout=2)
            except urllib.error.HTTPError as error:
                assert error.code == 403
                assert json.loads(error.read()) == {
                    "erreur": "chemin hors du dossier des scans"
                }
            else:
                raise AssertionError("service accepted a path outside the scans root")

            assert not service.loaded()
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)
