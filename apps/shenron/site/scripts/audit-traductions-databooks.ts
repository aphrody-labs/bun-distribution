#!/usr/bin/env bun
/**
 * Audit des traductions françaises des databooks → quarantaine des planches
 * corrompues.
 *
 * Le 2026-09-14, plusieurs écrivains automatiques ont déposé des milliers de
 * `text_fr` fautifs (jetons de masquage « Zêta010 », entrées courtes du lexique
 * appliquées au milieu d'un mot, bruit d'OCR traduit mot à mot, textes rédigés
 * de mémoire), aussitôt repris par `canon-ingest` et le RAG. Ce script note
 * chaque planche traduite avec les détecteurs purs de
 * `src/lib/databooks-audit-traductions.ts` et, avec `--appliquer`, met en
 * quarantaine les verdicts `corrompu` :
 *
 *   - la traduction fautive est versionnée dans `wiki_revisions`
 *     (`traduction#<n>`, réversible depuis l'historique du wiki) ;
 *   - `text_fr`, `text_fr_by`, `text_fr_at` sont retirés de CETTE planche seule,
 *     par un `jsonb_set` gardé (la planche doit porter encore exactement le texte
 *     audité : un écrivain concurrent n'est jamais écrasé) — la planche revient
 *     dans la file de traduction ;
 *   - si l'historique garde une traduction antérieure saine d'un traducteur
 *     fiable, elle est rétablie au lieu d'un retrait ;
 *   - la citation `canon_references` (`planche-<id>-<n>`) est masquée
 *     (`visible = false`), sans attendre la passe suivante de `canon-ingest`.
 *
 * Usage (depuis apps/shenron/site) :
 *   bun scripts/audit-traductions-databooks.ts                    # simulation
 *   bun scripts/audit-traductions-databooks.ts --json=/tmp/audit.json
 *   bun scripts/audit-traductions-databooks.ts --ecrivain=shenron-massive-vps --details
 *   bun scripts/audit-traductions-databooks.ts --appliquer --json=/tmp/audit.json
 */
import { join } from "node:path";
import {
	auditerPlanche,
	indexerEntites,
	SEUIL_CORROMPU,
	SEUIL_SUSPECT,
	type EntreeLexique,
	type Signal,
	type VerdictPlanche,
} from "../src/lib/databooks-audit-traductions";
import { arretSiGel, chargeOuvrages, connecte, RACINE_SITE, texteDePlanche, traductionDePlanche } from "./_databooks-base";

const args = process.argv.slice(2);
const APPLIQUER = args.includes("--appliquer");
if (APPLIQUER) arretSiGel("audit-traductions-databooks --appliquer");
const DETAILS = args.includes("--details");
const valeur = (nom: string) => args.find((a) => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const JSON_SORTIE = valeur("json");
const ECRIVAIN = valeur("ecrivain");
const LIVRE = valeur("livre") ? Number(valeur("livre")) : null;

const EDITEUR = "Audit des traductions databooks (quarantaine)";

/**
 * Verdicts établis par relecture du SCAN (2026-09-14), là où les détecteurs
 * textuels ne voient qu'une présomption : le texte français est bien formé, mais
 * ne décrit pas la planche. Chaque entrée cite ce que montre l'image.
 */
const VERDICTS_RELUS: Record<string, string> = {
	"18/230":
		"scan : planche « あの世 / 地獄 / 蛇姫の城 / アーリア星人 » ; la traduction décrit le téléfilm Bardock (dates, staff) absent de la page",
	"19/152":
		"scan : 技事典 « し » (次元に穴を開ける, 獅獅牙流拳法, 四身の拳, 舌突き, 尻尾攻撃) ; la traduction décrit le Senzu, les Potara et la Salle de l'Esprit et du Temps",
	"16/201":
		"scan : « ALL MARKS » (marques Capsule Corp., 桃白白, 鶴仙流, 亀仙流…) ; la traduction décrit des techniques (Kamehameha, Kaiô-ken, Genkidama)",
	"13/67":
		"scan : cartes Carddass n° 503 à 527 (DP, スカウター, 箔…) ; la traduction est une présentation générique inventée des Carddass",
	"19/74":
		"scan : キャラクター事典 « け〜こ » (ゲットー, ゲリノビッチ, ピロシキ, コウリュウ, ゴジータ…) ; la traduction décrit Giran, le roi Chappa et Guéshé, d'une autre page",
	"23/49":
		"source : entretien Toriyama / Nakatsuru (adaptation hollywoodienne, métier d'intervalliste) ; la traduction raconte la révélation de Raditz, sans rapport",
	"19/136":
		"source : 技事典 « あ » (アイビーム…) ; la traduction titre « LE KAÏŌ-KEN », entrée absente de la planche",
};

/** Écrivains dont une traduction antérieure peut être rétablie telle quelle. */
const FIABLES = /^Traduction ja→fr \((machine:sonnet|machine:fable|relecture|manual|human)/;

type Ligne = {
	livre: number;
	titre: string | null;
	page: number;
	numeroBrut: string;
	ecrivain: string;
	fr: string;
	verdict: VerdictPlanche;
};

const revisionId = () => {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	return Array.from(crypto.getRandomValues(new Uint8Array(24)), (o) => alphabet[o % 36]).join("");
};

const lexique = (await Bun.file(join(RACINE_SITE, "..", "..", "data", "lexique-db-canonique.json")).json()) as EntreeLexique[];
const index = indexerEntites(lexique);

const sql = await connecte();
try {
	const ouvrages = await chargeOuvrages(sql, LIVRE ? { ids: [LIVRE] } : {});
	const lignes: Ligne[] = [];
	for (const o of ouvrages) {
		for (let i = 0; i < o.pages.length; i++) {
			const p = o.pages[i]!;
			const fr = traductionDePlanche(p);
			if (!fr.trim()) continue;
			const ecrivain = p.text_fr_by ?? "(inconnu)";
			if (ECRIVAIN && ecrivain !== ECRIVAIN) continue;
			const page = Number(p.number);
			const voisines = [o.pages[i - 1], o.pages[i + 1], o.pages[i - 2], o.pages[i + 2]]
				.filter((v): v is NonNullable<typeof v> => Boolean(v))
				.map((v) => ({ numero: Number(v.number), src: texteDePlanche(v) }));
			const relu = VERDICTS_RELUS[`${o.id}/${page}`];
			const extras: Signal[] = relu ? [{ code: "relu-scan", poids: 10, certain: true, detail: relu }] : [];
			lignes.push({
				livre: o.id,
				titre: o.title,
				page,
				numeroBrut: String(p.number),
				ecrivain,
				fr,
				verdict: auditerPlanche({ fr, src: texteDePlanche(p), voisines, extras }, index),
			});
		}
	}

	// ── Rapport par écrivain ─────────────────────────────────────────────────
	type Bilan = { audites: number; suspects: number; corrompus: number; quarantaine: number; retablies: number; signaux: Record<string, number> };
	const parEcrivain = new Map<string, Bilan>();
	for (const l of lignes) {
		const b = parEcrivain.get(l.ecrivain) ?? { audites: 0, suspects: 0, corrompus: 0, quarantaine: 0, retablies: 0, signaux: {} };
		b.audites++;
		if (l.verdict.niveau === "suspect") b.suspects++;
		if (l.verdict.niveau === "corrompu") b.corrompus++;
		for (const s of l.verdict.signaux) b.signaux[s.code] = (b.signaux[s.code] ?? 0) + 1;
		parEcrivain.set(l.ecrivain, b);
	}

	const corrompues = lignes.filter((l) => l.verdict.niveau === "corrompu");
	console.log(`${lignes.length} planche(s) traduite(s) auditée(s) — seuils : suspect ≥ ${SEUIL_SUSPECT}, corrompu ≥ ${SEUIL_CORROMPU} ou signal certain.\n`);
	for (const [w, b] of [...parEcrivain].toSorted((a, b) => b[1].audites - a[1].audites)) {
		console.log(`  ${w.padEnd(36)} ${String(b.audites).padStart(5)} auditées  ${String(b.suspects).padStart(4)} suspectes  ${String(b.corrompus).padStart(4)} corrompues`);
	}
	if (DETAILS) {
		for (const l of lignes.filter((x) => x.verdict.niveau !== "sain")) {
			console.log(`\n#${l.livre} p${l.page} [${l.ecrivain}] ${l.verdict.niveau} (score ${l.verdict.score})`);
			for (const s of l.verdict.signaux) console.log(`    ${s.code} (${s.poids}${s.certain ? ", certain" : ""}) : ${s.detail}`);
		}
	}

	// ── Quarantaine ──────────────────────────────────────────────────────────
	const actions: { livre: number; page: number; ecrivain: string; action: "retrait" | "retablissement" | "ignoree"; raison?: string; canonMasquee: boolean }[] = [];
	let canonMasquees = 0;
	if (APPLIQUER && corrompues.length > 0) {
		// L'historique des traductions, sous ses deux formes de clé.
		const revisions = (await sql`
			select "rowId", "editorName", "createdAt", after
			from public.wiki_revisions
			where "tableName" = 'db_databooks'
			  and (after::text like '%traduction#%' or after::text like '%"text_fr"%')
			order by "createdAt"
		`) as unknown as { rowId: string; editorName: string | null; createdAt: Date; after: Record<string, unknown> | null }[];
		const historique = new Map<string, { editeur: string; valeur: string; le: Date }[]>();
		const note = (cle: string, editeur: string, valeur: unknown, le: Date) => {
			if (typeof valeur !== "string" || !valeur.trim()) return;
			historique.set(cle, [...(historique.get(cle) ?? []), { editeur, valeur, le }]);
		};
		for (const r of revisions) {
			if (!r.after || typeof r.after !== "object") continue;
			for (const [k, v] of Object.entries(r.after)) {
				const m = /^traduction#(\d+)$/.exec(k);
				if (m) note(`${r.rowId}/${m[1]}`, r.editorName ?? "", v, r.createdAt);
				if (k === "text_fr" && v && typeof v === "object") {
					for (const [n, t] of Object.entries(v as Record<string, unknown>)) note(`${r.rowId}/${n}`, r.editorName ?? "", t, r.createdAt);
				}
			}
		}

		const srcDe = new Map<string, string>(
			ouvrages.flatMap((o) => o.pages.map((p) => [`${o.id}/${Number(p.number)}`, texteDePlanche(p)] as const))
		);
		for (const l of corrompues) {
			const cle = `${l.livre}/${l.page}`;
			if (!Number.isInteger(l.page) || l.page <= 0) {
				actions.push({ livre: l.livre, page: l.page, ecrivain: l.ecrivain, action: "ignoree", raison: "numéro de planche non entier", canonMasquee: false });
				continue;
			}
			// Dernière traduction antérieure d'un traducteur fiable, différente et saine.
			const anterieure = (historique.get(cle) ?? [])
				.filter((h) => h.valeur !== l.fr && FIABLES.test(h.editeur))
				.filter((h) => auditerPlanche({ fr: h.valeur, src: srcDe.get(cle) ?? "" }, index).niveau === "sain")
				.at(-1);
			const signature = anterieure ? (/\(([^)]+)\)/.exec(anterieure.editeur)?.[1] ?? "relecture") : null;
			const raisons = l.verdict.signaux.map((s) => s.code).join(", ");

			const ok = await sql.begin(async (tx) => {
				const nouvelle = anterieure
					? tx`(d.pages -> t.i) || ${tx.json({ text_fr: anterieure.valeur, text_fr_by: signature!, text_fr_at: anterieure.le.toISOString() })}`
					: tx`(d.pages -> t.i) - 'text_fr' - 'text_fr_by' - 'text_fr_at'`;
				const res = await tx`
					update bot.db_databooks d
					set pages = jsonb_set(d.pages, array[t.i::text], ${nouvelle}, false)
					from (
						select (e.o - 1)::int as i
						from bot.db_databooks x, jsonb_array_elements(x.pages) with ordinality as e(p, o)
						where x.id = ${l.livre} and e.p ->> 'number' = ${l.numeroBrut} and e.p ->> 'text_fr' = ${l.fr}
						limit 1
					) t
					where d.id = ${l.livre}
					  and d.pages -> t.i ->> 'number' = ${l.numeroBrut}
					  and d.pages -> t.i ->> 'text_fr' = ${l.fr}
					returning d.id
				`;
				if (res.count !== 1) return false;
				await tx`insert into public.wiki_revisions ${tx({
					id: revisionId(),
					tableName: "db_databooks",
					rowId: String(l.livre),
					action: "update",
					label: `${l.titre ?? `Ouvrage ${l.livre}`} — ${anterieure ? "rétablissement" : "quarantaine"} de la traduction p${l.page} (${l.ecrivain} : ${raisons})`.slice(0, 500),
					before: tx.json({ [`traduction#${l.page}`]: l.fr }),
					after: tx.json({ [`traduction#${l.page}`]: anterieure?.valeur ?? null }),
					editorId: "agent",
					editorName: EDITEUR,
				})}`;
				return true;
			});
			if (!ok) {
				actions.push({ livre: l.livre, page: l.page, ecrivain: l.ecrivain, action: "ignoree", raison: "traduction modifiée depuis l'audit (écrivain concurrent)", canonMasquee: false });
				continue;
			}
			// La citation de canon tirée de la traduction retirée disparaît tout de suite ;
			// un rétablissement, lui, sera repris (et re-haché) par la passe suivante.
			let masquee = false;
			if (!anterieure) {
				const r = await sql`
					update public.canon_references set visible = false, updated_at = now()
					where provenance = 'databooks' and id = ${`planche-${l.livre}-${l.page}`} and visible
				`;
				masquee = r.count > 0;
				canonMasquees += r.count;
			}
			const b = parEcrivain.get(l.ecrivain)!;
			if (anterieure) b.retablies++;
			else b.quarantaine++;
			actions.push({ livre: l.livre, page: l.page, ecrivain: l.ecrivain, action: anterieure ? "retablissement" : "retrait", canonMasquee: masquee });
		}
		const n = (a: string) => actions.filter((x) => x.action === a).length;
		console.log(`\n✔ ${n("retrait")} traduction(s) mise(s) en quarantaine, ${n("retablissement")} rétablie(s), ${n("ignoree")} ignorée(s) ; ${canonMasquees} citation(s) de canon masquée(s).`);
	} else {
		console.log(`\n${corrompues.length} planche(s) corrompue(s)${APPLIQUER ? "" : " — simulation, relancer avec --appliquer pour les mettre en quarantaine"}.`);
	}

	if (JSON_SORTIE) {
		const classements = lignes
			.filter((l) => l.verdict.niveau !== "sain")
			.map((l) => {
				const primaire = [...l.verdict.signaux].toSorted(
					(a, b) => Number(Boolean(b.certain)) - Number(Boolean(a.certain)) || b.poids - a.poids || a.code.localeCompare(b.code)
				)[0];
				return {
					livre: l.livre, page: l.page,
					classe: primaire?.code ?? "signal-compose",
					disposition: l.verdict.niveau === "corrompu" ? "quarantaine" : "relecture-source-requise",
					preuve: primaire?.detail ?? "score composé",
				};
			});
		const parClasse = Object.fromEntries(
			[...Map.groupBy(classements, (c) => c.classe)].map(([classe, cas]) => [classe, cas.length]).toSorted()
		);
		await Bun.write(
			JSON_SORTIE,
			JSON.stringify(
				{
					genere: new Date().toISOString(),
					applique: APPLIQUER,
					seuils: { suspect: SEUIL_SUSPECT, corrompu: SEUIL_CORROMPU },
					corpus: { planchesTraduitesAuditees: lignes.length, baseLexique: "data/lexique-db-canonique.json", politique: "aucune traduction déduite; signaux déterministes seulement" },
					classements: { total: classements.length, parClasse, cas: classements },
					parEcrivain: Object.fromEntries(parEcrivain),
					canonMasquees,
					actions,
					planches: lignes
						.filter((l) => l.verdict.niveau !== "sain")
						.map((l) => ({
							livre: l.livre,
							titre: l.titre,
							page: l.page,
							ecrivain: l.ecrivain,
							niveau: l.verdict.niveau,
							score: l.verdict.score,
							signaux: l.verdict.signaux,
							extrait: l.fr.slice(0, 300),
						})),
				},
				null,
				1
			)
		);
		console.log(`rapport JSON : ${JSON_SORTIE}`);
	}
} finally {
	await sql.end();
}
