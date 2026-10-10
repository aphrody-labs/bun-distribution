<!-- SPDX-License-Identifier: Apache-2.0 -->
# Current Python workspace contracts

The workspace has seven installable distributions. `packages/aphrody` owns the
library and the Python side of the native ABI (the Rust crate is `crates/ai/rag-python`), `packages/cli` owns the optional Python CLI,
`apps/meetings` owns the meeting application, and the other four packages own
training, embedding fixtures, Koharu model export and the OCR service.

Every distribution uses `src/`, carries its license and `py.typed`, and is
built and installed outside the source tree by
`python tools/packaging/modernize_workspace.py check`. The SDK wheel is built from the monorepo
crate `crates/ai/rag-python` and its CycloneDX SBOM is verified.
CLI tests live with the CLI; the two Infra pruning tests are part of root CI.

The root owns Ruff, formatting, pytest and mypy configuration. Historical
migration reports under `docs/migration/` retain their original source paths.
Drive adapters remain protected upstream runtime inputs, outside first-party
style and type gates. UI asset tooling remains with its existing owner.

Python 3.12 is the complete workspace baseline because training and OCR are
qualified for `>=3.12,<3.13`. The independently distributed SDK and Python CLI
support Python 3.11+. The SDK matrix checks 3.11–3.14 on Ubuntu Linux;
the existence of a configured job is not evidence of a completed runtime test.
Changing the two runtime ceilings requires their provider/model qualification,
not merely changing metadata. These constraints do not restrict SDK consumers.

Antigravity extras use the same exact HTTPS Git revision inside and outside
the workspace. Private repository access uses Git's existing credential helper;
no workstation-specific SSH alias, token literal or neighboring checkout is used.
Authenticated provider qualification is explicit and separate from core tests.

Heavy models, CUDA training, Blender execution and live cloud APIs require
their actual Linux runtimes. Unit tests and installed
wheel tests do not establish those integration contracts.
