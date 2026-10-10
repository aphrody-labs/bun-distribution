// Must be the first import: it sets `window.Prism.manual` before the core evaluates.
// oxlint-disable-next-line import/no-unassigned-import -- side effect voulu : configure window.Prism.manual avant le core
import "./prism-manual";

import Prism from "prismjs";

// The language plugins are scripts that reference the global `Prism`. A bundler may evaluate
// side-effect imports of ESM-shaped scripts before a CommonJS dependency such as `prismjs`, so
// publish the core first and load the plugins afterwards through a dynamic import.
(window as unknown as { Prism: typeof Prism }).Prism = Prism;

const languages = import("./prism-languages");

/** Resolve once the Prism core and every language plugin are loaded. */
export async function loadPrism(): Promise<Pick<typeof Prism, "highlightElement">> {
	await languages;
	return { highlightElement: (element, async) => Prism.highlightElement(element, async) };
}
