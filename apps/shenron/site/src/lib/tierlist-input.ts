import type { TierlistItem, TierlistTier } from "@/db/schema";

/**
 * Validation/normalisation **partagée** des tiers reçus du client (éditeur).
 *
 * Source unique pour la route publique `POST /api/tierlists` (création
 * communautaire) ET la Server Action admin (`saveOfficialTierlist`). Pures
 * fonctions, sans accès DB — importables côté serveur uniquement (les deux
 * appelants sont server), mais sans dépendance `server-only`.
 */

export const MAX_ITEMS = 400;
export const MAX_TIERS = 12;

/**
 * Valide l'image d'une carte : URL `https` OU chemin d'asset self-hosté relatif
 * (`./assets/dbz/…` du pool wiki, `assets/wiki/…` des uploads, `db/…`). Rejette
 * `data:`/`javascript:`/`blob:` (poids jsonb / XSS) et la traversée de chemin.
 */
function asImage(v: unknown): string | null {
	if (typeof v !== "string") return null;
	const s = v.trim();
	if (!s || s.length > 512 || s.includes("..")) return null;
	if (/^https:\/\//i.test(s)) return s;
	if (/^\.?\/?(assets\/|wiki\/|db\/)/i.test(s)) return s;
	return null;
}

function asItem(v: unknown): TierlistItem | null {
	if (!v || typeof v !== "object") return null;
	const o = v as Record<string, unknown>;
	if (typeof o.id !== "string" || typeof o.label !== "string") return null;
	// id/label non vides : un id vide casserait le dédoublonnage de l'éditeur
	// (plusieurs cartes avec id="" deviennent indistinguables au déplacement).
	const id = o.id.trim().slice(0, 80);
	const label = o.label.trim().slice(0, 80);
	if (!id || !label) return null;
	return { id, label, image: asImage(o.image) };
}

export function asTier(v: unknown): TierlistTier | null {
	if (!v || typeof v !== "object") return null;
	const o = v as Record<string, unknown>;
	if (typeof o.id !== "string" || typeof o.label !== "string") return null;
	const color =
		typeof o.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(o.color) ? o.color : "#888";
	const items = Array.isArray(o.items)
		? o.items.map(asItem).filter((x): x is TierlistItem => x !== null)
		: [];
	return { id: o.id.slice(0, 40), label: o.label.slice(0, 24), color, items };
}

/**
 * Normalise un tableau de tiers reçu du client. Renvoie `null` si aucun tier
 * valide ou si le total de cartes dépasse `MAX_ITEMS` ; sinon les tiers nettoyés
 * et le total de cartes (l'appelant décide si 0 carte est acceptable).
 */
export function sanitizeTiers(
	input: unknown
): { tiers: TierlistTier[]; totalItems: number } | null {
	const tiers = Array.isArray(input)
		? input
				.map(asTier)
				.filter((x): x is TierlistTier => x !== null)
				.slice(0, MAX_TIERS)
		: [];
	if (tiers.length === 0) return null;
	const totalItems = tiers.reduce((n, t) => n + t.items.length, 0);
	if (totalItems > MAX_ITEMS) return null;
	return { tiers, totalItems };
}

/** Payload de sauvegarde d'une tier list officielle (admin). */
export interface OfficialTierlistPayload {
	id?: string | null;
	title: string;
	description?: string | null;
	templateKey?: string | null;
	tiers: TierlistTier[];
	official?: boolean;
	featured?: boolean;
	published?: boolean;
}

/** Résultat d'une sauvegarde (Server Action) consommé par l'éditeur client. */
export type SaveTierlistResult = { ok: true; slug: string } | { ok: false; error: string };
