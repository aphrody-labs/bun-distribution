# Material 3 platform alignment

This document records the common contract used by the packages in this
workspace. It is an implementation guide, not a replacement for the official
Material Design documentation.

## Android baseline

The Android Material 3 theme model has three primary subsystems:

- color scheme;
- typography;
- shapes.

The Android implementation also supports dynamic color from the system on
Android 12 and later. The token package represents this with a seed color,
light and dark schemes, semantic roles, and an explicit contrast level.

The canonical role names are kept in `packages/m3-tokens/src/native-theme.ts`.
The CSS spelling is `--md-sys-color-*`; the Android-style spelling is exposed
by the same role map without changing the semantic name.

The native reference currently contains 49 color roles, 15 typography styles,
motion easings and durations, shape values, and elevation levels. The
TypeScript adapter preserves those counts and does not create a second
palette.

## Web upstream baseline

Material Web provides custom elements based on Material 3. Production code
should import only the components it uses. The aggregate `all.js` entry point
is intended for prototypes and development builds.

Web adapters must therefore preserve:

1. semantic color roles rather than hard-coded component colors;
2. the M3 type-scale groups: display, headline, title, body, and label;
3. shape roles and state behavior;
4. accessible focus, disabled, selected, pressed, and error states.

Material Web uses `--md-sys-color-*` custom properties for the color scheme,
with matching `--md-sys-color-on-*` content roles. Production bundles should
import individual component definitions such as a button or checkbox; the
aggregate component entry point is intended for prototypes and development.
State-layer opacity is part of the component token contract and must remain
distinct for focus, hover, and pressed states.

## Package mapping

| Contract | Package |
| --- | --- |
| Color roles, dynamic schemes, native export validation | `m3-tokens` |
| Theme CSS and role aliases | `m3-theme` |
| Tailwind CSS-first theme generation | `m3-tailwind` |
| Web component registration | `m3-front` |
| React primitives and component states | `m3-primitives`, `m3-react` |
| Icons and Material Symbols catalogue | `material-design-icons`, `m3-icons`, `m3-fonts` |
| Bun development, build, serve, and package commands | `m3-bun` |

The native reference also defines the JSON/CSS mirror contract: schema version,
specification version, seed, variant, contrast level, and separate light/dark
role maps. Consumers should validate that contract before applying generated
CSS.

## Source record

- Android Compose Material 3: <https://developer.android.com/develop/ui/compose/designsystems/material3>
- Material Design guidance: <https://m3.material.io/>
- Material Web introduction: <https://github.com/material-components/material-web/blob/main/docs/intro.md>
- Material Web package source: <https://github.com/material-components/material-web>

The site requires JavaScript for some pages; package and Android documentation
are used for the machine-readable implementation contract.

The native design engine is maintained in `crates/m3-tokens`. `libm3` and its
WASM binding consume it directly. Web adapters preserve its named JSON role
contract; numeric WASM role indices use the native owner's order.

Context7 verification of the upstream documentation was performed against
`/material-components/material-web` and
`/websites/composables_jetpack-compose_androidx_compose_material3_material3`.
