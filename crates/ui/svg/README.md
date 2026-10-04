# aphrody-svg

The single SVG owner of the Aphrody ecosystem. Every repository that parses, cleans, recolours,
merges, optimizes, rasterizes or compares SVG uses this crate (Rust), `@aphrody/svg` (Bun,
`bun:ffi` over `crates/ui/bun`), instead of carrying its own implementation.
Inventory, migration map and remaining work: [`docs/SVG.md`](../../../m3/docs/reference/SVG.md).

| Module | Feature | What |
| --- | --- | --- |
| `sanitize` | always | Strip `<script>`, `foreignObject`, embeds, `on*`, `javascript:`/non-image `data:` URLs, CSS `expression`/`@import`, comments, DTDs (rejected); optional external refs and editor metadata. |
| `viewbox` | always | Parse `viewBox`, absolute lengths to px, intrinsic size, synthesize a missing `viewBox`, `Keep`/`Responsive`/`Fixed` sizing. |
| `theme` | always (`m3` for `Theme::m3`) | Bake `currentColor`, `var(--x, fallback)` and colour remaps in attributes, `style` and `<style>`. |
| `sprite` | always | `<symbol>` sheets from standalone SVGs; internal ids and `url(#…)`/`href="#…"` prefixed per symbol. |
| `glyph` | `glyph` | `skrifa` outline pen (`SvgPathPen`) and glyph → SVG path/metrics, variable axes, collections. |
| `optimize` | `raster` | usvg normalizing writer with bounded precision (Rust counterpart of svgo `preset-default`). |
| `raster` | `raster` | resvg to straight RGBA / PNG, ICO packing (PNG entries), favicon and Windows size sets. |
| `diff` | `raster` | Pixel diff of two SVGs or RGBA buffers (max/mean delta, mismatch %). |

Default features: `raster`, `glyph`. The workspace entry sets `default-features = false`, so
consumers name what they use (the `icons` module of `aphrody-bun`, formerly `aphrody-icons`,
needs `glyph`).

```rust
use aphrody_svg::{raster, sanitize, theme::Theme};

let clean = sanitize::sanitize(untrusted, Default::default())?;
let themed = aphrody_svg::theme::apply(&clean, &Theme::new().current_color("#6750a4"))?;
let ico = raster::render_ico(&themed, raster::WINDOWS_ICO_SIZES)?;
```

```ts
import { renderIco, sanitize, theme } from "@aphrody/svg";
const ico = renderIco(theme(sanitize(untrusted), { m3: true }));
```

## Gates

```sh
CARGO_TARGET_DIR=target/agent-svg cargo test -p aphrody-svg --all-features
cargo clippy -p aphrody-svg --all-targets --all-features -- -D warnings
cargo clippy -p aphrody-svg --no-default-features -- -D warnings
cargo build --release -p aphrody-bun && bun test packages/svg
```

Backends: resvg/usvg/tiny-skia 0.47/0.12 (same versions as `obscura-render`), roxmltree 0.21,
svgtypes 0.16, skrifa 0.47. All pure Rust; no system library.
