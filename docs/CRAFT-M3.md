# Craft identity and Material 3

Craft chrome uses the canonical Aphrody identity and Material 3 owners. Editing
engines, document colors, media previews, diagnostic colors and saved appearance
settings remain with their existing applications.

## Native and WASM editors

`craft_ui::theme::aphrody::Palette::get(dark, high_contrast)` derives its scheme
from `aphrody_m3::theme::Theme::aphrody_request()`. The M3 framework reads the
measured seed from `aphrody-identity`; the adapter caches the system role colors.
`palette.color(Role)` returns an egui color without maintaining a second palette.

CADCraft, DeckCraft, DesignCraft, EffectCraft, FigCraft, FilmCraft, GridCraft,
LightCraft, PDFCraft, PhotoCraft, SoundCraft, VectorCraft and WordCraft map their
chrome tokens to that adapter. Their desktop and browser applications share
these frontend crates. Native ArtCraft uses the same adapter. CLI and server
entry points keep their existing nonvisual contracts.

The shared shape adapter exposes M3 control, menu and window corners. All
thirteen editor themes use the window and menu roles; their egui widget states
use the control role, with CADCraft, GridCraft and SoundCraft routed through
`shape::apply_control_to_visuals`. Shared icon buttons in CADCraft, PhotoCraft
and PDFCraft also use the same control shape. The shared UI components keep
app-owned labels, icons, command handling and document behavior.

PhotoCraft's primary action buttons now use the paired `Primary`/`OnPrimary`
roles instead of legacy preset values. DeckCraft uses the same contrast pair for
its primary buttons; accent roles used for links and other selected indicators
remain app-specific.

FigCraft separates selected-row icon color from its link accent and uses
`OnSecondaryContainer` over `SecondaryContainer` for selected layer and toolbar
icons.

Legacy theme identifiers remain readable. Light and dark choices select their
M3 schemes; DesignCraft's high-contrast choice uses the canonical high-contrast
request. Editor-specific geometry, fonts and document rendering remain local.

## Browser startup and ArtCraft

`scripts/craft-web-shell.ts` builds `packages/m3/src/craft-shell.css` through
`@aphrody/m3/plugin`, using `@aphrody/identity`'s generated `PET_COLORS.seed`.
It also stages the canonical identity icon. There is no static palette fallback
when the native M3 binding is unavailable.

Trunk applications run this preparation in their pre-build hook. Their generated
assets live under root `build/craft-web/<application>`. FilmCraft, EffectCraft
and LightCraft invoke the same preparation from their existing web packaging
owners, writing into the selected artifact directory. WebOS assembly and the
static frontend deployment prepare the shell once per build batch and stage it
beside every app; Trunk-only CSS, icon and copy directives become ordinary
asset links in the assembled packages. Keep the existing app build commands;
opening unbuilt source HTML is not a packaged application.

ArtCraft's Bun frontend composes the M3 plugin with its existing worker, CSS and
asset pipeline. Its existing component variables alias M3 semantic roles, and
its top bar uses `AphrodyAvatar`. Stored appearance changes synchronize M3's
root light/dark classes. The Tauri shell consumes the sibling web app output.

## Qualification

Source integration does not establish release qualification. Run native Bun
format, lint and type gates and targeted Cargo checks on the canonical VPS
checkout. Cargo and Bun lockfile updates belong to the root owner. The native
`aphrody-ffi` M3 binding must be available for CSS generation. Native and WASM
compilation, visual light/dark checks, keyboard/focus behavior and packaged
startup must pass before declaring this migration qualified. Tests require the
owner's authorization under the repository workflow.
