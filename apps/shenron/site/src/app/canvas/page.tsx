import { PageShell } from "@/components/kit";
import type { Metadata } from "next";
import { ogMeta } from "@/lib/og";
import { PageHeader } from "@/components/PageHeader";
import { API_URL as API } from "@/lib/config";

export const metadata: Metadata = {
	title: "Cartes et visuels générés",
	description:
		"Les visuels générés à la volée par le bot Dragon Ball France : cartes de profil, bannières et rendus canvas, avec leurs paramètres.",
	...ogMeta({
		title: "Cartes & visuels — DBFR",
		description: "Les rendus canvas du bot Dragon Ball France et leurs paramètres.",
		type: "website",
		canonical: "/canvas",
	}),
};

const SAMPLES = [
	{
		name: "Profile Card",
		desc: "Carte de profil personnalisée (8 thèmes : default/goku/vegeta/kaio/ssj/blue/rose/ultra)",
		path: "/api/public/profile/:id/card.png",
		example: `${API}/api/public/profile/853295213473038376/card.png`,
		discord: "/eprofil",
	},
	{
		name: "Scan / Scouter",
		desc: "Mesure le 'power level' d'un membre, image style scouter Saiyan",
		path: "/api/public/profile/:id/scan.png",
		example: `${API}/api/public/profile/853295213473038376/scan.png`,
		discord: "/scan @membre",
	},
];

export default function CanvasShowcase() {
	return (
		<PageShell width="default">
			<PageHeader
				eyebrow="Rendu d'images"
				title="Canvas"
				className="mb-10"
				subtitle="Le bot génère des images PNG/WebP/AVIF via Skia (napi-rs). Aperçus live depuis l'API publique."
			/>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-8">
				{SAMPLES.map((s) => (
					<article key={s.path} className="dbz-panel overflow-hidden flex flex-col">
						<div className="aspect-[16/6] bg-dbz-bg overflow-hidden border-b-4 border-dbz-border">
							<img
								src={s.example}
								alt={s.name}
								className="w-full h-full object-cover"
								loading="lazy"
							/>
						</div>
						<div className="p-6 space-y-3">
							<h2 className="text-2xl font-saiyan text-dbz-yellow">{s.name}</h2>
							<p className="text-sm text-gray-300">{s.desc}</p>
							<div className="bg-dbz-bg border-2 border-dbz-border p-3 space-y-2">
								<div className="text-[10px] uppercase text-dbz-blue-light tracking-widest">
									API publique
								</div>
								<code className="block text-xs font-mono text-dbz-orange break-all">
									GET {s.path}
								</code>
							</div>
							<div className="bg-dbz-bg border-2 border-dbz-border p-3">
								<div className="text-[10px] uppercase text-dbz-blue-light tracking-widest mb-1">
									Commande Discord
								</div>
								<code className="text-xs font-mono text-dbz-yellow">{s.discord}</code>
							</div>
						</div>
					</article>
				))}
			</div>

			<section className="mt-12 dbz-panel p-6">
				<h2 className="text-2xl font-saiyan text-dbz-orange uppercase mb-3">Backgrounds NASA</h2>
				<p className="text-sm text-gray-300 mb-2">
					Tous les fonds de profile cards proviennent de NASA Images API (domaine public, zéro API à
					clé). Cache LRU 32 entries + dédoublonnage buffer.
				</p>
				<div className="text-xs text-dbz-blue-light font-mono uppercase tracking-widest">
					assets/backgrounds/{"{theme}"}/{"{slug}"}.jpg
				</div>
			</section>
		</PageShell>
	);
}
