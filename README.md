# Material 3

Monorepo for Material Design 3 components, tokens, themes, icons, and tools.

Packages are grouped directly under `packages/*`. Integrations remain decoupled
from the component model. `m3-bun` provides Bun commands for developing,
testing, serving, and packaging M3 applications.

## Layout

```text
packages/*  M3 packages
scripts/    workspace checks
docs/       design documentation
crates/m3-tokens/  native color and design-token owner
crates/libm3/     application layouts and COSMIC adapter
crates/libm3-wasm/ scalar WASM ABI over that owner
```

## Platform alignment

The shared contract follows the Material 3 theme model used by Android
Compose: color scheme, typography, and shapes. Web packages expose the same
semantic roles through CSS tokens and web components. See
[`docs/platform-alignment.md`](docs/platform-alignment.md).

Native color generation, typography, shapes, motion, state layers and adaptive
breakpoints belong to `aphrody-m3-tokens`. `libm3` consumes that crate; it has no
independent palette or HCT implementation. The `std` feature enables dynamic
seed colors, nine variants and contrast. The portable `no_std` facade accepts
computed colors from the host.

The Bun WASM loader is exported by `@aphrody/libm3/wasm`. ABI 2 uses the native
role order and distinguishes collapsed and expanded navigation rails. COSMIC
controls use the host event loop and must be mounted under the custom Material
theme. See [the native integration contract](docs/libm3.md).

## Development

```powershell
bun install
bun run list
bun test
```
