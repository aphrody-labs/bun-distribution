import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
	return {
		background_color: "#ffffff",
		categories: ["gaming", "social", "entertainment"],
		description:
			"Site officiel de l'association Rose Griffon, rassemblant la communauté Inazuma Eleven en France.",
		display: "standalone",
		// Trois fichiers RÉELS, générés aux dimensions annoncées. La version
		// précédente déclarait deux fois le même WebP de 1920 px en le disant
		// 192 puis 512 : le navigateur téléchargeait 100 Ko pour une icône de
		// lanceur, et Android refuse une icône dont la taille ne correspond pas.
		icons: [
			{
				src: "/icon-192.png",
				sizes: "192x192",
				type: "image/png",
				purpose: "any",
			},
			{
				src: "/icon-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "any",
			},
			// `maskable` est rogné en cercle ou en écusson selon le lanceur : le
			// logo y est réduit à 80 % sur fond blanc pour rester entier dans la
			// zone sûre. Le même fichier que `any` perdrait l'éclair et la rose.
			{
				src: "/icon-maskable-512.png",
				sizes: "512x512",
				type: "image/png",
				purpose: "maskable",
			},
		],
		lang: "fr-FR",
		name: "Rose Griffon - Association Inazuma Eleven France",
		orientation: "portrait-primary",
		short_name: "Rose Griffon",
		start_url: "/",
		theme_color: "#a14b3f",
	};
}
