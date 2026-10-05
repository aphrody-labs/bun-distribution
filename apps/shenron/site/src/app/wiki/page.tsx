import Link from "next/link";
import { GatedWrap } from "@/components/GatedLink";
import { getShenronCharacterCards, getShenronMovies } from "@/lib/shenron";
import { dbUniverse } from "@/lib/db-universe";
import { PageHero } from "@/components/PageHero";
import { StreamRow } from "@/components/stream/StreamRow";
import { PosterCard } from "@/components/stream/PosterCard";
import { EpisodeCard } from "@/components/stream/EpisodeCard";
import { CharacterPosterCard } from "@/components/wiki/CharacterPosterCard";
import { RepriseLecture } from "@/components/wiki/RepriseLecture";
import { WIKI_CATEGORIES } from "@/lib/wiki-categories";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { entryByKey, isPathPublic } from "@/lib/wiki-launch";
import { pickBestImage } from "@/lib/image-variants";
import { ContentCoverage } from "@/components/wiki/ContentCoverage";
import type { Metadata } from "next";
import { T } from "@/components/T";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "L'univers Dragon Ball",
	description:
		"Le sommaire de l'encyclopédie : personnages, sagas, planètes, races, techniques, films, épisodes, manga et databooks.",
	alternates: { canonical: "/wiki" },
};

const nf = new Intl.NumberFormat("fr-FR");

/**
 * Sommaire de l'encyclopédie.
 *
 * Réécrit avec les composants du site (`PageHero`, `StreamRow`, `PosterCard`,
 * `EpisodeCard`) au lieu du balisage recopié à la main : la page réimplémentait
 * une carte affiche, une carte épisode et une carte portrait déjà écrites
 * ailleurs, chacune avec ses propres tailles et ses propres replis d'image.
 *
 * Elle portait aussi **onze couleurs de rubrique** (orange, bleu, rouge, jaune,
 * blanc, vert, violet…), un titre en dégradé sur trois teintes et un kanji en
 * filigrane par carte. Sur le support officiel, la couleur occupe 13 à 17 % de
 * la page et sert un seul accent (cf. DESIGN.md, « Analyse du support
 * officiel ») : les rubriques se distinguent maintenant par leur nom et leur
 * volume, pas par un code couleur que personne n'apprend.
 */
export default async function WikiIndex() {
	const [
		characters,
		movies,
		episodesData,
		counts,
		access,
		databookData,
		mangaCatalogData,
		mangaData,
		battlesData,
		locationsData,
		tournamentsData,
		soundtracksData,
		dragonsData,
		itemsData,
	] = await Promise.all([
		getShenronCharacterCards(),
		getShenronMovies(),
		dbUniverse.episodes("DBZ", 12, 0),
		dbUniverse.counts(),
		getLaunchConfig(),
		dbUniverse.databooks(),
		dbUniverse.mangaCatalogVolumes(),
		dbUniverse.readableMangaChapters(),
		dbUniverse.battles(),
		dbUniverse.locations(),
		dbUniverse.tournaments(),
		dbUniverse.soundtracks(),
		dbUniverse.dragons(),
		dbUniverse.items(),
	]);

	const c = (counts ?? {}) as Record<string, number>;
	const total = Object.entries(c)
		.filter(([k]) => k !== "news" && k !== "tools")
		.reduce((n, [, v]) => n + (v ?? 0), 0);

	// Rubriques dans l'ordre du registre partagé — la même liste que la barre de
	// navigation, donc jamais de rubrique visible d'un côté et absente de l'autre.
	// `seeAllHref` d'un rail est un lien comme un autre : il doit disparaître si
	// la rubrique est fermée, sinon le sommaire promet une page qui répond 307.
	// On résout le gating ici (`isPathPublic`), la page étant déjà serveur.
	const ouvert = (href: string) => isPathPublic(href, access);

	// La phrase de situation vient du registre d'accès (`wiki-launch`), qui la
	// porte déjà pour le méga-menu : sans elle, le sommaire du wiki n'affichait
	// qu'un nom et un nombre, et une rubrique de 33 entrées ressemblait à une
	// rubrique de 1 300. Même traitement pour toutes, sans texte écrit deux fois.
	const rubriques = WIKI_CATEGORIES.map((cat) => (Object.assign(cat, {
	count: c[cat.countKey] ?? 0,
	blurb: entryByKey(cat.key)?.blurb ?? null
})));
	const encyclopedie = rubriques.filter((r) => r.group === "encyclopedia");
	const supports = rubriques.filter((r) => r.group === "media");

	const vedettes = characters
		.filter((ch) => ch.image)
		.slice(0, 18)
		.map((ch) => (Object.assign(ch, { image: pickBestImage([ch.image, ch.portraitXv2]) ?? ch.image })));
	const films = movies.slice(0, 18);
	const episodes = episodesData?.episodes.slice(0, 12) ?? [];
	const databooks = databookData?.items ?? [];
	const databooksWithContent = databooks.filter(
		(book) =>
			Boolean(book.description?.trim()) ||
			book.pages.some((page) => Boolean(page.image?.trim() || page.text?.trim()))
	).length;
	const volumes = mangaCatalogData?.volumes ?? [];
	const readableVolumeIds = new Set(
		(mangaData?.chapters ?? [])
			.map((chapter) => chapter.volume_id)
			.filter((id): id is number => id != null)
	);

	const battlesList = battlesData ?? [];
	const locationsList = locationsData ?? [];
	const tournamentsList = tournamentsData ?? [];
	const soundtracksList = soundtracksData ?? [];
	const dragonsList = dragonsData ?? [];
	const itemsList = itemsData ?? [];

	return (
		<div>
			<PageHero
				eyebrow="Encyclopédie"
				title="L'univers Dragon Ball"
				lead={`${nf.format(total)} entrées écrites sur les tomes du manga et les planches des databooks — personnages, mondes, récits et supports.`}
			/>

			<div className="wiki-container">
				{/* Avant les rubriques : quelqu'un qui revient cherche d'abord où il
				    s'était arrêté. L'îlot ne rend rien s'il n'a rien à proposer. */}
				<RepriseLecture />
				<Rubriques titre="L'univers" items={encyclopedie} />
				<Rubriques titre="Les supports" items={supports} />
				<ContentCoverage
					databooks={{
						label: "Databooks & interviews",
						availableHref: "/wiki/databooks?etat=disponibles",
						missingHref: "/wiki/databooks?etat=a-completer",
						available: databooksWithContent,
						total: databooks.length,
						unit: "ouvrages",
					}}
					manga={{
						label: "Manga",
						availableHref: "/wiki/manga?etat=disponibles",
						missingHref: "/wiki/manga?etat=a-completer",
						available: readableVolumeIds.size,
						total: volumes.length,
						unit: "tomes",
					}}
				/>

				{vedettes.length > 0 && (
					<StreamRow
						title="Personnages"
						count={c.characters}
						seeAllHref={ouvert("/wiki/personnages") ? "/wiki/personnages" : undefined}
					>
						{vedettes.map((ch) => (
							<CharacterPosterCard
								key={ch.id}
								href={`/wiki/personnages/${ch.id}`}
								name={ch.name}
								race={ch.race}
								image={ch.image}
							/>
						))}
					</StreamRow>
				)}

				{battlesList.length > 0 && (
					<StreamRow
						title="Combats Légendaires"
						count={c.battles}
						seeAllHref={ouvert("/wiki/evenements") ? "/wiki/evenements" : undefined}
					>
						{battlesList.slice(0, 10).map((b) => (
							<Link
								key={b.slug}
								href="/wiki/evenements"
								className="group/card relative block w-[240px] sm:w-[280px] shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 transition-all duration-300 hover:-translate-y-1 hover:border-red-500/50 hover:shadow-lg hover:shadow-red-950/20"
							>
								<div className="flex items-center justify-between gap-2 text-[10px] uppercase font-bold tracking-wider text-red-400">
									<span>⚔️ {b.series}</span>
									<span className="text-white/40">{b.location || b.series}</span>
								</div>
								<h3 className="mt-2 text-sm font-bold text-white transition-colors group-hover/card:text-red-400 line-clamp-1">
									{b.title}
								</h3>
								{b.title_ja && (
									<p className="font-jp text-[10px] text-white/40 truncate">{b.title_ja}</p>
								)}
								{b.climax_summary && (
									<p className="mt-2 text-xs text-white/60 line-clamp-2 leading-relaxed">
										{b.climax_summary}
									</p>
								)}
								<div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-white/40">
									<span>Vainqueur : <strong className="text-white/80">{b.winner_name || "Match nul"}</strong></span>
									<span className="text-red-400 font-semibold group-hover/card:translate-x-0.5 transition-transform">→</span>
								</div>
							</Link>
						))}
					</StreamRow>
				)}

				{locationsList.length > 0 && (
					<StreamRow
						title="Lieux & Sanctuaires"
						count={c.locations}
						seeAllHref={ouvert("/wiki/lieux") ? "/wiki/lieux" : undefined}
					>
						{locationsList.slice(0, 10).map((loc) => (
							<Link
								key={loc.slug}
								href={`/wiki/lieux/${loc.slug}`}
								className="group/card relative block w-[220px] sm:w-[260px] shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 transition-all duration-300 hover:-translate-y-1 hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-950/20"
							>
								<div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider text-emerald-400">
									<span>🏛️ {loc.realm_type}</span>
									{loc.planet && <span className="text-white/40">{loc.planet}</span>}
								</div>
								<h3 className="mt-2 text-sm font-bold text-white transition-colors group-hover/card:text-emerald-400 line-clamp-1">
									{loc.name}
								</h3>
								{loc.name_ja && (
									<p className="font-jp text-[10px] text-white/40 truncate">{loc.name_ja}</p>
								)}
								<p className="mt-2 text-xs text-white/60 line-clamp-2 leading-relaxed">
									{loc.description}
								</p>
								<div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-emerald-400 font-semibold">
									<span><T k="wiki.index.exploreSanctuary" /></span>
									<span className="group-hover/card:translate-x-0.5 transition-transform">→</span>
								</div>
							</Link>
						))}
					</StreamRow>
				)}

				{tournamentsList.length > 0 && (
					<StreamRow
						title="Tournois d'Arts Martiaux"
						count={c.tournaments}
						seeAllHref={ouvert("/wiki/evenements") ? "/wiki/evenements" : undefined}
					>
						{tournamentsList.slice(0, 6).map((t) => (
							<Link
								key={t.slug}
								href="/wiki/evenements"
								className="group/card relative block w-[220px] sm:w-[260px] shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 transition-all duration-300 hover:-translate-y-1 hover:border-orange-500/50 hover:shadow-lg hover:shadow-orange-950/20"
							>
								<div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider text-orange-400">
									<span>🏆 {t.tournament_type}</span>
									<span className="text-white/40">{t.saga}</span>
								</div>
								<h3 className="mt-2 text-sm font-bold text-white transition-colors group-hover/card:text-orange-400 line-clamp-1">
									{t.name}
								</h3>
								{t.winner_name && (
									<p className="mt-1 text-xs text-white/80">
										Champion : <strong className="text-orange-300">{t.winner_name}</strong>
									</p>
								)}
								<p className="mt-2 text-xs text-white/60 line-clamp-2 leading-relaxed">
									{t.rules_summary}
								</p>
								<div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-orange-400 font-semibold">
									<span>Tableau & Matchs</span>
									<span className="group-hover/card:translate-x-0.5 transition-transform">→</span>
								</div>
							</Link>
						))}
					</StreamRow>
				)}

				{dragonsList.length > 0 && (
					<StreamRow
						title="Dragons Sacrés & Vœux"
						count={c.dragons}
						seeAllHref={ouvert("/wiki/personnages") ? "/wiki/personnages#dragons-personnages" : undefined}
					>
						{dragonsList.map((d) => (
							<Link
								key={d.slug}
								href="/wiki/personnages#dragons-personnages"
								className="group/card relative block w-[200px] sm:w-[240px] shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 transition-all duration-300 hover:-translate-y-1 hover:border-orange-500/50 hover:shadow-lg hover:shadow-orange-950/20"
							>
								<div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider text-orange-400">
									<span>🐉 {d.balls_count} Boules</span>
									<span className="text-white/40">{d.wishes_count} vœu{d.wishes_count > 1 ? "x" : ""}</span>
								</div>
								<h3 className="mt-2 text-sm font-bold text-white transition-colors group-hover/card:text-orange-400 line-clamp-1">
									{d.name}
								</h3>
								{d.creator && (
									<p className="text-xs text-white/60">Créé par {d.creator}</p>
								)}
								{d.summon_phrase && (
									<p className="mt-2 text-xs italic text-orange-200/80 line-clamp-2">
										« {d.summon_phrase} »
									</p>
								)}
								<div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-orange-400 font-semibold">
									<span>Vœux & Règles</span>
									<span className="group-hover/card:translate-x-0.5 transition-transform">→</span>
								</div>
							</Link>
						))}
					</StreamRow>
				)}

				{itemsList.length > 0 && (
					<StreamRow
						title="Objets & Technologies"
						count={c.items}
						seeAllHref={ouvert("/wiki/objets") ? "/wiki/objets" : undefined}
					>
						{itemsList.slice(0, 8).map((it) => (
							<Link
								key={it.slug}
								href={`/wiki/objets/${it.slug}`}
								className="group/card relative block w-[220px] sm:w-[260px] shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 transition-all duration-300 hover:-translate-y-1 hover:border-amber-500/50 hover:shadow-lg hover:shadow-amber-950/20"
							>
								<div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider text-amber-400">
									<span>⚡ {it.category}</span>
									{it.creator && (
										<span className="text-white/40 truncate max-w-[120px]">{it.creator}</span>
									)}
								</div>
								<h3 className="mt-2 text-sm font-bold text-white transition-colors group-hover/card:text-amber-400 line-clamp-1">
									{it.name}
								</h3>
								{it.name_ja && (
									<p className="font-jp text-[10px] text-white/40 truncate">{it.name_ja}</p>
								)}
								<p className="mt-2 text-xs text-white/60 line-clamp-2 leading-relaxed">
									{it.description}
								</p>
								<div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-amber-400 font-semibold">
									<span><T k="wiki.index.properties" /></span>
									<span className="group-hover/card:translate-x-0.5 transition-transform">→</span>
								</div>
							</Link>
						))}
					</StreamRow>
				)}

				{soundtracksList.length > 0 && (
					<StreamRow
						title="Musiques & Bandes Originales"
						count={c.soundtracks}
						seeAllHref={ouvert("/wiki/musiques") ? "/wiki/musiques" : undefined}
					>
						{soundtracksList.slice(0, 8).map((ost) => (
							<Link
								key={ost.slug}
								href={`/wiki/musiques`}
								className="group/card relative block w-[220px] sm:w-[260px] shrink-0 snap-start overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-4 transition-all duration-300 hover:-translate-y-1 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-950/20"
							>
								<div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider text-blue-400">
									<span>🎵 {ost.series}</span>
									<span className="text-white/40">{ost.release_year}</span>
								</div>
								<h3 className="mt-2 text-sm font-bold text-white transition-colors group-hover/card:text-blue-400 line-clamp-1">
									{ost.title}
								</h3>
								<p className="text-xs text-white/70 truncate">{ost.artist}</p>
								<p className="mt-2 text-xs text-white/50 line-clamp-2 leading-relaxed">
									{ost.description}
								</p>
								<div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[11px] text-blue-400 font-semibold">
									<span>Écouter & Analyser</span>
									<span className="group-hover/card:translate-x-0.5 transition-transform">→</span>
								</div>
							</Link>
						))}
					</StreamRow>
				)}

				{films.length > 0 && (
					<StreamRow
						title="Films"
						count={c.movies}
						seeAllHref={ouvert("/wiki/films") ? "/wiki/films" : undefined}
					>
						{films.map((m) => (
							<PosterCard
								key={m.id}
								href={`/wiki/films/${m.slug}`}
								title={m.title}
								poster={m.poster}
								badge="Film"
							/>
						))}
					</StreamRow>
				)}

				{episodes.length > 0 && (
					<StreamRow
						title="Épisodes"
						count={c.episodes}
						seeAllHref={ouvert("/wiki/episodes") ? "/wiki/episodes" : undefined}
					>
						{episodes.map((ep) => (
							<EpisodeCard
								key={ep.id}
								href={`/wiki/episodes/${ep.id}`}
								number={ep.number_in_series}
								title={ep.title}
								image={ep.image}
							/>
						))}
					</StreamRow>
				)}

				<section className="rounded-xl border border-white/[0.08] p-8 lg:p-10">
					<h2 className="font-serif text-[26px] font-semibold tracking-tight text-white">
						Ce wiki n'est pas fini
					</h2>
					{/* Le circuit interne (« vous modifiez le texte, un relecteur publie,
					    la modification garde votre nom ») a été retiré le 2026-09-12 : ce
					    qu'un lecteur a besoin de savoir, c'est d'où vient le contenu et où
					    cliquer. */}
					<p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-white/60">
						Il est écrit sur les tomes du manga et les planches des databooks, jamais recopié
						d'ailleurs. Chaque fiche porte un bouton «&nbsp;Proposer une correction&nbsp;».
					</p>
					<Link
						href="/wiki/contribuer"
						className="mt-6 inline-flex h-11 items-center rounded-full border border-white/15 px-6 font-display text-[14px] font-semibold text-white transition-colors hover:border-dbz-orange/60 hover:text-dbz-orange focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange/60"
					>
						Contribuer au wiki
					</Link>
				</section>
			</div>
		</div>
	);
}

/**
 * Grille de rubriques : nom, volume mesuré, et ce que la rubrique contient.
 *
 * La version précédente alignait des cellules « nom + nombre » séparées par un
 * filet d'un pixel. Deux défauts : aucune rubrique ne disait ce qu'on y trouve
 * (un lecteur ne devine pas ce que « Cosmologie » recouvre), et la grille ne
 * partageait rien avec le reste du site — ni cadre d'encre, ni ombre portée,
 * alors que chaque carte du wiki en a un. Une cellule = une case de manga, avec
 * le même cadre et le même mouvement au survol que partout ailleurs.
 */
function Rubriques({
	titre,
	items,
}: {
	titre: string;
	items: Array<{ key: string; label: string; href: string; count: number; blurb: string | null }>;
}) {
	if (items.length === 0) return null;
	return (
		<section>
			<h2 className="mb-5 font-scouter text-[11px] uppercase tracking-[0.18em] text-white/45">
				{titre}
			</h2>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{items.map((r) => (
					<GatedWrap
						key={r.key}
						href={r.href}
						className="group flex h-full flex-col border border-white/[0.08] bg-dbz-card/80 p-4 transition-transform duration-150 hover:-translate-y-0.5 hover:border-dbz-orange hover:focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange/60"
					>
						<span className="flex items-baseline justify-between gap-3">
							<span className="font-display text-[15px] font-bold text-white transition-colors group-hover:text-dbz-orange">
								{r.label}
							</span>
							{r.count > 0 && (
								<span className="font-scouter text-[11px] tabular-nums text-white/40">
									{nf.format(r.count)}
								</span>
							)}
						</span>
						{r.blurb && (
							<span className="mt-1.5 text-[13px] leading-relaxed text-white/55">{r.blurb}</span>
						)}
					</GatedWrap>
				))}
			</div>
		</section>
	);
}
