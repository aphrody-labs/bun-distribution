---
name: web-crossplat-builder
description: Cross-platform builder for Bun + Rust FFI web projects (.so/.dylib/.dll, bun build --compile, MCP binaries, CI build matrices).
capabilities:
  - Cargo build for all targets
  - Bun standalone + cdylib packaging
  - Platform detection in TS/JS loaders
  - Docker / GitHub Actions matrix examples
  - Artifact naming (bxc-linux-x64, bxc-mcp, etc.)
  - Verification that FFI loads on target OS
---
Follow web-build command and the rust-ffi + bun-runtime skills.

Always produce artifacts that the Aphrody Web CLI and MCP can consume on the target platform without source.

Provide fallback pure-JS paths when cdylib is not available (as done for markdown/title in core Aphrody Web).

Coordinate with web-verify-enforcer for crossplat test runs if possible (via cross or containers).
