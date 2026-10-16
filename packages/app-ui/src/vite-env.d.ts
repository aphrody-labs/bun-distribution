// SPDX-License-Identifier: FSL-1.1-Apache-2.0
// Ambient module shapes for bundler-handled imports in the interface package. Both hosts bundle
// these files: Vite in drive/apps/tauri (vite/client) and Bun in drive/apps/web. Keep this a
// script file (no top-level import/export) so the declarations stay ambient. `import.meta.env`
// is read through a typed view at each call site instead of a global declaration, because the
// Vite and Bun hosts declare conflicting `ImportMeta.env` shapes.

// Side-effect stylesheet imports (e.g. `maplibre-gl/dist/maplibre-gl.css`).
declare module "*.css";
