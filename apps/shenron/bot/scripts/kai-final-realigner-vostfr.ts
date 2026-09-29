#!/usr/bin/env bun
/**
 * kai-final-realigner-vostfr.ts — Replace les lecteurs VOSTFR des fiches Kai Final
 * sur l'épisode que chaque fiche décrit.
 *
 * `import-kai-voiranime.ts` a donné à la fiche n les lecteurs de l'épisode
 * voir-anime 97 + n dans les DEUX langues. C'est juste en VF (numérotation
 * internationale) et faux en VOSTFR (numérotation japonaise) : au-delà de la
 * fiche 3, la VOSTFR montrait un autre épisode que celui décrit (trace.moe,
 * 2026-09-13). La correspondance fiche → épisode japonais J est dans
 * `data/kai-final-correspondance.json` (cf. kai-final-correspondance.ts).
 *
 * Aucun re-scraping. Avant tout réalignement, la fiche m portait les lecteurs
 * VOSTFR de l'épisode japonais 97 + m. Cet état d'origine est figé dans la
 * PREMIÈRE sauvegarde (`data/export/kai-final-lecteurs-avant-realignement-*.json`)
 * et c'est lui qui fait référence : la VOSTFR cible de la fiche n est celle que
 * portait, à l'origine, la fiche J − 97. Le script est donc rejouable — quand la
 * table gagne des fiches, seules celles dont la VOSTFR cible diffère de l'actuelle
 * sont réécrites. La VF n'est jamais touchée. Une fiche non placée perd sa VOSTFR,
 * qui est fausse.
 *
 * Les flux résolus. Au premier passage (pas encore de sauvegarde), ils suivent
 * leurs lecteurs. Ensuite, ceux de la sauvegarde sont périmés — le proxy HLS tient
 * un flux de plus de 8 h pour mort — : une VOSTFR déplacée repart sans flux, et le
 * proxy la résout à la demande par bxc `scripts/resolve-episode.ts`, dont la table
 * `vostfrNumbers` doit suivre la correspondance.
 *
 * Ce que ça écrit : `players` et `streams` des fiches modifiées, en une transaction
 * Postgres ; puis `data/streams.json`, que le proxy HLS lit EN PREMIER — sinon il
 * resservirait l'ancien flux pendant des heures ; enfin `lecteursRealignes: true`
 * dans la correspondance, que le dépôt de sous-titres jimaku exige.
 *
 * SAUVEGARDE : l'état complet des 70 fiches est écrit dans data/export/ avant
 * toute écriture.
 * SIMULATION PAR DÉFAUT — `--appliquer` pour écrire.
 */
import { mkdir, readdir, rename } from "node:fs/promises";
import postgres from "postgres";

const DATA = new URL("../data/", import.meta.url).pathname;
const EXPORT = `${DATA}export/`;
const CORRESPONDANCE = `${DATA}kai-final-correspondance.json`;
const STREAMS = `${DATA}streams.json`;
const REFERENCE = /^kai-final-lecteurs-avant-realignement-(\d+)\.json$/;
const APPLIQUER = process.argv.includes("--appliquer");

type Lecteur = { name?: string; provider?: string; embedUrl?: string; lang?: string };
type Fiche = { id: number; n: number; players: Lecteur[] | null; streams: Record<string, unknown> | null };
type Corr = { lecteursRealignes?: boolean; entrees: { n: number; id: number; jp: number }[] };

const corr = (await Bun.file(CORRESPONDANCE).json()) as Corr;
const jpParN = new Map(corr.entrees.map((e) => [e.n, e.jp]));
const vostfr = (f: Fiche) => (f.players ?? []).filter((p) => p.lang === "vostfr");
const empreinte = (lecteurs: Lecteur[]) => lecteurs.map((p) => p.embedUrl).join("\n");

const references = (await readdir(EXPORT).catch(() => [] as string[]))
	.map((nom) => ({ nom, ts: Number(REFERENCE.exec(nom)?.[1] ?? 0) }))
	.filter((x) => x.ts > 0)
	.toSorted((a, b) => a.ts - b.ts);
const reference = references.length ? `${EXPORT}${references[0].nom}` : null;
if (!reference && corr.lecteursRealignes) {
	console.error("✗ lecteurs déjà réalignés mais aucune sauvegarde de référence dans data/export/ — l'état d'origine est perdu, une permutation depuis l'état courant mélangerait tout. Arrêt.");
	process.exit(2);
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL requis");
const sql = postgres(url, { max: 1 });

try {
	const fiches = await sql<Fiche[]>`
		select id, number_in_series as n, players, streams from bot.db_episodes
		 where series = 'DBZ_KAI_FINAL' order by number_in_series`;
	if (fiches.length !== 70) throw new Error(`70 fiches attendues, ${fiches.length} trouvées`);
	const origine = reference ? ((await Bun.file(reference).json()) as Fiche[]) : fiches;
	if (origine.length !== 70) throw new Error(`sauvegarde de référence : 70 fiches attendues, ${origine.length} trouvées`);
	console.log(`référence : ${reference ?? "état courant (premier réalignement)"}`);

	// État d'origine : la fiche m porte la VOSTFR de l'épisode japonais 97 + m.
	const vostfrParJp = new Map<number, { lecteurs: Lecteur[]; flux: unknown }>();
	for (const f of origine) {
		const lecteurs = vostfr(f);
		const flux = reference ? undefined : f.streams?.vostfr;
		if (lecteurs.length || flux) vostfrParJp.set(Number(f.n) + 97, { lecteurs, flux });
	}

	const plan = fiches.map((f) => {
		const n = Number(f.n);
		const jp = jpParN.get(n);
		const source = jp === undefined ? undefined : vostfrParJp.get(jp);
		const cible = source?.lecteurs ?? [];
		const avant = vostfr(f);
		const players = [...(f.players ?? []).filter((p) => p.lang !== "vostfr"), ...cible];
		const streams: Record<string, unknown> = { ...f.streams };
		delete streams.vostfr;
		if (source?.flux) streams.vostfr = source.flux;
		return { id: Number(f.id), n, jp, avant: avant.length, apres: cible.length, modifiee: empreinte(avant) !== empreinte(cible), players, streams, flux: source?.flux };
	});
	const modifiees = plan.filter((p) => p.modifiee);

	const gagnent = modifiees.filter((p) => p.avant === 0 && p.apres > 0);
	const perdent = modifiees.filter((p) => p.avant > 0 && p.apres === 0);
	console.log(`${plan.length} fiches · ${plan.filter((p) => p.jp !== undefined).length} placées · ${modifiees.length} à réécrire · gagnent une VOSTFR : ${gagnent.map((p) => p.n).join(",") || "∅"} · perdent leur VOSTFR fausse : ${perdent.map((p) => p.n).join(",") || "∅"}`);
	for (const p of modifiees) {
		console.log(`  fiche ${String(p.n).padStart(2)} (#${p.id}) ← ${p.jp === undefined ? "non placée" : `JP ${p.jp} (VOSTFR d'origine de la fiche ${p.jp - 97})`} · VOSTFR ${p.avant} → ${p.apres}`);
	}

	if (!APPLIQUER) {
		console.log("SIMULATION — relancer avec --appliquer.");
	} else {
		await mkdir(EXPORT, { recursive: true });
		const sauvegarde = `${EXPORT}kai-final-lecteurs-avant-${reference ? "placement" : "realignement"}-${Date.now()}.json`;
		await Bun.write(sauvegarde, JSON.stringify(fiches, null, "\t"));
		console.log(`sauvegarde : ${sauvegarde}`);

		if (modifiees.length) {
			await sql.begin(async (tx) => {
				for (const p of modifiees) {
					await tx`update bot.db_episodes set players = ${tx.json(p.players as never)}, streams = ${tx.json(p.streams as never)} where id = ${p.id}`;
				}
			});
			console.log(`✓ ${modifiees.length} fiche(s) écrite(s) (transaction)`);

			const store = (await Bun.file(STREAMS).json().catch(() => ({}))) as Record<string, unknown>;
			for (const p of modifiees) {
				delete store[`${p.id}-vostfr`];
				if (p.flux) store[`${p.id}-vostfr`] = p.flux;
			}
			await Bun.write(`${STREAMS}.tmp`, JSON.stringify(store));
			await rename(`${STREAMS}.tmp`, STREAMS);
			console.log(`✓ streams.json : flux VOSTFR des fiches réécrites ${reference ? "retirés (résolus à la demande)" : "déplacés avec leurs lecteurs"}`);
		}

		corr.lecteursRealignes = true;
		await Bun.write(CORRESPONDANCE, `${JSON.stringify(corr, null, "\t")}\n`);
		console.log("✓ correspondance marquée lecteursRealignes: true");
	}
} finally {
	await sql.end({ timeout: 5 });
}
