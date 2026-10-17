//! The NES machine on Bun Engine's Bevy runtime in the browser (Bevy web, WebGPU).
//!
//! ```sh
//! cargo build --release -p bun-engine --example bevy_web --target wasm32-unknown-unknown \
//!     --no-default-features --features runtime-web,nes
//! wasm-bindgen --target web --no-typescript --out-name bevy_web --out-dir <dir> \
//!     <target>/wasm32-unknown-unknown/release/examples/bevy_web.wasm
//! ```
//!
//! Serve `<dir>` with a page holding `<canvas id="bun-engine">` that imports `bevy_web.js` and
//! calls its default export. The free test ROM is embedded; Z/X/Enter/Backspace/arrows play it.

use bun_engine::{
    bevy::app::App,
    runtime::{BunEnginePlugin, NesPlugin},
};

const ROM: &[u8] = include_bytes!("../../../vendor/tetanes/tetanes/assets/roms/alter_ego.nes");

fn main() {
    App::new()
        .add_plugins(BunEnginePlugin::windowed("Bun Engine - NES (WebGPU)"))
        .add_plugins(NesPlugin::new("alter_ego.nes", ROM.to_vec()))
        .run();
}
