// SPDX-License-Identifier: Apache-2.0
// The one Bun plugin of an M3 app. It is `@aphrody/m3`'s plugin (Tailwind v4, Sass, `m3:*` token sheets, `?url`
// imports) plus what makes it work in a standalone checkout:
//   - canonical native theme artifacts and the Rust `@aphrody/bun` generator through `m3Plugin`,
//     with caller-provided `css` overrides preserved,
//   - `m3:fonts.css`, `m3:fonts-jp.css`, `m3:fonts-symbols.css` from `@aphrody/m3-fonts` when no Aphrody OS checkout
//     holds the fonts,
//   - the m3 packages as modules (src/plugins-m3.ts): `m3:icons/[style/]name[?fill=1&wght=300]` (Material Symbols SVG
//     markup from the catalogue, @aphrody/m3-icons native rendering or the CDN), `m3:icon/<style>/<name>`
//     (@aphrody/m3-icons/plugin), `m3:theme/*.css` and `m3:assets/<path>[?url]`,
//   - the fork plugins (src/plugins.ts): Svelte (on), YAML, MDX, n2b and Oxc (opt-in), each imported on first use,
//   - `m3:optional/<specifier>`: a module that may not be installed. `import brand, { resolved } from
//     "m3:optional/@aphrody/nie-ui"` is the module namespace and `resolved: true` when the specifier resolves
//     from the app, `null` and `resolved: false` when it does not (host-bound packages outside the workspace).
//
//   bunfig.toml        [serve.static]  plugins = ["@aphrody/m3-bun/plugin"]
//   Bun.build / compile                plugins: [m3Bun({ theme: { seed: "#6750a4" } })]
import { m3Plugin, type M3PluginOptions } from "@aphrody/m3/plugin";
import type { BunPlugin } from "bun";
import { dirname } from "node:path";
import { forkPlugins, type ForkPluginOptions } from "./plugins.ts";
import { m3PackagesPlugin } from "./plugins-m3.ts";

const FONT_SHEETS: Record<string, string> = {
  "m3:fonts.css": "@aphrody/m3-fonts/fonts.css",
  "m3:fonts-jp.css": "@aphrody/m3-fonts/fonts-jp.css",
  "m3:fonts-symbols.css": "@aphrody/m3-fonts/fonts-symbols.css",
};

const OPTIONAL_NAMESPACE = "m3-optional";

export interface M3BunPluginOptions extends M3PluginOptions, ForkPluginOptions {
  /** Directory of the Material Symbols SVG catalogue (default: `M3_ICONS_ROOT`, then @aphrody/material-design-icons). */
  iconsRoot?: string;
  /** Directory containing the application or config (default: process.cwd()). */
  configDir?: string;
  /** Optional theme override */
  theme?: M3PluginOptions["theme"];
  /** Optional css generator override */
  css?: M3PluginOptions["css"];
}

/**
 * What `m3Bun` adds to `m3Plugin` besides the fork plugins: the m3 package modules, `m3:optional/` and the standalone
 * font sheets. Exported for `Bun.build` callers that compose themselves.
 */
export function m3BunExtras(
  options: Pick<M3BunPluginOptions, "iconsRoot" | "configDir"> = {},
): BunPlugin {
  const packages = m3PackagesPlugin(options);
  return {
    name: "@aphrody/m3-bun",
    setup(build) {
      void packages.setup(build);
      build.onResolve({ filter: /^m3:optional\// }, (args) => ({
        path: args.path.slice("m3:optional/".length),
        namespace: OPTIONAL_NAMESPACE,
      }));
      build.onLoad({ filter: /.*/, namespace: OPTIONAL_NAMESPACE }, (args) => {
        try {
          const resolved = Bun.resolveSync(
            args.path,
            options.configDir ?? process.cwd(),
          );
          return {
            contents: `import * as namespace from ${JSON.stringify(resolved)};\nexport default namespace;\nexport const resolved = true;\n`,
            loader: "js",
          };
        } catch {
          return {
            contents: "export default null;\nexport const resolved = false;\n",
            loader: "js",
          };
        }
      });
      // m3Plugin serves the font sheets from an Aphrody OS checkout; without one, `@aphrody/m3-fonts` does.
      build.onResolve({ filter: /^m3:fonts[-a-z]*\.css$/ }, (args) => {
        const specifier = FONT_SHEETS[args.path];
        if (!specifier) return undefined;
        try {
          return {
            path: Bun.resolveSync(
              specifier,
              options.configDir ?? process.cwd(),
            ),
          };
        } catch {
          return {
            path: Bun.resolveSync(specifier, dirname(import.meta.path)),
          };
        }
      });
    },
  };
}

/** The complete plugin. */
export function m3Bun(options: M3BunPluginOptions = {}): BunPlugin {
  const {
    iconsRoot: icons,
    yaml,
    svelte,
    mdx,
    n2b,
    oxc,
    ...m3Options
  } = options;
  const extras = m3BunExtras({
    ...(icons ? { iconsRoot: icons } : {}),
    ...(options.configDir ? { configDir: options.configDir } : {}),
  });
  const forks = forkPlugins({ yaml, svelte, mdx, n2b, oxc }, options.configDir);
  const base = m3Plugin(m3Options);
  return {
    name: "@aphrody/m3-bun",
    setup(build) {
      // Extras first: they decide before m3Plugin throws on an `m3:` module or a font sheet it does not know.
      void extras.setup(build);
      // Only the native-hook plugins (mdx, oxc `native`) set up asynchronously; the default plugin stays synchronous.
      const pending = forks
        .map((plugin) => plugin.setup(build))
        .filter((result) => result instanceof Promise);
      void base.setup(build);
      if (pending.length > 0) return Promise.all(pending).then(() => undefined);
    },
  };
}

/** For `bunfig.toml`: the plugin with its defaults, theme read from the `m3.config.ts` of the working directory. */
const plugin: BunPlugin = m3Bun();
export default plugin;
