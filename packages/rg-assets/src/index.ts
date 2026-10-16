/**
 * Contrat unique des assets publics Rose Griffon.
 *
 * Les visuels communs vivent dans `packages/assets/public` et sont publiés
 * sous `/static/rg/public`. Les fichiers extraits du jeu restent sous
 * `/static/azalee` : ils ont leur propre cycle de génération et ne doivent pas
 * être confondus avec les éléments de marque.
 */
export const DEFAULT_CDN_ORIGIN = "https://cdn.rosegriffon.fr";
export const SHARED_ASSETS_PATH = "/static/rg/public";
export const GAME_ASSETS_PATH = "/static/azalee";

/** Normalise une origine sans accepter de chemin, query string ou fragment. */
export function cdnOrigin(configuredOrigin?: string): string {
	const candidate = configuredOrigin?.trim() || DEFAULT_CDN_ORIGIN;
	const url = new URL(candidate);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("L'origine CDN doit utiliser HTTP ou HTTPS.");
	}
	if (url.pathname !== "/" || url.search || url.hash) {
		throw new Error("L'origine CDN ne doit contenir ni chemin, ni query string, ni fragment.");
	}
	return url.origin;
}

/** Construit une URL CDN à partir d'un chemin public, sans double slash. */
export function cdnUrl(path: string, configuredOrigin?: string): string {
	if (!path || !path.startsWith("/")) {
		throw new Error("Le chemin CDN doit commencer par '/'.");
	}
	return `${cdnOrigin(configuredOrigin)}${path}`;
}

/** Asset de marque/commun publié par `@rosegriffon/assets`. */
export function sharedAssetUrl(path: string, configuredOrigin?: string): string {
	return cdnUrl(`${SHARED_ASSETS_PATH}/${path.replace(/^\/+/, "")}`, configuredOrigin);
}

/** Asset de jeu Azalée : données générées, textures, sprites et médias CPK. */
export function gameAssetUrl(path: string, configuredOrigin?: string): string {
	return cdnUrl(`${GAME_ASSETS_PATH}/${path.replace(/^\/+/, "")}`, configuredOrigin);
}
