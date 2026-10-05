#!/usr/bin/env bun
/**
 * Traduction française des citations d'auteur de `/wiki/canon`.
 *
 * Les guides Shueisha nous arrivent traduits en anglais par Kanzenshuu ; le site
 * est français. Une citation affichée en anglais reste une preuve, mais elle
 * n'est lue par presque personne. Ce script organise leur passage en français
 * **sans jamais effacer l'original** : `text` reste, `textFr` s'ajoute, la page
 * publique montre les deux (même règle que les planches de databooks).
 *
 * Il ne traduit pas lui-même : il sort le lot à traduire, puis relit et
 * enregistre ce qu'on lui rend. C'est délibéré — une traduction automatique
 * généraliste rend `Kaiô-ken` par « le poing du roi » et `Freeza` par « Freeza »
 * là où le wiki écrit « Freezer ». Le contrôle ci-dessous refuse ces rendus.
 *
 * Usage :
 *   bun scripts/canon-traduit-citations.ts --sortir /tmp/lot.json [--lot 12]
 *   bun scripts/canon-traduit-citations.ts --entrer /tmp/lot-fr.json --appliquer
 *   bun scripts/canon-traduit-citations.ts --etat
 *
 * Le fichier rendu est un tableau `[{ "id": "…", "textFr": "…" }]`. Reprendre le
 * travail est sans risque : une citation déjà traduite ne ressort plus du
 * `--sortir`, exactement comme le curseur de la traduction des databooks.
 */
import postgres from "postgres";
import { join } from "node:path";
import type { CanonReference } from "../src/lib/canon-engine";

const args = process.argv.slice(2);
const valeur = (drapeau: string) => {
	const i = args.indexOf(drapeau);
	return i === -1 ? null : (args[i + 1] ?? null);
};
const APPLIQUER = args.includes("--appliquer");
const SORTIR = valeur("--sortir");
/**
 * La mémoire de traduction versionnée.
 *
 * Le corpus `.aphrody` vit hors du dépôt, mais les traductions sont notre
 * travail : les laisser dans la seule base, c'est les perdre au premier
 * `CanonConfig` réinitialisé. Ce fichier les conserve, se relit sans corpus et
 * se relit à froid — `--entrer` sans argument repart de lui.
 */
const MEMOIRE = join(import.meta.dir, "inventaires", "canon-citations-fr.json");
const ENTRER = args.includes("--entrer") ? (valeur("--entrer") ?? MEMOIRE) : null;
const LOT = Number(valeur("--lot") ?? "0") || 0;

/**
 * Les rendus que le wiki refuse, avec la forme qu'il écrit.
 *
 * Tirés des graphies réelles de `bot.db_characters`, `db_races` et
 * `db_techniques` : ce ne sont pas des préférences de style, c'est le nom sous
 * lequel la fiche existe sur le site. Une traduction qui écrit « Freeza » envoie
 * le lecteur chercher une page qui n'existe pas.
 */
const GLOSSAIRE: { faux: RegExp; correct: string }[] = [
	{ faux: /\bFreeza\b/g, correct: "Freezer" },
	{ faux: /\bFrieza\b/g, correct: "Freezer" },
	{ faux: /\bKuririn\b/gi, correct: "Krilin" },
	{ faux: /\bKrillin\b/gi, correct: "Krilin" },
	{ faux: /\bTenshinhan\b/g, correct: "Tenshinhan" },
	{ faux: /\bTien\b/g, correct: "Tenshinhan" },
	{ faux: /\bpoing du roi\b/gi, correct: "Kaiôken" },
	{ faux: /\bKaio-?ken\b/g, correct: "Kaioken" },
	{ faux: /\bboule d[’']énergie\b/gi, correct: "Genkidama" },
	{ faux: /\bvague déferlante de la tortue\b/gi, correct: "Kamehameha" },
	{ faux: /\bSaiya-?jin\b/gi, correct: "Saiyan" },
	{ faux: /\bSaiyen\b/gi, correct: "Saiyan" },
	{ faux: /\bNamekian\b/gi, correct: "Namékien" },
	{ faux: /\bMajin Buu\b/g, correct: "Majin Boo" },
	{ faux: /\bMr\.? Hercule\b/gi, correct: "Mr. Satan" },
	{ faux: /\bSon Gokou\b/gi, correct: "Son Goku" },
	{ faux: /\bDragon Balls\b/g, correct: "Dragon Balls (invariable : « les Dragon Ball »)" },
];

/** Les mots anglais qui trahissent une phrase non traduite. */
const ANGLAIS = /\b(the|and|with|that|which|would|because|about|there|their|it’s|don’t)\b/gi;

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	const texte = await Bun.file(join(import.meta.dir, "..", ".env"))
		.text()
		.catch(() => "");
	// La DERNIÈRE : `.env` porte l'ancienne URL Neon en commentaire AVANT la locale.
	const url = texte
		.split("\n")
		.filter((l) => l.startsWith("DATABASE_URL="))
		.at(-1)
		?.slice("DATABASE_URL=".length)
		.trim()
		.replace(/^["']|["']$/g, "");
	if (!url) {
		console.error("✗ DATABASE_URL introuvable.");
		process.exit(1);
	}
	return url;
}

const sql = postgres(await urlBase(), { max: 2, prepare: false });

// Les citations vivent dans `public.canon_references` (alimentée par
// `canon-ingest.ts`) ; on ne traduit que les déclarations d'auteur du corpus.
const lignes = (await sql`
	select id, subject, text, text_fr as "textFr", source, year, lang
	from public.canon_references
	where visible and provenance = 'aphrody'
	order by id
`) as unknown as Pick<CanonReference, "id" | "subject" | "text" | "textFr" | "source" | "year" | "lang">[];
const config = { references: lignes.map((r) => (Object.assign(r, { textFr: r.textFr ?? undefined }))) };

const aTraduire = config.references.filter((r) => r.lang !== "fr" && !r.textFr);
const traduites = config.references.filter((r) => r.lang !== "fr" && r.textFr);
const francaises = config.references.filter((r) => r.lang === "fr");

console.log(
	`\n${config.references.length} citations · ${francaises.length} déjà en français · ` +
		`${traduites.length} traduites · ${aTraduire.length} à traduire`
);

if (SORTIR) {
	const lot = LOT > 0 ? aTraduire.slice(0, LOT) : aTraduire;
	const charge = lot.map((r) => ({
		id: r.id,
		subject: r.subject,
		source: r.source,
		year: r.year ?? null,
		text: r.text,
		textFr: "",
	}));
	await Bun.write(SORTIR, `${JSON.stringify(charge, null, "\t")}\n`);
	console.log(`\n✓ ${lot.length} citations écrites dans ${SORTIR}`);
	console.log("  Remplir `textFr` puis relancer avec --entrer <fichier> --appliquer\n");
	await sql.end();
	process.exit(0);
}

if (!ENTRER) {
	if (aTraduire.length > 0) {
		console.log("\nÀ traduire :");
		for (const r of aTraduire.slice(0, 10)) {
			console.log(`  ${r.id} · ${r.source}`);
		}
		if (aTraduire.length > 10) console.log(`  … et ${aTraduire.length - 10} autres`);
	}
	console.log("");
	await sql.end();
	process.exit(0);
}

// ── Relecture d'un lot rendu ────────────────────────────────────────────────

const rendu = (await Bun.file(ENTRER).json()) as { id: string; textFr?: string }[];
const parId = new Map(config.references.map((r) => [r.id, r]));
const refus: string[] = [];
const acceptees = new Map<string, string>();

for (const item of rendu) {
	const reference = parId.get(item.id);
	// Les appels de note des guides (`<sup>11</sup>`) n'ont pas de note en face
	// sur notre page : ils s'afficheraient tels quels, en clair.
	const textFr = (item.textFr ?? "")
		.replace(/<sup\b[^>]*>[^<]*<\/sup>/gi, "")
		.replace(/<\/?[a-z][^>]*>/gi, "")
		.trim();
	if (!reference) {
		refus.push(`${item.id} — citation inconnue`);
		continue;
	}
	if (!textFr) continue;
	if (textFr === reference.text) {
		refus.push(`${item.id} — texte identique à l'original`);
		continue;
	}
	// Une traduction deux fois plus courte ou plus longue que l'original n'est
	// pas une traduction : c'est un résumé, ou un commentaire ajouté.
	const ratio = textFr.length / Math.max(reference.text.length, 1);
	if (ratio < 0.5 || ratio > 2) {
		refus.push(`${item.id} — longueur suspecte (×${ratio.toFixed(2)})`);
		continue;
	}
	const restesAnglais = textFr.match(ANGLAIS)?.length ?? 0;
	if (restesAnglais >= 3) {
		refus.push(`${item.id} — ${restesAnglais} mots anglais restants`);
		continue;
	}
	const fautes = GLOSSAIRE.filter((g) => g.faux.test(textFr)).map((g) => g.correct);
	for (const g of GLOSSAIRE) g.faux.lastIndex = 0;
	if (fautes.length > 0) {
		refus.push(`${item.id} — glossaire : écrire ${fautes.join(", ")}`);
		continue;
	}
	acceptees.set(item.id, textFr);
}

console.log(`\n${acceptees.size} traductions acceptées · ${refus.length} refusées`);
for (const r of refus) console.log(`  ✗ ${r}`);

if (!APPLIQUER) {
	console.log("\nSimulation — relancer avec --appliquer pour enregistrer.\n");
	await sql.end();
	process.exit(refus.length > 0 ? 1 : 0);
}

for (const [id, textFr] of acceptees) {
	await sql`update public.canon_references set text_fr = ${textFr}, updated_at = now() where id = ${id}`;
}
const fusion = {
	references: config.references.map((r) =>
		acceptees.has(r.id) ? Object.assign(r, { textFr: acceptees.get(r.id) }) : r
	),
};

// La mémoire est réécrite en entier à partir de l'état enregistré : elle reste
// le miroir exact de ce que la page publique affiche.
const memoire = fusion.references
	.filter((r) => r.textFr)
	.map((r) => ({ id: r.id, source: r.source, text: r.text, textFr: r.textFr }));
await Bun.write(MEMOIRE, `${JSON.stringify(memoire, null, "\t")}\n`);

const reste = fusion.references.filter((r) => r.lang !== "fr" && !r.textFr).length;
console.log(
	`\n✓ enregistré · ${memoire.length} traductions en mémoire (${MEMOIRE}) · ` +
		`${reste} citations restent à traduire\n`
);
await sql.end();
