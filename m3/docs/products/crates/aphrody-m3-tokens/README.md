# m3-tokens

Material Design 3 baseline design tokens for Rust.

Provides compile-time constants for:

- **Color roles** — all 29 M3 color roles (light + dark baseline palettes).
- **Type scale** — 15 canonical type styles (Display/Headline/Title/Body/Label, L/M/S).
- **Elevation** — 6 levels with dp values and CSS `box-shadow` strings.
- **Motion** — 7 easing curves + 16 duration tokens.
- **SpaceUI fusion** (`spaceui`) — the SpaceUI vocabulary mapped onto M3 roles and state layers, and its seven themes as M3 dynamic-scheme seeds (`docs/architecture/ui/design/SPACEUI-M3-FUSION.md`).

The crate is `no_std` by default.  Enable the `std` feature (on by default) for
`export_css`, which emits a complete `:root { --md-sys-color-* }` CSS block.

## Usage

```toml
[dependencies]
m3-tokens = { path = "crates/aphrody-m3-tokens" }
# disable std for embedded / WASM no-alloc targets:
# m3-tokens = { path = "crates/aphrody-m3-tokens", default-features = false }
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

## Token counts

| Module       | Constants |
|--------------|-----------|
| `color`      | 29 color roles x 2 themes + `BASELINE` + `BASELINE_DARK` |
| `typography` | 15 `TypeStyle` constants + `ALL` array |
| `elevation`  | `LEVELS` array (6 entries), `dp()`, `shadow()` |
| `motion`     | 6 `Easing` + 8 `Duration` constants + `PRIMARY_DURATIONS_MS` |

## License

Apache-2.0
