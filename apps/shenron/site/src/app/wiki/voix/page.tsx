import type { Metadata } from "next";
import { dbUniverse } from "@/lib/db-universe";
import { PageHero } from "@/components/PageHero";
import { VoiceActorsGrid } from "@/components/wiki/VoiceActorsGrid";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { ContributeRail, DomainBar } from "@/components/kit";
import { ogMeta } from "@/lib/og";
import { pageHero } from "@/lib/banner-config";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Casting Vocal & Seiyū de Dragon Ball",
	description:
		"Les comédiens de doublage et seiyū légendaires qui ont donné vie à Dragon Ball : Masako Nozawa, Ryō Horikawa, Toshio Furukawa, Patrick Borg, Brigitte Lecordier, Éric Legrand, Philippe Ariotti.",
	...ogMeta({
		title: "Casting Vocal & Seiyū — Dragon Ball FR",
		description:
			"Portraits, biographies et rôles des comédiens japonais originaux et des voix françaises cultes de la saga Dragon Ball.",
		type: "website",
		canonical: "/wiki/voix",
	}),
};

export default async function VoiceActorsIndexPage() {
	const voiceActors = (await dbUniverse.voiceActors()) ?? [];
	const heroImage = await pageHero("voix");

	return (
		<div>
			<PageHero
				eyebrow="Encyclopédie"
				title="Casting vocal — VF, VO & seiyū"
				lead="Une indexation encyclopédique des voix de Dragon Ball, Dragon Ball Z, GT, Super, Daima et des films : interprètes, personnages, séries et variantes de doublage."
				image={heroImage}
				imageAlt="Les guerriers de Dragon Ball Z"
			/>

			<WikiPageShell>
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Casting Vocal & Seiyū" }]} />
					<WikiDrawer />
				</div>
				<div className="rounded-2xl border border-white/10 bg-gradient-to-r from-purple-950/20 via-black/40 to-transparent p-5 backdrop-blur-md">
					<div className="flex items-center gap-3">
						<span className="text-2xl">🎙️</span>
						<div>
							<h2 className="text-sm font-bold text-white">Comment lire cette page</h2>
							<p className="text-xs text-white/60">
								VF désigne le doublage français, VO le doublage japonais original. Les rôles sont séparés par production ; une même personne peut donc apparaître dans plusieurs séries ou films. Chaque fiche doit être recoupée avec un générique, un livret ou un crédit d'éditeur avant publication.
							</p>
						</div>
					</div>
				</div>

				<VoiceActorsGrid voiceActors={voiceActors} fallbackImage={heroImage} />
				<ContributeRail quoiKey="kit.contribute.what.voice" />
			</WikiPageShell>
		</div>
	);
}
