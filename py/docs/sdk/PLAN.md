<!-- SPDX-License-Identifier: Apache-2.0 -->
# Linux SDK qualification plan

Linux is the development and release target. The complete workspace uses
CPython 3.12; the SDK's Linux artifact matrix covers CPython 3.11–3.14.

- [x] Native source owned by the Rust workspace (`crates/ai/rag-python`); no projected copy in the package (2026-10-05).
- [x] Separate SDK, Python CLI and meeting application distributions.
- [x] Root lint, format, types and tests; clean installed distribution gates.
- [x] Linux executable discovery, permissions and explicit configuration.
- [x] Ubuntu-only CI matrix and Linux distribution metadata.
- [ ] Qualify live Linux models, CUDA, audio fixtures and Blender execution.
- [ ] Qualify authenticated cloud APIs before release of each optional feature.
- [ ] Publish correlated release artifacts and prove installation and rollback
  through the owning Infra workflow.

The checks are owned by `tools/packaging/modernize_workspace.py`.
Use `linux-sdk --python VERSION` for installed SDK artifacts outside the
workspace environment. See [validation](validation.md) and [Linux](linux.md).
NIE/IECODE runtime ownership remains with the IECODE repository.
Older audit and platform observations remain historical evidence in Git.
