/**
 * Enveloppes de réponse transverses.
 *
 * L'API Achilléa n'a pas une enveloppe unique : les mutations de clans, de
 * tournois et d'organisations renvoient `{ success, error? }`, et certains
 * contrôleurs y ajoutent `data`. Les deux formes sont décrites ici plutôt que
 * réinventées par chaque appelant.
 */

/** Réponse des mutations : `{ success, error? }`. */
export interface SuccessResponse {
	success: boolean;
	error?: string;
}

/** Réponse enveloppée : `{ success, data?, error? }`. */
export interface ApiEnvelope<T> {
	success: boolean;
	data?: T;
	error?: string;
}

/**
 * Relation sérialisée par l'ORM : soit l'identifiant seul, soit l'entité
 * peuplée, selon que la requête a chargé la relation ou non. Un client doit
 * gérer les deux cas — d'où ce type plutôt qu'un objet supposé toujours présent.
 */
export type EntityRef<T> = number | T;

/** `POST /proxy/upload` — image dédupliquée par hash côté API. */
export interface UploadedImage {
	id: string;
	url: string;
}
