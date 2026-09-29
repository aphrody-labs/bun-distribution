import Link from "next/link";
import { T } from "@/components/T";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import type { Metadata } from "next";
import { dbUniverse } from "@/lib/db-universe";
import { PageHero } from "@/components/PageHero";
import { pageHero } from "@/lib/banner-config";
import { DatabookGrid } from "@/components/databooks/DatabookGrid";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { ContinueRail } from "@/components/history/ContinueRail";
import { progressionTranscription } from "@/lib/databooks-transcription";
import { DomainBar, StatTiles, ContributeRail } from "@/components/kit";

import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { ogMeta } from "@/lib/og";
import { publicDatabookImage } from "@/lib/databook-media";
import { isToriyamaInterviewBook } from "@/lib/toriyama-words";

/** Part arrondie à l'entier, « — » quand le dénominateur est nul. */
const pourcentage = (part: number, total: number): string =>
	total > 0 ? `${Math.round((part / total) * 100)} %` : "—";

export const revalidate = 3600;

const title = "Databooks Dragon Ball";
const description =
	"Guides officiels, artbooks et daizenshuu Dragon Ball, séparés des interviews et des paroles d'Akira Toriyama.";

export const metadata: Metadata = {
	title,
	description,
	...ogMeta({
		title: "Databooks Dragon Ball — DBFR",
		description,
		type: "website",
		canonical: "/wiki/databooks",
	}),
};

export default async function DatabooksIndexPage() {
	// `access` : la grille est un composant client et ne peut pas lire la
	// configuration de lancement ; on la résout ici et on la lui passe.
	const [data, access, progression] = await Promise.all([
		dbUniverse.databooks({ order: "desc" }),
		getLaunchConfig().catch(() => null),
		// La couverture de transcription vient du MÊME calcul que l'écran
		// d'administration : un seul chiffre, pas deux versions qui divergent.
		// En échec (base indisponible), la page s'affiche sans les compteurs.
		progressionTranscription().catch(() => null),
	]);
	const items = (data?.items ?? [])
		.filter((d) => {
			if (d.kind === "interview") return false;
			if (d.category === "Interview") return false;
			if (isToriyamaInterviewBook(d)) return false;
			return true;
		})
		.map((d) => ({
		id: d.id,
		kind: d.kind,
		category: d.category ?? null,
		title: d.title,
		titleJa: d.title_ja,
		author: d.author,
		publishedAt: d.published_at,
		// Chemin brut : DatabookGrid / WikiImg résolvent via assetUrl (évite
		// double-préfixe et permet le repli placeholder si cover 404).
		cover: publicDatabookImage(d.cover),
		pageCount: d.pages.filter((page) =>
			Boolean(publicDatabookImage(page.image) || page.text?.trim())
		).length,
		hasDescription: Boolean(d.description?.trim()),
	}));

	// Bannière fixe plutôt que la couverture du dernier ouvrage entré : une
	// jaquette portrait étirée sur 1920 px de large sortait floue, et le hero
	// changeait de visage à chaque nouveau V-Jump ingéré.
	const heroImage = await pageHero("databooks");

	return (
		<div>
			<PageHero
				eyebrow={<T k="wiki.databooks.eyebrow" />}
				title={<T k="wiki.databooks.title" />}
				lead={
					// Un nombre vérifiable plutôt qu'une promesse d'ambiance (règle 18) ;
					// catalogue vide, le compteur disparaît au lieu d'afficher un zéro.
					items.length > 0 ? (
						<T
							k="wiki.databooks.leadCount"
							values={{ count: items.length.toLocaleString("fr-FR") }}
						/>
					) : (
						<T k="wiki.databooks.lead" />
					)
				}
				image={heroImage}
				imageAlt="Databooks Dragon Ball"
			/>
			<div className="wiki-container">
				<div className="flex flex-wrap items-center justify-between gap-4 mb-6 sm:mb-8">
					<Breadcrumbs
						items={[{ label: "Databooks", display: <T k="wiki.databooks.breadcrumb" /> }]}
					/>
					<WikiDrawer />
				</div>
				<nav aria-label="Parcours éditorial" className="mb-8 flex flex-wrap gap-2 text-sm">
					<Link className="rounded-lg border border-dbz-orange/40 bg-dbz-orange/10 px-3 py-2 text-dbz-orange" href="/wiki/databooks"><T k="wiki.editorialNav.databooks" /></Link>
					<Link className="rounded-lg border border-white/10 px-3 py-2 text-white/70 hover:border-white/30 hover:text-white" href="/wiki/romans">Romans &amp; Light Novels</Link>
					<Link className="rounded-lg border border-white/10 px-3 py-2 text-white/70 hover:border-white/30 hover:text-white" href="/wiki/interviews"><T k="wiki.editorialNav.interviews" /></Link>
					<Link className="rounded-lg border border-white/10 px-3 py-2 text-white/70 hover:border-white/30 hover:text-white" href="/wiki/toriyama"><T k="wiki.editorialNav.toriyama" /></Link>
				</nav>

				{/* Pont staff → pilotage des campagnes de traduction, sans repasser par
				    la sidebar d'administration. Invisible pour les visiteurs. */}
				<DomainBar
					domain="databooks"
					className="mb-6"
					actions={[{ href: "/admin/transcriptions", label: "Transcriptions & arbitrage" }]}
				/>

				{/* Couverture réelle de la transcription. Ce compteur n'existait que
				    dans l'administration, alors qu'il dit au lecteur ce qu'il peut
				    espérer trouver — et ce qui reste à faire. Mesuré, jamais arrondi
				    à la hausse. */}
				{progression && (
					<StatTiles
						className="mb-8"
						items={[
							{ label: <T k="wiki.databooks.statWorks" />, value: progression.total.fiches },
							{
								label: <T k="wiki.databooks.statPlates" />,
								value: progression.total.planches,
								hint: <T k="wiki.databooks.statPlatesHint" />,
							},
							{
								label: <T k="wiki.databooks.statTranscribed" />,
								value: progression.total.transcrites,
								hint: (
									<T
										k="wiki.databooks.statTranscribedHint"
										values={{
											percent: pourcentage(
												progression.total.transcrites,
												progression.total.planches
											),
										}}
									/>
								),
							},
							{
								label: <T k="wiki.databooks.statTranslated" />,
								value: progression.total.traduites,
								hint: (
									<T
										k="wiki.databooks.statTranslatedHint"
										values={{
											percent: pourcentage(progression.total.traduites, progression.total.planches),
										}}
									/>
								),
							},
						]}
					/>
				)}

				{/* Les ouvrages restent séparés des interviews et de la page auteur. */}
				<p className="mb-8 text-[13px] text-white/55">
					<Link
						href="/wiki/interviews"
						className="text-dbz-orange underline-offset-4 hover:underline"
					>
						<T k="wiki.databooks.toriyamaLink" />
					</Link>{" "}
					<T k="wiki.databooks.toriyamaAfter" />
				</p>

				<ContinueRail kinds={["databook"]} titleKey="history.resumeBook" />
				<DatabookGrid items={items} access={access} />
				<ContributeRail className="mt-14" quoiKey="kit.contribute.what.databookPlate" />
			</div>
		</div>
	);
}
