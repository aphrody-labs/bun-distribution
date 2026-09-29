/**
 * /wiki/toriyama — Akira Toriyama, the author page.
 *
 * One page for the author and his words. The facts (dates, works, roles) are
 * verified against official archives; everything he said is quoted verbatim
 * from the corpus (`lib/toriyama-words`), never paraphrased.
 *
 * Multilingual parity: French reference, native Japanese, and English via <T />.
 */
import type { Metadata } from "next";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SITE_URL } from "@/lib/config";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import {
	Chip,
	ChipRow,
	ContributeRail,
	EmptyState,
	PageShell,
	SectionHeading,
	StatTiles,
	Stack,
} from "@/components/kit";
import { listToriyamaWords, pickThemes, prettyDocument, type ToriyamaWord } from "@/lib/toriyama-words";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { GatedLink } from "@/components/GatedLink";
import { isPathPublic } from "@/lib/wiki-launch";
import { ogMeta } from "@/lib/og";
import { T } from "@/components/T";
import { assetUrl } from "@/lib/assets";
import { ToriyamaEmblem, KintoUnCloud, DragonBallSphere } from "@shenron/ui/toriyama";

export const revalidate = 3600;

export const metadata: Metadata = ogMeta({
	title: "Akira Toriyama (鳥山明) : l'auteur de Dragon Ball et ses mots",
	description:
		"Akira Toriyama, 1955-2024 : Dr. Slump, Dragon Ball, Dragon Quest. Repères, œuvres, et toutes ses déclarations citées avec leur source et leur traduction.",
	canonical: "/wiki/toriyama",
	type: "website",
});

/** Reference facts. Anything not printed in an official source stays out. */
interface Repere {
	key: string;
	fallbackValue: string;
}

const REPERES: ReadonlyArray<Repere> = [
	{ key: "factName", fallbackValue: "Akira Toriyama · 鳥山明 · Toriyama Akira" },
	{ key: "factBirth", fallbackValue: "5 avril 1955, Nagoya (préfecture d'Aichi)" },
	{ key: "factDeath", fallbackValue: "1er mars 2024, à 68 ans" },
	{ key: "factStudio", fallbackValue: "Bird Studio, fondé en 1983" },
	{ key: "factMagazine", fallbackValue: "Weekly Shōnen Jump (Shūeisha)" },
	{ key: "factEditor", fallbackValue: "Kazuhiko Torishima" },
];

/** Works, in publication order. Roles are the credited ones. */
interface OeuvreItem {
	key: string;
	years: string;
	fallbackTitle: string;
	fallbackRole: string;
	coverUrl: string;
	badge: string;
	href?: string;
}

const OEUVRES: ReadonlyArray<OeuvreItem> = [
	{
		key: "drSlump",
		years: "1980-1984",
		fallbackTitle: "Dr. Slump",
		fallbackRole: "Manga, 18 tomes. Prix Shōgakukan 1981.",
		coverUrl: "https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088511818/1200/9784088511818.jpg",
		badge: "Manga",
	},
	{
		key: "dragonBall",
		years: "1984-1995",
		fallbackTitle: "Dragon Ball",
		fallbackRole: "Manga, 519 chapitres en 42 tomes, du n°51 de 1984 au n°25 de 1995 du Weekly Shōnen Jump.",
		coverUrl: "https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088518312/1200/9784088518312.jpg",
		badge: "Manga",
		href: "/wiki/manga",
	},
	{
		key: "dragonQuest",
		years: "1986-",
		fallbackTitle: "Dragon Quest",
		fallbackRole: "Design des personnages et des monstres de la série de jeux.",
		coverUrl: "https://cache-www.dragonquest.jp/img/common/ogp2019.png",
		badge: "Jeux vidéo",
	},
	{
		key: "chronoTrigger",
		years: "1995",
		fallbackTitle: "Chrono Trigger",
		fallbackRole: "Design des personnages.",
		coverUrl: "https://www.jp.square-enix.com/chronotrigger/twitter_card.jpg",
		badge: "Jeux vidéo",
	},
	{
		key: "sandLand",
		years: "2000",
		fallbackTitle: "Sand Land",
		fallbackRole: "Manga en un tome.",
		coverUrl: "https://dosbg3xlm0x1t.cloudfront.net/images/items/9784087926071/1200/9784087926071.jpg",
		badge: "Manga",
	},
	{
		key: "jaco",
		years: "2013",
		fallbackTitle: "Jaco the Galactic Patrolman",
		fallbackRole: "Manga en un tome, suivi de Dragon Ball Minus.",
		// ISBN 978-4-08-870892-8 (Jump Comics, 4 avril 2014), vérifié au catalogue Shūeisha.
		// L'ancien 978-4-08-870873-7 n'y existe pas : le CDN répondait 403 (clé absente).
		coverUrl: "https://dosbg3xlm0x1t.cloudfront.net/images/items/9784088708928/1200/9784088708928.jpg",
		badge: "Manga",
	},
	{
		key: "modernFilms",
		years: "2013-2022",
		fallbackTitle: "Battle of Gods, La Résurrection de F, Broly, Super Hero",
		fallbackRole: "Scénario et design des films.",
		coverUrl: "./assets/wiki/databooks/2c152758-a95f-4b6a-89c4-493f58f57ae6.jpg",
		badge: "Films",
		href: "/wiki/films",
	},
	{
		key: "dragonBallSuper",
		years: "2015-",
		fallbackTitle: "Dragon Ball Super",
		fallbackRole: "Histoire originale ; manga dessiné par Toyotarō.",
		coverUrl: "./assets/wiki/databooks/52146a88-ad14-4375-8f32-182f3b610ba2.jpg",
		badge: "Manga & Anime",
		href: "/wiki/sagas",
	},
	{
		key: "dragonBallDaima",
		years: "2024",
		fallbackTitle: "Dragon Ball Daima",
		fallbackRole: "Histoire et design des personnages.",
		coverUrl: "https://dragonballdaima.com/assets/img/kv1.png",
		badge: "Anime",
	},
];

const THEME_EMBLEMS: Record<string, "go" | "vegeta_royal" | "demon" | "kame" | "kai" | "capsule_corp"> = {
	goku: "go",
	vegeta: "vegeta_royal",
	piccolo: "demon",
	gohan: "kame",
	ennemis: "demon",
	"super-saiyan": "kai",
	atelier: "capsule_corp",
};

export default async function ToriyamaPage() {
	const [{ groups, total, documents, translated }, access] = await Promise.all([
		listToriyamaWords("profile"),
		getLaunchConfig().catch(() => null),
	]);
	const databooksOuverts = access ? isPathPublic("/wiki/databooks", access) : true;
	const themes = pickThemes(groups.flatMap((g) => g.words));

	const personLd = {
		"@context": "https://schema.org",
		"@type": "Person",
		name: "Akira Toriyama",
		alternateName: ["鳥山明", "Toriyama Akira"],
		birthDate: "1955-04-05",
		deathDate: "2024-03-01",
		birthPlace: { "@type": "Place", name: "Nagoya, Aichi, Japon" },
		jobTitle: "Mangaka",
		url: `${SITE_URL}/wiki/toriyama`,
	};

	return (
		<PageShell rhythm="loose">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(personLd) }}
			/>
			<div className="flex flex-wrap items-center justify-between gap-4 mb-8">
				<Breadcrumbs
					items={[
						{ label: "Wiki", display: <T k="wiki.breadcrumb" />, href: "/wiki" },
						{ label: "Akira Toriyama", display: <T k="wiki.toriyama.breadcrumb" /> },
					]}
				/>
				<WikiDrawer />
			</div>
			<div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-white/70">
				<span>Archives InLife, Caramel Mama et Wikipédia JA : provenance affichée, statut non canonique.</span>
				<Link href="/sources/dragon-ball" className="font-semibold text-emerald-200 hover:text-white">Voir le dossier des sources →</Link>
			</div>
			<nav aria-label="Parcours éditorial" className="mb-8 flex flex-wrap gap-2 text-sm">
				<Link className="rounded-lg border border-dbz-orange/40 bg-dbz-orange/10 px-3 py-2 text-dbz-orange" href="/wiki/toriyama"><T k="wiki.editorialNav.toriyama" /></Link>
				<Link className="rounded-lg border border-white/10 px-3 py-2 text-white/70 hover:border-white/30 hover:text-white" href="/wiki/interviews"><T k="wiki.editorialNav.interviews" /></Link>
				<GatedLink className="rounded-lg border border-white/10 px-3 py-2 text-white/70 hover:border-white/30 hover:text-white" href="/wiki/databooks"><T k="wiki.editorialNav.catalogue" /></GatedLink>
			</nav>

			{/* ——— Hero Section ——— */}
			<div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-dbz-card via-dbz-card/90 to-dbz-card/50 p-6 sm:p-10">
				<div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
					<div className="flex-1 space-y-4">
						<div className="inline-flex items-center gap-2 rounded-full border border-dbz-orange/40 bg-dbz-orange/10 px-3.5 py-1 text-[0.8125rem] font-medium text-dbz-orange">
							<span className="inline-block h-2 w-2 rounded-full bg-dbz-orange animate-pulse" />
							<span>鳥山明 · 1955-2024</span>
						</div>

						<h1 className="font-serif text-3xl font-bold tracking-tight text-white sm:text-5xl">
							Akira Toriyama
						</h1>

						<p className="max-w-2xl text-[1.0625rem] leading-relaxed text-white/75 sm:text-[1.125rem]">
							<T k="wiki.toriyama.standfirst" />
						</p>

						<div className="pt-2 flex flex-wrap items-center gap-3">
							<Link href="/wiki/canon" className="toriyama-btn-secondary !text-[0.8125rem]">
								<T k="wiki.toriyama.checkClaim" />
							</Link>
							<a
								href="#oeuvres"
								className="inline-flex items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.04] px-3.5 py-2 text-[0.8125rem] font-medium text-white/85 transition-colors hover:border-dbz-gold/60 hover:text-white"
							>
								<DragonBallSphere stars={4} size={18} className="shrink-0" />
								<span>
									<T k="wiki.toriyama.worksTitle" />
								</span>
							</a>
							<a
								href="#sujets"
								className="inline-flex items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.04] px-3.5 py-2 text-[0.8125rem] font-medium text-white/85 transition-colors hover:border-dbz-gold/60 hover:text-white"
							>
								<ToriyamaEmblem name="go" size={18} className="shrink-0" />
								<span>
									<T k="wiki.toriyama.themesTitle" />
								</span>
							</a>
						</div>
					</div>

					{/* Author portrait card with historic photo */}
					<div className="relative shrink-0 self-center md:self-auto">
						<div className="relative overflow-hidden rounded-xl border-2 border-dbz-gold/40 bg-black/40 p-1 shadow-2xl shadow-black/60 transition-transform duration-300 hover:scale-[1.02]">
							<img
								src="https://upload.wikimedia.org/wikipedia/en/1/15/Akira_Toriyama_in_1982.jpg"
								alt="Akira Toriyama à son atelier Bird Studio (1982)"
								loading="eager"
								className="h-56 w-44 rounded-lg object-cover sm:h-64 sm:w-52"
							/>
							<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 text-center">
								<p className="text-[0.6875rem] font-medium text-white/90">Akira Toriyama (1982)</p>
								<p className="text-[0.625rem] text-white/50">Bird Studio · © Shūeisha</p>
							</div>
						</div>
					</div>
				</div>

				{/* Signature watermark accent */}
				<div className="pointer-events-none absolute right-4 bottom-2 select-none opacity-5">
					<img
						src="https://upload.wikimedia.org/wikipedia/commons/5/58/Signature_of_Akira_Toriyama.svg"
						alt=""
						className="h-24 w-auto invert"
						aria-hidden="true"
					/>
				</div>
			</div>

			{total > 0 && (
				<StatTiles
					className="mt-8"
					items={[
						{ label: <T k="wiki.toriyama.statQuotes" />, value: total, href: "#corpus" },
						{ label: <T k="wiki.toriyama.statWorks" />, value: documents, href: "#oeuvres" },
						{
							label: <T k="wiki.toriyama.statTranslated" />,
							value: translated,
							hint:
								translated < total ? (
									<T k="wiki.toriyama.statToTranslate" values={{ count: total - translated }} />
								) : (
									<T k="wiki.toriyama.statComplete" />
								),
						},
					]}
				/>
			)}

			<Stack className="mt-12">
				{/* ——— Repères ——— */}
				<section aria-labelledby="reperes">
					<SectionHeading
						id="reperes"
						level={2}
						kicker={<T k="wiki.toriyama.factsKicker" />}
						title={<T k="wiki.toriyama.factsTitle" />}
					/>
					<dl className="mt-6 grid gap-px overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-3">
						{REPERES.map((r) => (
							<div key={r.key} className="bg-dbz-card/90 px-5 py-4 transition-colors hover:bg-dbz-card">
								<dt className="text-[0.6875rem] uppercase tracking-[0.14em] text-white/45">
									<T k={`wiki.toriyama.${r.key}`} />
								</dt>
								<dd className="mt-1 text-[0.9375rem] font-medium text-white/95">
									<T k={`wiki.toriyama.${r.key}Val`} />
								</dd>
							</div>
						))}
					</dl>
				</section>

				{/* ——— Œuvres ——— */}
				<section aria-labelledby="oeuvres">
					<SectionHeading
						id="oeuvres"
						level={2}
						kicker={<T k="wiki.toriyama.worksKicker" />}
						title={<T k="wiki.toriyama.worksTitle" />}
					/>
					<div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{OEUVRES.map((o) => (
							<article
								key={o.key}
								className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-white/[0.08] bg-dbz-card/70 p-4 transition-all duration-200 hover:border-dbz-gold/60 hover:bg-dbz-card/90"
							>
								<div className="flex gap-4">
									{/* Book / Work visual thumbnail */}
									<div className="relative h-28 w-20 shrink-0 overflow-hidden rounded-lg border border-white/[0.1] bg-black/40 shadow-md">
										<img
											src={assetUrl(o.coverUrl)}
											alt={o.fallbackTitle}
											loading="lazy"
											className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
										/>
									</div>

									<div className="flex flex-1 flex-col justify-between">
										<div>
											<div className="flex items-center justify-between gap-2">
												<span className="font-mono text-[0.8125rem] font-medium text-dbz-orange">
													{o.years}
												</span>
												<span className="rounded bg-white/[0.06] px-2 py-0.5 text-[0.6875rem] font-medium text-white/60">
													{o.badge}
												</span>
											</div>

											<h3 className="mt-1.5 font-serif text-[1.125rem] font-bold text-white">
												{o.href ? (
													<Link href={o.href} className="underline-offset-4 hover:underline">
														<T k={`wiki.toriyama.work.${o.key}Title`} />
													</Link>
												) : (
													<T k={`wiki.toriyama.work.${o.key}Title`} />
												)}
											</h3>
										</div>

										{o.key === "dragonBall" && (
											<div className="mt-1 inline-flex items-center gap-1.5">
												<KintoUnCloud width={40} height={24} decorative />
											</div>
										)}
									</div>
								</div>

								<p className="mt-3 text-[0.875rem] leading-relaxed text-white/65">
									<T k={`wiki.toriyama.work.${o.key}Role`} />
								</p>

								{o.href && (
									<div className="mt-3 pt-3 border-t border-white/[0.06]">
										<Link
											href={o.href}
											className="inline-flex items-center gap-1 text-[0.75rem] font-medium text-dbz-orange underline-offset-4 hover:underline"
										>
											<span>
												<T k="wiki.toriyama.readWork" />
											</span>
											<span aria-hidden="true">→</span>
										</Link>
									</div>
								)}
							</article>
						))}
					</div>
				</section>

				{/* ——— By subject ——— */}
				{themes.length > 0 && (
					<section aria-labelledby="sujets">
						<SectionHeading
							id="sujets"
							level={2}
							kicker={<T k="wiki.toriyama.themesKicker" />}
							title={<T k="wiki.toriyama.themesTitle" />}
							standfirst={<T k="wiki.toriyama.themesStandfirst" />}
						/>
						<div className="mt-8 space-y-12">
							{themes.map((theme) => {
								const emblemSymbol = THEME_EMBLEMS[theme.id] ?? "go";
								return (
									<div
										key={theme.id}
										id={`sujet-${theme.id}`}
										className="rounded-2xl border border-white/[0.06] bg-dbz-card/40 p-6"
									>
										<div className="flex items-center gap-3">
											<div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04]">
												<ToriyamaEmblem name={emblemSymbol} size={24} />
											</div>
											<div>
												<h3 className="font-serif text-[1.25rem] font-semibold text-white">
													<T k={`wiki.toriyama.theme.${theme.id}Title`} />
												</h3>
												<p className="text-[0.875rem] text-white/55">
													<T k={`wiki.toriyama.theme.${theme.id}Lede`} />
												</p>
											</div>
										</div>

										<ul className="mt-6 grid gap-4 lg:grid-cols-3">
											{theme.words.map((word) => (
												<WordCard
													key={word.id}
													word={word}
													databooksOuverts={databooksOuverts}
													compact
												/>
											))}
										</ul>
									</div>
								);
							})}
						</div>
					</section>
				)}

				{/* ——— Corpus, by work ——— */}
				<section aria-labelledby="corpus">
					<SectionHeading
						id="corpus"
						level={2}
						kicker={<T k="wiki.toriyama.corpusKicker" />}
						title={<T k="wiki.toriyama.corpusTitle" />}
						standfirst={<T k="wiki.toriyama.corpusStandfirst" />}
					/>
					{groups.length > 0 && (
						<ChipRow className="mt-6">
							{groups.map((group) => (
								<Chip
									key={group.documentKey}
									href={`#src-${slugifyAnchor(group.documentKey)}`}
									tone="neutral"
								>
									{group.year ? `${group.year} · ` : ""}
									{group.document}
									{group.words.length > 0 ? ` (${group.words.length})` : ""}
								</Chip>
							))}
						</ChipRow>
					)}

					{groups.length === 0 ? (
						<EmptyState
							title={<T k="wiki.toriyama.emptyTitle" />}
							description={<T k="wiki.toriyama.emptyDescription" />}
							actions={[
								...(databooksOuverts
									? [
											{
												href: "/wiki/databooks",
												label: <T k="wiki.toriyama.openDatabooks" />,
											},
										]
									: []),
								{ href: "/wiki/canon", label: <T k="wiki.toriyama.canon" /> },
							]}
						/>
					) : (
						<div className="mt-10 space-y-14">
							{groups.map((group) => (
								<section
									key={group.documentKey}
									aria-labelledby={`src-${slugifyAnchor(group.documentKey)}`}
									className="rounded-2xl border border-white/[0.08] bg-dbz-card/60 p-6"
								>
									<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
										<div className="flex items-center gap-4">
											{group.cover && (
												<div className="relative h-16 w-12 shrink-0 overflow-hidden rounded border border-white/[0.12] bg-black/40">
													<img
														src={assetUrl(group.cover)}
														alt={group.document}
														loading="lazy"
														className="h-full w-full object-cover"
													/>
												</div>
											)}
											<div>
												{group.year && (
													<span className="font-mono text-[0.75rem] font-medium text-dbz-orange">
														{group.year}
													</span>
												)}
												<h3
													id={`src-${slugifyAnchor(group.documentKey)}`}
													className="font-serif text-[1.25rem] font-bold text-white"
												>
													{group.document}
												</h3>
											</div>
										</div>

										{group.databookId && databooksOuverts && (
											<Link
												href={`/wiki/databooks/${group.databookId}`}
												className="inline-flex items-center gap-1 text-[0.8125rem] font-medium text-dbz-orange underline-offset-4 hover:underline"
											>
												<span>
													<T k="wiki.toriyama.readWork" />
												</span>
												<span aria-hidden="true">→</span>
											</Link>
										)}
									</div>

									{group.words.length === 0 ? (
										<p className="mt-4 text-[0.9375rem] text-white/55">
											<T k="wiki.toriyama.noQuote" />
										</p>
									) : (
										<ul className="mt-6 space-y-5">
											{group.words.map((word) => (
												<WordCard key={word.id} word={word} databooksOuverts={databooksOuverts} />
											))}
										</ul>
									)}
								</section>
							))}
						</div>
					)}
				</section>

				<ContributeRail
					quoiKey="kit.contribute.what.interview"
					contributeHref="/wiki/contribuer"
				/>
			</Stack>
		</PageShell>
	);
}

/**
 * Quote body. The corpus is markdown: 366 references carried over from
 * databook transcriptions are bullet lists with `**label**` emphasis and line
 * breaks. Printed as a text node, the asterisks showed and the lines collapsed
 * into one run. Rendered without `rehype-raw`, so any raw HTML stays escaped.
 */
function QuoteText({ text, className }: { text: string; className: string }) {
	return (
		<div className={`${className} space-y-2`}>
			<ReactMarkdown
				remarkPlugins={[remarkGfm, remarkBreaks]}
				disallowedElements={["img"]}
				unwrapDisallowed
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}

/** One quote: subject, source text (Japanese original + French translation), reference. */
function WordCard({
	word,
	databooksOuverts,
	compact = false,
}: {
	word: ToriyamaWord;
	databooksOuverts: boolean;
	compact?: boolean;
}) {
	return (
		<li className="rounded-xl border border-white/[0.08] bg-dbz-card/80 p-5 transition-colors hover:border-dbz-gold/60">
			{word.subject && (
				<h4 className="font-serif text-[1.0625rem] font-semibold text-white">{word.subject}</h4>
			)}

			{word.lang === "ja" ? (
				<div className="mt-3 space-y-3">
					{(!compact || !word.textFr) && (
						<div>
							<div className="inline-flex items-center gap-1.5 rounded bg-white/[0.06] px-2 py-0.5 text-[0.6875rem] font-medium text-dbz-gold">
								<T k="wiki.toriyama.originalJa" />
							</div>
							<QuoteText text={word.text} className="mt-1.5 font-jp text-[1rem] leading-relaxed text-white/90" />
						</div>
					)}
					{word.textFr && (
						<div className="border-l-2 border-dbz-orange/60 pl-3.5">
							<div className="inline-flex items-center gap-1.5 text-[0.6875rem] font-medium text-dbz-orange/90">
								<T k="wiki.toriyama.translationFr" />
							</div>
							<QuoteText text={word.textFr} className="mt-1 text-[0.9375rem] leading-relaxed text-white/80" />
						</div>
					)}
				</div>
			) : (
				<QuoteText text={word.textFr ?? word.text} className="mt-3 text-[0.9375rem] leading-relaxed text-white/85" />
			)}

			<ChipRow className="mt-4">
				<Chip tone="quiet" title="Source de la citation">
					{word.source}
				</Chip>
				{compact && (
					<Chip href={`#src-${slugifyAnchor(word.document)}`} tone="quiet">
						{prettyDocument(word.document)}
					</Chip>
				)}
				{word.href && databooksOuverts && (
					<Chip href={word.href} tone="neutral">
						<T k="wiki.toriyama.seePlate" />
					</Chip>
				)}
			</ChipRow>
		</li>
	);
}

/** Stable anchor for a work title (deep links from the summary). */
function slugifyAnchor(value: string): string {
	return value
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 60);
}
