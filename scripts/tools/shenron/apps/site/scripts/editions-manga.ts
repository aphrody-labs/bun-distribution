#!/usr/bin/env bun
/**
 * Où en est le catalogue de lecture, édition par édition.
 *
 * Une œuvre se lit en quatre versions : français ou japonais, noir et blanc ou
 * couleur. Le site n'en publie aujourd'hui qu'une partie, et rien ne le disait —
 * ni le code (`manga-editions.ts` ne connaissait que la colorisation), ni la
 * base (la série porte l'édition sans que personne ne la croise avec la langue).
 *
 * Ce script croise les deux et distingue trois états, qu'il ne faut pas
 * confondre :
 *   · **complète**   — l'édition existe chez l'éditeur ET on la possède ;
 *   · **manquante**  — elle existe chez l'éditeur, on ne l'a pas ;
 *   · **inexistante**— elle n'a jamais été publiée (Super n'a pas d'édition en
 *                      couleur ; aucune source ne la fera apparaître).
 *
 * Lecture seule. Aucune écriture, aucun réseau.
 *
 * Usage : bun scripts/editions-manga.ts [--json]
 */
import { join } from "node:path";
import postgres from "postgres";
import {
	CODES_EDITION,
	type CodeEdition,
	EDITION_PAR_SERIE,
	EDITIONS_PUBLIEES,
	codeEdition,
	editionPubliee,
	libelleEdition,
	libelleSerie,
	serieOeuvre,
} from "../src/lib/manga-editions";

const JSON_SEUL = process.argv.includes("--json");

async function urlBase(): Promise<string> {
	const direct = process.env.DATABASE_URL?.trim();
	if (direct) return direct;
	// La DERNIÈRE ligne `^DATABASE_URL=` fait foi : l'ancienne URL Neon la précède, en commentaire.
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
		console.error("✗ DATABASE_URL introuvable (environnement ou apps/site/.env).");
		process.exit(1);
	}
	return valeur;
}

type Case = {
	oeuvre: string;
	edition: CodeEdition;
	etat: "complète" | "manquante" | "inexistante";
	chapitres: number;
	planches: number;
	series: string[];
};

const sql = postgres(await urlBase(), { max: 2, prepare: false });
try {
	const lignes = await sql<{ series: string; chapitres: string; planches: string | null }[]>`
		SELECT series, count(*) AS chapitres, sum(jsonb_array_length(pages)) AS planches
		FROM bot.db_manga_chapters
		WHERE visible GROUP BY series`;

	// postgres-js rend les agrégats en CHAÎNES : sans Number(), les totaux se concatènent.
	const possede = new Map<string, { chapitres: number; planches: number; series: string[] }>();
	for (const l of lignes) {
		const edition = EDITION_PAR_SERIE[l.series];
		if (!edition) continue;
		const cle = `${serieOeuvre(l.series)}|${codeEdition(edition.langue, edition.colorisation)}`;
		const cumul = possede.get(cle) ?? { chapitres: 0, planches: 0, series: [] };
		cumul.chapitres += Number(l.chapitres);
		cumul.planches += Number(l.planches ?? 0);
		cumul.series.push(l.series);
		possede.set(cle, cumul);
	}

	const matrice: Case[] = [];
	for (const oeuvre of Object.keys(EDITIONS_PUBLIEES)) {
		for (const edition of CODES_EDITION) {
			const tenu = possede.get(`${oeuvre}|${edition}`);
			matrice.push({
				oeuvre,
				edition,
				etat: !editionPubliee(oeuvre, edition) ? "inexistante" : tenu ? "complète" : "manquante",
				chapitres: tenu?.chapitres ?? 0,
				planches: tenu?.planches ?? 0,
				series: tenu?.series ?? [],
			});
		}
	}

	if (JSON_SEUL) {
		console.log(JSON.stringify(matrice, null, 2));
	} else {
		const marque = { complète: "✓", manquante: "✗", inexistante: "—" } as const;
		for (const oeuvre of Object.keys(EDITIONS_PUBLIEES)) {
			console.log(`\n${libelleSerie(oeuvre)}`);
			for (const c of matrice.filter((m) => m.oeuvre === oeuvre)) {
				const detail =
					c.etat === "complète"
						? `${c.chapitres} chapitre(s), ${c.planches} planche(s) — série ${c.series.join(", ")}`
						: c.etat === "manquante"
							? "publiée chez l'éditeur, absente de la base"
							: "jamais publiée";
				console.log(`  ${marque[c.etat]} ${libelleEdition(c.edition).padEnd(22)} ${detail}`);
			}
		}
		const manquantes = matrice.filter((m) => m.etat === "manquante").length;
		const inexistantes = matrice.filter((m) => m.etat === "inexistante").length;
		console.log(
			`\n${matrice.length - manquantes - inexistantes} édition(s) tenue(s), ${manquantes} à acquérir, ${inexistantes} sans existence éditoriale.`
		);
	}
} finally {
	await sql.end({ timeout: 5 });
}
