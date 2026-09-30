/**
 * `ogMeta` — aperçus de partage.
 *
 * Régression vécue le 2026-08-21 : le helper posait `images: undefined` en
 * l'absence d'image, en croyant laisser la page hériter de la carte de marque
 * (`app/opengraph-image.tsx`). Elle n'en héritait pas — déclarer `openGraph`
 * REMPLACE l'objet hérité. Toutes les pages appelant `ogMeta` sans visuel
 * propre (`/shop`, `/leaderboard`, `/classements`, `/stats`, `/jeux`, et chaque
 * fiche sans image) se partageaient donc sans vignette sur Discord et Twitter.
 * Le défaut était invisible depuis le code : chaque page semblait correcte.
 */
import { describe, expect, test } from "bun:test";
import { ogMeta } from "../src/lib/og";

describe("ogMeta", () => {
	test("émet TOUJOURS une image, même sans image propre", () => {
		const m = ogMeta({ title: "Une page" });
		expect(m.openGraph?.images).toBeDefined();
		expect(Array.isArray(m.openGraph?.images) && m.openGraph.images.length).toBeGreaterThan(0);
		expect(m.twitter?.images).toBeDefined();
	});

	test("l'image de repli est une URL absolue", () => {
		const imgs = ogMeta({ title: "x" }).openGraph?.images as Array<{ url: string }>;
		expect(imgs[0]!.url).toMatch(/^https?:\/\//);
	});

	test("une image fournie prime sur le repli", () => {
		const url = "https://bot.dragonballfr.com/db/x.png";
		const imgs = ogMeta({ title: "x", image: url }).openGraph?.images as Array<{ url: string }>;
		expect(imgs[0]!.url).toBe(url);
	});

	test("la canonique alimente à la fois `alternates` et `og:url`", () => {
		const m = ogMeta({ title: "x", canonical: "/wiki/films" });
		expect(m.alternates?.canonical).toBe("/wiki/films");
		expect(m.openGraph && "url" in m.openGraph ? m.openGraph.url : null).toBe("/wiki/films");
	});

	test("sans canonique, aucune `alternates` n'est imposée", () => {
		expect(ogMeta({ title: "x" }).alternates).toBeUndefined();
	});

	test("les types vidéo sont ramenés à `video.other` (valeur OG valide)", () => {
		// `OpenGraph` est une union discriminée : `type` n'existe pas sur toutes
		// ses branches, d'où la lecture via un index plutôt qu'un accès direct.
		for (const t of ["video.episode", "video.movie"] as const) {
			const og = ogMeta({ title: "x", type: t }).openGraph as Record<string, unknown>;
			expect(og.type).toBe("video.other");
		}
	});
});
