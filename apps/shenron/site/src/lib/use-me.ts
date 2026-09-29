"use client";

import { useEffect, useState } from "react";

export type Me = {
	authenticated: boolean;
	username: string | null;
	avatar: string | null;
	isAdmin: boolean;
};

// Cache module-level + requête en vol partagée : la nav desktop ET la nav mobile
// consomment le même `/api/me` sans le fetcher deux fois.
let cache: Me | undefined;
let inflight: Promise<Me> | undefined;

const ANON: Me = {
	authenticated: false,
	username: null,
	avatar: null,
	isAdmin: false,
};

function fetchMe(): Promise<Me> {
	inflight ??= fetch("/api/me", { credentials: "include" })
		.then((r) => (r.ok ? (r.json() as Promise<Me>) : ANON))
		.then((m) => {
			cache = m;
			return m;
		})
		.catch(() => ANON);
	return inflight;
}

/** État d'auth client (nav). `undefined` tant que le 1er fetch n'a pas répondu. */
export function useMe(): Me | undefined {
	// TOUJOURS `undefined` au premier rendu, JAMAIS `cache` — même si la réponse
	// est déjà là. Le serveur rend forcément l'état anonyme (le layout n'a pas le
	// droit de lire la session, sinon tout le site perd son cache CDN) : partir du
	// cache faisait hydrater un arbre différent du HTML servi, React abandonnait
	// l'hydratation et regénérait la branche (« Minified React error #418 »).
	// Symptôme vécu : intermittent — 1 à 3 chargements sur 6 selon que `/api/me`
	// avait répondu avant l'hydratation — et pendant la régénération les clics ne
	// prenaient pas. L'effet ci-dessous applique le cache dès le montage : le coût
	// est un rendu de plus, pas un aller-retour réseau.
	const [me, setMe] = useState<Me | undefined>(undefined);
	useEffect(() => {
		if (cache) {
			setMe(cache);
			return;
		}
		let alive = true;
		void fetchMe().then((m) => {
			if (alive) setMe(m);
		});
		return () => {
			alive = false;
		};
	}, []);
	return me;
}
