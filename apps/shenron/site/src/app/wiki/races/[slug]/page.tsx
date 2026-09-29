import { EntityParticipation } from "@/components/social/EntityParticipation";
import { WikiMarkdown } from "@/components/wiki/WikiMarkdown";
import { WikiArticle } from "@/components/wiki/WikiArticle";
import { WikiEntitySections } from "@/components/wiki/WikiEntitySections";
import { WikiEditBar } from "@/components/wiki/WikiEditBar";
import { WikiFicheVide } from "@/components/wiki/WikiFicheVide";
import { getShenronRace, getShenronRaces } from "@/lib/shenron";
import { assetUrl } from "@/lib/db-universe";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { GatedWrap } from "@/components/GatedLink";
import type { Metadata } from "next";
import { ogMeta } from "@/lib/og";

export const revalidate = 3600;

export async function generateStaticParams() {
	if (process.env.SHENRON_BUILD_LOW_MEMORY === "1") return [];
	const list = await getShenronRaces();
	return list.map((r) => ({ slug: r.slug }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const race = await getShenronRace(slug);
	if (!race) return { title: "Race Dragon Ball" };
	// Cf. `@/lib/og` : sans `ogMeta`, la fiche n'émettait aucun `og:image`.
	// `db_races` ne porte pas d'illustration — on laisse `image` vide, ce qui
	// fait pointer explicitement la carte de marque au lieu de rien.
	return {
		title: `${race.name} — Race Dragon Ball`,
		description: race.description ?? `Détails de la race ${race.name}.`,
		...ogMeta({
			title: `${race.name} — Race Dragon Ball`,
			description: race.description ?? `Détails de la race ${race.name}.`,
			canonical: `/wiki/races/${slug}`,
		}),
	};
}

/**
 * Les variantes sont ÉCRITES EN ENTIER dans chaque thème (`barre`, `survol`).
 * Tailwind scanne le source : une classe composée à l'exécution
 * (`hover:${theme.text}`, `theme.text.replace("text-", "bg-")`) n'apparaît
 * nulle part littéralement, donc la règle n'est jamais générée — le filet
 * d'accent du panneau restait transparent et le survol du lien de la planète
 * d'origine ne changeait pas de couleur.
 */
const defaultTheme = {
	text: "text-amber-400",
	barre: "bg-amber-400",
	survol: "hover:text-amber-400",
	border: "border-amber-500/30",
	glow: "shadow-[0_0_40px_rgba(245,158,11,0.1)]",
	accentBg: "bg-amber-500/10",
	accentBorder: "border-amber-500/20",
};

const colorThemes: Record<string, typeof defaultTheme> = {
	saiyan: {
		text: "text-dbz-orange",
		barre: "bg-dbz-orange",
		survol: "hover:text-dbz-orange",
		border: "border-dbz-orange/30",
		glow: "shadow-[0_0_40px_rgba(255,178,0,0.12)]",
		accentBg: "bg-dbz-orange/10",
		accentBorder: "border-dbz-orange/20",
	},
	human: {
		text: "text-zinc-300",
		barre: "bg-zinc-300",
		survol: "hover:text-zinc-300",
		border: "border-zinc-500/30",
		glow: "shadow-[0_0_40px_rgba(250,250,250,0.08)]",
		accentBg: "bg-zinc-500/10",
		accentBorder: "border-zinc-500/20",
	},
	namekian: {
		text: "text-emerald-400",
		barre: "bg-emerald-400",
		survol: "hover:text-emerald-400",
		border: "border-emerald-500/30",
		glow: "shadow-[0_0_40px_rgba(16,185,129,0.12)]",
		accentBg: "bg-emerald-500/10",
		accentBorder: "border-emerald-500/20",
	},
	"frieza-race": {
		text: "text-purple-400",
		barre: "bg-purple-400",
		survol: "hover:text-purple-400",
		border: "border-purple-500/30",
		glow: "shadow-[0_0_40px_rgba(168,85,247,0.12)]",
		accentBg: "bg-purple-500/10",
		accentBorder: "border-purple-500/20",
	},
	android: {
		text: "text-cyan-400",
		barre: "bg-cyan-400",
		survol: "hover:text-cyan-400",
		border: "border-cyan-500/30",
		glow: "shadow-[0_0_40px_rgba(6,182,212,0.12)]",
		accentBg: "bg-cyan-500/10",
		accentBorder: "border-cyan-500/20",
	},
	majin: {
		text: "text-pink-400",
		barre: "bg-pink-400",
		survol: "hover:text-pink-400",
		border: "border-pink-500/30",
		glow: "shadow-[0_0_40px_rgba(244,63,94,0.12)]",
		accentBg: "bg-pink-500/10",
		accentBorder: "border-pink-500/20",
	},
	"god-of-destruction": {
		text: "text-violet-400",
		barre: "bg-violet-400",
		survol: "hover:text-violet-400",
		border: "border-violet-600/30",
		glow: "shadow-[0_0_40px_rgba(139,92,246,0.12)]",
		accentBg: "bg-violet-600/10",
		accentBorder: "border-violet-600/20",
	},
	angel: {
		text: "text-sky-300",
		barre: "bg-sky-300",
		survol: "hover:text-sky-300",
		border: "border-sky-300/30",
		glow: "shadow-[0_0_40px_rgba(125,211,252,0.12)]",
		accentBg: "bg-sky-300/10",
		accentBorder: "border-sky-300/20",
	},
	kaioshin: {
		text: "text-indigo-300",
		barre: "bg-indigo-300",
		survol: "hover:text-indigo-300",
		border: "border-indigo-400/30",
		glow: "shadow-[0_0_40px_rgba(129,140,248,0.12)]",
		accentBg: "bg-indigo-400/10",
		accentBorder: "border-indigo-400/20",
	},
	demon: {
		text: "text-red-500",
		barre: "bg-red-500",
		survol: "hover:text-red-500",
		border: "border-red-600/30",
		glow: "shadow-[0_0_40px_rgba(239,68,68,0.12)]",
		accentBg: "bg-red-600/10",
		accentBorder: "border-red-600/20",
	},
};

export default async function RaceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const race = await getShenronRace(slug);

	if (!race) notFound();

	const theme = colorThemes[slug] || defaultTheme;

	return (
		<div className="wiki-container">
			<Breadcrumbs
				className="mb-6"
				items={[{ label: "Races & peuples", href: "/wiki/races" }, { label: race.name }]}
			/>

			<div className="mb-4">
				<WikiEditBar table="db_races" id={race.id} indexHref="/wiki/races" label={race.name} />
			</div>

			<div className="space-y-16">
				{/* Centered Hero Header - Toriyama Style */}
				<header className="flex flex-col items-center justify-center text-center space-y-4 py-8">
					<div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-dbz-orange/15 border-2 border-black shadow-[2px_2px_0px_#000]">
						<span className="w-2 h-2 rounded-full bg-dbz-orange animate-pulse" />
						<span className={`font-saiyan text-xs tracking-[0.2em] uppercase ${theme.text}`}>
							CLASSIFICATION BIOLOGIQUE
						</span>
					</div>

					<h1 className="font-saiyan text-5xl sm:text-7xl md:text-8xl font-bold tracking-wider text-white drop-shadow-[0_4px_20px_rgba(255,107,0,0.35)]">
						{race.name}
					</h1>

					{race.nameJa && (
						<p className="font-jp text-2xl sm:text-3xl font-bold text-dbz-orange/90 tracking-wide drop-shadow">
							{race.nameJa}
						</p>
					)}
				</header>

				<div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
						{/* Main Description / Article */}
						<div className="lg:col-span-2 space-y-8">
							{race.article ? (
								<WikiArticle
									article={race.article}
									sources={race.articleSources}
									heading="Article"
								/>
							) : !race.description ? (
								<WikiFicheVide
									table="db_races"
									rowId={race.id}
									label={race.name}
									quoi="ses traits, son monde d'origine et ce que les sources en établissent"
								/>
							) : (
								<div
									className={`dbz-panel p-10 relative overflow-hidden ${theme.border} ${theme.glow}`}
								>
									<div className={`absolute top-0 left-0 w-1.5 h-full ${theme.barre}`} />
									<div className="prose prose-invert max-w-none wiki-content">
										<WikiMarkdown body={race.description} />
									</div>
								</div>
							)}
						</div>

						{/* Origin Planet Sidebar */}
						{race.homePlanet && (
							<div
								className={`dbz-panel p-6 border ${theme.border} ${theme.glow} flex flex-col items-center text-center space-y-4`}
							>
								<p className={`text-[10px] font-bold ${theme.text} tracking-[0.25em] uppercase`}>
									Monde d&apos;Origine
								</p>

								{race.homePlanet.image && (
									<div className="relative w-28 h-28 overflow-hidden bg-black/40 rounded-full flex items-center justify-center p-3 border border-white/5">
										<img
											src={assetUrl(race.homePlanet.image)}
											alt={race.homePlanet.name}
											className="w-full h-full object-contain drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]"
										/>
									</div>
								)}

								<h3 className="text-2xl font-saiyan tracking-widest text-white">
									<GatedWrap
										href="/wiki/lieux"
										className={`${theme.survol} transition-colors`}
									>
										{race.homePlanet.name}
									</GatedWrap>
								</h3>

								{race.homePlanet.description && (
									<p className="text-gray-400 text-xs leading-relaxed">
										{race.homePlanet.description}
									</p>
								)}
							</div>
						)}
					</div>

				{race.characters && race.characters.length > 0 && (
					<section className="space-y-10">
						<div className="flex items-center gap-6">
							<h2 className="font-saiyan text-2xl sm:text-4xl text-white uppercase tracking-widest">
								Représentants Connus ({race.characters.length})
							</h2>
							<div className="h-px flex-1 bg-gradient-to-r from-white/20 to-transparent" />
						</div>

						<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
							{race.characters.map((char, idx) => (
								<GatedWrap
									key={char.id}
									href={`/wiki/personnages/${char.slug || char.id}`}
									className="group dbz-panel overflow-hidden hover:scale-105 hover:border-dbz-orange transition-all duration-300"
									style={{ animationDelay: `${0.1 + idx * 0.03}s` }}
								>
									<div className="relative aspect-[3/4] bg-dbz-bg overflow-hidden">
										<div className="absolute inset-0 halftone opacity-10 z-10 pointer-events-none" />
										<img
											src={assetUrl(char.image)}
											alt={char.name}
											className="w-full h-full object-cover object-top opacity-100 group-hover:scale-110 transition-all duration-700"
										/>
										<div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent z-20" />
										<div className="absolute inset-x-0 bottom-0 p-4 z-30">
											<p className="font-display font-bold text-sm text-white group-hover:text-dbz-orange transition-colors">
												{char.name}
											</p>
										</div>
									</div>
								</GatedWrap>
							))}
						</div>
					</section>
				)}

				<WikiEntitySections entityType="race" entityId={race.id} />
			</div>
			<EntityParticipation
				kind="wiki"
				table="db_races"
				id={race.id}
				path={`/wiki/races/${slug}`}
				label={race.name}
			/>
		</div>
	);
}
