import { EntityParticipation } from "@/components/social/EntityParticipation";
import { JsonLd } from "@/components/JsonLd";
import { TrackView } from "@/components/TrackView";
import { ViewTransition } from "@/components/ViewTransition";
import { WikiSources } from "@/components/wiki/WikiArticle";
import { WikiRelatedCharacters } from "@/components/wiki/WikiRelatedCharacters";
import { CharacterSagaVariants } from "@/components/wiki/CharacterSagaVariants";
import { WikiSectionsReader, type ReaderPanel } from "@/components/wiki/WikiSectionsReader";
import { WikiEditBar } from "@/components/wiki/WikiEditBar";
import { WikiImg } from "@/components/wiki/WikiImg";
import { CharacterPowerScaling } from "@/components/wiki/CharacterPowerScaling";
import { buildWikiContentPanels } from "@/lib/wiki-panels";
import { TECH_SECTION_KEYS, TRANSFO_SECTION_KEYS } from "@/lib/wiki-article-sections";
import {
	getShenronCharacter,
	getShenronCharacterIds,
	getShenronCharacterVariants,
} from "@/lib/shenron";
import { assetUrl } from "@/lib/db-universe";
import type { Metadata } from "next";
import { ogMeta } from "@/lib/og";
import { notFound, permanentRedirect } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { DomainBar } from "@/components/kit";
import { GatedWrap } from "@/components/GatedLink";
import { cache, type ReactNode } from "react";
import type { Person, WithContext } from "schema-dts";
import type { SectionAccent } from "@/lib/wiki-section-accents";
import { capParams } from "@/lib/prerender";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { pickBestImage } from "@/lib/image-variants";
import {
	CHARACTER_CANONICAL_SLUGS,
	resolveCharacterParam,
} from "@/lib/wiki-slugs";

export const revalidate = 3600;

/** Fiches prérendues au build ; l'ISR sert toutes les autres à la demande. */
const PRERENDU = 100;

export async function generateStaticParams() {
	if (process.env.SHENRON_BUILD_LOW_MEMORY === "1") return [];
	const ids = await getShenronCharacterIds(PRERENDU);
	return capParams(
		ids.map((id) => ({ slug: CHARACTER_CANONICAL_SLUGS[id] || String(id) })),
		PRERENDU
	);
}

// Mémoïsé par requête : generateMetadata + le composant partagent un seul fetch.
const getChar = cache((idOrSlug: string | number) => getShenronCharacter(idOrSlug));

// Résumé texte brut pour <meta description> (markdown/HTML retirés, tronqué).
function plainText(md: string, max = 160): string {
	const t = md
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, "")
		.replace(/[#*_`>~|]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const resolved = resolveCharacterParam(slug);
	const c = await getChar(resolved.id ?? resolved.canonicalSlug ?? slug);
	if (!c) return { title: "Personnage introuvable" };
	const heroImage = pickBestImage([c.image, c.portraitXv2]) ?? c.image;
	const img = heroImage ? assetUrl(heroImage) : undefined;
	const description = c.description
		? plainText(c.description)
		: `${c.name} — fiche personnage Dragon Ball : race, techniques, transformations et lore sur DBFR.`;
	const pageTitle = c.nameJa ? `${c.name} (${c.nameJa}) — Personnage Dragon Ball` : `${c.name} — Personnage Dragon Ball`;
	return {
		title: pageTitle,
		description,
		...ogMeta({
			title: `${c.name} — DBFR`,
			description,
			image: img ?? null,
			canonical: `/wiki/personnages/${c.slug}`,
		}),
	};
}

export default async function CharacterPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const resolved = resolveCharacterParam(slug);
	const character = await getChar(resolved.id ?? resolved.canonicalSlug ?? slug);

	if (!character) notFound();
	// Meilleure résolution existante entre l'image éditoriale et le portrait XV2
	// (dimensions mesurées par l'inventaire ; sans mesure, l'image éditoriale reste).
	const heroImage = pickBestImage([character.image, character.portraitXv2]) ?? character.image;

	// Redirection permanente 301 post-migration : si l'URL est numérique ou un alias,
	// redirection vers le slug mondial officiel canonique.
	if (resolved.isLegacyNumericId || resolved.isAlias || slug !== character.slug) {
		permanentRedirect(`/wiki/personnages/${character.slug}`);
	}

	// Versions saga par saga (bot.db_character_variants) — chargées après la
	// fiche parce qu'elles en dépendent, et lues même quand la liste est vide :
	// une requête indexée sur (character_id, sort_order) coûte moins qu'un
	// aller-retour conditionnel de plus dans le rendu.
	// `access` : la frise est un composant client et ne peut pas lire la
	// configuration de lancement ; on la résout ici et on la lui passe.
	const [variants, access] = await Promise.all([
		getShenronCharacterVariants(character.id),
		getLaunchConfig().catch(() => null),
	]);

	const personSchema: WithContext<Person> = {
		"@context": "https://schema.org",
		"@type": "Person",
		name: character.name,
		image: character.image ? assetUrl(character.image) : undefined,
		description: character.description ? plainText(character.description) : undefined,
		alternateName: character.nameJa ?? undefined,
		homeLocation: character.originPlanet
			? {
					"@type": "Place",
					name: character.originPlanet.name,
				}
			: undefined,
	};

	// ── Catégories de la fiche ────────────────────────────────────────────────
	// Contenu = article long-format éclaté par titre `##` (Histoire, Personnalité,
	// Pouvoirs et techniques, Transformations, Anecdotes…) + surcharges/ajouts
	// éditoriaux du studio (db_wiki_sections, ex. PWS). Zéro fabrication : on ne
	// fait que structurer du contenu déjà présent, tout rendu côté serveur.
	const contentPanels = await buildWikiContentPanels({
		entityType: "character",
		entityId: character.id,
		article: character.article,
		description: character.description,
	});

	// Galeries relationnelles (vignettes de transformations, fiches techniques).
	// `withHeading=false` quand on les fusionne dans une catégorie de l'article
	// qui porte déjà son titre (évite un double bandeau).
	const transfoGrid = (withHeading: boolean): ReactNode => (
		<section className="space-y-8">
			{withHeading && (
				<div className="flex items-center gap-6">
					<h2 className="font-saiyan text-2xl sm:text-4xl md:text-5xl text-dbz-orange uppercase tracking-widest">
						TRANSFORMATIONS
					</h2>
					<div className="h-px flex-1 bg-gradient-to-r from-dbz-orange/50 to-transparent" />
				</div>
			)}
			<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-6">
				{character.transformations.map((transfo) => (
					<div
						key={transfo.id}
						className="dbz-panel p-4 flex flex-col items-center group hover:scale-105 transition-transform duration-300"
					>
						<div className="aspect-square w-full bg-dbz-bg border border-dbz-border p-2 mb-4 overflow-hidden relative rounded-lg">
							<div className="absolute inset-0 halftone opacity-10" />
							{/* `WikiImg` et non `<img>` : `mapTransfo` remplace une image
							    absente par une chaîne VIDE, et `assetUrl("")` rend "". Le
							    navigateur résout alors `src=""` en l'URL de la PAGE : il la
							    retélécharge en entier pour dessiner une vignette cassée. Le
							    repli du composant montre un repère neutre, et l'image
							    existante devient paresseuse (ces vignettes sont en bas de
							    fiche, derrière le sélecteur de catégories). */}
							<WikiImg
								src={transfo.image}
								alt={transfo.name}
								className="w-full h-full object-contain relative z-10 group-hover:scale-110 transition-transform duration-700"
								placeholderClassName="relative z-10 flex h-full w-full items-center justify-center rounded"
							/>
						</div>
						<h3 className="text-xs font-bold text-white uppercase text-center group-hover:text-dbz-orange transition-colors leading-tight tracking-widest">
							{transfo.name}
						</h3>
						{transfo.ki && <span className="scouter-text text-[10px] mt-2">KI: {transfo.ki}</span>}
					</div>
				))}
			</div>
		</section>
	);

	const techGrid = (withHeading: boolean): ReactNode => (
		<section className="space-y-8">
			{withHeading && (
				<div className="flex items-center gap-6">
					<h2 className="font-saiyan text-2xl sm:text-4xl md:text-5xl text-dbz-blue-light uppercase tracking-widest">
						TECHNIQUES & CAPACITÉS
					</h2>
					<div className="h-px flex-1 bg-gradient-to-r from-dbz-blue-light/50 to-transparent" />
				</div>
			)}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
				{character.techniques.map(({ technique: tech }) => (
					<div
						key={tech.id}
						className="dbz-panel p-6 hover:border-dbz-blue-light transition-all group"
					>
						<div className="flex justify-between items-start mb-4">
							<h3 className="text-xl font-bold text-white group-hover:text-dbz-blue-light transition-colors uppercase tracking-wider">
								{tech.name}
							</h3>
							<span className="scouter-text text-[10px] text-dbz-blue-light/60">
								TECH_ID: {tech.id}
							</span>
						</div>
						{tech.description && (
							<p className="text-sm text-gray-400 leading-relaxed line-clamp-3 font-sans">
								{tech.description}
							</p>
						)}
						<div className="mt-4 pt-4 border-t border-white/5 flex justify-end">
							<GatedWrap
								href={`/wiki/techniques/${tech.slug}`}
								className="text-[10px] font-bold text-dbz-blue-light hover:text-white uppercase tracking-widest transition-colors"
							>
								Détails Technique →
							</GatedWrap>
						</div>
					</div>
				))}
			</div>
		</section>
	);

	// Assemble les pilules : catégories de contenu, puis fusion/ajout des galeries
	// relationnelles, puis Versions et Personnages affiliés.
	const panels: ReaderPanel[] = [...contentPanels];

	const mergeOrAppendGrid = (
		keys: Set<string>,
		has: boolean,
		render: (withHeading: boolean) => ReactNode,
		key: string,
		label: string,
		accent: SectionAccent
	) => {
		if (!has) return;
		const idx = panels.findIndex((p) => keys.has(p.key));
		if (idx >= 0) {
			panels[idx] = {
				...panels[idx],
				node: (
					<div className="space-y-12">
						{panels[idx].node}
						{render(false)}
					</div>
				),
			};
		} else {
			panels.push({ key, label, accent, node: render(true) });
		}
	};

	mergeOrAppendGrid(
		TRANSFO_SECTION_KEYS,
		character.transformations.length > 0,
		transfoGrid,
		"transformations",
		"Transformations",
		"purple"
	);
	mergeOrAppendGrid(
		TECH_SECTION_KEYS,
		character.techniques.length > 0,
		techGrid,
		"techniques",
		"Techniques",
		"blue"
	);

	// Placé AVANT « Versions & apparitions » : la frise des sagas parle du même
	// personnage à des époques différentes, l'autre catégorie parle d'autres
	// fiches (Xeno, futur, GT). Les inverser ferait lire la seconde comme la
	// suite de la première.
	if (variants.length > 0) {
		panels.push({
			key: "sagas",
			label: "Au fil des sagas",
			accent: "gold",
			node: (
				<CharacterSagaVariants
					variants={variants}
					characterName={character.name}
					characterImage={heroImage}
					access={access}
				/>
			),
		});
	}

	if (character.versions.length > 0) {
		panels.push({
			key: "versions",
			label: "Versions",
			accent: "blue",
			node: (
				<WikiRelatedCharacters
					heading="Versions & apparitions"
					caption="Autres versions de ce personnage à travers les époques, les timelines et les jeux (GT, Xenoverse, Heroes…)."
					items={character.versions}
					accent="blue"
				/>
			),
		});
	}
	if (character.affiliates.length > 0) {
		panels.push({
			key: "affilies",
			label: "Personnages affiliés",
			accent: "cyan",
			node: (
				<WikiRelatedCharacters
					heading="Personnages affiliés"
					caption={
						character.affiliation
							? `Autres personnages liés à « ${character.affiliation} ».`
							: undefined
					}
					items={character.affiliates}
					accent="cyan"
				/>
			),
		});
	}

	// Panneau Power Scaling officiel canonique (BP, Daizenshuu 7, SEG, Kiri)
	panels.push({
		key: "power-scaling",
		label: "Power Scaling (BP & Kiri)",
		accent: "orange",
		node: (
			<CharacterPowerScaling
				characterName={character.name}
				characterId={character.id}
			/>
		),
	});

	// Panneau Combats Légendaires issus de bot.db_battles
	if (character.battles && character.battles.length > 0) {
		panels.push({
			key: "combats",
			label: `Combats (${character.battles.length})`,
			accent: "red",
			node: (
				<section className="space-y-8">
					<div className="flex items-center gap-6">
						<h2 className="font-saiyan text-2xl sm:text-4xl md:text-5xl text-dbz-red uppercase tracking-widest">
							COMBATS LÉGENDAIRES
						</h2>
						<div className="h-px flex-1 bg-gradient-to-r from-dbz-red/50 to-transparent" />
					</div>
					<p className="text-sm text-white/50 max-w-3xl">
						Duels majeurs et confrontations épiques de {character.name} relatés dans le manga et l&apos;histoire canonique.
					</p>
					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						{character.battles.map((b) => (
							<GatedWrap
								key={b.id}
								href={`/wiki/combats/${b.slug}`}
								className="dbz-panel p-5 hover:border-dbz-red/50 transition-all group flex flex-col justify-between"
							>
								<div>
									<div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider text-dbz-red mb-2">
										<span>⚔️ {b.series}</span>
										{b.location && <span className="text-white/40">{b.location}</span>}
									</div>
									<h3 className="text-lg font-bold text-white group-hover:text-dbz-red transition-colors">
										{b.title}
									</h3>
									{b.titleJa && (
										<p lang="ja" className="font-jp text-xs text-white/40 mt-1">
											{b.titleJa}
										</p>
									)}
									{b.climaxSummary && (
										<p className="text-xs text-gray-400 mt-3 leading-relaxed line-clamp-3">
											{b.climaxSummary}
										</p>
									)}
								</div>
								<div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px]">
									<span className="text-white/50">
										Vainqueur : <strong className="text-white">{b.winnerName || "Indéterminé"}</strong>
									</span>
									<span className="text-dbz-red font-bold group-hover:translate-x-1 transition-transform">
										Détails →
									</span>
								</div>
							</GatedWrap>
						))}
					</div>
				</section>
			),
		});
	}

	return (
		<article
			data-entity={character.name}
			data-source-id="db_characters"
			data-lang="fr"
			className="wiki-container reveal-up"
		>
			<JsonLd data={personSchema} />
			<TrackView
				entityType="character"
				entityId={character.id}
				entityName={character.name}
				image={character.image}
			/>
			<DomainBar domain="wiki" />
			<div className="flex flex-wrap items-center justify-between gap-4 mb-4">
				<Breadcrumbs
					items={[{ label: "L'Univers", href: "/wiki/personnages" }, { label: character.name }]}
				/>
				<WikiDrawer />
			</div>
			<WikiEditBar
				sansArticle
				table="db_characters"
				id={character.id}
				indexHref="/wiki/personnages"
				label={character.name}
			/>

			{/* En-tête de fiche centré & dynamique façon Fandom officiel */}
			<header className="text-center max-w-4xl mx-auto space-y-4 mb-8">
				<h1
					className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-sans font-black text-white uppercase tracking-tight leading-none break-words"
					style={{ textShadow: "0 4px 20px rgba(0,0,0,0.9), 0 0 30px rgba(231,130,32,0.3)" }}
				>
					{character.name}
				</h1>
				{(character.nameJa || character.nameRomaji) && (
					<div className="flex items-center justify-center flex-wrap gap-4 text-gray-300">
						{character.nameJa && (
							<span
								lang="ja"
								className="font-jp text-2xl sm:text-3xl font-bold tracking-widest text-dbz-orange drop-shadow-[0_2px_6px_#000]"
							>
								{character.nameJa}
							</span>
						)}
						{character.nameRomaji && (
							<span className="text-sm font-extrabold italic uppercase tracking-[0.2em] text-white/80">
								{character.nameRomaji}
							</span>
						)}
					</div>
				)}
				<div className="flex justify-center flex-wrap gap-3 pt-2">
					{character.race && (
						<span className="toriyama-badge bg-dbz-orange text-black px-3.5 py-1 text-xs font-black">
							<span>{character.race}</span>
						</span>
					)}
					{character.affiliation && (
						<span className="toriyama-badge bg-white text-black px-3.5 py-1 text-xs font-black">
							<span>{character.affiliation}</span>
						</span>
					)}
					{character.originPlanet && (
						<span className="toriyama-badge bg-[#141416] text-dbz-cyan border-2 border-dbz-cyan px-3.5 py-1 text-xs font-black">
							<span>{character.originPlanet.name}</span>
						</span>
					)}
				</div>
			</header>

			{/* Grille principale : Infobox Fandom à gauche, Contenu & Onglets à droite */}
			<div className="flex flex-col lg:flex-row gap-8 xl:gap-12 items-start">
				{/* Infobox Fandom standardisée avec finitions Toriyama */}
				<aside className="w-full lg:w-[360px] xl:w-[400px] shrink-0 lg:sticky lg:top-24 space-y-6">
					<div className="wiki-infobox">
						<div className="wiki-infobox-header">
							DONNÉES OFFICIELLES //
						</div>

						{/* Portrait principal */}
						<div className="p-4 bg-[#0a0a0c] border-b-2 border-black flex justify-center items-center relative overflow-hidden group">
							<div className="absolute inset-0 halftone opacity-10" />
							<ViewTransition name={`character-img-${character.id}`} share="morph">
								{/* Meilleure résolution existante en premier (image éditoriale,
								    portrait XV2 ou copie plus grande de la même image, mesurées
								    par l'inventaire) ; l'autre reste en repli. */}
								<WikiImg
									src={heroImage}
									fallback={heroImage === character.image ? character.portraitXv2 : character.image}
									alt={character.name}
									loading="eager"
									className="max-h-[380px] w-auto object-contain relative z-10 drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)] group-hover:scale-105 transition-transform duration-500"
									placeholderClassName="relative z-10 w-full aspect-[3/4] flex items-center justify-center bg-dbz-card overflow-hidden rounded"
								/>
							</ViewTransition>
						</div>

						{/* Attributs structurés */}
						<div className="divide-y divide-white/[0.08]">
							<div className="wiki-infobox-row">
								<span className="wiki-infobox-label">Nom officiel</span>
								<span className="wiki-infobox-value">{character.name}</span>
							</div>
							{character.nameJa && (
								<div className="wiki-infobox-row">
									<span className="wiki-infobox-label">Japonais</span>
									<span lang="ja" className="wiki-infobox-value font-jp text-dbz-orange">{character.nameJa}</span>
								</div>
							)}
							{character.nameRomaji && (
								<div className="wiki-infobox-row">
									<span className="wiki-infobox-label">Romaji</span>
									<span className="wiki-infobox-value italic">{character.nameRomaji}</span>
								</div>
							)}
							{character.race && (
								<div className="wiki-infobox-row">
									<span className="wiki-infobox-label">Race</span>
									<span className="wiki-infobox-value text-dbz-yellow">{character.race}</span>
								</div>
							)}
							{character.affiliation && (
								<div className="wiki-infobox-row">
									<span className="wiki-infobox-label">Affiliation</span>
									<span className="wiki-infobox-value">{character.affiliation}</span>
								</div>
							)}
							{character.originPlanet && (
								<div className="wiki-infobox-row">
									<span className="wiki-infobox-label">Planète</span>
									<span className="wiki-infobox-value text-dbz-cyan">{character.originPlanet.name}</span>
								</div>
							)}
							{character.voiceActors?.map((va) => (
								<div key={va.id} className="wiki-infobox-row">
									<span className="wiki-infobox-label">
										{va.nationality === "ja" ? "Seiyū (Japonais)" : va.nationality === "fr" ? "Voix Française" : `Voix (${va.nationality.toUpperCase()})`}
									</span>
									<span className="wiki-infobox-value text-dbz-orange">
										<GatedWrap href={`/wiki/voix/${va.slug}`} className="hover:underline">
											{va.name} {va.nameJa && <span lang="ja" className="font-jp text-xs opacity-75">({va.nameJa})</span>}
										</GatedWrap>
										{va.roleNotes && (
											<span className="block text-[10px] text-white/40 font-normal mt-0.5">
												{va.roleNotes}
											</span>
										)}
									</span>
								</div>
							))}
							{character.ki && (
								<div className="wiki-infobox-row">
									<span className="wiki-infobox-label">Ki de base</span>
									<span className="wiki-infobox-value font-mono text-dbz-orange">{character.ki}</span>
								</div>
							)}
							{character.maxKi && (
								<div className="wiki-infobox-row">
									<span className="wiki-infobox-label">Ki maximum</span>
									<span className="wiki-infobox-value font-mono text-dbz-red">{character.maxKi}</span>
								</div>
							)}
							{character.stats?.map((st) => (
								<div key={st.label} className="wiki-infobox-row">
									<span className="wiki-infobox-label">{st.label}</span>
									<span className="wiki-infobox-value font-mono text-dbz-yellow">{st.value}</span>
								</div>
							))}
						</div>
					</div>
				</aside>

				{/* Colonne de contenu principale : Sections, Biographie, Powerscaling */}
				<main className="flex-1 min-w-0 w-full space-y-10">
					<WikiSectionsReader panels={panels} />
					<WikiSources sources={character.articleSources} />
				</main>
			</div>
			<EntityParticipation
				kind="wiki"
				table="db_characters"
				id={character.id}
				path={`/wiki/personnages/${slug}`}
				label={character.name}
			/>
		</article>
	);
}
