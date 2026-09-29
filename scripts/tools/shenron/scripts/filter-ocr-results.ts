import { readFileSync } from "node:fs";
import { classerDefaut } from "../apps/site/src/lib/databooks-defauts.ts";

const [input, output] = Bun.argv.slice(2);
if (!input || !output) throw new Error("usage: bun scripts/filter-ocr-results.ts <input.jsonl> <output.jsonl>");
const kept: string[] = [];
for (const line of readFileSync(input, "utf8").split(/\r?\n/)) {
	if (!line.trim()) continue;
	const record = JSON.parse(line) as { text?: { kind?: string; markdown?: string } };
	const markdown = record.text?.kind === "text" ? (record.text.markdown ?? "") : "";
	if (markdown.trim() && classerDefaut(markdown) === null) kept.push(line);
}
await Bun.write(output, kept.join("\n") + (kept.length ? "\n" : ""));
console.log(`${kept.length} resultats sains ecrits dans ${output}`);
