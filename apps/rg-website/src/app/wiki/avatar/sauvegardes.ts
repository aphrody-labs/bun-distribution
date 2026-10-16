/** Règles métier de la persistance d'avatars, indépendantes de Next et de Supabase. */

export type AvatarEnregistre = {
	choix: Record<number, string>;
	valeurs: Record<string, number>;
	champs: Record<string, string>;
	genre: number;
	morphologie: number;
};

export type Sauvegarde = {
	id: string;
	nom: string;
	code: string | null;
	donnees: AvatarEnregistre;
	modifieLe: string;
};

export type LigneSauvegarde = {
	id: string;
	userId: string;
	nom: string;
	code: string | null;
	donnees: AvatarEnregistre;
	modifieLe: string;
};

export type ErreurDepot = { code?: string };

export interface DepotSauvegardes {
	compter(userId: string): Promise<number>;
	inserer(ligne: {
		userId: string;
		nom: string;
		code: string | null;
		donnees: AvatarEnregistre;
	}): Promise<{ id?: string; error?: ErreurDepot }>;
	lister(
		userId: string,
		limite: number
	): Promise<{ lignes?: LigneSauvegarde[]; error?: ErreurDepot }>;
	trouverParCode(code: string): Promise<{ ligne?: LigneSauvegarde | null; error?: ErreurDepot }>;
	supprimer(userId: string, id: string): Promise<{ error?: ErreurDepot }>;
}

export const MAX_SAUVEGARDES = 24;
export const LONGUEUR_CODE = 69;

// Alphabet exact publié dans codePartage.alphabet par `niers avatar export`.
const ALPHABET_CODE = "3456789ABCDEFGHJKLMNPQRSTUVWXYabcdefghijkmnpqrstuvwxy!?-#$*&=+><";
const CARACTERES_CODE = new Set(ALPHABET_CODE);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLE_RECETTE = /^(?!__proto__$|constructor$|prototype$)[A-Za-z0-9_.-]{1,80}$/;
const TAILLE_RECETTE_MAX = 100_000;

function objet(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Valide à nouveau la recette reçue du navigateur avant toute écriture privilégiée. */
export function recetteAvatarValide(v: unknown): v is AvatarEnregistre {
	if (!objet(v)) return false;
	let taille: number;
	try {
		taille = JSON.stringify(v).length;
	} catch {
		return false;
	}
	if (taille > TAILLE_RECETTE_MAX || !objet(v.choix) || !objet(v.valeurs) || !objet(v.champs)) {
		return false;
	}
	if (!Number.isInteger(v.genre) || (v.genre !== 0 && v.genre !== 1)) return false;
	if (!Number.isInteger(v.morphologie) || Number(v.morphologie) < 0 || Number(v.morphologie) > 32) {
		return false;
	}
	const choix = Object.entries(v.choix);
	const valeurs = Object.entries(v.valeurs);
	const champs = Object.entries(v.champs);
	if (choix.length > 100 || valeurs.length > 100 || champs.length > 100) return false;
	if (
		choix.some(
			([cle, valeur]) => !/^\d{1,3}$/.test(cle) || typeof valeur !== "string" || valeur.length > 128
		)
	) {
		return false;
	}
	if (
		valeurs.some(
			([cle, valeur]) =>
				!CLE_RECETTE.test(cle) ||
				typeof valeur !== "number" ||
				!Number.isFinite(valeur) ||
				Math.abs(valeur) > 10_000
		)
	) {
		return false;
	}
	return !champs.some(
		([cle, valeur]) => !CLE_RECETTE.test(cle) || typeof valeur !== "string" || valeur.length > 500
	);
}

export function codePartageValide(code: string): boolean {
	return (
		code.length === LONGUEUR_CODE && [...code].every((caractere) => CARACTERES_CODE.has(caractere))
	);
}

function nomPropre(brut: string): string {
	const nettoye = [...brut.trim()]
		.filter((c) => c >= " ")
		.join("")
		.slice(0, 40);
	return nettoye.length > 0 ? nettoye : "Avatar";
}

export async function enregistrerDansDepot(
	depot: DepotSauvegardes,
	userId: string | null | undefined,
	nom: string,
	donnees: AvatarEnregistre,
	code: string | null
): Promise<{ id?: string; error?: string }> {
	if (!userId) return { error: "Connecte-toi pour enregistrer un avatar." };
	if (!recetteAvatarValide(donnees)) return { error: "Cette recette d'avatar n'est pas valide." };
	if (code !== null && !codePartageValide(code)) {
		return { error: "Ce code de partage n'est pas valide." };
	}
	if ((await depot.compter(userId)) >= MAX_SAUVEGARDES) {
		return { error: `Tu as atteint ${MAX_SAUVEGARDES} avatars enregistrés — supprimes-en un.` };
	}
	const resultat = await depot.inserer({ userId, nom: nomPropre(nom), donnees, code });
	if (resultat.error?.code === "23505")
		return { error: "Cet avatar est déjà partagé sous ce code." };
	if (resultat.error || !resultat.id) return { error: "Impossible d'enregistrer cet avatar." };
	return { id: resultat.id };
}

export async function listerDansDepot(
	depot: DepotSauvegardes,
	userId: string | null | undefined
): Promise<{ avatars?: Sauvegarde[]; error?: string }> {
	if (!userId) return { avatars: [] };
	const resultat = await depot.lister(userId, MAX_SAUVEGARDES);
	if (resultat.error) return { error: "Impossible de relire tes avatars." };
	return {
		avatars: (resultat.lignes ?? []).map(({ id, nom, code, donnees, modifieLe }) => ({
			id,
			nom,
			code,
			donnees,
			modifieLe,
		})),
	};
}

export async function ouvrirDansDepot(
	depot: DepotSauvegardes,
	code: string
): Promise<{ avatar?: AvatarEnregistre; nom?: string; error?: string }> {
	const propre = code.trim();
	if (!codePartageValide(propre)) return { error: "Ce code de partage n'est pas valide." };
	const resultat = await depot.trouverParCode(propre);
	if (resultat.error) return { error: "Impossible d'ouvrir ce code." };
	if (!resultat.ligne) return { error: "Aucun avatar ne porte ce code." };
	if (!recetteAvatarValide(resultat.ligne.donnees)) {
		return { error: "La recette liée à ce code n'est pas valide." };
	}
	return { avatar: resultat.ligne.donnees, nom: resultat.ligne.nom };
}

export async function supprimerDansDepot(
	depot: DepotSauvegardes,
	userId: string | null | undefined,
	id: string
): Promise<{ error?: string }> {
	if (!userId) return { error: "Connecte-toi pour supprimer un avatar." };
	if (!UUID.test(id)) return { error: "Sauvegarde inconnue." };
	const resultat = await depot.supprimer(userId, id);
	return resultat.error ? { error: "Impossible de supprimer cet avatar." } : {};
}
