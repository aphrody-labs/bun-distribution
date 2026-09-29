#!/usr/bin/env bun
/**
 * Répare les épisodes de *Dragon Ball DAIMA*, dont la couche japonaise décrit
 * un AUTRE anime.
 *
 * CE QUI S'EST PASSÉ
 * ------------------
 * `apps/bot/scripts/ingest/ingest-jikan.ts` interroge MyAnimeList par
 * identifiant. Celui écrit pour DAIMA, **54900, est celui de *Wind Breaker***
 * (série de printemps 2024). Nos épisodes 1 à 13 ont donc reçu les titres
 * japonais, les rōmaji et les dates de diffusion de cette série : `サクラとフウリン`
 * (« Sakura et le carillon »), `梅宮の流儀` (« la manière d'Umemiya » — un
 * personnage de Wind Breaker), diffusés d'avril à juin 2024. Le titre FRANÇAIS,
 * lui, est juste : seule la couche japonaise est contaminée.
 *
 * Les épisodes 14 à 20 sont indemnes (`タブー`, `サードアイ`, `デゲス`…) : ils ont
 * été saisis autrement. Ce script les laisse donc tranquilles — et s'en sert
 * comme témoin, voir plus bas.
 *
 * Trois autres identifiants du même script sont faux (mesuré le 2026-09-04) :
 * DBZ_KAI pointait le film *K-On!*, DBGT et DBZ_KAI_FINAL rendaient 404. Ils
 * sont corrigés dans `ingest-jikan.ts` ; ce script-ci ne traite que DAIMA,
 * seule série dont les données fausses ont réellement atterri en base.
 *
 * LA SOURCE
 * ---------
 * L'article `ドラゴンボールDAIMA` de Wikipédia en japonais (API MediaWiki,
 * CC BY-SA), section 各話リスト, modèle `エピソードリスト/base`. On n'en tire que
 * des faits : numéro d'épisode, sous-titre, date de première diffusion.
 *
 * LE RŌMAJI EST CALCULÉ, ET LE CALCUL EST PROUVÉ AVANT D'ÊTRE UTILISÉ
 * ------------------------------------------------------------------
 * Les titres de DAIMA sont en katakana pur, ce qui rend la translittération
 * mécanique. Mais une translittération qu'on ne vérifie pas est une invention
 * comme une autre : le script commence donc par retranslittérer les SEPT
 * titres sains déjà en base (`タブー`→`Tabū`, `サードアイ`→`Sādoai`, `ゴマー`→`Gomā`…)
 * et **refuse de continuer** si un seul ne retombe pas exactement sur le rōmaji
 * qui y figure. Un titre contenant un kanji ne reçoit aucun rōmaji — on laisse
 * vide plutôt que de deviner.
 *
 * SIMULATION PAR DÉFAUT. Chaque écriture passe par `public.wiki_revisions`.
 *
 * Usage :
 *   bun scripts/corrige-episodes-daima.ts
 *   bun scripts/corrige-episodes-daima.ts --appliquer
 */
import { join } from "node:path";
import postgres from "postgres";
import { SITE_URL } from "../src/lib/config";

const args = process.argv.slice(2);
const flag = (nom: string) => args.includes(`--${nom}`);
const APPLIQUER = flag("appliquer");
const AGENT = `${new URL(SITE_URL).host}-wiki/1.0 (metadonnees d'episodes; +${SITE_URL})`;
const PAGE = "ドラゴンボールDAIMA";

// ------------------------------------------------------------- translittération

/** Kana de base. Les digrammes (キャ…) se traitent par composition, plus bas. */
const KANA: Record<string, string> = {
	ア: "a",
	イ: "i",
	ウ: "u",
	エ: "e",
	オ: "o",
	カ: "ka",
	キ: "ki",
	ク: "ku",
	ケ: "ke",
	コ: "ko",
	ガ: "ga",
	ギ: "gi",
	グ: "gu",
	ゲ: "ge",
	ゴ: "go",
	サ: "sa",
	シ: "shi",
	ス: "su",
	セ: "se",
	ソ: "so",
	ザ: "za",
	ジ: "ji",
	ズ: "zu",
	ゼ: "ze",
	ゾ: "zo",
	タ: "ta",
	チ: "chi",
	ツ: "tsu",
	テ: "te",
	ト: "to",
	ダ: "da",
	ヂ: "ji",
	ヅ: "zu",
	デ: "de",
	ド: "do",
	ナ: "na",
	ニ: "ni",
	ヌ: "nu",
	ネ: "ne",
	ノ: "no",
	ハ: "ha",
	ヒ: "hi",
	フ: "fu",
	ヘ: "he",
	ホ: "ho",
	バ: "ba",
	ビ: "bi",
	ブ: "bu",
	ベ: "be",
	ボ: "bo",
	パ: "pa",
	ピ: "pi",
	プ: "pu",
	ペ: "pe",
	ポ: "po",
	マ: "ma",
	ミ: "mi",
	ム: "mu",
	メ: "me",
	モ: "mo",
	ヤ: "ya",
	ユ: "yu",
	ヨ: "yo",
	ラ: "ra",
	リ: "ri",
	ル: "ru",
	レ: "re",
	ロ: "ro",
	ワ: "wa",
	ヰ: "i",
	ヱ: "e",
	ヲ: "o",
	ン: "n",
	ヴ: "vu",
	ー: "",
	ッ: "",
};
const PETITS: Record<string, string> = {
	ャ: "ya",
	ュ: "yu",
	ョ: "yo",
	ァ: "a",
	ィ: "i",
	ゥ: "u",
	ェ: "e",
	ォ: "o",
};
const MACRON: Record<string, string> = { a: "ā", i: "ī", u: "ū", e: "ē", o: "ō" };

const KATAKANA_SEUL = /^[゠-ヿ　\s・=＝\-–—!！?？♪、。「」]+$/;

/**
 * Katakana → Hepburn avec macrons. Rend `null` sur tout ce qui n'est pas du
 * katakana : un titre à kanji se translittère avec un dictionnaire, pas avec
 * une table, et une lecture plausible serait une invention.
 */
function romaji(titre: string): string | null {
	if (!KATAKANA_SEUL.test(titre)) return null;
	let out = "";
	const c = [...titre];
	for (let i = 0; i < c.length; i++) {
		const k = c[i]!;
		if (k === "ー") {
			// Allongement : macron sur la voyelle qui précède.
			const derniere = out.at(-1);
			if (derniere && MACRON[derniere]) out = out.slice(0, -1) + MACRON[derniere];
			continue;
		}
		if (k === "ッ") {
			// Gémination : on double la consonne de la more suivante.
			const suivante = c[i + 1] ? KANA[c[i + 1]!] : undefined;
			if (suivante) out += suivante[0];
			continue;
		}
		if (PETITS[k]) {
			const petit = PETITS[k]!;
			// Digramme. En Hepburn, `シ`/`チ`/`ジ` absorbent le `y` : シャ = sha, pas
			// « shya » — piège que les témoins de DAIMA ne couvraient pas (aucun
			// d'eux n'a de digramme), d'où cette règle écrite à part.
			const sifflante = ["shi", "chi", "ji"].find((s) => out.endsWith(s));
			if (sifflante && /^y[auo]$/.test(petit)) {
				out = out.slice(0, -1) + petit.slice(1);
			} else if (out.endsWith("i")) {
				out = out.slice(0, -1) + petit;
			} else {
				out += petit;
			}
			continue;
		}
		const base = KANA[k];
		if (base === undefined) {
			if (/\s|・|=|＝/.test(k)) {
				out += " ";
				continue;
			}
			if (/[!！?？♪]/.test(k)) {
				out += k;
				continue;
			}
			return null; // signe inconnu : on préfère ne rien poser.
		}
		// `オ`+`ウ` et `ウ`+`ウ` notent aussi un allongement (インボウ → Inbō).
		if (k === "ウ" && (out.endsWith("o") || out.endsWith("u"))) {
			const derniere = out.at(-1)!;
			out = out.slice(0, -1) + MACRON[derniere];
			continue;
		}
		out += base;
	}
	const propre = out.trim().replace(/\s+/g, " ");
	if (!propre) return null;
	return propre.charAt(0).toUpperCase() + propre.slice(1);
}

// -------------------------------------------------------------------- la source

async function wikitexte(page: string): Promise<string> {
	const url = `https://ja.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json&formatversion=2`;
	const proc = Bun.spawn(["curl", "-sS", "-m", "40", "-A", AGENT, "--compressed", url], {
		stdout: "pipe",
		stderr: "ignore",
	});
	const texte = await new Response(proc.stdout).text();
	await proc.exited;
	return (JSON.parse(texte) as { parse?: { wikitext?: string } }).parse?.wikitext ?? "";
}

type Episode = { n: number; titreJa: string; date: string | null };

/** Retire les modèles et le balisage wiki d'une valeur de champ. */
function nettoie(valeur: string): string {
	return valeur
		.replace(/\{\{(?:nobr|small)\|([^}]*)\}\}/g, "$1")
		.replace(/\{\{[^}]*\}\}/g, "")
		.replace(/'''?/g, "")
		.replace(/<br\s*\/?>/gi, " ")
		.replace(/<[^>]+>/g, "")
		.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
		.trim();
}

function episodes(wiki: string): Episode[] {
	const out: Episode[] = [];
	let annee = "";
	for (const m of wiki.matchAll(/\{\{エピソードリスト\/base\n([\s\S]*?)\n\}\}/g)) {
		const bloc = m[1]!;
		const champ = (nom: string) =>
			bloc.match(new RegExp(`\\|\\s*${nom}\\s*=\\s*([^\\n]*)`))?.[1] ?? "";
		const numero = nettoie(champ("Number")).match(/(\d+)/)?.[1];
		const titreJa = nettoie(champ("Title"));
		if (!numero || !titreJa) continue;
		// L'année n'est répétée que lorsqu'elle change : on retient la dernière vue.
		const brut = nettoie(champ("Aux6"));
		const an = brut.match(/(\d{4})年/)?.[1];
		if (an) annee = an;
		const jour = brut.match(/(\d{1,2})月\s*(\d{1,2})日/);
		out.push({
			n: Number(numero),
			titreJa,
			date:
				annee && jour ? `${annee}-${jour[1]!.padStart(2, "0")}-${jour[2]!.padStart(2, "0")}` : null,
		});
	}
	return out;
}

// ------------------------------------------------------------------------ base

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

const source = episodes(await wikitexte(PAGE));
console.log(`${source.length} épisode(s) relevé(s) sur ja.wikipedia.\n`);
if (!source.length) {
	console.error("✗ aucun épisode extrait — la structure de l'article a changé.");
	process.exit(1);
}

const sql = postgres(await urlBase(), { max: 2, prepare: false });
try {
	const enBase = await sql<
		{
			id: string;
			number_in_series: string;
			title: string;
			title_ja: string | null;
			title_romaji: string | null;
			air_date: string | null;
		}[]
	>`
		SELECT id, number_in_series, title, title_ja, title_romaji, air_date
		FROM bot.db_episodes WHERE series = 'DB_DAIMA' ORDER BY number_in_series`;
	const parNumero = new Map(enBase.map((e) => [Number(e.number_in_series), e]));

	// ---- Le témoin : la translittération doit reproduire les rōmaji déjà sains.
	const temoins = enBase.filter(
		(e) =>
			e.title_ja &&
			e.title_romaji &&
			source.some((s) => s.n === Number(e.number_in_series) && s.titreJa === e.title_ja)
	);
	const ecarts = temoins.filter((e) => romaji(e.title_ja!) !== e.title_romaji);
	console.log(
		`Témoins de translittération : ${temoins.length - ecarts.length}/${temoins.length} reproduits à l'identique.`
	);
	for (const e of ecarts)
		console.log(
			`  ✗ ${e.title_ja} → « ${romaji(e.title_ja!)} » alors que la base dit « ${e.title_romaji} »`
		);
	if (temoins.length < 5) {
		console.error("✗ trop peu de témoins pour valider la translittération — arrêt.");
		process.exit(1);
	}
	if (ecarts.length) {
		console.error(
			"✗ la translittération ne reproduit pas les témoins — arrêt avant toute écriture."
		);
		process.exit(1);
	}

	let corriges = 0;
	for (const s of source) {
		const ligne = parNumero.get(s.n);
		if (!ligne) {
			console.log(`  ⊘ épisode ${s.n} absent de la base`);
			continue;
		}
		const dateSec = s.date ? Math.floor(Date.parse(`${s.date}T00:00:00Z`) / 1000) : null;
		const rom = romaji(s.titreJa);
		const avant = {
			title_ja: ligne.title_ja,
			title_romaji: ligne.title_romaji,
			air_date: ligne.air_date ? Number(ligne.air_date) : null,
		};
		const apres = { title_ja: s.titreJa, title_romaji: rom, air_date: dateSec ?? avant.air_date };
		if (JSON.stringify(avant) === JSON.stringify(apres)) continue;

		console.log(
			`  ${String(s.n).padStart(2)} « ${ligne.title} »\n     ja      : ${avant.title_ja ?? "∅"}  →  ${apres.title_ja}\n     rōmaji  : ${avant.title_romaji ?? "∅"}  →  ${apres.title_romaji ?? "∅"}\n     diffusé : ${avant.air_date ? new Date(avant.air_date * 1000).toISOString().slice(0, 10) : "∅"}  →  ${s.date ?? "inchangé"}`
		);
		corriges++;
		if (!APPLIQUER) continue;

		await sql.begin(async (tx) => {
			await tx`UPDATE bot.db_episodes SET title_ja = ${apres.title_ja}, title_romaji = ${apres.title_romaji}, air_date = ${apres.air_date} WHERE id = ${Number(ligne.id)}`;
			await tx`INSERT INTO public.wiki_revisions ${tx({
				id: idRevision(),
				tableName: "db_episodes",
				rowId: String(ligne.id),
				action: "update",
				label: `DAIMA ${s.n} — ${ligne.title}`,
				before: tx.json(avant),
				after: tx.json(apres),
				editorId: "agent",
				editorName: "Script corrige-episodes-daima (ja.wikipedia, CC BY-SA)",
			})}`;
		});
	}

	console.log(
		APPLIQUER
			? `\n✔ ${corriges} épisode(s) corrigé(s) et versionné(s).`
			: `\n${corriges} épisode(s) à corriger.\n(simulation — relancer avec --appliquer)`
	);
} catch (e) {
	console.error("✗", e instanceof Error ? e.message : e);
	process.exitCode = 1;
} finally {
	await sql.end();
}
