// SPDX-License-Identifier: Apache-2.0
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prunePublicFontCopies } from "../public-assets-package";

test("public packaging removes remote-only duplicate fonts and retains local glyph/image assets", () => {
  const root = mkdtempSync(join(tmpdir(), "public-font-trim-"));
  const fonts = join(root, "fonts");
  mkdirSync(fonts);
  for (const name of ["remote.woff2", "glyph.woff2", "icon.png", "spritesheet.webp"])
    writeFileSync(join(fonts, name), "bytes");
  const base = "https://public.example";
  try {
    const result = prunePublicFontCopies(
      root,
      [`url("${base}/m3/fonts/remote.woff2") url("./fonts/glyph.woff2")`],
      base,
    );
    expect(result).toEqual({ files: 1, bytes: 5 });
    expect(existsSync(join(fonts, "remote.woff2"))).toBe(false);
    for (const name of ["glyph.woff2", "icon.png", "spritesheet.webp"])
      expect(existsSync(join(fonts, name))).toBe(true);
    expect(() =>
      prunePublicFontCopies(root, ['url("https://other.example/unsafe.woff2")'], base),
    ).toThrow("Unqualified");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
