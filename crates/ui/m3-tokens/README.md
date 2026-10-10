# m3-tokens

Material Design 3 baseline design tokens for Rust.

Provides compile-time constants for:

- **Color roles** — all 29 M3 color roles (light + dark baseline palettes).
- **Type scale** — 15 canonical type styles (Display/Headline/Title/Body/Label, L/M/S).
- **Elevation** — 6 levels with dp values and CSS `box-shadow` strings.
- **Motion** — 7 easing curves + 16 duration tokens.
- **SpaceUI fusion** (`spaceui`) — the SpaceUI vocabulary mapped onto M3 roles and state layers, and its seven themes as M3 dynamic-scheme seeds (`docs/design/SPACEUI-M3-FUSION.md`).

The crate is `no_std` by default.  Enable the `std` feature (on by default) for
`export_css`, which emits a complete `:root { --md-sys-color-* }` CSS block.

## Usage

```toml
[dependencies]
m3-tokens = { path = "crates/ui/m3-tokens" }
# disable std for embedded / WASM no-alloc targets:
# m3-tokens = { path = "crates/ui/m3-tokens", default-features = false }
```

```rust
use m3_tokens::color::{BASELINE, export_css};
use m3_tokens::typography::{DISPLAY_LARGE, ALL as TYPE_SCALE};
use m3_tokens::elevation::{LEVELS, dp, shadow};
use m3_tokens::motion::{EASING_EMPHASIZED, PRIMARY_DURATIONS_MS};

fn main() {
    // Color role (ARGB u32)
    println!("primary: #{:06X}", BASELINE.primary & 0x00FF_FFFF);

    // CSS export (requires `std` feature)
    let css = export_css(&BASELINE);
    println!("{css}");

    // Type scale
    println!("{} type styles", TYPE_SCALE.len()); // 15

    // Elevation
    println!("level 3: {}dp  shadow: {}", dp(3), shadow(3));

    // Motion
    println!(
        "emphasized easing: {}",
        EASING_EMPHASIZED.cubic_bezier
    );
    println!("primary durations: {:?}", PRIMARY_DURATIONS_MS);
}
```

## Facade (`facade`, `std` only)

`aphrody_m3_tokens::facade` is the one stable import surface for native Rust, Tauri/CEF, WASM
adapters and FFI (it replaces the former `aphrody-m3` crate). The implementation stays in the
modules above; the facade owns no duplicate token tables, so changes belong here and flow to all
consumers.

```rust
use aphrody_m3_tokens::facade::{export_css, layout::Breakpoint, platform::LayoutContract};

let layout = LayoutContract::from_width_dp(1280);
assert_eq!(layout.breakpoint, Breakpoint::Large);
let css = export_css();
assert!(css.contains("--md-sys-color-primary:"));
```

Exposed layers:

- `facade::color`: baseline roles, HCT and tonal/dynamic palettes;
- `facade::layout`: breakpoints, navigation, panes and scaffold contracts;
- `facade::typography`: Google Sans and the complete M3 type scale;
- `facade::motion`: easing, durations, elevation, shape and state layers;
- `facade::theme`: Aphrody/Gemini brand and SpaceUI aliases;
- `facade::platform`: theme mode, icon family and cross-runtime layout contract;
- `facade::accessibility`, `facade::icons`, `facade::sheets`, `facade::export_css`,
  `facade::export_brand_css`, `facade::API_VERSION`.

## Token counts

| Module       | Constants |
|--------------|-----------|
| `color`      | 29 color roles x 2 themes + `BASELINE` + `BASELINE_DARK` |
| `typography` | 15 `TypeStyle` constants + `ALL` array |
| `elevation`  | `LEVELS` array (6 entries), `dp()`, `shadow()` |
| `motion`     | 6 `Easing` + 8 `Duration` constants + `PRIMARY_DURATIONS_MS` |

## License

Apache-2.0
