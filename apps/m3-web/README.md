# @aphrody/m3-web

Showcase app of the M3 framework: an HTML entry (`src/index.html`, `src/main.ts`, `src/styles.css`)
themed by `<m3-theme>` from `@aphrody/m3-front`, styled with `@aphrody/m3-tailwind` and the
`@aphrody/m3-tokens` sheets, configured by `m3.config.ts`. Favicon: `src/favicon.svg` (Aphrody
emblem).

It is built, served and compiled through the yolo CLI from the repository root, which runs this
package's scripts (`scripts/yolo.ts`):

| Root script       | yolo               | Package script                              |
| ----------------- | ------------------ | ------------------------------------------- |
| `bun run serve`   | `yolo web dev`     | `dev`: `m3 dev`                             |
| `bun run build`   | `yolo web build`   | `build`: `m3 build` into `dist/`            |
| `bun run compile` | `yolo tauri build` | `compile`: `m3 compile` (single executable) |

`bun run test` (`test/web.test.ts`) builds the app with the deterministic sheet generator and checks
the emitted HTML, favicon, script and stylesheet; `bun run typecheck` runs Bun's native checker.
