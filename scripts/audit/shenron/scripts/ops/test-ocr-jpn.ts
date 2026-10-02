// SPDX-License-Identifier: Apache-2.0
import { chargeOuvrages, cheminPlanche, connecte } from "../../../../../apps/shenron/site/scripts/_databooks-base";
import { recogniseRemotePage } from "@shenron/pipeline/aphrody/remote-ocr";

async function main() {
	const sql = await connecte();
	const [book] = await chargeOuvrages(sql, { ids: [27] });
	await sql.end();
	if (!book || !book.pages || book.pages.length === 0) {
		console.log("Livre 27 introuvable");
		return;
	}

	// Trouver une page avec image
	for (let i = 5; i < 15; i++) {
		const p = book.pages[i]!;
		const disk = cheminPlanche(p.image);
		if (disk && Bun.file(disk).size > 0) {
			console.log(`Test page #${p.number || i + 1} (${disk}) :`);
			const t0 = Date.now();
			const report = await recogniseRemotePage(new Uint8Array(await Bun.file(disk).arrayBuffer()));
			const elapsed = Date.now() - t0;
			if (report.suspect) throw new Error(`Aphrody OCR requires visual review for ${disk}`);
			const text = report.text.trim();
			console.log(`Temps: ${elapsed}ms, caractères: ${text.length}`);
			console.log("Extrait:\n", text.slice(0, 400));
			break;
		}
	}
}

main().catch(console.error);

