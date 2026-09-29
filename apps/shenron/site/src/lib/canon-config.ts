/**
 * canon-config — lecture/écriture **server-only** de la doctrine de canonicité.
 *
 * La table `CanonConfig` (schéma public) stocke un unique document JSON
 * (singleton `default`) : définitions des cinq rangs, règles générales, sources
 * admises et refusées, sujets tranchés et familles de formulations. La page
 * `/wiki/canon` lit ici la doctrine effective et la passe à `analyzeCanon` ;
 * l'éditeur `/admin/ia?tab=canon` l'écrit via `/api/canon-config`.
 *
 * Toute lecture est enveloppée et ne throw jamais : table absente, base
 * indisponible ou document invalide ⇒ doctrine livrée avec le dépôt. La page de
 * canonicité doit répondre même quand la base ne répond pas — c'est justement
 * elle qui promet de ne rien inventer.
 */
import "server-only";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { canonConfig, canonReferences } from "@/db/schema";
import {
	DEFAULT_CANON_CONFIG,
	resolveCanonConfig,
	type CanonConfig,
	type CanonReference,
} from "@/lib/canon-engine";

const SINGLETON_ID = "default";

/**
 * Doctrine effective (document en base fusionné aux défauts).
 *
 * Mémoïsée par requête : la page publique l'appelle pour le verdict et pour
 * l'affichage des règles, `canon-preuves` aussi — une seule lecture suffit.
 */
export const getCanonConfig = cache(async (): Promise<CanonConfig> => {
	try {
		const [row] = await db
			.select()
			.from(canonConfig)
			.where(eq(canonConfig.id, SINGLETON_ID))
			.limit(1);
		const doctrine = row ? resolveCanonConfig(row.data) : structuredClone(DEFAULT_CANON_CONFIG);
		const entryIds = new Set(doctrine.entries.map((e) => e.id));
		const missingEntries = DEFAULT_CANON_CONFIG.entries.filter((e) => !entryIds.has(e.id));
		if (missingEntries.length > 0) {
			doctrine.entries = [...doctrine.entries, ...missingEntries];
		}
		const heuristicIds = new Set(doctrine.heuristics.map((h) => h.id));
		const missingHeuristics = DEFAULT_CANON_CONFIG.heuristics.filter((h) => !heuristicIds.has(h.id));
		if (missingHeuristics.length > 0) {
			doctrine.heuristics = [...doctrine.heuristics, ...missingHeuristics];
		}
		if (!doctrine.powerScaling || !doctrine.powerScaling.enabled) {
			doctrine.powerScaling = DEFAULT_CANON_CONFIG.powerScaling;
		}
		// Le corpus de preuves vit en table (`canon_references`, alimentée 24h/24
		// par `scripts/canon-ingest.ts`) ; le blob ne garde que les saisies
		// manuelles de l'éditeur. Les deux se lisent ensemble.
		const manuelles = doctrine.references.filter((r) => r.provenance === "manuel");
		return { ...doctrine, references: [...manuelles, ...(await getCanonReferences())] };
	} catch (e) {
		console.error("[canon-config] lecture échouée, repli sur la doctrine du dépôt :", e);
		return structuredClone(DEFAULT_CANON_CONFIG);
	}
});

/** Le corpus ingéré, visible, typé comme le moteur l'attend. Ne throw jamais. */
export const getCanonReferences = cache(async (): Promise<CanonReference[]> => {
	try {
		const rows = await db.select().from(canonReferences).where(eq(canonReferences.visible, true));
		return rows.map((r) => ({
			id: r.id,
			subject: r.subject,
			keywords: Array.isArray(r.keywords) ? r.keywords : [],
			text: r.text,
			...(r.textFr ? { textFr: r.textFr } : {}),
			source: r.source,
			...(r.year ? { year: r.year } : {}),
			document: r.document,
			lang: r.lang === "en" || r.lang === "ja" ? r.lang : "fr",
			provenance:
				r.provenance === "aphrody" || r.provenance === "databooks" || r.provenance === "manga"
					? r.provenance
					: "manuel",
			...(r.href ? { href: r.href } : {}),
		}));
	} catch (e) {
		console.error("[canon-config] corpus canon_references illisible :", e);
		return [];
	}
});

/** Upsert du singleton (on stocke le document déjà résolu) → doctrine résolue. */
export async function saveCanonConfig(patch: unknown, by?: string | null): Promise<CanonConfig> {
	const brut = resolveCanonConfig(patch);
	// Seules les citations saisies à la main s'enregistrent dans le blob : les
	// autres viennent de la table et y retournent au prochain passage du service.
	const resolved: CanonConfig = {
		...brut,
		references: brut.references.filter((r) => r.provenance === "manuel"),
	};
	// L'éditeur peut retoucher une traduction ou retirer une citation ingérée :
	// ces deux gestes s'appliquent à la table, pas au blob.
	const ingerees = brut.references.filter((r) => r.provenance !== "manuel");
	const actuelles = await getCanonReferences();
	const gardees = new Set(ingerees.map((r) => r.id));
	for (const r of actuelles) {
		if (!gardees.has(r.id)) {
			await db
				.update(canonReferences)
				.set({ visible: false, updatedAt: new Date() })
				.where(eq(canonReferences.id, r.id));
			continue;
		}
		const edit = ingerees.find((x) => x.id === r.id);
		if (edit && (edit.textFr ?? null) !== (r.textFr ?? null)) {
			await db
				.update(canonReferences)
				.set({ textFr: edit.textFr ?? null, updatedAt: new Date() })
				.where(eq(canonReferences.id, r.id));
		}
	}
	// La colonne jsonb est typée Record<string, unknown> ; CanonConfig est
	// structurellement du JSON → cast localisé (cf. chronology-config.ts).
	const data = resolved as unknown as Record<string, unknown>;
	await db
		.insert(canonConfig)
		.values({ id: SINGLETON_ID, data, updatedBy: by ?? null, updatedAt: new Date() })
		.onConflictDoUpdate({
			target: canonConfig.id,
			set: { data, updatedBy: by ?? null, updatedAt: new Date() },
		});
	return { ...resolved, references: [...resolved.references, ...(await getCanonReferences())] };
}
