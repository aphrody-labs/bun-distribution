import { ContributeRail, DomainBar } from "@/components/kit";
import { getShenronTechniques } from "@/lib/shenron";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { PageHero } from "@/components/PageHero";
import { pageHero } from "@/lib/banner-config";
import { TechniqueGrid } from "@/components/wiki/TechniqueGrid";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { LIBELLES_TYPE } from "@/lib/techniques-types";
import { ogMeta } from "@/lib/og";
import type { Metadata } from "next";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Techniques Dragon Ball",
	description:
		"Catalogue des techniques et capacités de l'univers Dragon Ball : Kamehameha, Genkidama, Final Flash et plus.",
	...ogMeta({
		title: "Techniques Dragon Ball — DBFR",
		description:
			"Catalogue des techniques et capacités de l'univers Dragon Ball : Kamehameha, Genkidama, Final Flash et plus.",
		canonical: "/wiki/techniques",
		type: "website",
	}),
};

export default async function TechniquesPage() {
	const [techniques, access] = await Promise.all([getShenronTechniques(), getLaunchConfig()]);

	// Charge allégée : on n'envoie au client que ce que la carte affiche, et la
	// description tronquée à ce qui tient dans deux lignes. La page rendait les
	// 825 fiches entières — 2,4 Mo de HTML mesurés en production, pour 60 cartes
	// visibles. Le reste voyageait pour rien, deux fois (DOM + charge RSC).
	const cartes = techniques.map((t) => ({
		id: t.id,
		slug: t.slug,
		name: t.name,
		type: t.type,
		image: t.image ?? t.creatorImage ?? null,
		creatorName: t.creatorName,
		description: t.description ? tronquer(t.description, 160) : null,
	}));

	return (
		<div>
			<PageHero
				eyebrow="Encyclopédie"
				title="Techniques & Capacités"
				lead={`${techniques.length} techniques répertoriées — Kamehameha, Genkidama, Final Flash et les attaques les plus dévastatrices de l'univers Dragon Ball.`}
				image={await pageHero("techniques")}
				imageAlt="Techniques Dragon Ball"
			/>

			<div className="wiki-container space-y-8">
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Techniques" }]} />
					<WikiDrawer />
				</div>
				<p className="max-w-2xl text-[13px] leading-relaxed text-white/45">
					Répertoire des techniques canoniques issues du manga original d&apos;Akira Toriyama, de{" "}
					<em>Dragon Ball Super</em> et des dictionnaires officiels (<em>Daizenshuu 7</em>,{" "}
					<em>Chōzenshū 4</em>, <em>Super Exciting Guide</em>). Les techniques exclusives aux jeux
					vidéo ont été retirées pour garantir la conformité canonique. Les vignettes illustrent
					un utilisateur emblématique de l&apos;attaque.
				</p>
				<TechniqueGrid techniques={cartes} libelles={LIBELLES_TYPE} access={access} />
				<ContributeRail quoiKey="kit.contribute.what.technique" />
			</div>
		</div>
	);
}

/** Coupe sur un mot entier — une phrase tranchée en plein milieu se remarque. */
function tronquer(texte: string, max: number): string {
	const t = texte.trim();
	if (t.length <= max) return t;
	const coupe = t.slice(0, max);
	const espace = coupe.lastIndexOf(" ");
	return `${(espace > max * 0.6 ? coupe.slice(0, espace) : coupe).trimEnd()}…`;
}
