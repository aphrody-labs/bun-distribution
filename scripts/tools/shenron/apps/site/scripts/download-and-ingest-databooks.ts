#!/usr/bin/env bun
/**
 * download-and-ingest-databooks.ts
 *
 * Rapatriement et hébergement local des planches de databooks manquantes :
 *   1. Databooks 457 à 464 (471 planches pointant vers comic.dragonballcn.com) :
 *      - Téléchargement via BXC curl-impersonate (profile chrome131)
 *      - Validation d'intégrité par Sharp
 *      - Écriture atomique dans apps/site/public/wiki/databooks/
 *      - Mise à jour en base vers ./assets/wiki/databooks/<fichier>
 *      - Audit trail dans public.wiki_revisions
 *
 *   2. Databook 1 (Daizenshuu 1 — Complete Illustrations, 208 planches) :
 *      - Téléchargement des planches manquantes depuis 0-5-34-1.json
 *      - Sauvegarde dans apps/site/public/wiki/databooks/daizenshuu-01/
 *      - Préservation des planches existantes HD (p. 1, 2, 3, 4, 6) et de leurs traductions
 *      - Mise à jour en base et journalisation
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, statfs, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import sharp from "sharp";
import {
	arretSiGel,
	cheminPlanche,
	connecte,
	RACINE_PLANCHES,
} from "./_databooks-base";
import {
	referencedScanBasename,
} from "../src/lib/referenced-databook-scan";

arretSiGel("download-and-ingest-databooks.ts");

const DRY_RUN = process.argv.includes("--dry-run");
const MAX_BYTES = 25_000_000;
const MIN_EDGE = 160;
const MIN_FREE_DISK_BYTES = 5 * 1024 * 1024 * 1024; // 5 Go

const bxcRoot = process.env.BXC_ROOT?.trim() || resolve(import.meta.dir, "..", "..", "..", "..", "aphrody-web", "apps", "bxc");
const { ImpersonatedClient } = await import(join(bxcRoot, "src", "ffi", "curl-impersonate.ts"));

const generateRevisionId = () =>
	Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

async function checkDiskSpace() {
	const s = await statfs(RACINE_PLANCHES);
	const free = s.bavail * s.bsize;
	if (free < MIN_FREE_DISK_BYTES) {
		throw new Error(`Espace disque insuffisant : ${(free / (1024 * 1024 * 1024)).toFixed(2)} Go libres (minimum 5 Go requis).`);
	}
}

async function validateAndSave(bytes: Uint8Array, targetPath: string): Promise<{ width: number; height: number; format: string }> {
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
		throw new Error(`Taille invalide : ${bytes.byteLength} octets`);
	}
	const meta = await sharp(bytes, { failOn: "error", limitInputPixels: false }).metadata();
	if (!meta.width || !meta.height || meta.width < MIN_EDGE || meta.height < MIN_EDGE || !["jpeg", "png", "webp"].includes(meta.format ?? "")) {
		throw new Error(`Contenu image invalide : ${meta.format} ${meta.width}x${meta.height}`);
	}
	const dir = join(targetPath, "..");
	await mkdir(dir, { recursive: true });
	const temp = `${targetPath}.part-${process.pid}-${randomUUID()}`;
	try {
		await writeFile(temp, bytes, { flag: "wx" });
		await rename(temp, targetPath);
	} catch (err) {
		await unlink(temp).catch(() => {});
		throw err;
	}
	return { width: meta.width, height: meta.height, format: meta.format! };
}

async function downloadUrl(client: any, url: string, targetPath: string): Promise<boolean> {
	if (existsSync(targetPath)) {
		try {
			const meta = await sharp(targetPath).metadata();
			if (meta.width && meta.height && meta.width >= MIN_EDGE && meta.height >= MIN_EDGE) {
				return false; // Déjà présent et valide
			}
		} catch {
			// Fichier corrompu, on retélécharge
		}
	}

	const parsed = new URL(url);
	let lastError: unknown;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			const res = await client.fetch(url, {
				headers: {
					Referer: `${parsed.origin}/`,
					Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
					"Accept-Language": "zh-CN,zh;q=0.9,ja;q=0.8,en;q=0.7",
				},
				httpVersion: "1.1",
				followRedirects: false,
				timeoutMs: 30000,
			});

			if (res.status === 301 || res.status === 302) {
				const loc = res.headers.get("location");
				if (loc) {
					const nextUrl = new URL(loc, url).href;
					return downloadUrl(client, nextUrl, targetPath);
				}
			}

			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}

			const bytes = new Uint8Array(await res.arrayBuffer());
			await validateAndSave(bytes, targetPath);
			return true;
		} catch (err) {
			lastError = err;
			await new Promise((r) => setTimeout(r, 400 * attempt));
		}
	}
	throw new Error(`Échec téléchargement ${url} : ${lastError}`);
}

async function main() {
	await checkDiskSpace();
	const sql = await connecte();
	const client = new ImpersonatedClient({ profile: "chrome131", httpVersion: "1.1", followRedirects: false, timeoutMs: 30000 });

	console.log(`\n=== Démarrage du téléchargement et de l'ingestion des planches ===`);
	console.log(`Mode : ${DRY_RUN ? "SIMULATION (--dry-run)" : "APPLICATION EN BASE"}`);
	console.log(`Racine des planches : ${RACINE_PLANCHES}\n`);

	try {
		// -------------------------------------------------------------
		// PARTIE 1 : Databooks 457 à 464 (471 planches référencées)
		// -------------------------------------------------------------
		console.log(`--- Étape 1 : Databooks 457 à 464 ---`);
		const bookIds = [457, 458, 459, 460, 461, 462, 463, 464];
		const databooks = await sql<Array<{ id: number; title: string; pages: any[] }>>`
			SELECT id, title, pages
			FROM bot.db_databooks
			WHERE id IN ${sql(bookIds)}
			ORDER BY id
		`;

		let total471Downloaded = 0;
		let total471Skipped = 0;

		for (const book of databooks) {
			console.log(`\nOuvrage #${book.id} : ${book.title} (${book.pages.length} planches)`);
			let bookDownloaded = 0;
			let bookSkipped = 0;
			const updatedPages = [...book.pages];
			let modified = false;

			for (let i = 0; i < updatedPages.length; i++) {
				const page = { ...updatedPages[i] };
				const currentImage = (page.image ?? "").trim();

				if (currentImage.startsWith("http://") || currentImage.startsWith("https://")) {
					const filename = referencedScanBasename(currentImage) || basename(new URL(currentImage).pathname);
					const targetPath = join(RACINE_PLANCHES, "databooks", filename);
					const localRef = `./assets/wiki/databooks/${filename}`;

					try {
						const wasDownloaded = await downloadUrl(client, currentImage, targetPath);
						if (wasDownloaded) bookDownloaded++;
						else bookSkipped++;

						page.image = localRef;
						updatedPages[i] = page;
						modified = true;
					} catch (err) {
						console.error(`  ✗ Erreur planche ${page.number ?? i + 1} (${currentImage}) :`, err);
						throw err;
					}
				} else if (currentImage) {
					bookSkipped++;
				}
			}

			console.log(`  -> ${bookDownloaded} téléchargées, ${bookSkipped} déjà présentes`);
			total471Downloaded += bookDownloaded;
			total471Skipped += bookSkipped;

			if (modified && !DRY_RUN) {
				await sql.begin(async (tx) => {
					await tx`
						UPDATE bot.db_databooks
						SET pages = ${tx.json(updatedPages)}
						WHERE id = ${book.id}
					`;

					const revId = generateRevisionId();
					await tx`
						INSERT INTO public.wiki_revisions (
							id,
							"tableName",
							"rowId",
							action,
							label,
							before,
							after,
							"editorId",
							"editorName",
							"createdAt"
						) VALUES (
							${revId},
							'db_databooks',
							${String(book.id)},
							'update',
							${`${book.title} — Self-hosting des ${book.pages.length} planches`},
							${tx.json({ pages_count: book.pages.length, sample: book.pages.slice(0, 2) })},
							${tx.json({ pages_count: updatedPages.length, sample: updatedPages.slice(0, 2) })},
							'shenron-databooks-agent',
							'Shenron Databooks Ingestion Agent',
							NOW()
						)
					`;
				});
				console.log(`  ✓ Mis à jour en base et consigné dans wiki_revisions`);
			}
		}

		console.log(`\nBilan Étape 1 : ${total471Downloaded} téléchargées, ${total471Skipped} déjà présentes sur disque.`);

		// -------------------------------------------------------------
		// PARTIE 2 : Databook 1 (Daizenshuu 1 — Complete Illustrations)
		// -------------------------------------------------------------
		console.log(`\n--- Étape 2 : Databook 1 (Daizenshuu 1 Complete Illustrations) ---`);
		const [db1] = await sql<Array<{ id: number; title: string; pages: any[] }>>`
			SELECT id, title, pages
			FROM bot.db_databooks
			WHERE id = 1
		`;

		const cnVolPath = join(import.meta.dir, "..", "..", "..", "data", "dragonballcn", "volumes", "0-5-34-1.json");
		if (!existsSync(cnVolPath)) {
			throw new Error(`Fichier dragonballcn 0-5-34-1.json introuvable : ${cnVolPath}`);
		}
		const cnData = JSON.parse(readFileSync(cnVolPath, "utf-8"));
		const cnPages: Array<{ pageNumber: number; name: string; imageUrl: string }> = cnData.pages ?? [];

		console.log(`Databook 1 en base : ${db1.pages.length} entrées.`);
		console.log(`Inventaire DragonBallCN : ${cnPages.length} planches.`);

		const daizenshuuDir = join(RACINE_PLANCHES, "databooks", "daizenshuu-01");
		await mkdir(daizenshuuDir, { recursive: true });

		let db1Downloaded = 0;
		let db1Skipped = 0;
		const newDb1Pages: any[] = [];

		for (let i = 0; i < cnPages.length; i++) {
			const cnPage = cnPages[i]!;
			const pageNum = i + 1;
			const existingPage = db1.pages[i] ?? null;

			// Si la page existante a déjà une image locale vérifiée, on la préserve intégralement
			if (existingPage && existingPage.image && cheminPlanche(existingPage.image) && existsSync(cheminPlanche(existingPage.image)!)) {
				newDb1Pages.push(existingPage);
				db1Skipped++;
				continue;
			}

			// Sinon, on télécharge et on référence la planche dragonballcn
			const targetPath = join(daizenshuuDir, cnPage.name);
			const localRef = `./assets/wiki/databooks/daizenshuu-01/${cnPage.name}`;
			const httpsUrl = cnPage.imageUrl.replace(/^http:\/\//, "https://");

			const wasDownloaded = await downloadUrl(client, httpsUrl, targetPath);
			if (wasDownloaded) db1Downloaded++;
			else db1Skipped++;

			newDb1Pages.push({
				number: pageNum,
				image: localRef,
				text: existingPage?.text ?? null,
				text_fr: existingPage?.text_fr ?? null,
				text_fr_by: existingPage?.text_fr_by ?? undefined,
				text_fr_at: existingPage?.text_fr_at ?? undefined,
			});
		}

		console.log(`  Daizenshuu 1 : ${db1Downloaded} téléchargées, ${db1Skipped} préservées/existantes.`);

		if (!DRY_RUN) {
			await sql.begin(async (tx) => {
				await tx`
					UPDATE bot.db_databooks
					SET pages = ${tx.json(newDb1Pages)}
					WHERE id = 1
				`;

				const revId = generateRevisionId();
				await tx`
					INSERT INTO public.wiki_revisions (
						id,
						"tableName",
						"rowId",
						action,
						label,
						before,
						after,
						"editorId",
						"editorName",
						"createdAt"
					) VALUES (
						${revId},
						'db_databooks',
						'1',
						'update',
						${`Dragon Ball Daizenshuu 1 — Complétion des ${newDb1Pages.length} planches (self-hosted)`},
						${tx.json({ pages_count: db1.pages.length, with_images: db1.pages.filter((p: any) => p.image).length })},
						${tx.json({ pages_count: newDb1Pages.length, with_images: newDb1Pages.filter((p: any) => p.image).length })},
						'shenron-databooks-agent',
						'Shenron Databooks Ingestion Agent',
						NOW()
					)
				`;
			});
			console.log(`  ✓ Databook 1 mis à jour en base (${newDb1Pages.length} planches complétées)`);
		}

		console.log(`\n======================================================`);
		console.log(`✓ OPÉRATION TERMINÉE AVEC SUCCÈS`);
		console.log(`Total planches téléchargées : ${total471Downloaded + db1Downloaded}`);
		console.log(`Total planches traitées : ${471 + cnPages.length}`);
		console.log(`======================================================\n`);
	} finally {
		client.close();
		await sql.end();
	}
}

main().catch((err) => {
	console.error("✗ Échec de l'ingestion :", err);
	process.exit(1);
});
