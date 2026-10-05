// SPDX-License-Identifier: Apache-2.0

/**
 * Capacités de l'appareil et de la connexion — détection et **mesure**.
 *
 * Pourquoi ne pas se contenter de ce que le navigateur déclare : les valeurs
 * déclaratives sont approximatives quand elles existent, et absentes ailleurs.
 * `navigator.hardwareConcurrency` est arrondi et parfois plafonné à 8 par
 * lutte contre le pistage ; `navigator.deviceMemory` n'existe que sur
 * Chromium et rend des paliers (0,25 / 0,5 / 1 / 2 / 4 / 8) ; le nom du GPU est
 * masqué par Safari et Firefox ; `navigator.connection` n'existe ni sur Safari
 * ni sur Firefox — c'est-à-dire pour une bonne part du trafic mobile.
 *
 * Ce module croise donc trois sources, dans cet ordre de confiance :
 *
 *  1. **la mesure** — images par seconde réellement rendues, débit réellement
 *     obtenu sur une ressource déjà nécessaire ;
 *  2. **le déclaratif** — cœurs, mémoire, type de réseau, quand il est là ;
 *  3. **les préférences** — `prefers-reduced-motion` et `Save-Data`, qui
 *     priment sur tout le reste : ce sont des choix, pas des symptômes.
 *
 * Ce qu'on en fait : décider de la qualité des images, du préchargement, des
 * animations de fond et de la lecture automatique. Rien n'est envoyé au serveur
 * — le profil vit dans l'onglet, et le site a un consentement strict pour la
 * mesure d'audience (cf. `lib/consent.ts`). Ce n'est pas un mouchard, c'est un
 * réglage.
 */

export type NiveauAppareil = "leger" | "moyen" | "puissant";
export type NiveauReseau = "lent" | "moyen" | "rapide";

export interface CapacitesClient {
	appareil: NiveauAppareil;
	reseau: NiveauReseau;
	/** Images par seconde mesurées au démarrage (null si non mesuré). */
	fps: number | null;
	/** Cœurs logiques déclarés (null si le navigateur ne le dit pas). */
	coeurs: number | null;
	/** Mémoire déclarée, en Go, par paliers (null hors Chromium). */
	memoireGo: number | null;
	/** Nom du GPU si le navigateur accepte de le donner. */
	gpu: string | null;
	/** Débit descendant estimé, en Mb/s (déclaré ou mesuré). */
	debitMbps: number | null;
	/** Latence aller-retour estimée, en ms. */
	latenceMs: number | null;
	ecran: {
		largeur: number;
		hauteur: number;
		/** Rapport de pixels physiques — 2 ou 3 sur mobile récent. */
		densite: number;
		/** L'écran annonce-t-il une plage dynamique étendue ? */
		hdr: boolean;
		/** Taux de rafraîchissement mesuré (Hz), null si non mesuré. */
		hz: number | null;
	};
	/** L'utilisateur a demandé moins d'animations. */
	animationsReduites: boolean;
	/** L'utilisateur a demandé l'économie de données. */
	economieDonnees: boolean;
}

/* ─────────────────────────── Mesures ─────────────────────────── */

/**
 * Images par seconde sur une courte fenêtre.
 *
 * `requestAnimationFrame` est cadencé par le compositeur : compter ses appels
 * mesure à la fois le taux de rafraîchissement de l'écran ET la capacité de la
 * machine à le tenir. C'est la seule donnée qui distingue un mobile récent
 * d'un mobile d'entrée de gamme — les deux déclarent souvent 8 cœurs.
 */
export function mesurerFps(dureeMs = 500): Promise<number | null> {
	if (typeof requestAnimationFrame !== "function") return Promise.resolve(null);
	return new Promise((resolve) => {
		let images = 0;
		const debut = performance.now();
		const tick = () => {
			images++;
			const ecoule = performance.now() - debut;
			if (ecoule >= dureeMs) resolve(Math.round((images * 1000) / ecoule));
			else requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
}

/**
 * Débit et latence, lus dans les mesures que le navigateur a DÉJÀ faites.
 *
 * On n'ajoute pas de téléchargement de test : ce serait payer en données ce
 * qu'on prétend économiser. `PerformanceResourceTiming` porte la taille
 * transférée et la durée de chaque ressource de la page — les images du wiki
 * en fournissent largement assez.
 */
export function mesurerReseau(): { debitMbps: number | null; latenceMs: number | null } {
	if (typeof performance?.getEntriesByType !== "function") {
		return { debitMbps: null, latenceMs: null };
	}
	const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
	// Seules les ressources d'un poids réel disent quelque chose du débit :
	// sur un fichier de 2 Ko, la latence domine et le calcul rendrait n'importe
	// quoi.
	const grosses = res.filter((r) => r.transferSize > 20_000 && r.duration > 0);
	let debitMbps: number | null = null;
	if (grosses.length > 0) {
		// Médiane et non moyenne : une seule ressource servie depuis le cache
		// (durée quasi nulle) ferait exploser une moyenne.
		const debits = grosses
			.map((r) => (r.transferSize * 8) / (r.duration / 1000) / 1_000_000)
			.toSorted((a, b) => a - b);
		debitMbps = Math.round(debits[Math.floor(debits.length / 2)] * 10) / 10;
	}

	const nav = performance.getEntriesByType("navigation")[0] as
		| PerformanceNavigationTiming
		| undefined;
	const latenceMs =
		nav && nav.responseStart > 0 && nav.requestStart > 0
			? Math.round(nav.responseStart - nav.requestStart)
			: null;
	return { debitMbps, latenceMs };
}

/**
 * Nom du GPU, quand le navigateur veut bien le donner.
 *
 * WebGPU d'abord (`adapter.info`, la voie moderne et non dépréciée), WebGL
 * ensuite via `WEBGL_debug_renderer_info`. Le contexte est libéré aussitôt :
 * garder un contexte WebGL ouvert consomme de la mémoire vidéo pour une chaîne
 * de caractères.
 */
export async function detecterGpu(): Promise<string | null> {
	try {
		const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
		if (gpu) {
			const adapter = (await gpu.requestAdapter()) as { info?: Record<string, string> } | null;
			const info = adapter?.info;
			if (info) {
				const nom = [info.vendor, info.architecture].filter(Boolean).join(" ").trim();
				if (nom) return nom;
			}
		}
	} catch {
		// WebGPU absent ou refusé : on tente WebGL.
	}
	try {
		const canvas = document.createElement("canvas");
		const gl = (canvas.getContext("webgl") ??
			canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
		if (!gl) return null;
		const ext = gl.getExtension("WEBGL_debug_renderer_info");
		const nom = ext
			? (gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string)
			: (gl.getParameter(gl.RENDERER) as string);
		gl.getExtension("WEBGL_lose_context")?.loseContext();
		return typeof nom === "string" && nom.trim() ? nom.trim() : null;
	} catch {
		return null;
	}
}

/* ─────────────────────────── Classement ─────────────────────────── */

/**
 * Décide du niveau d'appareil. Fonction PURE : c'est elle qu'on teste, et elle
 * ne doit jamais dépendre d'un objet global.
 *
 * Le FPS prime quand il a été mesuré : c'est la seule donnée qui reflète ce que
 * la machine fait vraiment. En dessous de 45 images par seconde soutenues, une
 * animation de fond coûte plus qu'elle n'apporte.
 */
export function classerAppareil(x: {
	fps: number | null;
	coeurs: number | null;
	memoireGo: number | null;
	densite: number;
}): NiveauAppareil {
	if (x.fps !== null) {
		if (x.fps < 45) return "leger";
		// Un écran à 120 Hz qui tient la cadence est un appareil récent, quoi
		// qu'en dise `hardwareConcurrency`.
		if (x.fps >= 100) return "puissant";
	}
	const coeurs = x.coeurs ?? 0;
	const memoire = x.memoireGo ?? 0;
	if ((coeurs > 0 && coeurs <= 4) || (memoire > 0 && memoire <= 2)) return "leger";
	if (coeurs >= 8 && memoire >= 8) return "puissant";
	// Sans rien de déclaré et sans FPS bas : un écran très dense sans mémoire
	// annoncée est le profil typique d'un mobile — on reste prudent.
	if (x.coeurs === null && x.memoireGo === null && x.densite >= 3) return "moyen";
	return "moyen";
}

/**
 * Décide du niveau de réseau. `economieDonnees` écrase tout : c'est une
 * demande explicite, pas une déduction.
 */
export function classerReseau(x: {
	effectiveType: string | null;
	debitMbps: number | null;
	latenceMs: number | null;
	economieDonnees: boolean;
}): NiveauReseau {
	if (x.economieDonnees) return "lent";
	if (x.effectiveType === "slow-2g" || x.effectiveType === "2g") return "lent";
	if (x.effectiveType === "3g") return "moyen";
	if (x.debitMbps !== null) {
		if (x.debitMbps < 1.5) return "lent";
		if (x.debitMbps >= 10) return "rapide";
		return "moyen";
	}
	if (x.latenceMs !== null && x.latenceMs > 600) return "lent";
	if (x.effectiveType === "4g") return "rapide";
	return "moyen";
}

/* ─────────────────────────── Ce qu'on en fait ─────────────────────────── */

export interface Reglages {
	/** Qualité d'image visée (largeur maximale servie). */
	largeurImageMax: number;
	/** Animations de fond (ken-burns, aurora, starfield). */
	animationsFond: boolean;
	/** Lecture automatique des carrousels et vidéos. */
	lectureAuto: boolean;
	/** Nombre d'éléments préchargés en avance dans les listes virtuelles. */
	prechargement: number;
}

/**
 * Traduit un profil en décisions concrètes. Une seule fonction, pour que
 * l'arbitrage soit lisible d'un coup d'œil plutôt que dispersé dans dix
 * composants.
 */
export function reglagesPour(c: {
	appareil: NiveauAppareil;
	reseau: NiveauReseau;
	animationsReduites: boolean;
	economieDonnees: boolean;
	densite: number;
}): Reglages {
	const faible = c.appareil === "leger" || c.reseau === "lent";
	// Les largeurs sont celles autorisées par `next.config.ts` (`qualities`/
	// `deviceSizes`) : demander une largeur hors liste rend un 400, pas une
	// image plus petite.
	const largeurImageMax =
		c.economieDonnees || c.reseau === "lent" ? 640 : faible ? 1080 : c.densite >= 2 ? 1920 : 1200;
	return {
		largeurImageMax,
		// `prefers-reduced-motion` est un choix de l'utilisateur : il n'est jamais
		// réexaminé à la lumière d'une mesure de performance.
		animationsFond: !c.animationsReduites && c.appareil !== "leger",
		lectureAuto: !c.animationsReduites && !faible,
		prechargement: faible ? 1 : c.appareil === "puissant" ? 6 : 3,
	};
}
