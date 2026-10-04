# Desktop (Tauri 3, Aphrody forks)

`src-tauri/` depends on the `aphrody-*` crates of the yolo checkout by path. The window loads the
Bun server (`devUrl`) in development; for a bundled build point `frontendDist` at the static output
of `bun build ./src/web/index.html --outdir dist`.

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo tauri dev        # after `just -f __YOLO__/justfile install-cli`
```
