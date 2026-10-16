# React + Material 3 (`react` feature)

The `/` route serves `src/web/index.html`. Bun bundles its TSX, CSS and the Material 3 web components in
development and inside the compiled executable (`bun run build:bin`): no Vite, no compiler plugin.

| Path                 | Role                                                                         |
| :------------------- | :--------------------------------------------------------------------------- |
| `src/web/App.tsx`    | Runtime panel (`/api/stats`), live stats (SSE), cancellable native benchmark |
| `src/web/m3.ts`      | `@lit/react` wrappers of the `@aphrody/material-web` components in use       |
| `src/web/styles.css` | Material 3 colour tokens, light and dark following the system preference     |
| `test/react.test.ts` | The HTML entry bundles with Bun alone; the server answers `/` with the page  |

Add a component: import its module from `@aphrody/material-web/<group>/<component>.js` in `m3.ts` and wrap it
with `createComponent`. Only imported components reach the bundle. The components are plain custom elements, so
a page without React registers them the same way and uses the `md-*` tags.

`tsconfig.json` is the base one plus `"jsx": "react-jsx"`. For the desktop shell, `bun build ./src/web/index.html
--outdir dist` produces the static frontend. Choose either `web` or `react`; both own `src/web/`.
