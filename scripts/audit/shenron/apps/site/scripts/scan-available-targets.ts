import { $ } from "bun";
import { resolve } from "node:path";

const targets = [
	1, 52, 74, 76, 77, 78, 80, 85, 93, 96, 97, 100, 101, 103, 104, 106, 107, 109,
	112, 113, 121, 131, 132, 138, 244, 281, 282, 284, 286, 288, 290, 294, 296, 299, 309
];

async function main() {
	console.log("Scanning target databooks...");
	for (const id of targets) {
		const res = await $`${process.execPath} ${resolve(import.meta.dir, "planches-a-traduire.ts")} --databook ${id} --compte`.quiet().nothrow();
		const out = res.stdout.toString().trim() || res.stderr.toString().trim();
		if (!out.includes("aucune planche")) {
			console.log(`#${String(id).padEnd(4)} : ${out}`);
		}
	}
}

main().catch(console.error);
