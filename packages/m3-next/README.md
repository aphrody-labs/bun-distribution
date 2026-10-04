# @aphrody/m3-next

Next.js 16 App Router integration for the M3 layer.

| Import                    | Runtime                            | Contents                                                                                                                                                                             |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@aphrody/m3-next`        | any (config, server, client, edge) | `withM3` config wrapper (transpiles the M3 packages, keeps `@aphrody/bun` external), metadata / viewport helpers, scheme helpers, crawler files (sitemap, robots, llms.txt, JSON-LD) |
| `@aphrody/m3-next/server` | Server Components                  | `M3Html`, `M3Root` (color-scheme, dark class from cookie or system, SSR scheme variables), `m3Css` server helper                                                                     |
| `@aphrody/m3-next/client` | `'use client'`                     | `M3NextThemeProvider`, `M3ThemeCookieSync`, `useM3ThemeToggle`                                                                                                                       |
| `@aphrody/m3-next/m3.css` | CSS                                | the M3 base stylesheet                                                                                                                                                               |

```ts
// next.config.ts
import { withM3 } from "@aphrody/m3-next";
export default withM3({});
```

`examples/` holds a minimal App Router app; `scripts/` the bundle report. Scripts: `build`
(`scripts/build.ts`), `typecheck`, `test`.
