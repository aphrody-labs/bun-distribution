import { $ } from "bun";
import { resolve } from "node:path";

const batchIds = [103, 109, 111, 121, 297];
const allPlanches: any[] = [];
let allLexique: any[] = [];

for (const id of batchIds) {
	const res = await $`${process.execPath} ${resolve(import.meta.dir, "planches-a-traduire.ts")} --databook ${id} --json /tmp/db_${id}.json`.quiet().nothrow();
	if (res.exitCode === 0) {
		const data = await Bun.file(`/tmp/db_${id}.json`).json();
		allPlanches.push(...data.planches);
		allLexique.push(...data.lexique);
	}
}

// Dédupliquer le lexique
const seenLex = new Set<string>();
const uniqueLex = allLexique.filter((item) => {
	if (seenLex.has(item.ja)) return false;
	seenLex.add(item.ja);
	return true;
});

const output = {
	databooks: batchIds,
	totalPlanches: allPlanches.length,
	planches: allPlanches,
	lexique: uniqueLex,
};

await Bun.write("/tmp/batch-golden-3.json", JSON.stringify(output, null, 2) + "\n");
console.log(`Exporté ${allPlanches.length} planches pour les databooks ${batchIds.join(", ")}`);
