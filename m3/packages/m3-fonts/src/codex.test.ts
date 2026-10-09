import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";

const root = join(import.meta.dir, "..", "codex");
const index = JSON.parse(readFileSync(join(root, "index.json"), "utf8"));
const manifest: Record<string, string> = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

test("codex manifest hashes match generated files", () => {
  for (const [file, digest] of Object.entries(manifest)) {
    const actual = createHash("sha256")
      .update(readFileSync(join(root, file)))
      .digest("hex");
    expect(actual).toBe(digest);
  }
});

test("codex index covers every icon in every style and variant", () => {
  const names = Object.keys(index.icons);
  expect(names).toHaveLength(26);
  for (const name of names) {
    for (const style of index.styles) {
      expect(index.icons[name][style]).toMatch(/^[0-9A-F]{4}$/);
    }
  }
  const { wght, fill, grade, opsz } = index.variants;
  const svgCount = names.length * index.styles.length * wght.length * fill.length * grade.length * opsz.length;
  const svgs = Object.keys(manifest).filter(file => file.startsWith("svg/") && !file.startsWith("svg/brand/"));
  expect(svgs).toHaveLength(svgCount);
});
