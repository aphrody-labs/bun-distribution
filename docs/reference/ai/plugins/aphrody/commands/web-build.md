---
name: web-build
description: Cross-platform build of the aphrody web stack (Rust cdylibs, Bun standalone binaries, MCP server).
argument-hint: [--linux|--mac|--win|--all]
allowed-tools: ["Bash"]
---
Typical:
bun run build:linux
bun run build:mcp

For full:
- cargo build -p aphrody-web-ffi --release (and other crates)
- bun run build (the root script that orchestrates rust-bridge + msvc + standalone)
- bun run build:mcp

The command prints the artifacts and reminds about BXC_RUST_BRIDGE_LIB for dev overrides.

Use web-crossplat-builder agent for complex platform work.
