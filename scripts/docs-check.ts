#!/usr/bin/env bun
// Checks the documentation site: every docs.json page exists and every relative Markdown link
// in the site pages, the README and the root guides resolves.
import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const root = join(import.meta.dir, "..");
const docs = join(root, "docs");
const config = await Bun.file(join(docs, "docs.json")).json();
const problems: string[] = [];

const pageFile = async (page: string): Promise<string | undefined> => {
  for (const extension of [".mdx", ".md"]) {
    const path = join(docs, page.replace(/^\//, "") + extension);
    if (await Bun.file(path).exists()) return path;
  }
  return undefined;
};

const files = [join(root, "README.md")];
for (const tab of config.navigation.tabs)
  for (const group of tab.groups)
    for (const page of group.pages) {
      const file = await pageFile(page);
      if (file) files.push(file);
      else problems.push(`docs.json: missing page ${page}`);
    }

for (const file of files) {
  const text = await Bun.file(file).text();
  for (const [, target] of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    if (!target || /^[a-z]+:/i.test(target)) continue;
    const resolved = target.startsWith("/")
      ? await pageFile(target)
      : normalize(join(dirname(file), decodeURI(target)));
    if (!resolved || !existsSync(resolved)) problems.push(`${file.slice(root.length + 1)}: broken link ${target}`);
  }
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`docs: ${files.length} pages, links resolve`);
