# Material workspace

Material owns the M3 framework, shared UI, native token engine and libm3 adapters.
Read GOAL.md, PLAN.md, MEMORY.md and START-HERE.md before changes. Preserve
concurrent submodule work. Follow Bun and COSMIC upstream conventions.

`crates/m3-tokens` is the sole Rust color, typography, shape, motion, state and
adaptive-token owner. `crates/libm3` consumes it for application and COSMIC
integration. `crates/libm3-wasm` is the same implementation's scalar ABI.
Distribution tooling consumes this workspace; it does not keep another copy.

Use native Windows on the owner workstation; never start WSL. Resolve checkout
paths from configuration or the selected workspace. Use native Bun check, lint,
fmt and n2b commands. Run heavy Cargo commands through the configured serialized
native owner with explicit time bounds. Do not run tests unless requested.

Retain licenses and exact source pins. Keep provider authentication, cookies,
raw sessions and other protected data in their isolated stores. Stage only
owned files; commit and push authorized batches as aphrody-dev.
