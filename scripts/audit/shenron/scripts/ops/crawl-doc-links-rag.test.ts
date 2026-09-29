import { describe, expect, test } from "bun:test";
import { isUsableMarkdown, parseOptions } from "./crawl-doc-links-rag";

describe("crawl-doc-links-rag options", () => {
	test("defaults to crawl-only mode", () => {
		expect(parseOptions([])).toEqual({
			concurrency: 6,
			rebuild: false,
			rebuildOnly: false,
			dryRun: false,
			force: false,
			host: null,
			profile: "stealth",
		});
	});

	test("uses BXC live retrieval only when requested", () => {
		expect(parseOptions(["--force"]).force).toBe(true);
	});

	test("can scope a retry to one hostname", () => {
		expect(parseOptions(["--host", "web.archive.org"]).host).toBe("web.archive.org");
	});

	test("requires an explicit rebuild flag", () => {
		expect(parseOptions(["--rebuild", "--concurrency", "4"]).rebuild).toBe(true);
	});

	test("can rebuild without retrying failed URLs", () => {
		const options = parseOptions(["--rebuild-only"]);
		expect(options.rebuild).toBe(true);
		expect(options.rebuildOnly).toBe(true);
	});

	test("rejects unbounded concurrency", () => {
		expect(() => parseOptions(["--concurrency", "13"])).toThrow("integer from 1 to 12");
	});
});

test("usable Markdown excludes short and corrupt BXC output", () => {
	expect(isUsableMarkdown("short markdown")).toBe(false);
	expect(isUsableMarkdown(`${"Valid source text ".repeat(20)}${"�".repeat(10)}`)).toBe(false);
	expect(isUsableMarkdown("# Source\n\n" + "Reliable source text. ".repeat(20))).toBe(true);
});
