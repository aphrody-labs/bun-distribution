#!/usr/bin/env bun
/**
 * `bot.db_characters.name_ja` qui contient du japonais ET du bruit.
 *
 * À NE PAS CONFONDRE avec `corrige-name-ja-fautifs.ts`, qui traite les 10
 * fiches où le champ ne contient **aucun** japonais (rōmaji seul, coréen, nom
 * de comédien de doublage). Ici, le japonais est bon : c'est ce qui l'entoure
 * qui ne devrait pas être là.
 *
 * Mesuré le 2026-09-04 sur les 777 fiches renseignées, **87 sont bruitées**.
 * Quatre familles se réparent sans rien deviner :
 *
 *   1. **Rōmaji collé par une virgule** (55) — `占いババ, Uranai Baba`. La partie
 *      japonaise est à gauche, le rōmaji à droite, et `name_romaji` existe
 *      précisément pour l'accueillir. Ce rōmaji est ATTESTÉ (il vient de la
 *      même source que le japonais), donc il est déposé — mais **jamais par
 *      dessus une valeur existante** : la colonne `name_romaji` est un
 *      fourre-tout où cohabitent des noms de doublage (`Basil aux coups de
 *      pied`, `Beelzébubu (Glénat Manga)`) qu'on n'a pas à écraser.
 *   2. **Rōmaji entre parenthèses** (`ブヨン (Buyon)`) ou séparé par une espace
 *      (`未来のビルス Mirai no Birusu`) — même traitement.
 *   3. **Point médian latin** (3) — `ミスター·ポポ` porte U+00B7 là où le japonais
 *      écrit `・` (U+30FB). Piège déjà documenté dans le CLAUDE.md du projet :
 *      il fait échouer tout appariement avec le lexique.
 *   4. **Tiret ASCII** (1) — `セ-ル` pour `セル` (Cell).
 *
 * CE QUI N'EST PAS TOUCHÉ, ET POURQUOI
 * ------------------------------------
 * `Dr.ライチー`, `Dr. ロタ`, `EX ゴジータ`, `ＯＧ73Ⅰ` **ne sont pas fautifs** : ces
 * noms s'écrivent réellement ainsi en japonais, le latin y est un préfixe du
 * nom et non un rōmaji ajouté. La règle ne coupe donc qu'un SUFFIXE entièrement
 * latin, jamais un préfixe. De même, `ガーリック・Ｊｒジュニア` est un ruby aplati
 * (le furigana ジュニア collé à `Jr`) : le démêler demande de savoir ce que la
 * source affichait, donc il est listé et laissé en place.
 *
 * GARDE-FOU : une valeur réparée qui ne contiendrait plus de kana ni de kanji,
 * ou qui garderait des lettres latines, est refusée — on préfère laisser le
 * bruit que fabriquer une graphie qui n'existe pas.
 *
 * SIMULATION PAR DÉFAUT. Une révision `public.wiki_revisions` par écriture.
 *
 * Usage :
 *   bun scripts/repare-name-ja-bruite.ts
 *   bun scripts/repare-name-ja-bruite.ts --appliquer
 */
import { join } from "node:path";
import postgres from "postgres";

const args = new Set(process.argv.slice(2));
const flag = (nom: string) => args.has(`--${nom}`);
const APPLIQUER = flag("appliquer");

const JAPONAIS = /[ぁ-ゟ゠-ヿ一-鿿]/;
const LATIN = /[A-Za-zÀ-ÿĀ-ſ]/;

type Reparation = { valeur: string; romaji: string | null; motif: string };

/**
 * Rend la graphie japonaise nettoyée et, quand le bruit était un rōmaji, ce
 * rōmaji. Rend `null` quand rien de sûr ne peut être fait.
 */
function reparer(brut: string): Reparation | null {
	const ja = brut.trim();

	// 1 & 2 — un SUFFIXE entièrement latin, introduit par une virgule, une
	// parenthèse ou une espace. Le préfixe latin (`Dr.`, `EX`) est préservé.
	for (const motif of [
		{ re: /^(.*?[ぁ-ゟ゠-ヿ一-鿿].*?)\s*,\s*([^,]+)$/, nom: "rōmaji après une virgule" },
		{
			re: /^(.*?[ぁ-ゟ゠-ヿ一-鿿].*?)\s*[（(]\s*([^)）]+)\s*[)）]\s*$/,
			nom: "rōmaji entre parenthèses",
		},
		{
			re: /^(.*?[ぁ-ゟ゠-ヿ一-鿿])\s+([A-Za-zÀ-ÿĀ-ſ][A-Za-zÀ-ÿĀ-ſ'’\s.-]*)$/,
			nom: "rōmaji après une espace",
		},
	]) {
		const m = ja.match(motif.re);
		if (!m) continue;
		const gauche = m[1]!.trim();
		const droite = m[2]!.trim();
		// La droite doit être du rōmaji : du latin, et pas de japonais.
		if (!LATIN.test(droite) || JAPONAIS.test(droite)) continue;
		if (!JAPONAIS.test(gauche) || LATIN.test(gauche)) continue;
		return { valeur: gauche, romaji: droite, motif: motif.nom };
	}

	// 3 — point médian latin (U+00B7) ou puce (U+2022) au lieu de U+30FB.
	if (/[·•]/.test(ja)) {
		return { valeur: ja.replace(/[·•]/g, "・"), romaji: null, motif: "point médian latin → ・" };
	}

	// 4 — tiret ASCII parasite au milieu du katakana.
	if (/[ぁ-ゟ゠-ヿ][-‐‑][ぁ-ゟ゠-ヿ]/.test(ja)) {
		return {
			valeur: ja.replace(/([ぁ-ゟ゠-ヿ])[-‐‑]([ぁ-ゟ゠-ヿ])/g, "$1$2"),
			romaji: null,
			motif: "tiret ASCII retiré",
		};
	}

	return null;
}

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	const lignes = texte.split("\n").filter((l) => l.startsWith("DATABASE_URL="));
	const valeur = lignes
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!valeur) {
		console.error("✗ DATABASE_URL introuvable.");
		process.exit(1);
	}
	return valeur;
}

const idRevision = () =>
	Array.from(
		{ length: 24 },
		() => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]
	).join("");

const sql = postgres(await urlBase(), { max: 2, prepare: false });
try {
	const lignes = await sql<
		{ id: string; name: string; name_ja: string; name_romaji: string | null }[]
	>`
		SELECT id, name, name_ja, name_romaji FROM bot.db_characters
		WHERE name_ja IS NOT NULL AND btrim(name_ja) <> '' ORDER BY id`;

	const parMotif: Record<string, number> = {};
	const laissees: { id: string; name: string; ja: string }[] = [];
	let reparees = 0;
	let romajiPoses = 0;

	for (const l of lignes) {
		const r = reparer(l.name_ja);
		if (!r) {
			// Bruité mais non réparable sûrement : on le liste pour arbitrage.
			if (LATIN.test(l.name_ja) && JAPONAIS.test(l.name_ja))
				laissees.push({ id: l.id, name: l.name, ja: l.name_ja });
			continue;
		}
		// Garde-fou : le résultat doit être du japonais, et rien que du japonais.
		if (!JAPONAIS.test(r.valeur) || LATIN.test(r.valeur)) {
			laissees.push({ id: l.id, name: l.name, ja: l.name_ja });
			continue;
		}
		if (r.valeur === l.name_ja && !r.romaji) continue;

		const poseRomaji = r.romaji !== null && (l.name_romaji === null || l.name_romaji.trim() === "");
		parMotif[r.motif] = (parMotif[r.motif] ?? 0) + 1;
		reparees++;
		if (poseRomaji) romajiPoses++;

		console.log(
			`  ${String(l.id).padStart(4)} ${l.name.slice(0, 24).padEnd(24)} « ${l.name_ja} » → « ${r.valeur} »${
				poseRomaji
					? `  + rōmaji « ${r.romaji} »`
					: r.romaji
						? `  (rōmaji « ${r.romaji} » ignoré : ${l.name_romaji} déjà en place)`
						: ""
			}`
		);
		if (!APPLIQUER) continue;

		const avant = { name_ja: l.name_ja, ...(poseRomaji ? { name_romaji: l.name_romaji } : {}) };
		const apres = { name_ja: r.valeur, ...(poseRomaji ? { name_romaji: r.romaji } : {}) };
		await sql.begin(async (tx) => {
			if (poseRomaji) {
				await tx`UPDATE bot.db_characters SET name_ja = ${r.valeur}, name_romaji = ${r.romaji} WHERE id = ${Number(l.id)}`;
			} else {
				await tx`UPDATE bot.db_characters SET name_ja = ${r.valeur} WHERE id = ${Number(l.id)}`;
			}
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: idRevision(),
				tableName: "db_characters",
				rowId: String(l.id),
				action: "update",
				label: l.name,
				before: tx.json(avant),
				after: tx.json(apres),
				editorId: "agent",
				editorName: "Script repare-name-ja-bruite (nettoyage mécanique)",
			})}`;
		});
	}

	console.log(`\nPar motif :`);
	for (const [m, n] of Object.entries(parMotif).toSorted((a, b) => b[1] - a[1]))
		console.log(`  ${String(n).padStart(3)}  ${m}`);
	if (laissees.length) {
		console.log(`\n${laissees.length} fiche(s) bruitée(s) LAISSÉES EN PLACE (arbitrage humain) :`);
		for (const l of laissees)
			console.log(`  ${String(l.id).padStart(4)} ${l.name.slice(0, 24).padEnd(24)} « ${l.ja} »`);
	}
	console.log(
		APPLIQUER
			? `\n✔ ${reparees} graphie(s) nettoyée(s), dont ${romajiPoses} rōmaji attesté(s) récupéré(s). Le tout versionné.`
			: `\n${reparees} graphie(s) à nettoyer, dont ${romajiPoses} rōmaji à récupérer.\n(simulation — relancer avec --appliquer)`
	);
} catch (e) {
	console.error("✗", e instanceof Error ? e.message : e);
	process.exitCode = 1;
} finally {
	await sql.end();
}
