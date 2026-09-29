# aphrody-m3

Unified Rust facade for Aphrody OS Material 3. The implementation remains in
`aphrody-m3-tokens`; this crate is the one stable import surface for native
Rust, Tauri/Wry, WASM adapters and FFI.

```rust
use aphrody_m3::{export_css, layout::Breakpoint, platform::LayoutContract};

let layout = LayoutContract::from_width_dp(1280);
assert_eq!(layout.breakpoint, Breakpoint::Large);
let css = export_css();
assert!(css.contains("--md-sys-color-primary:"));
```

Exposed layers:

- `color`: baseline roles, HCT and tonal/dynamic palettes;
- `layout`: breakpoints, navigation, panes and scaffold contracts;
- `typography`: Google Sans and the complete M3 type scale;
- `motion`: easing, durations, elevation, shape and state layers;
- `theme`: Aphrody/Gemini brand and SpaceUI aliases;
- `platform`: theme mode, icon family and cross-runtime layout contract.

The facade owns no duplicate token tables. Changes belong in
`aphrody-m3-tokens` and flow to all consumers.
