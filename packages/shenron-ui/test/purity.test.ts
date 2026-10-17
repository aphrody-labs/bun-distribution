import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

// Local guard until the shared guard kit lands (wave 2): package sources stay
// framework- and environment-agnostic.
const FORBIDDEN: Array<[string, RegExp]> = [
  ["next/", /from\s+["']next\/|import\(\s*["']next\//],
  ["next-intl", /["']next-intl(\/[^"']*)?["']/],
  ["@/ alias", /["']@\/[^"']*["']/],
  ["process.env", /process\.env/],
];

const srcDir = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

describe("purity of packages/shenron-ui/src", async () => {
  const files = await Array.fromAsync(new Glob("**/*.{ts,tsx}").scan({ cwd: srcDir }));

  test("scans source files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test("no next/, next-intl, @/ or process.env", async () => {
    const hits: string[] = [];
    for (const f of files) {
      const text = await Bun.file(`${srcDir}${f}`).text();
      for (const [label, re] of FORBIDDEN) if (re.test(text)) hits.push(`${f}: ${label}`);
    }
    expect(hits).toEqual([]);
  });
});
