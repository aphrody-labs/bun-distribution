<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody M3 contract

The design contract shared by the desktop, the web packages and the native renderer. Framework:
[`M3-FRAMEWORK.md`](./M3-FRAMEWORK.md). Product rules: [`../UI-RULES.md`](../../reference/UI-RULES.md).
For Material 3 guidance itself, query m3.material.io (or Context7); this repository keeps no copy
of Google's documentation.

## Ownership chain

```text
aphrody-m3-tokens (Rust, no_std)
  ├── aphrody-m3-tokens::facade (layout, accessibility, icons, theme)
  ├── @aphrody/m3-tokens, @aphrody/m3-theme (CSS / TS)
  ├── @aphrody/material-web, @aphrody/m3-react, @aphrody/m3-primitives family
  └── aphrody-app (Tauri/Wry, static frontend)
```

`aphrody-m3-tokens` alone owns palettes, HCT, typography, elevation, shape, motion, state layers
and window size classes. `aphrody_m3_tokens::facade` copies none of these tables; `aphrody-render` consumes them
and never recreates a token system.

## Invariants

| Domain | Contract | Source |
| --- | --- | --- |
| Colour | M3 roles, dynamic palettes, HCT | `aphrody_m3_tokens::facade::color` |
| Typography | 15 roles, Google Sans Flex / Code | `aphrody_m3_tokens::facade::typography`, [`TYPOGRAPHY.md`](./TYPOGRAPHY.md) |
| Adaptive | compact 0-599, medium 600-839, expanded 840-1199, large 1200-1599, extra-large 1600+ | `aphrody_m3_tokens::facade::layout` |
| Navigation | bar -> rail -> expanded rail / drawer, by width not device | `aphrody_m3_tokens::facade::layout` |
| Accessibility | 48 dp targets, 24 dp icons, visible focus ring, AA contrast minimum | `aphrody_m3_tokens::facade::accessibility`, [`../ACCESSIBILITY.md`](../../reference/ACCESSIBILITY.md) |
| Icons | Material Symbols, variable axes | `aphrody_m3_tokens::facade::icons`, [`M3-ICONS.md`](./M3-ICONS.md) |
| Spacing | 4 dp grid; 16 dp compact margins, 24 dp from medium up | `adaptive.rs` |

## Integration rules

- Pick colours by `--md-sys-color-*` role, never by hex value in a component.
- Interactive targets stay 48 dp even when the visual is 24 dp.
- Icon-only controls carry an accessible name; glyph names are Material Symbols `snake_case`.
- The Tauri frontend is static and uses the same CSS as the web packages.
- Windows follows `prefers-color-scheme` and `prefers-contrast`; no registry theme is written.
  GTK/GNOME follows the system scheme. The OS accent colour is not bridged to the webview: the
  unused `aphrody-tauri-m3` plugin was removed (2026-10-01, no consumer; recoverable from git
  history at `crates/ui/tauri-m3` (not in repo)).
- Imported assets keep their manifest and provenance.

## Rendering

`aphrody-render` provides `RenderSurface` for 2D and 3D. `Auto` falls back to CPU and
`GpuRequired` fails explicitly when no GPU backend is available; never claim GPU rendering from
the presence of a feature flag. Details: [`M3-RENDER.md`](./M3-RENDER.md).
