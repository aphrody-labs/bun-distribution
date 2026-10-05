<!-- SPDX-License-Identifier: Apache-2.0 -->
# SDK optional extras: isolated installation

Four optional SDK extras install independently from the committed Python clone
`29000968ef5e75baa0d64b7d34e8cd311737fa83` on Linux x86_64/CPython 3.12.
Each environment passes `uv pip check` and its existing local contract tests
without skips. The [machine evidence](python-extras-qualification.json) records
the source inputs, lock, wheel, requirement and test hashes, and the installed
distribution versions for each profile.

| Extra | Existing tests | Actual local coverage |
| --- | ---: | --- |
| `images` | 12 passed | PNG optimization through oxipng, Pillow WebP round trip, helpers |
| `icons` | 14 passed | resvg SVG-to-PNG, multi-size ICO encoding/decoding, catalogue and prompt helpers |
| `to3d` | 8 passed | Real NumPy/trimesh relief and textured GLB exports, invalid-mask handling |
| `antigravity` | 5 passed | Installed Google SDK bridge contracts with a fake Gemini transport |

Run the same checks:

```sh
uv run --no-project --python 3.12 python tools/packaging/qualify_extras.py \
  --report /tmp/aphrody-extras-qualification.json
```

Use repeatable `--extra images`, `--extra icons`, `--extra to3d` or
`--extra antigravity` arguments to narrow the profiles. The default runs all
four. The tool clones committed Git source and stages the SDK independently,
builds its real native wheel, verifies the wheel RECORD, and creates a separate
environment outside the clone for each extra. Requirements are exported from
the clone's uv lock with `--locked`, with local entries removed, and installed
using required hashes. SDK and needed upstream peer wheels are installed without
resolving additional dependencies; `uv pip check` verifies the resulting graph.
The [official uv CLI reference](https://docs.astral.sh/uv/reference/cli/#uv-export)
documents these export controls and
[uv's locking guide](https://docs.astral.sh/uv/pip/compile/) documents hashed
requirements.

All test source comes unchanged from the same immutable clone. The installed
SDK must resolve inside its environment; `python -I` runs the tests outside
the source package. Every environment reads and verifies the five bundled
Blender scripts using `importlib.resources`. A skipped contract test fails the
profile. These checks generate generic test images/geometry only, and require
no game datasets, credential access, model downloads or service calls.

The SDK wheel SHA256 is
`324e801ceb12a32b35f4fa9b5137d5d91615e1a5aebdd8c9ab56083d3dd860a2`,
matching the independently qualified
[byte-reproducible distribution](python-packaging-qualification.md).
Antigravity is built from the pinned workspace source chosen by that lock;
its wheel SHA256 is
`d94fe5d1c52bd0510cce8a62259d29c3b1274b2b8c551a21ccf83f2d095ab2ec`.
This does not qualify replacing that upstream source with a PyPI distribution.

## Remaining optional-provider gates

The depth estimator test uses the existing mocked transformer/torch pipeline;
it does not qualify the `depth` extra, model accuracy, model provenance, CPU/CUDA
runtime or GPU execution. Antigravity uses the existing fake Gemini transport;
authenticated service execution and the desktop harness remain open. Blender
resource availability is checked, but execution by Blender is not.

The `voice`, `depth`, `forensic`, `rag` and `docling` extras still need independent
clean installs and their corresponding model/runtime/provider scenarios. Actual
Windows/macOS artifacts, type/API checks across all providers, and correlated
release publication/installation/rollback remain open under the
[SDK plan](../sdk/PLAN.md) and [root plan](../../../src/PLAN.md).
