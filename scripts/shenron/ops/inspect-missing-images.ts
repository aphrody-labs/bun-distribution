// SPDX-License-Identifier: Apache-2.0
import { existsSync } from "node:fs";
import {
	chargeOuvrages,
	cheminPlanche,
	connecte,
	texteDePlanche,
} from "../../apps/site/scripts/_databooks-base";

async function main() {
	const sql = await connecte();
	const ouvrages = await chargeOuvrages(sql);
	await sql.end();

	const sansImage = [];
	for (const o of ouvrages) {
		for (let i = 0; i < o.pages.length; i++) {
			const p = o.pages[i]!;
			const txt = texteDePlanche(p).trim();
			if (txt.length === 0) {
				const disk = cheminPlanche(p.image);
				if (!disk || !existsSync(disk)) {
					sansImage.push({
						bookId: o.id,
						title: o.title,
						page: Number(p.number) || i + 1,
						image: p.image,
						disk,
					});
				}
			}
		}
	}
	console.log("Nombre de planches sans texte et sans image disque:", sansImage.length);
	console.log("Exemples (15 premiers):");
	console.log(JSON.stringify(sansImage.slice(0, 15), null, 2));

	// Groupement par bookId
	const parLivre = new Map<number, { title: string; count: number }>();
	for (const item of sansImage) {
		const cur = parLivre.get(item.bookId) || { title: item.title, count: 0 };
		cur.count++;
		parLivre.set(item.bookId, cur);
	}
	const avecImageDisque = [];
	for (const o of ouvrages) {
		for (let i = 0; i < o.pages.length; i++) {
			const p = o.pages[i]!;
			const txt = texteDePlanche(p).trim();
			if (txt.length === 0) {
				const disk = cheminPlanche(p.image);
				if (disk && existsSync(disk)) {
					avecImageDisque.push({
						bookId: o.id,
						title: o.title,
						page: Number(p.number) || i + 1,
						image: p.image,
						disk,
					});
				}
			}
		}
	}
	console.log(`\nNombre de planches SANS texte mais AVEC image sur disque: ${avecImageDisque.length}`);
	const parLivreDisque = new Map<number, { title: string; count: number }>();
	for (const item of avecImageDisque) {
		const cur = parLivreDisque.get(item.bookId) || { title: item.title, count: 0 };
		cur.count++;
		parLivreDisque.set(item.bookId, cur);
	}
	console.log("Répartition des planches prêtes pour OCR (images sur disque) :");
	for (const [id, info] of parLivreDisque.entries()) {
		console.log(`  - Livre #${id} : ${info.title} (${info.count} planches)`);
	}
}

main().catch(console.error);
