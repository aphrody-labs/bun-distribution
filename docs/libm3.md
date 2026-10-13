# Native Material integration

Material owns the native framework. `aphrody-m3-tokens` provides the existing
HCT/CAM16 engine, nine dynamic variants, 49 semantic roles, contrast validation,
typography, shape, motion, state and five adaptive breakpoints. `libm3` adapts
those types to renderer storage, application families and COSMIC widgets.
It does not generate a second palette.

```rust
use libm3::{Theme, ThemeMode, tokens_owner::scheme::Variant};
let theme = Theme::from_seed(ThemeMode::Dark, 0xff006c4c, Variant::TonalSpot, 0.0)?;
```

With `default-features = false`, callers provide all computed roles to
`ColorScheme::from_argb` or `from_named` and then `Theme::new`. Dynamic color
generation needs the `std` feature. Invalid alpha, variant or contrast is
rejected by the native owner. The implemented color specification is 2021;
this is not a claim of parity with newer specifications.

WASM ABI 2 uses `tokens_owner::role::Role::ALL` order and nine variants in
`tokens_owner::scheme::Variant::ALL` order. Zero color means an invalid scalar
request. Navigation is none=0, bar=1, collapsed rail=2, expanded rail=3,
explicit drawer=4. An invalid family returns u32::MAX. ABI 1 loaders must not
consume ABI 2 artifacts.

COSMIC theme conversion supplies semantic colors to inherited controls. Buttons
and surfaces have explicit styles; the remaining native component coverage and
cross-platform GUI qualification are tracked in PLAN.md. A compiled scalar
WASM module does not qualify a complete desktop.
