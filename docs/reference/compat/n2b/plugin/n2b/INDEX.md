# n2b — historical documentation bundle

Point-in-time documentation imported from the original standalone n2b project (the `rsbun`
research workspace), before n2b became the `aphrody-n2b*` crates of this repository. Paths,
crate names (`n2b-cli`, `n2b-core`), hosts and commands in these files predate that move.

The code and its rules now live here: the repository layout is in the root
[`README.md`](../../../../../products/compat/README.md), and the frozen n2b CLI contract (flags, exit codes, JSON
schema, rule IDs, cdylib ABI) is in [`AGENTS.md`](../../../AGENTS.md#n2b-external-contract-frozen).
Edit these files in place only to fix facts; there is no upstream to re-sync from.

## Contents

| Path | Content |
| --- | --- |
| [`README.md`](../../../../../products/compat/n2b/plugin/n2b/README.md) | Index of the research notes, Bun notes and reports below. |
| [`CHANGELOG.md`](./CHANGELOG.md) | n2b version history up to the move into this repository. |
| [`build-your-own-x.md`](./build-your-own-x.md) | "Build your own X" reading list (Rust and TypeScript). |
| `bun/` | Bun roadmap (issue #159) and its mapping to n2b rules. |
| `research/` | Rust library, web stack, monorepo architecture, wasm-bindgen and Discord stack studies. |
| [`wasm/`](wasm/) | wasm-bindgen / wasm-pack Bun patches and n2b audit reports of binaryen, wabt, wasm-bindgen, wasm-pack. |
