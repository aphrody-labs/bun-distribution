import { NextResponse } from "next/server";

import { SITE_URL } from "@/lib/site-url";

// Données 100% statiques (mascots, socials).
export const revalidate = 86_400;

export async function GET() {
	const info = {
		colors: {
			primary: "#a14b3f", // Rouge Roy
			secondary: "#2f6e9c", // Bleu Gaëlle
		},
		contact: "contact@rosegriffon.fr",
		mascots: {
			gaelle: {
				color: "#2f6e9c",
				description: "Mascotte féminine (cheveux bleus)",
				name: "Gaëlle",
			},
			roy: {
				color: "#a14b3f",
				description: "Mascotte masculine (cheveux rouges/bruns)",
				name: "Roy",
			},
		},
		name: "Rose Griffon",
		slogan: "La communauté française dans ce qu'elle a d'entier.",
		socials: {
			discord: "https://discord.gg/rosegriffon", // À vérifier
			twitch: "https://twitch.tv/rose_griffontv",
			twitter: "https://twitter.com/RoseGriffonFR",
			youtube: "https://youtube.com/@RoseGriffon",
		},
		structure: {
			achillea: "E-Sport / Compétition",
			azalee: "Média / Actualités",
			rose_griffon: "Cœur / Communauté / Art",
		},
		website: SITE_URL,
	};

	return NextResponse.json({
		data: info,
		success: true,
	});
}
