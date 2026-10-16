<!-- SPDX-License-Identifier: Apache-2.0 -->
# Python/Bun queue

- [x] Transfer the external CPython host and SDK PyO3 adapter to Bun.
- [x] Build/install both Windows wheels from pinned fork sources; preserve imports.
- [x] Retire Aphrody's native Python bridge sources and redirect consumers.
- [x] Commit/push the qualified Aphrody consumer batch and its receipt (`214c3d4fe6`).
- [ ] Qualify the private CPython 3.12.15 source fork and CUDA profiles.
- [ ] Complete the real vu/uv/Ruff source, packaging and provenance transfer gates.
- [ ] Add and qualify the shared-host CLI API and real Bun `.py` dispatch.
- [ ] Integrate parsers, Cython/Jupyter and library/environment qualification.
- [ ] Implement shared-object/buffer ownership and Python/JS/Rust roundtrips.
- [ ] Define/qualify mixed-language files after the format choice.
- [ ] Measure binary changes and qualify installation/activation on each target.
