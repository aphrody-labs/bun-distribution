# Bun native dependency ownership

The root catalog pins common frontend versions observed from the official npm registry on 2026-10-14. Root overrides and imported manifests use this same catalog. The source owner retains its Git history and licenses.

ArtCraft's 62 frontend manifests now share product version 1.4.4. Its commands use `bun check`, `bun lint`, `bun fmt` and the existing native Bun compiler. Direct TypeScript, SWC, ESLint, Prettier, Vite and Vitest tooling was removed with its obsolete tracked configuration. Protected stores and fixtures were preserved.

The Tailwind 4 pipeline uses `@tailwindcss/postcss`; Panels 4 consumers use its current group, separator and layout APIs. React-Konva 19.3 matches React/DOM 19.3 and Konva 10. Native types and compilation are separate from browser execution and deployment.

| Dependency | Version |
| --- | --- |
| [@preact/signals-react](https://registry.npmjs.org/%40preact%2Fsignals-react/latest) | 3.12.0 |
| [@radix-ui/react-tooltip](https://registry.npmjs.org/%40radix-ui%2Freact-tooltip/latest) | 1.4.1 |
| [@remix-run/node](https://registry.npmjs.org/%40remix-run%2Fnode/latest) | 2.17.5 |
| [@tailwindcss/postcss](https://registry.npmjs.org/%40tailwindcss%2Fpostcss/latest) | 4.3.3 |
| [@tauri-apps/plugin-dialog](https://registry.npmjs.org/%40tauri-apps%2Fplugin-dialog/latest) | 2.8.2 |
| [@tauri-apps/plugin-http](https://registry.npmjs.org/%40tauri-apps%2Fplugin-http/latest) | 2.8.2 |
| [@types/lodash](https://registry.npmjs.org/%40types%2Flodash/latest) | 4.17.26 |
| [@types/react](https://registry.npmjs.org/%40types%2Freact/latest) | 19.3.0 |
| [@types/react-dom](https://registry.npmjs.org/%40types%2Freact-dom/latest) | 19.3.0 |
| [autoprefixer](https://registry.npmjs.org/autoprefixer/latest) | 10.6.1 |
| [dayjs](https://registry.npmjs.org/dayjs/latest) | 1.11.23 |
| [detect-gpu](https://registry.npmjs.org/detect-gpu/latest) | 5.0.70 |
| [konva](https://registry.npmjs.org/konva/latest) | 10.8.0 |
| [postcss](https://registry.npmjs.org/postcss/latest) | 8.5.30 |
| [postcss-import](https://registry.npmjs.org/postcss-import/latest) | 17.0.1 |
| [postcss-nesting](https://registry.npmjs.org/postcss-nesting/latest) | 14.0.3 |
| [posthog-js](https://registry.npmjs.org/posthog-js/latest) | 1.438.9 |
| [react](https://registry.npmjs.org/react/latest) | 19.3.0 |
| [react-copy-to-clipboard](https://registry.npmjs.org/react-copy-to-clipboard/latest) | 5.1.1 |
| [react-dom](https://registry.npmjs.org/react-dom/latest) | 19.3.0 |
| [react-drag-drop-files](https://registry.npmjs.org/react-drag-drop-files/latest) | 3.1.0 |
| [react-helmet](https://registry.npmjs.org/react-helmet/latest) | 6.1.0 |
| [react-hot-toast](https://registry.npmjs.org/react-hot-toast/latest) | 2.6.1 |
| [react-resizable-panels](https://registry.npmjs.org/react-resizable-panels/latest) | 4.14.5 |
| [react-router-dom](https://registry.npmjs.org/react-router-dom/latest) | 7.18.4 |
| [tailwind-merge](https://registry.npmjs.org/tailwind-merge/latest) | 3.7.0 |
| [tailwindcss](https://registry.npmjs.org/tailwindcss/latest) | 4.3.3 |
| [terser](https://registry.npmjs.org/terser/latest) | 5.51.2 |
| [react-konva](https://registry.npmjs.org/react-konva/latest) | 19.3.0 |

Root quality commands pass separately from frontend qualification. Legacy test globals have not been migrated or executed. Lifecycle hooks remain disabled. Some transitive dependencies may retain their own implementation tooling; it is not invoked by product quality commands.
