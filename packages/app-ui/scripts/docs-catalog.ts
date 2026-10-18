// Builds the public documentation catalogue read by app-ui's public site: an array of { id, title, summary, content }.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const root = join(import.meta.dir, "../../../docs");
const out: { id: string; title: string; summary: string; content: string }[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith(".md")) {
      const text = readFileSync(p, "utf8");
      const title = /^#\s+(.+)$/m.exec(text)?.[1] ?? name;
      const summary = text.replace(/^#.*$/m, "").replace(/\s+/g, " ").trim().slice(0, 240);
      out.push({ id: relative(root, p).replaceAll("\\", "/").replace(/\.md$/, ""), title, summary, content: text.slice(0, 60000) });
    }
  }
};
walk(root);
await Bun.write(join(import.meta.dir, "../../../build/docs-catalog.json"), JSON.stringify(out));
console.log("articles", out.length);
