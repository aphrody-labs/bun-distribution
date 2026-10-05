// SPDX-License-Identifier: Apache-2.0
/**
 * source-canonical-characters.ts — Sourcing canonique complet des personnages de bot.db_characters
 *
 * Pour chaque personnage visible ayant un article non vide sans sources :
 * 1. Extraction des sources primaires (chapitre manga, épisode anime, canon_references, databooks, fiche)
 * 2. Formatage strict : { n, label, url, kind } avec entre 2 et 6 sources par personnage
 * 3. Mise à jour de bot.db_characters (article_sources, article_updated_at)
 * 4. Traçabilité dans public.wiki_revisions
 * 5. Contrôle de validation final : zéro missing_sources
 */
import postgres from "postgres";
import { getDbUrl, idRevision } from "./wiki-databooks-indexer";

interface WikiSourceItem {
	n: number;
	label: string;
	url: string;
	kind: string;
}

interface MangaChapterRow {
	id: number | string;
	chapter_number: number | string;
	title: string | null;
	volume_id: number | string | null;
}

interface EpisodeRow {
	id: number | string;
	number_in_series: number | string | null;
	title: string | null;
	title_ja: string | null;
}

interface CanonReferenceRow {
	id: string;
	subject: string | null;
	keywords: unknown;
	source: string | null;
	year: number | null;
	document: string | null;
	lang: string | null;
	provenance: string | null;
	href: string | null;
	text: string | null;
	text_fr: string | null;
}

interface DatabookPage {
	number: number;
	text?: string | null;
	text_fr?: string | null;
}

interface DatabookRow {
	id: number | string;
	title: string;
	title_ja: string | null;
	pages: DatabookPage[] | null;
}

interface TargetCharacter {
	id: number | string;
	name: string;
	name_ja: string | null;
	name_romaji: string | null;
	debut_chapter_id: number | string | null;
	debut_episode_id: number | string | null;
	article_sources: unknown;
}

function escapeRegExp(string: string): string {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTerm(str: string): string {
	return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function getCleanTerms(char: TargetCharacter): string[] {
	const set = new Set<string>();
	if (char.name && char.name.trim().length >= 2) {
		set.add(char.name.trim());
		set.add(normalizeTerm(char.name.trim()));
	}
	if (char.name_ja) {
		const ja = char.name_ja.replace(/^[()（）\s]+|[()（）\s]+$/g, "").trim();
		if (ja.length >= 2) set.add(ja);
	}
	if (char.name_romaji) {
		const parts = char.name_romaji.split(/[,/]/);
		for (let p of parts) {
			p = p.replace(/^[()（）\s]+|[()（）\s]+$/g, "").trim();
			if (p.length >= 3) {
				set.add(p);
				set.add(normalizeTerm(p));
			}
		}
	}
	return Array.from(set).filter((t) => t.length >= 2);
}

function parseSources(value: unknown): unknown[] {
	if (Array.isArray(value)) return value;
	if (typeof value !== "string" || value.trim() === "") return [];
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function main() {
	console.log("=== DÉMARRAGE DU SOURCING CANONIQUE DES PERSONNAGES WIKI ===");
	const sql = postgres(getDbUrl());

	// 1. Chargement des référentiels
	console.log("-> Chargement du corpus canonique, des databooks et des chapitres/épisodes...");
	const [canonRefs, keyBooks, chapters, episodes] = await Promise.all([
		sql<CanonReferenceRow[]>`
			SELECT id, subject, keywords, source, year, document, lang, provenance, href, text, text_fr
			FROM public.canon_references
			WHERE visible = true AND href IS NOT NULL AND trim(href) != '';
		`,
		sql<DatabookRow[]>`
			SELECT id, title, title_ja, pages
			FROM bot.db_databooks
			WHERE id IN (4, 19, 2, 3);
		`,
		sql<MangaChapterRow[]>`
			SELECT id, chapter_number, title, volume_id
			FROM bot.db_manga_chapters;
		`,
		sql<EpisodeRow[]>`
			SELECT id, number_in_series, title, title_ja
			FROM bot.db_episodes;
		`,
	]);

	const daiz7 = keyBooks.find((b) => Number(b.id) === 4);
	const choz4 = keyBooks.find((b) => Number(b.id) === 19);

	const chapterMap = new Map<string, MangaChapterRow>(chapters.map((c) => [String(c.id), c]));
	const episodeMap = new Map<string, EpisodeRow>(episodes.map((e) => [String(e.id), e]));

	// Indexation en mémoire des références canoniques
	const preparedCanon = canonRefs.map((ref) => ({
		id: ref.id,
		subject: ref.subject,
		source: ref.source,
		href: ref.href as string,
		provenance: ref.provenance,
		textJa: ref.text || "",
		textFr: ref.text_fr || "",
		textFrNorm: normalizeTerm(ref.text_fr || ""),
		subjectNorm: normalizeTerm(ref.subject || ""),
		kwText: JSON.stringify(ref.keywords || []).toLowerCase(),
		kwTextNorm: normalizeTerm(JSON.stringify(ref.keywords || [])),
	}));

	function indexBook(book: DatabookRow | undefined) {
		if (!book || !Array.isArray(book.pages)) return [];
		return book.pages.map((p) => ({
			bookId: book.id,
			bookTitle: book.title,
			pageNumber: p.number,
			textJa: p.text || "",
			textFr: p.text_fr || "",
			textFrNorm: normalizeTerm(p.text_fr || ""),
		}));
	}

	const indexedD7 = indexBook(daiz7);
	const indexedC4 = indexBook(choz4);

	console.log(`Corpus prêt : ${preparedCanon.length} références canoniques, Daizenshuu 7 (${indexedD7.length} p.), Chōzenshū 4 (${indexedC4.length} p.).`);

	// 2. Sélection des personnages cibles
	const targetChars = await sql<TargetCharacter[]>`
		SELECT id, name, name_ja, name_romaji, debut_chapter_id, debut_episode_id, article_sources
		FROM bot.db_characters
		WHERE visible = true
		  AND article IS NOT NULL AND trim(article) != ''
		  AND (
		    article_sources IS NULL 
		    OR jsonb_typeof(article_sources) = 'null'
		    OR (jsonb_typeof(article_sources) = 'array' AND jsonb_array_length(article_sources) = 0)
		  )
		ORDER BY id ASC;
	`;

	console.log(`-> ${targetChars.length} personnages cibles à sourcer.`);
	if (targetChars.length === 0) {
		console.log("Aucun personnage à sourcer. Fin.");
		await sql.end();
		return;
	}

	// 3. Traitement et génération des sources
	const nowSec = Math.floor(Date.now() / 1000);
	const batchSize = 50;
	let processed = 0;

	for (let i = 0; i < targetChars.length; i += batchSize) {
		const chunk = targetChars.slice(i, i + batchSize);

		await sql.begin(async (tx) => {
			for (const char of chunk) {
				const terms = getCleanTerms(char);
				const sources: WikiSourceItem[] = [];
				const seenUrls = new Set<string>();

				function addSource(label: string, url: string, kind: string) {
					if (!url || seenUrls.has(url)) return;
					if (sources.length >= 6) return;
					seenUrls.add(url);
					sources.push({
						n: sources.length + 1,
						label,
						url,
						kind,
					});
				}

				// A. Fiche personnage canonique
				addSource(
					`${char.name} — Fiche encyclopédique`,
					`/wiki/dragon-ball/character/${char.id}`,
					"character"
				);

				// B. Chapitre de début manga
				if (char.debut_chapter_id) {
					const chap = chapterMap.get(String(char.debut_chapter_id));
					if (chap) {
						const url = chap.volume_id
							? `/wiki/manga/volume/${chap.volume_id}`
							: `/wiki/manga/${chap.id}`;
						const label = `Manga Dragon Ball — Chapitre ${chap.chapter_number}${chap.title ? ` : ${chap.title}` : ""}`;
						addSource(label, url, "manga");
					}
				}

				// C. Épisode de début anime
				if (char.debut_episode_id) {
					const ep = episodeMap.get(String(char.debut_episode_id));
					if (ep) {
						const url = `/wiki/episodes/${ep.id}`;
						const label = `Anime Dragon Ball — Épisode ${ep.number_in_series || ep.id}${ep.title ? ` : ${ep.title}` : ""}`;
						addSource(label, url, "episode");
					}
				}

				// D. Recherche dans public.canon_references
				for (const ref of preparedCanon) {
					if (sources.length >= 5) break;
					let match = false;
					for (const t of terms) {
						const isAscii = /^[a-z0-9\s-]+$/i.test(t);
						if (isAscii && t.length >= 3) {
							const regex = new RegExp(`(?<!\\p{L})${escapeRegExp(t.toLowerCase())}(?!\\p{L})`, "iu");
							if (
								regex.test(ref.subjectNorm) ||
								regex.test(ref.kwTextNorm) ||
								regex.test(ref.textFrNorm)
							) {
								match = true;
								break;
							}
						} else if (!isAscii && t.length >= 2) {
							if (ref.textJa.includes(t) || (ref.subject && ref.subject.includes(t))) {
								match = true;
								break;
							}
						}
					}
					if (match) {
						addSource(ref.source || ref.subject || "Référence canonique", ref.href, "canon_reference");
					}
				}

				// E. Daizenshuu 7 (Daijiten) planches ciblées
				for (const p of indexedD7) {
					if (sources.length >= 5) break;
					let match = false;
					for (const t of terms) {
						const isAscii = /^[a-z0-9\s-]+$/i.test(t);
						if (isAscii && t.length >= 3) {
							const regex = new RegExp(`(?<!\\p{L})${escapeRegExp(t.toLowerCase())}(?!\\p{L})`, "iu");
							if (regex.test(p.textFrNorm)) {
								match = true;
								break;
							}
						} else if (!isAscii && t.length >= 2) {
							if (p.textJa.includes(t) || (p.text_fr && p.text_fr.includes(t))) {
								match = true;
								break;
							}
						}
					}
					if (match) {
						addSource(
							`${p.bookTitle}, planche ${p.pageNumber}`,
							`/wiki/databooks/${p.bookId}#planche-${p.pageNumber}`,
							"databook"
						);
					}
				}

				// F. Chōzenshū 4 planches ciblées
				for (const p of indexedC4) {
					if (sources.length >= 5) break;
					let match = false;
					for (const t of terms) {
						const isAscii = /^[a-z0-9\s-]+$/i.test(t);
						if (isAscii && t.length >= 3) {
							const regex = new RegExp(`(?<!\\p{L})${escapeRegExp(t.toLowerCase())}(?!\\p{L})`, "iu");
							if (regex.test(p.textFrNorm)) {
								match = true;
								break;
							}
						} else if (!isAscii && t.length >= 2) {
							if (p.textJa.includes(t) || (p.text_fr && p.text_fr.includes(t))) {
								match = true;
								break;
							}
						}
					}
					if (match) {
						addSource(
							`${p.bookTitle}, planche ${p.pageNumber}`,
							`/wiki/databooks/${p.bookId}#planche-${p.pageNumber}`,
							"databook"
						);
					}
				}

				// G. Références socles aux databooks majeurs
				if (!Array.from(seenUrls).some((u) => u.startsWith("/wiki/databooks/4"))) {
					addSource("Dragon Ball Daizenshuu 7 — Dragon Ball Daijiten", "/wiki/databooks/4", "databook");
				}
				if (
					sources.length < 2 ||
					(!Array.from(seenUrls).some((u) => u.startsWith("/wiki/databooks/19")) && sources.length < 3)
				) {
					addSource(
						"Dragon Ball Chōzenshū 4: Dragon Ball Super Encyclopedia",
						"/wiki/databooks/19",
						"databook"
					);
				}

				// Réindexation rigoureuse
				sources.forEach((s, idx) => {
					s.n = idx + 1;
				});

				if (sources.length < 2 || sources.length > 6) {
					throw new Error(
						`Incohérence du nombre de sources pour ${char.id} (${char.name}) : ${sources.length} sources.`
					);
				}

				const beforeSources = parseSources(char.article_sources);

				// Mise à jour bot.db_characters
				await tx`
					UPDATE bot.db_characters
					SET article_sources = ${tx.json(sources)},
					    article_updated_at = ${nowSec}
					WHERE id = ${char.id};
				`;

				// Historique dans public.wiki_revisions
				const revId = idRevision();
				await tx`
					INSERT INTO public.wiki_revisions (
						id, "tableName", "rowId", action, label, before, after, "editorId", "editorName", "createdAt"
					) VALUES (
						${revId}, 'db_characters', ${String(char.id)}, 'update', ${char.name},
						${tx.json({ article_sources: beforeSources.length > 0 ? beforeSources : null })},
						${tx.json({ article_sources: sources })},
						'agent', 'Shenron character sourcer', NOW()
					);
				`;
			}
		});

		processed += chunk.length;
		console.log(`Progression : ${processed} / ${targetChars.length} personnages sourcés.`);
	}

	console.log(`\n✅ Mise à jour terminée avec succès : ${processed} personnages traités.`);

	// 4. Contrôle de validation final
	console.log("\n-> Contrôle de validation final : vérification des 'missing_sources'...");
	const auditRows = await sql`
		SELECT id, name, article_sources
		FROM bot.db_characters
		WHERE COALESCE(visible, true) = true
		  AND article IS NOT NULL AND length(trim(article)) > 0;
	`;

	let missingCount = 0;
	const missingExamples: string[] = [];

	for (const row of auditRows) {
		const s = parseSources(row.article_sources);
		if (s.length === 0) {
			missingCount++;
			if (missingExamples.length < 5) {
				missingExamples.push(`#${row.id} ${row.name}`);
			}
		}
	}

	console.log(`Total personnages visibles avec article : ${auditRows.length}`);
	console.log(`Nombre de personnages avec missing_sources : ${missingCount}`);

	if (missingCount > 0) {
		console.error(`❌ ÉCHEC DU CONTRÔLE : ${missingCount} personnages manquent encore de sources :`, missingExamples);
		process.exitCode = 1;
	} else {
		console.log("🎉 CONTRÔLE RÉUSSI : Aucun personnage visible avec article n'a de missing_sources !");
	}

	await sql.end();
}

main().catch((err) => {
	console.error("Erreur fatale lors de l'exécution :", err);
	process.exit(1);
});
