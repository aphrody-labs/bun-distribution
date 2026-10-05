<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shenron relecture OCR

Loopback service for a cached RapidOCR second read of databook scans. It keeps
the current French HTTP contract:

- `GET /sante` reports cache size and whether the model is loaded.
- `POST /lire` accepts `{"image":"<absolute path>"}` for scans contained under
  the configured public directory.

The service binds to `127.0.0.1`. Run it from the workspace root with
`uv run --package shenron-relecture-ocr relecture-ocr`.

Configuration is read from `RELECTURE_OCR_PORT` (default `8791`),
`RELECTURE_OCR_CACHE` (default `~/.cache/relecture-ocr`), and
`RELECTURE_OCR_RACINE` (default `~/shenron/apps/site/public`). The OCR engine
loads on its first valid request. Tests inject an in-memory engine and do not
download model weights.
