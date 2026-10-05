// SPDX-License-Identifier: Apache-2.0
// The one Bun plugin of an M3 app. It is `@aphrody/m3`'s plugin (Tailwind v4, Sass, `m3:*` token sheets, `?url`
// imports) plus what makes it work in a standalone checkout:
//   - the `m3:theme.css` / `m3:tokens.css` / `m3:scheme.css` sheets from `@aphrody/m3-tokens` when the Rust library
//     of `@aphrody/bun` is not there (`css` overrides),
//   - `m3:fonts.css`, `m3:fonts-jp.css`, `m3:fonts-symbols.css` from `@aphrody/m3-fonts` when no Aphrody OS checkout
//     holds the fonts,
//   - `m3:icons/[style/]name[?fill=1&wght=300]`: Material Symbols SVG markup from the forked catalogue,
//   - `m3:optional/<specifier>`: a module that may not be installed. `import brand, { resolved } from
//     "m3:optional/@rosegriffon/ui/tokens"` is the module namespace and `resolved: true` when the specifier resolves
//     from the app, `null` and `resolved: false` when it does not (host-bound packages outside the workspace).
//
//   bunfig.toml        [serve.static]  plugins = ["@aphrody/m3-bun/plugin"]
//   Bun.build / compile                plugins: [m3Bun({ theme: { seed: "#6750a4" } })]
import { m3Plugin, type M3PluginOptions } from "@aphrody/m3/plugin";
import type { BunPlugin } from "bun";
import { dirname } from "node:path";
import { iconsRoot, parseIconSpecifier, readIcon } from "./icons.ts";
import { tsM3Css } from "./theme-css.ts";

const FONT_SHEETS: Record<string, string> = {
  "m3:fonts.css": "@aphrody/m3-fonts/fonts.css",
  "m3:fonts-jp.css": "@aphrody/m3-fonts/fonts-jp.css",
  "m3:fonts-symbols.css": "@aphrody/m3-fonts/fonts-symbols.css",
};

const ICON_NAMESPACE = "m3-icons";
const OPTIONAL_NAMESPACE = "m3-optional";

export interface M3BunPluginOptions extends M3PluginOptions {
  /** Directory of the Material Symbols SVG catalogue (default: discovered, `M3_ICONS_ROOT`). */
  iconsRoot?: string;
}

/** What `m3Bun` adds to `m3Plugin`: icons and the standalone font sheets. Exported for `Bun.build` callers that compose themselves. */
export function m3BunExtras(options: Pick<M3BunPluginOptions, "iconsRoot" | "configDir"> = {}): BunPlugin {
  return {
    name: "@aphrody/m3-bun",
    setup(build) {
      build.onResolve({ filter: /^m3:icons\// }, (args) => ({ path: args.path.slice("m3:icons/".length), namespace: ICON_NAMESPACE }));
      build.onLoad({ filter: /.*/, namespace: ICON_NAMESPACE }, (args) => {
        const svg = readIcon(parseIconSpecifier(args.path), options.iconsRoot ?? iconsRoot(options.configDir ?? process.cwd()) ?? iconsRoot());
        return { contents: `export default ${JSON.stringify(svg)};\n`, loader: "js" };
      });
      build.onResolve({ filter: /^m3:optional\// }, (args) => ({ path: args.path.slice("m3:optional/".length), namespace: OPTIONAL_NAMESPACE }));
      build.onLoad({ filter: /.*/, namespace: OPTIONAL_NAMESPACE }, (args) => {
        try {
          const resolved = Bun.resolveSync(args.path, options.configDir ?? process.cwd());
          return { contents: `import * as namespace from ${JSON.stringify(resolved)};\nexport default namespace;\nexport const resolved = true;\n`, loader: "js" };
        } catch {
          return { contents: "export default null;\nexport const resolved = false;\n", loader: "js" };
        }
      });
      // m3Plugin serves the font sheets from an Aphrody OS checkout; without one, `@aphrody/m3-fonts` does.
      build.onResolve({ filter: /^m3:fonts[-a-z]*\.css$/ }, (args) => {
        const specifier = FONT_SHEETS[args.path];
        if (!specifier) return undefined;
        try {
          return { path: Bun.resolveSync(specifier, options.configDir ?? process.cwd()) };
        } catch {
          return { path: Bun.resolveSync(specifier, dirname(import.meta.path)) };
        }
      });
    },
  };
}

/** The complete plugin. */
export function m3Bun(options: M3BunPluginOptions = {}): BunPlugin {
  const { iconsRoot: icons, ...m3Options } = options;
  const extras = m3BunExtras({ ...(icons ? { iconsRoot: icons } : {}), ...(options.configDir ? { configDir: options.configDir } : {}) });
  const base = m3Plugin({ css: tsM3Css, ...m3Options });
  return {
    name: "@aphrody/m3-bun",
    setup(build) {
      // Extras first: they decide before m3Plugin throws on a font sheet it cannot find.
      void extras.setup(build);
      void base.setup(build);
    },
  };
}

/** For `bunfig.toml`: the plugin with its defaults, theme read from the `m3.config.ts` of the working directory. */
const plugin: BunPlugin = m3Bun();
export default plugin;
