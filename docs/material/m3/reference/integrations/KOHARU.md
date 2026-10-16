<!-- SPDX-License-Identifier: Apache-2.0 -->
# Koharu integration map for Aphrody

Status: source comparison snapshot dated 2026-09-27; standalone UI extraction and
native settings integration updated 2026-09-28. Aphrody's Settings > Koharu
section reads and saves through the same `koharu-sdk` JSONL methods as the
Bun SDK and CLI. The full editor is not mounted and product parity is not proven.

## Ownership and boundary

Koharu originated as a separate Tauri application. Its web client imports `@koharu/bridge/protocol` and
calls generated Tauri commands directly; its Rust side owns project documents, processing jobs,
inference, persistence and export. `aphrody-ui` owns a different Tauri desktop and its generic
Chat/Files/Web/Models surfaces. The aphrody-ui desktop contract explicitly keeps AI out of its
process and talks to `aphrody app-server`; Koharu's `run_agent` is a Koharu command and must not be
treated as an Aphrody API. The 2026-09-27 comparison found no Koharu package, command binding,
scene schema, or page editor dependency in `aphrody-ui`; the current working-tree extraction is
described below.

### Working-tree update (2026-09-28)

The aphrody monorepo provides the canonical headless Rust
[`koharu-library`](https://github.com/aphrody-labs/aphrody/blob/main/crates/koharu/koharu-library/README.md)
for page import, the four model stages, typed results, and PNG/PSD export.
`aphrody-ai` consumes this library through an optional `aphrody-manga` feature;
`aphrody-ui` now contains the `@aphrody/koharu-ui` source package at
`packages/koharu/ui`. Its export map exposes `./components/*`, `./lib/*`,
`./locales/*`, and `./styles.css`. Exported component owners cover app chrome,
startup, editor/canvas/overlays, page rail and inspector, toolbar/selection,
agent/activity/resource panels, controls, and pipeline/provider/translation/
typesetting preferences. The complete package editor is not yet mounted by
`@aphrody/app-ui`; the current host still has no integrated Koharu scene/data
adapter or job feed. Mounting the complete `KoharuApp` would introduce a second titlebar/
shell, contrary to `docs/reference/ui/UI-RULES.md`; integration must compose editor-owned
views inside the existing shell and use a supported project/scene contract.

The extracted package also includes `SettingsPage` with its pipeline, provider,
translation, typesetting, generation and keyboard-shortcut tabs; `StartView`,
`Editor`, `PageRail`, editor side panels and canvas navigation are exported
component files. `lib/store.ts` carries shortcut settings and `lib/backend.ts`
defines the Koharu command boundary. The extracted editor's own tabs remain
source surfaces, while Aphrody's single settings shell now mounts
`Settings > Koharu` with pipeline, translation, provider and typography
sections. Those sections use the `koharu_rpc` Tauri v2 broker, which relays
`preferences.get`, `preferences.setPipeline`, `preferences.setProviders`,
`preferences.setCredential`, `preferences.setTypesetting`,
`models.translation` and `models.pipeline` to `koharu-sdk`. Save operations
refresh from the Rust owner and show errors. Credentials are entered only for
write operations and are not displayed on read. The editor shortcut tab
remains separate from Aphrody's keyboard settings. The tab primitives remain
internal and are not package exports.

The package stylesheet now maps Koharu semantic colors, surfaces, shapes and
elevation to Aphrody M3 roles and scopes its overrides to `[data-koharu-ui]`.
It sets an 18 px text floor, 48 px interactive minimum height, static focus
outline, high-contrast/forced-colors support, and reduced-motion behavior.
This is a source-level conversion only: no browser/computed-style or visual
accessibility check was run. Ten incompatible internal primitive groups remain
private under `src/internal`; `Badge`, `Input`, and `Switch` use
`@aphrody/m3-primitives`. The API differences and remaining controls mean this
is not a full M3 component-port or visual-parity claim.

Portaled dialogs, alert dialogs, sheets, drawers, popovers, selects, tooltips,
toasts, comboboxes, context/dropdown/menubar items, hover cards and navigation
menus use a `data-koharu-ui-layer` marker so scoped typography, M3 aliases and
focus rules also apply after they leave the editor subtree. The stylesheet does not
import Tailwind, animation utilities, or the M3 theme entrypoint; the host
must load its existing Tailwind v4 and M3 theme first, then import
`@aphrody/koharu-ui/styles.css`. This avoids a second preflight/reset. The
standalone example has its own build entrypoint and is not the host integration.

The independent Koharu checkout has no configured Git remote, so the local
`file:` dependency on `@koharu/bridge` and source references are not yet a
portable package-release contract. The focused package TypeScript check passed
before the latest CSS-only conversion; this audit did not rerun it or exercise
the host route. The feature map below remains the 2026-09-27 capability
comparison, not proof that the listed product surfaces are integrated.

The intended reusable layer is the existing Aphrody shell and generic services. Manga/page
semantics, Koharu's scene model and Koharu-specific inference remain owned by Koharu unless a
deliberate API ownership change is made. Do not equate similarly named generic features with
Koharu capability.

## Feature map

| Koharu capability | Koharu evidence | Existing aphrody-ui surface | Coverage |
| --- | --- | --- | --- |
| Project lifecycle and page collection | `commands.listProjects`, `createProject`, `openProject`, `deleteProject`, `closeProject`, `getPages`, `import`; UI `StartView`, `PageRail` | `packages/app-ui` (not in repo) explorer browses filesystem locations and collections; Drive is storage-oriented | **Absent**: no Koharu project/page contract, import pipeline, or lifecycle UI. Explorer folders are not manga projects. |
| Structured page/scene document | `koharu-scene` and `koharu-storage`; protocol `Page`, `Layer`, `AnalysisRegion`; layer editing commands | Aphrody has generic file metadata, preview, and inspector surfaces | **Absent**: no Koharu scene schema, layer hierarchy, per-page revisions, or editing commands. |
| Manga detection, OCR, translation, inpainting pipeline | `commands.process(scope, operation)`; stages `detection`, `ocr`, `translation`, `inpainting`; `koharu-pipeline`, `koharu-ml`, `koharu-translator` | Generic Aphrody OCR action (`runOcr` / `aphrody/ocr/run`) and background job UI; agent chat can invoke tools | **Partial only at generic OCR/job level**. No manga detector, translation-stage orchestration, region association, or Koharu model lifecycle is present in app-ui. |
| Provider and generation preferences | `koharu-sdk` preferences methods, model/provider preference panels; `koharu-translator` supports local and remote backends | Settings > Koharu reads and saves pipeline, translation, provider and typography configuration through `koharu_rpc` | **Native settings path implemented**. The complete editor settings component still uses the original Tauri command contract. |
| Canvas rendering and navigation | `@koharu/bridge/canvas`: WASM `createCanvas`, WebGPU surface, staged manifests/resources, page prefetch; `CanvasWorkspace` | `aphrody-render` and `aphrody-tauri-3d` are native scene renderers; `@aphrody/canvas` is the native/CPU Skia image/PDF path | **Partial primitives, no drop-in editor**. Renderers have different scene and editing contracts; Aphrody has no Koharu page manifest/resource protocol or equivalent 2D editing command surface. |
| Selection, transforms, paint/erase/inpaint tools | Koharu `CanvasWorkspace`, `ToolBar`, `SelectionControls`; commands `commitTransform`, `commitInpaint`, `setGeometry`, `setVisibility`; raster strokes are applied by Koharu project commands | Aphrody explorer supports selecting files and batch file actions; canvas/render packages provide rendering primitives | **Absent**: file selection and visual rendering are not page-layer manipulation, brush editing, or transactional scene changes. |
| Text and typography review | `Inspector`, `setSourceText`, `setTranslation`, `setTypography`; `FontPicker`; editable text layers | Aphrody has text/file preview and chat composer | **Absent**: no source/translation pair, bubble-aware text layer, typography editor, or translation review workflow. |
| Undo/redo and revision-aware editing | Koharu commands `undo`, `redo`, revision-scoped canvas and edit commands | Aphrody chat supports thread operations; general app state and file actions are separate | **Absent**: no Koharu document history or revision-safe edit transaction API in app-ui. |
| Export | Koharu `export(format)` and `koharu-psd` (PSD writing) | Aphrody Drive and file actions can store/open files; native canvas supports image/PDF work | **Partial at file handling only**. No Koharu export formats, layered PSD semantics, or project export workflow. |
| Agent panel that edits a project | Koharu `getAgentStatus`, `loginAgent`, `runAgent`, `cancelAgent`; streamed `Event` values update the UI and refresh project/page queries after changed tool calls | `codex-chat.tsx` streams the Aphrody app-server protocol and shows agent activities; separate explorer actions can send files to the chat | **Partial as an agent UI pattern, not connected**. Aphrody agent context and tool schema are not Koharu's project/scene context. No shared run, login, or edit API. |
| Jobs and resource monitoring | `subscribe` streams `Job`, `Download`, `ModelResources`, `CanvasState`, and project state into `useKoharuStore`; `ActivityCenter`, `ResourceMonitor` | Aphrody `TasksView`, `aphrodyJobStore`, `JobManagerPopover` show Aphrody jobs and downloads | **Partial UI pattern only**. Separate stores, job IDs, event channels and lifecycle. |
| Settings, shortcuts and localization | Koharu preference pages, `defaultShortcuts`, `lib/i18n.ts` | Aphrody settings shell mounts Settings > Koharu with four sections | **Partial**. Native Koharu preferences persist; editor-specific shortcuts and locales are not merged into Aphrody's shared shell. |

## Interfaces and extracted source

The extracted UI package lives in this repository under
`packages/koharu/ui/src`. Its `lib/backend.ts` and `lib/queries.ts` are the
client boundary consumed by the copied editor components. The generated
Tauri bridge is owned by this monorepo at
`packages/koharu/bridge/src/protocol.ts` and `canvas.ts`; its
protocol is generated from Rust and should not be hand-edited. The example
consumer at `apps/koharu/editor` demonstrates the package in a separate
standalone host, not in Aphrody's app shell.

The bridge, SDK peer dependency, extracted UI package and example now resolve
`@aphrody/api`, `@aphrody/plugin-opener` and
`@aphrody/plugin-process` from the Tauri v2 family. The old generated
Koharu command names remain unchanged and are not implemented by Aphrody's
`koharu_rpc` JSONL broker. The original standalone Koharu Rust desktop host
still targets Tauri v3 alpha; its runtime compatibility with these v2
JavaScript packages is not established by the package typechecks or Next build.

Relevant Koharu Rust owners include `koharu-app` for desktop commands and lifecycle,
`koharu-scene` for document/scene structure and edits, `koharu-storage` for persistence,
`koharu-pipeline` for processing, `koharu-ml` for model execution, `koharu-translator` for
translation providers, `koharu-runtime` for runtime/model assets, and `koharu-psd` for PSD output.
This is a capability routing map, not a claim that every crate is directly exposed to the UI.

## Aphrody reuse points and limits

- **Application shell and design system:** `packages/app-ui` (not in repo), `@aphrody/m3-*`, and
  `aphrody-app` host the Koharu settings section. The `koharu_rpc` broker exposes
  the library JSONL method surface; a project editor route and scene adapter remain absent.
- **Agent:** `packages/app-ui/src/codex-chat.tsx` (not in repo) uses the Aphrody app-server path. Koharu's
  AgentPanel currently uses Koharu Tauri commands. Unifying them requires an explicit tool/API
  contract for project and scene operations, including authorization and cancellation.
- **OCR and tasks:** `packages/app-ui/src/tauri-bridge.ts` (not in repo) contains generic OCR RPC and task
  adapters; the Aphrody job store is not a Koharu job feed. Koharu's four-stage pipeline has
  semantics beyond file OCR.
- **Rendering:** `aphrody-render`/`aphrody-render3d` own Aphrody render contracts. The
  `@aphrody/canvas` package wraps upstream Skia for native image/PDF operations. Neither is the
  Koharu WASM/WebGPU canvas module; reuse requires a deliberate renderer/scene bridge.
- **Files and export:** Explorer and Drive can provide generic file discovery/storage, but do
  not provide project import, scene persistence, translation review, layered PSD export, or
  Koharu revision semantics.

## Suggested integration seam

Keep Koharu as the owner of `koharu-scene` documents and pipeline operations. If the product
decision is to surface it in Aphrody, first define a supported out-of-process contract for
project discovery/open, typed page/scene queries and edits, job events/cancel, preferences, and
export. Then add a Koharu-specific adapter/route in the Aphrody desktop shell. Avoid coupling
`aphrody-ui` directly to Koharu internals or treating filesystem explorer, OCR, generic model
management, or the Aphrody agent as substitutes for that contract.

## Source pointers

Extracted UI in this checkout:

- `packages/koharu/ui/src/components/app/KoharuApp.tsx`, `TitleBar.tsx`, `StartupView.tsx`
- `packages/koharu/ui/src/components/editor/Editor.tsx`, `CanvasWorkspace.tsx`, `AgentPanel.tsx`,
  `ToolBar.tsx`, `Inspector.tsx`, `PageRail.tsx`, `ActivityCenter.tsx`, `ResourceMonitor.tsx`
- `packages/koharu/ui/src/lib/backend.ts`, `queries.ts`, `store.ts`, `document.ts`
- `apps/koharu/editor` (standalone example consumer)

Koharu Rust/bridge source (this monorepo):

- `packages/koharu/bridge/src/protocol.ts`, `canvas.ts`
- `crates/koharu/koharu-app/src/commands/`, `crates/koharu/koharu-scene/`, `crates/koharu/koharu-storage/`,
  `crates/koharu/koharu-pipeline/`, `crates/koharu/koharu-ml/`, `crates/koharu/koharu-translator/`,
  `crates/koharu/koharu-runtime/`, `crates/koharu/koharu-psd/`

aphrody-ui checkout:

- `packages/app-ui/src/tauri-bridge.ts` (not in repo), `codex-chat.tsx`, `routes/explorer/`, `routes/tasks/`,
  `models-hub.tsx`, `stores/aphrodyJobStore.ts`
- `crates/ui/app/`, `crates/ui/render/`, `crates/aphrody-render3d/` (not in repo),
  `packages/canvas/`
