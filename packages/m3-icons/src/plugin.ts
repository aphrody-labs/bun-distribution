// SPDX-License-Identifier: Apache-2.0

import type { BunPlugin } from "bun";
import { m3Icon, type M3IconStyle } from "@aphrody/bun";

const VIRTUAL_PREFIX = "m3:icon/";
const STYLES: readonly M3IconStyle[] = ["outlined", "rounded", "sharp"];

/**
 * Resolves `m3:icon/<style>/<name>?fill=<0|1>&wght=<100..700>&grad=<-25..200>&opsz=<20..48>`
 * (e.g. `import svg from "m3:icon/outlined/home?fill=1&wght=500"`) to an ESM module exporting
 * the rendered SVG string as its default export.
 *
 * Exported for another agent to compose into `@aphrody/m3`'s own plugin
 * (`docs/design/M3-PLAN.md` phase 3); not wired into `packages/m3` here.
 */
export const m3IconPlugin: BunPlugin = {
  name: "m3-icon-loader",
  setup(build) {
    build.onResolve({ filter: /^m3:icon\// }, (args) => ({
      path: args.path,
      namespace: "m3-icon",
    }));

    build.onLoad({ filter: /.*/, namespace: "m3-icon" }, (args) => {
      const rest = args.path.slice(VIRTUAL_PREFIX.length);
      const [stylePart, query = ""] = rest.split("?", 2);
      const [style, name] = splitStyleAndName(stylePart);
      const params = new URLSearchParams(query);

      const svg = m3Icon({
        name,
        style,
        fill: parseNumber(params.get("fill")),
        weight: parseNumber(params.get("wght")),
        grade: parseNumber(params.get("grad")),
        opticalSize: parseNumber(params.get("opsz")),
        size: parseNumber(params.get("size")),
      });

      return {
        contents: `export default ${JSON.stringify(svg)};\n`,
        loader: "js",
      };
    });
  },
};

function splitStyleAndName(stylePart: string): [M3IconStyle, string] {
  const slash = stylePart.indexOf("/");
  if (slash === -1) {
    throw new Error(
      `m3:icon module path must be "m3:icon/<style>/<name>", got "${stylePart}"`,
    );
  }
  const style = stylePart.slice(0, slash);
  const name = stylePart.slice(slash + 1);
  if (!STYLES.includes(style as M3IconStyle)) {
    throw new Error(
      `m3:icon style must be one of ${STYLES.join(", ")}, got "${style}"`,
    );
  }
  return [style as M3IconStyle, name];
}

function parseNumber(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
