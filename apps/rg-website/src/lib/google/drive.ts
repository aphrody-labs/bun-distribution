import "server-only";

import { google } from "googleapis";

/**
 * Accès en lecture au Drive partagé de l'association.
 *
 * Authentification par **compte de service** (`calendar-service@rgfr-8927d`),
 * pas par le client OAuth web : le tableau de bord lit des dossiers partagés
 * avec ce compte, il n'a donc pas besoin qu'un administrateur se connecte, et
 * cet accès reste fonctionnel indépendamment de la connexion « Google » des
 * visiteurs.
 *
 * Les identifiants viennent des mêmes variables que le calendrier
 * (`GOOGLE_CLIENT_EMAIL` + `GOOGLE_PRIVATE_KEY`), avec le même garde-fou contre
 * les valeurs restées sous forme de secret scellé.
 */

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

/** Un secret scellé non déchiffré commence par ce préfixe une fois encodé. */
function isSealedBlob(value: string): boolean {
	return value.startsWith("eyJ2Ijoi");
}

export interface DriveFile {
	id: string;
	name: string;
	mimeType: string;
	modifiedTime: string | null;
	size: number | null;
	webViewLink: string | null;
	isFolder: boolean;
}

/** Libellé lisible d'un type MIME Google. */
export function describeMimeType(mimeType: string): string {
	const map: Record<string, string> = {
		"application/pdf": "PDF",
		"application/vnd.google-apps.document": "Document",
		"application/vnd.google-apps.folder": "Dossier",
		"application/vnd.google-apps.presentation": "Présentation",
		"application/vnd.google-apps.spreadsheet": "Feuille de calcul",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Classeur Excel",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Document Word",
	};
	if (map[mimeType]) {
		return map[mimeType];
	}
	if (mimeType.startsWith("image/")) {
		return "Image";
	}
	if (mimeType.startsWith("video/")) {
		return "Vidéo";
	}
	return mimeType.split("/").pop() ?? mimeType;
}

/**
 * Derniers fichiers modifiés du Drive partagé.
 *
 * Renvoie une liste vide plutôt que de lever : le tableau de bord doit rester
 * affichable si Google est indisponible ou si les identifiants manquent.
 */
export async function listRecentDriveFiles(limit = 8): Promise<DriveFile[]> {
	const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
	const privateKey = process.env.GOOGLE_PRIVATE_KEY;

	if (!clientEmail || !privateKey) {
		return [];
	}
	if (isSealedBlob(clientEmail) || isSealedBlob(privateKey)) {
		console.error(
			"[drive] identifiants inutilisables : un secret scellé (eyJ2Ijoi…) a remplacé la valeur en clair."
		);
		return [];
	}

	try {
		const auth = new google.auth.GoogleAuth({
			credentials: {
				client_email: clientEmail,
				// Les sauts de ligne de la clé PEM sont stockés littéralement (`\n`)
				// dans le fichier d'environnement.
				private_key: privateKey.replaceAll(/\\n/g, "\n"),
			},
			scopes: SCOPES,
		});

		const drive = google.drive({ auth, version: "v3" });
		const res = await drive.files.list({
			fields: "files(id,name,mimeType,modifiedTime,size,webViewLink)",
			orderBy: "modifiedTime desc",
			pageSize: limit,
			// Inclut les Drive partagés, sinon seuls les fichiers appartenant en
			// propre au compte de service remontent — c'est-à-dire aucun.
			includeItemsFromAllDrives: true,
			supportsAllDrives: true,
			q: "trashed = false",
		});

		return (res.data.files ?? []).map((file) => ({
			id: file.id ?? "",
			isFolder: file.mimeType === "application/vnd.google-apps.folder",
			mimeType: file.mimeType ?? "",
			modifiedTime: file.modifiedTime ?? null,
			name: file.name ?? "Sans nom",
			size: file.size ? Number(file.size) : null,
			webViewLink: file.webViewLink ?? null,
		}));
	} catch (error) {
		console.error("[drive] listing impossible", error);
		return [];
	}
}
