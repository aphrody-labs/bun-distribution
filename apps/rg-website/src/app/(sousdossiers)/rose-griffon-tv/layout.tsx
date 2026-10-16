import type { Metadata, Viewport } from "next";

import { absoluteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
	alternates: { canonical: absoluteUrl("/rose-griffon-tv") },
	description:
		"Votre rendez-vous quotidien 100% Inazuma Eleven sur Twitch et YouTube avec Rose Griffon TV.",
	openGraph: {
		description:
			"Votre rendez-vous quotidien 100% Inazuma Eleven sur Twitch et YouTube avec Rose Griffon TV.",
		images: [
			{
				url: "/rgtv/rgtv.webp",
				width: 1200,
				height: 630,
				alt: "Rose Griffon TV - WebTV Inazuma Eleven",
			},
		],
		title: "Rose Griffon TV | 100% Inazuma Eleven",
		type: "website",
		url: absoluteUrl("/rose-griffon-tv"),
	},
	title: "Rose Griffon TV | 100% Inazuma Eleven",
	twitter: {
		card: "summary_large_image",
		creator: "@rose_griffon",
		description: "Votre rendez-vous quotidien 100% Inazuma Eleven sur Twitch et YouTube.",
		images: ["/rgtv/rgtv.webp"],
		title: "Rose Griffon TV | 100% Inazuma Eleven",
	},
};

export const viewport: Viewport = {
	initialScale: 1,
	maximumScale: 1,
	themeColor: "#a14b3f",
	userScalable: false,
	viewportFit: "cover",
	width: "device-width",
};

export default function RoseGriffonTvLayout({ children }: { children: React.ReactNode }) {
	// La barre du bas est déjà montée par `client-layout.tsx` sur les écrans
	// compacts : la remonter ici en empilait deux.
	return children;
}
