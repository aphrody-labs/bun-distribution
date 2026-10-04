/**
 * Production bundle and CSS smoke check for the source-first UI package.
 *
 * It deliberately keeps output in memory: consumers import TypeScript sources
 * and let their framework tree-shake them. This proves the package can still
 * be minified for a browser without committing a second, stale `dist` tree.
 */
import { join } from "node:path";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const root = join(import.meta.dir, "..");
const textEncoder = new TextEncoder();
const entries = ["server", "client", "admin", "public", "reader"] as const;
const forbiddenSpecifier = /["'`](?:node|bun):/;

async function bundle(entry: (typeof entries)[number]) {
	const result = await Bun.build({
		entrypoints: [join(root, "src", entry === "reader" ? "reader/index.ts" : `${entry}.ts`)],
		target: "browser",
		format: "esm",
		packages: "external",
		minify: true,
		treeShaking: true,
		allowUnresolved: [],
		env: "disable",
		metafile: true,
		throw: false,
	});
	if (!result.success) {
		const details = result.logs.map((log) => log.message).join("\n");
		throw new Error(`${entry}: Bun build failed\n${details}`);
	}
	let bytes = 0;
	for (const output of result.outputs) {
		bytes += output.size;
		if (forbiddenSpecifier.test(await output.text())) {
			throw new Error(`${entry}: browser bundle contains a Node or Bun specifier`);
		}
	}
	return { entry, bytes, inputs: Object.keys(result.metafile?.inputs ?? {}).length };
}

async function compileCss() {
	const source = [
		'@import "tailwindcss";',
		'@import "@shenron/ui/styles.css";',
		'@import "@shenron/ui/site.css";',
		'@import "@shenron/ui/toriyama.css";',
		'@import "@shenron/ui/barre-nav.css";',
		'@import "@shenron/ui/editor.css";',
		'@import "@shenron/ui/editorial.css";',
		'@import "@shenron/ui/reader-styles.css";',
		'@import "@shenron/ui/reader-dragon-ball.css";',
	].join("\n");
	const result = await postcss([tailwindcss({ base: root, optimize: { minify: true } })]).process(source, {
		from: join(root, "src", "production.css"),
	});
	return textEncoder.encode(result.css).byteLength;
}

const bundles = await Promise.all(entries.map(bundle));
const cssBytes = await compileCss();
for (const result of bundles) {
	console.log(`${result.entry}: ${result.bytes} bytes minified, ${result.inputs} inputs`);
}
console.log(`css: ${cssBytes} bytes minified`);
