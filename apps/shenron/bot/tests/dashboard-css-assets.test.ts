import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DASHBOARD = resolve(import.meta.dir, "../src/dashboard");
const STYLESHEETS = ["styles.css", "styles.compiled.css"] as const;

/** Relative `url()` targets; remote, data and root-absolute references are not files of this tree. */
function relativeUrls(css: string): string[] {
	const urls = [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map((m) => m[2]!.trim());
	return urls.filter((u) => !/^(data:|https?:|\/|#)/.test(u));
}

describe("dashboard stylesheet assets", () => {
	for (const name of STYLESHEETS) {
		it(`${name}: every relative url() resolves to an existing file`, () => {
			const file = resolve(DASHBOARD, name);
			const urls = relativeUrls(readFileSync(file, "utf8"));
			expect(urls.length).toBeGreaterThan(0);
			const missing = urls.filter((u) => !existsSync(resolve(dirname(file), u.split(/[?#]/)[0]!)));
			expect(missing).toEqual([]);
		});
	}
});
