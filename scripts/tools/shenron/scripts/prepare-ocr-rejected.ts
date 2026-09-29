import { basename, join } from "node:path";
import { classerDefaut } from "../apps/site/src/lib/databooks-defauts.ts";

const [input, sourceDir, destinationDir] = Bun.argv.slice(2);
if (!input || !sourceDir || !destinationDir) throw new Error("usage: bun scripts/prepare-ocr-rejected.ts <resultats.jsonl> <images> <destination>");
await Bun.write(join(destinationDir, ".keep"), "");
let copied = 0;
for (const line of (await Bun.file(input).text()).split(/\r?\n/)) {
	if (!line.trim()) continue;
	const record = JSON.parse(line) as { image?: string; text?: { kind?: string; markdown?: string } };
	const markdown = record.text?.kind === "text" ? (record.text.markdown ?? "") : "";
	if (!record.image || (markdown.trim() && classerDefaut(markdown) === null)) continue;
	const name = basename(record.image);
	await Bun.write(join(destinationDir, name), Bun.file(join(sourceDir, name)));
	copied++;
}
console.log(`${copied} images rejetées préparées dans ${destinationDir}`);
