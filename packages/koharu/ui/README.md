# @aphrody/koharu-ui

Koharu's React editor, project browser, settings, controls, localization, and
browser interaction helpers are owned here. The application host supplies the
Koharu command transport and canvas WASM through `@aphrody/koharu-bridge`.

The package exports product components under `components/*`, editor state and
hooks under `lib/*`, nine locale dictionaries under `locales/*`, and its M3 theme
sheet as `styles.css`. The editor uses canonical `@aphrody/m3-primitives`
where the component contract fits. Remaining Koharu-specific controls are
internal until they can be ported without changing editor behavior.

The shell in `apps/koharu/editor` consumes this package. The host imports
its own Tailwind and M3 tokens before opting into `@aphrody/koharu-ui/styles.css`.
That stylesheet scopes its UI rules to `[data-koharu-ui]` and portal rules to
`[data-koharu-ui-layer]`. The package includes the full Noto Sans CJK variable
font for Japanese, Korean and Chinese text. The font is under SIL OFL 1.1; see
`src/assets/OFL.txt`.

`./navigation` exports the settings tabs, editor side panels, and title menu
sections used by the components. `./providers` exports the React state and
query providers. Preferences, shortcuts, project navigation and editor controls
are available from the corresponding component and `lib/*` subpaths.

The extracted editor still depends on `@aphrody/koharu-bridge` and its original
generated Koharu command contract. Its JavaScript API and opener/process
plugins now use Tauri v2, matching the Aphrody desktop dependency family.
It can be packed independently of the original
Koharu checkout, but the unpublished bridge package must be supplied to a
consumer from a local archive or a registry. Aphrody `app-ui` uses Tauri v2
and does not mount the editor. Its Settings > Koharu section instead uses
`@aphrody/koharu-sdk/settings` with the native `koharu_rpc` broker to read/save
pipeline, translation, provider credentials and typography settings. The
native broker does not implement every command used by the extracted editor.
The standalone Koharu Rust host still has its own Tauri v3 alpha dependency;
this frontend dependency alignment does not prove that host runs with the v2
JavaScript packages.
Generic Aphrody navigation and shell components remain owned by `@aphrody/app-ui`.
