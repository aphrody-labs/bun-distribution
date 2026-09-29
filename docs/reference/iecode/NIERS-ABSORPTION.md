# Absorbed niers libraries

The portable, non-IEVR foundations formerly owned by `niers` live in
`crates/{emu,geom,re,sql,tasks,video}/` and are built by the root Rust workspace:

- `iecode-emu`: emulator backend and capability contracts;
- `iecode-geom`: shared geometry primitives;
- `iecode-re`: portable PE/ELF/Mach-O triage and disassembly primitives;
- `iecode-sql`: read-only SQL boundary;
- `iecode-tasks`: cancellable task orchestration;
- `iecode-video`: frame-to-video encoding contract.

The IEVR/Victory Road engine, formats, RE, site, desktop host and product
surfaces remain in `nie`. The Bun media package is `iecode`, and the Rust crates are packaged for crates.io
with `../src/aphrody-infra/scripts/iecode/publish-rust-crates.sh` (dry run: `bun run release:check`). There is one source owner for each
absorbed crate; `nie` has no second copy or workspace member for them.

Validation from the IECODE root:

```sh
cargo test --workspace --locked
```

The root CMake `iecode_shared_rust` target runs the same gate before the managed
and native integration targets.
