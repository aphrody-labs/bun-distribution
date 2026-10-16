import { checkReadmeInventory } from "../tools/readme";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

import { archivedDocPrefixes, listArchivedDocs } from "../tools/docs-archive";
import { documentationSourceFiles } from "./docs-files";

checkReadmeInventory();

const root = resolve(import.meta.dir, "../../..");
const manifest = JSON.parse(readFileSync(resolve(root, "docs/documentation.json"), "utf8"));
const archived = new Set(
  listArchivedDocs().filter((file) =>
    archivedDocPrefixes.some((prefix) => file.startsWith(prefix)),
  ),
);
const files = documentationSourceFiles(root, archived);
const errors: string[] = [];
const current = new Set<string>([...manifest.entrypoints, ...manifest.currentFiles]);
let classified = 0;
for (const file of files.filter((p) => p.startsWith("docs/"))) {
  const isCurrent =
    current.has(file) || manifest.currentPrefixes.some((p: string) => file.startsWith(p));
  if (isCurrent) current.add(file);
  const retained =
    (manifest.historicalFiles ?? []).includes(file) ||
    [...manifest.referencePrefixes, ...manifest.historicalPrefixes].some((p: string) =>
      file.startsWith(p),
    );
  if (!isCurrent && !retained && !["docs/documentation.json", "docs/README.md"].includes(file))
    errors.push(`Unclassified documentation: ${file}`);
  classified++;
}
for (const file of [...manifest.entrypoints, ...manifest.sourceOwners]) {
  if (!existsSync(resolve(root, file))) errors.push(`Missing canonical entry: ${file}`);
}
for (const file of files) {
  if (/(^|\/)(AGENTS|CLAUDE)\.md$/.test(file) && !["AGENTS.md", "CLAUDE.md"].includes(file))
    errors.push(`Competing agent instruction file: ${file}`);
  if (file.startsWith(".agents/skills/") && /(^|\/)(Cargo\.toml|Cargo\.lock)$/.test(file))
    errors.push(`Copied Rust workspace in skill: ${file}`);
}
let links = 0;
for (const file of [...current].filter((p) => p.endsWith(".md"))) {
  if (!existsSync(resolve(root, file))) continue;
  const text = readFileSync(resolve(root, file), "utf8");
  for (const match of text.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    let target = match[1].trim();
    if (target.startsWith("<")) target = target.slice(1, target.indexOf(">"));
    else target = target.split(/\s+["']/)[0];
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/)/i.test(target)) continue;
    target = decodeURIComponent(target.split("#")[0].split("?")[0]);
    if (!target) continue;
    links++;
    const absolute = resolve(root, dirname(file), target);
    if (!existsSync(absolute) && !archived.has(relative(root, absolute).replaceAll("\\", "/")))
      errors.push(`${file}: missing link ${target} (${relative(root, absolute)})`);
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  `Documentation: ${classified} classified files, ${current.size} current entries, ${links} local links; 2 root AI routers, no copied skill workspaces.`,
);
