# libm3

Material-owned adapter for 49 color roles, 15 typography styles, 10 shape
roles, component states and 15 application families. All token values and
five breakpoints come from the native `aphrody-m3-tokens` owner.

The no_std facade has no window-system dependency. ColorScheme::from_named
imports a complete computed scheme. The std feature enables the existing HCT
engine, nine variants and validated seed/contrast requests. No fixed palette
or independent color algorithm is maintained here.

```rust
use libm3::{ApplicationFamily, Component, Interaction, Theme};

let theme = Theme::dark().performance();
let layout = ApplicationFamily::Editor.layout(1280);
let style = Component::FilledButton.style(theme, Interaction::Hovered);
```

The cosmic feature supplies native Element composition, theme translation,
buttons, surfaces, fields, checkboxes, switches and sliders. It pins libcosmic
and selects winit with default features disabled. GPU, X11, Wayland and
accessibility are explicit host feature selections.

Applications own font loading, event loops, state, validation and persistence.
COSMIC's pinned text API handles family, size, line height and weight.
Material surfaces preserve semantic colors; native private containers use
COSMIC theme derivation. The `themed` scope covers inherited controls and
overlays. Standalone fields, checkboxes, switches and sliders receive Theme
explicitly; application composition supplies a scope at its root.

libm3-wasm exposes scalar ABI 2, with native role and variant names.
The complete Bun/JSC runtime and desktop have separate build owners.
