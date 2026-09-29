/**
 * Consentement RGPD — état minimal, client-only, sans dépendance.
 *
 * Stocke le choix de l'utilisateur (analytics oui/non) dans `localStorage` et
 * expose un petit bus de souscription. Pilote :
 *   - la télémétrie first-party + Vercel Analytics (`telemetry.ts`),
 *   - le Consent Mode v2 de Google (GTM) via `gtag('consent', 'update', …)`.
 *
 * Catégorisation RGPD : la mesure d'audience first-party anonymisée PEUT être
 * exemptée de consentement dans certains régimes (CNIL), mais on adopte ici une
 * posture stricte (opt-in) pour Vercel + GTM + first-party tant que la bannière
 * n'a pas été tranchée. Le strictement nécessaire (auth, sécurité) n'est jamais
 * conditionné.
 */

export type ConsentState = {
	/** L'utilisateur a-t-il accepté la mesure d'audience / analytics ? */
	analytics: boolean;
	/** A-t-il fait un choix explicite (true) ou est-ce l'état par défaut ? */
	decided: boolean;
};

const STORAGE_KEY = "dbfr_consent";
const isBrowser = typeof window !== "undefined";

/** État par défaut : refus (opt-in strict UE) tant que pas de choix. */
const DEFAULT: ConsentState = { analytics: false, decided: false };

let current: ConsentState = DEFAULT;
const listeners = new Set<(c: ConsentState) => void>();

function read(): ConsentState {
	if (!isBrowser) return DEFAULT;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT;
		const parsed = JSON.parse(raw) as Partial<ConsentState>;
		return {
			analytics: parsed.analytics === true,
			decided: parsed.decided === true,
		};
	} catch {
		return DEFAULT;
	}
}

// Hydrate au chargement du module (client).
if (isBrowser) {
	current = read();
	syncGoogleConsent(current);
}

/** État de consentement courant (lecture synchrone). */
export function getConsent(): ConsentState {
	return current;
}

type GtagWindow = Window & {
	dataLayer?: unknown[];
	gtag?: (...args: unknown[]) => void;
};

/**
 * Propage le choix au Consent Mode v2 de Google (GTM). Utilise `gtag()` s'il
 * existe, sinon pousse directement la commande consent dans le dataLayer (forme
 * acceptée par GTM : `['consent','update', {...}]`).
 */
function syncGoogleConsent(c: ConsentState): void {
	if (!isBrowser) return;
	const w = window as GtagWindow;
	const granted = c.analytics ? "granted" : "denied";
	const update = {
		analytics_storage: granted,
		ad_storage: granted,
		ad_user_data: granted,
		ad_personalization: granted,
	};
	if (typeof w.gtag === "function") {
		w.gtag("consent", "update", update);
	} else {
		w.dataLayer ??= [];
		w.dataLayer.push(["consent", "update", update]);
	}
}

/** Enregistre le choix utilisateur et notifie les abonnés + Google Consent Mode. */
export function setConsent(analytics: boolean): void {
	current = { analytics, decided: true };
	if (isBrowser) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
		} catch {
			/* ignore */
		}
		syncGoogleConsent(current);
	}
	for (const l of listeners) l(current);
}

/**
 * Variante appliquée quand un **CMP certifié IAB TCF** est présent sur la page
 * (« Confidentialité et messages » d'AdSense / Funding Choices). Dans ce cas,
 * c'est le CMP qui est la source de vérité du consentement publicitaire :
 *  - il pilote lui-même `ad_storage` / `ad_user_data` / `ad_personalization`
 *    auprès de Google — on n'y touche pas, sous peine d'écraser un signal
 *    certifié par un signal maison (et de perdre la diffusion dans l'EEE) ;
 *  - on ne recopie que la dimension *mesure d'audience*, qui pilote notre
 *    télémétrie first-party et `analytics_storage`.
 *
 * `decided` passe à `true` : notre propre bannière ne doit plus s'afficher, le
 * visiteur a déjà tranché dans celle du CMP.
 */
export function setConsentFromCmp(analytics: boolean): void {
	current = { analytics, decided: true };
	if (isBrowser) {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
		} catch {
			/* ignore */
		}
		const w = window as GtagWindow;
		const update = { analytics_storage: analytics ? "granted" : "denied" };
		if (typeof w.gtag === "function") w.gtag("consent", "update", update);
		else {
			w.dataLayer ??= [];
			w.dataLayer.push(["consent", "update", update]);
		}
	}
	for (const l of listeners) l(current);
}

/** S'abonne aux changements de consentement. Retourne un cleanup. */
export function onConsentChange(fn: (c: ConsentState) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}
