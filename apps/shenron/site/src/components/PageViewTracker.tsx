"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { trackPageView } from "@/lib/telemetry";

/**
 * Émet une `pageview` (visite) à chaque changement de route — y compris au
 * premier chargement. C'est la source des KPIs d'audience du dashboard
 * « Activité du site » (visites, visiteurs uniques, sessions, top pages, sources).
 *
 * Île client montée dans le layout racine :
 *   - lit UNIQUEMENT `usePathname()` (jamais `useSearchParams` → pas de dé-opt
 *     statique, jamais de `cookies()`/`headers()` → cache CDN préservé) ;
 *   - `track()` est no-op sans consentement / sous Do-Not-Track (cf. telemetry.ts)
 *     → 100 % RGPD, rien n'est envoyé sans accord explicite.
 *
 * Ne compte pas les query strings (le path est normalisé côté ingest, sans `?`).
 */
export function PageViewTracker() {
	const pathname = usePathname();
	const last = useRef<string | null>(null);

	useEffect(() => {
		if (last.current === pathname) return; // dé-doublonne un même path
		last.current = pathname;
		trackPageView();
	}, [pathname]);

	return null;
}
