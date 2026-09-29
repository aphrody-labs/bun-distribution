"use client";

// SPDX-License-Identifier: Apache-2.0

/**
 * Hook d'accès aux capacités de l'appareil — une seule mesure par onglet.
 *
 * Le profil est calculé une fois puis partagé : mesurer les images par seconde
 * dans chaque composant qui s'y intéresse ferait tourner autant de boucles
 * d'animation qu'il y a d'abonnés, pour mesurer… la charge qu'elles créent.
 *
 * Le premier rendu retombe sur un profil **prudent mais pas dégradé** : « moyen »
 * partout. Deviner « puissant » ferait démarrer les animations avant de savoir,
 * et sur un appareil lent c'est précisément le moment où ça se voit ; deviner
 * « léger » priverait tout le monde des animations pendant une demi-seconde.
 */
import { useEffect, useState } from "react";
import {
	classerAppareil,
	classerReseau,
	detecterGpu,
	mesurerFps,
	mesurerReseau,
	reglagesPour,
	type CapacitesClient,
	type Reglages,
} from "@/lib/capacites-client";

type Connexion = {
	effectiveType?: string;
	downlink?: number;
	rtt?: number;
	saveData?: boolean;
	addEventListener?: (t: string, f: () => void) => void;
	removeEventListener?: (t: string, f: () => void) => void;
};

const DEFAUT: CapacitesClient = {
	appareil: "moyen",
	reseau: "moyen",
	fps: null,
	coeurs: null,
	memoireGo: null,
	gpu: null,
	debitMbps: null,
	latenceMs: null,
	ecran: { largeur: 0, hauteur: 0, densite: 1, hdr: false, hz: null },
	animationsReduites: false,
	economieDonnees: false,
};

let cache: CapacitesClient | null = null;
let enCours: Promise<CapacitesClient> | null = null;
const abonnes = new Set<(c: CapacitesClient) => void>();

function connexion(): Connexion | null {
	return (navigator as unknown as { connection?: Connexion }).connection ?? null;
}

async function calculer(): Promise<CapacitesClient> {
	const conn = connexion();
	const economieDonnees = conn?.saveData === true;
	const animationsReduites =
		typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

	// Le FPS se mesure APRÈS le premier rendu, sinon on mesure le coût du
	// montage de la page plutôt que la capacité de la machine.
	const fps = await mesurerFps();
	const { debitMbps: mesureDebit, latenceMs: mesureLatence } = mesurerReseau();
	const gpu = await detecterGpu();

	const densite = Math.round((window.devicePixelRatio || 1) * 100) / 100;
	// `downlink` est plafonné à 10 Mb/s par la spécification : au-delà, la
	// mesure réelle en sait davantage.
	const debitMbps = mesureDebit ?? (typeof conn?.downlink === "number" ? conn.downlink : null);
	const latenceMs = mesureLatence ?? (typeof conn?.rtt === "number" ? conn.rtt : null);
	const coeurs =
		typeof navigator.hardwareConcurrency === "number" ? navigator.hardwareConcurrency : null;
	const memoireGo = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null;

	const c: CapacitesClient = {
		appareil: classerAppareil({ fps, coeurs, memoireGo, densite }),
		reseau: classerReseau({
			effectiveType: conn?.effectiveType ?? null,
			debitMbps,
			latenceMs,
			economieDonnees,
		}),
		fps,
		coeurs,
		memoireGo,
		gpu,
		debitMbps,
		latenceMs,
		ecran: {
			largeur: window.screen?.width ?? window.innerWidth,
			hauteur: window.screen?.height ?? window.innerHeight,
			densite,
			hdr: typeof matchMedia === "function" && matchMedia("(dynamic-range: high)").matches,
			// Le FPS mesuré EST le taux de rafraîchissement quand la machine
			// tient la cadence ; en dessous de 45 il ne dit plus rien de l'écran.
			hz: fps !== null && fps >= 45 ? fps : null,
		},
		animationsReduites,
		economieDonnees,
	};
	cache = c;
	for (const f of abonnes) f(c);
	return c;
}

/** Capacités mesurées (profil « moyen » tant que la mesure n'a pas abouti). */
function useCapacites(): CapacitesClient {
	const [etat, setEtat] = useState<CapacitesClient>(() => cache ?? DEFAUT);

	useEffect(() => {
		if (cache) {
			setEtat(cache);
		} else {
			enCours ??= calculer();
			enCours.then(setEtat).catch(() => {});
		}
		abonnes.add(setEtat);

		// Le réseau change en cours de route (wifi → cellulaire) : on reclasse
		// sans refaire la mesure d'images par seconde, qui n'a pas bougé.
		const conn = connexion();
		const onChange = () => {
			if (!cache) return;
			const c = connexion();
			const maj: CapacitesClient = {
				...cache,
				economieDonnees: c?.saveData === true,
				reseau: classerReseau({
					effectiveType: c?.effectiveType ?? null,
					debitMbps: cache.debitMbps,
					latenceMs: cache.latenceMs,
					economieDonnees: c?.saveData === true,
				}),
			};
			cache = maj;
			for (const f of abonnes) f(maj);
		};
		conn?.addEventListener?.("change", onChange);

		return () => {
			abonnes.delete(setEtat);
			conn?.removeEventListener?.("change", onChange);
		};
	}, []);

	return etat;
}

/** Décisions d'affichage dérivées du profil. */
export function useReglages(): Reglages {
	const c = useCapacites();
	return reglagesPour({
		appareil: c.appareil,
		reseau: c.reseau,
		animationsReduites: c.animationsReduites,
		economieDonnees: c.economieDonnees,
		densite: c.ecran.densite,
	});
}
