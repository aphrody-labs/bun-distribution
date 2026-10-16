import { Geist, Geist_Mono } from "next/font/google";

import type { Metadata } from "next";

// Page technique affichée pendant une coupure : aucun contenu propre à indexer.
export const metadata: Metadata = {
	robots: { follow: false, index: false },
	title: "Maintenance · Rose Griffon",
};


const geistSans = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-geist-mono",
});

export default function MaintenancePage() {
	return (
		<div
			className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col items-center justify-center bg-background text-foreground p-4 text-center font-sans`}
		>
			<h1 className="mb-4 text-4xl font-extrabold tracking-tight lg:text-5xl">
				Maintenance en cours
			</h1>
			<p className="max-w-[600px] text-lg text-muted-foreground sm:text-xl">
				Rose Griffon est actuellement en cours de mise à jour. Nous serons de retour très bientôt.
				Merci de votre patience !
			</p>
		</div>
	);
}
