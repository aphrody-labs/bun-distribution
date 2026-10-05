# @aphrody/koharu-bridge

This package owns Koharu's browser/native boundary:

- `src/protocol.ts` is generated from the Rust Tauri command surface;
- `src/canvas.ts` adapts that protocol and `koharu-canvas` to the browser;
- `src/wasm` is ignored derived output produced by `wasm-pack`.

The bridge package builds its WASM output for Bun packaging. During development, `bunx --bun nodemon` watches the Rust canvas and rasterizer crates using paths relative to this package and rebuilds the bridge on change. The generated glue is imported from this package so a consuming bundler can include the canvas in its module graph. `bun pm pack --dry-run --ignore-scripts` lists the package files without rebuilding the ignored WASM output; the normal pack runs `prepack` to build it first.

Regenerate the protocol with `cargo run -p koharu-app --bin generate`. Do not edit generated protocol or WASM output by hand.
