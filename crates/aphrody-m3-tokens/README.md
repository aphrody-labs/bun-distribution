# Material native tokens

`aphrody-m3-tokens` owns Material color generation and design tokens. Web,
COSMIC, native and WASM adapters consume this implementation.

The default `std` feature provides the HCT/CAM16 engine, nine scheme variants,
49 semantic system roles, validated `ThemeRequest` / `ThemeExport`, CSS
exports and component token tables. Dynamic color implements Google's 2021
specification; it does not claim a newer color specification.

With `default-features = false`, fixed color, typography, shape, motion,
state, font descriptor and adaptive layout APIs remain available without
allocation. Dynamic color and allocating exports require `std`.

## Usage

```toml
[dependencies]
aphrody-m3-tokens = { path = "crates/m3-tokens" }
```

```rust
use aphrody_m3_tokens::{
    adaptive::Breakpoint,
    scheme::{Role, Variant},
    theme::ThemeRequest,
};

let theme = ThemeRequest::new(0xff6750a4, Variant::TonalSpot, 0.0)?;
let primary = theme.scheme(false).argb(Role::Primary);
let breakpoint = Breakpoint::from_width_dp(1280);
```

`role::Role` is also available without `std`. `scheme::Role` preserves the
existing import path and role order. Typography, shapes, elevation, interaction
states and breakpoints have one table each; `libm3` supplies renderer adapters.

The embedded Google Sans APIs retain their original bytes and OFL licenses.
The native font sources differ from the Material web font package's pins.
Google Sans Code here includes MONO/wght axes; the web source is wght-only.
They are distinct contracts and must not be substituted by filename.

See [TRANSFER.md](TRANSFER.md) and [transfer-receipt.json](transfer-receipt.json)
for source provenance. Existing tests and fixtures are transferred unchanged;
build and execution evidence is recorded by the workspace integrator.

## License

Rust framework: Apache-2.0. Fonts: SIL OFL-1.1. Google fixture licenses remain
beside their corresponding source files.
