import type { Metadata } from "next";
import Link from "next/link";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { PageShell } from "@/components/kit";
import { SITE_URL } from "@/lib/config";
import {
	EXTERNAL_SOURCE_KINDS,
	externalSourceHref,
	searchExternalSources,
} from "@/lib/external-source-catalog";
import { ogMeta } from "@/lib/og";

// La provenance est alimentée par les campagnes BXC en cours : cinq minutes
// gardent le coût des lectures PG borné tout en évitant une page figée pendant
// une longue collecte.
export const revalidate = 300;

export const metadata: Metadata = {
	title: "Sources Dragon Ball — collecte BXC et Shenron",
	description:
		"Moteur de recherche Dragon Ball attribué : pages web, publications, épisodes, statistiques, archives et médias.",
	...ogMeta({
		title: "Sources Dragon Ball — BXC × Shenron",
		description:
			"Moteur de recherche attribué couvrant les sources Dragon Ball collectées par BXC.",
		canonical: "/sources/dragon-ball",
		type: "website",
	}),
};

type JsonValue = { [key: string]: unknown } | unknown[];

async function readDataset<T extends JsonValue>(name: string): Promise<T | null> {
	const candidates = [
		join(process.cwd(), "data", "crawled_db", name),
		join(process.cwd(), "..", "..", "data", "crawled_db", name),
	];
	for (const path of candidates) {
		if (!existsSync(/* turbopackIgnore: true */ path)) continue;
		try {
			return JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8")) as T;
		} catch {
			return null;
		}
	}
	return null;
}

function countRows(value: JsonValue | null): number {
	if (Array.isArray(value)) return value.length;
	if (value && typeof value === "object") {
		const docs = value.docs;
		if (Array.isArray(docs)) return docs.length;
	}
	return 0;
}

function firstTitle(value: JsonValue | null): string | null {
	if (!Array.isArray(value) || !value.length || typeof value[0] !== "object" || !value[0])
		return null;
	const item = value[0] as Record<string, unknown>;
	for (const key of ["title", "title_fr", "name", "originalTitle"]) {
		if (typeof item[key] === "string" && item[key]) return item[key] as string;
	}
	return null;
}

function sourceHost(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "source externe";
	}
}

function formatFetchedAt(value: Date): string {
	return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(value);
}

function provenanceLabel(provenance: Record<string, unknown>): string | null {
	const crawlSource = provenance.crawlSource;
	if (typeof crawlSource !== "string" || !crawlSource) return null;
	return crawlSource.split("/").filter(Boolean).at(-2) ?? null;
}

const KIND_LABEL: Record<string, string> = {
	publisher: "Éditeur",
	reference: "Référence",
	archive: "Archive",
	wayback: "Archive web",
	encyclopedia: "Encyclopédie",
	statistics: "Statistiques",
	media: "Média",
};

function safeExternalUrl(value: string): string | null {
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
	} catch {
		return null;
	}
}

const SOURCES = [
	{
		key: "web-a",
		label: "Collecte Web A",
		kind: "Actualités et publications",
		url: "https://dragon-ball-official.com/",
		href: "/news",
		file: "db_official_news.json",
		accent: "border-dbz-orange/40 bg-dbz-orange/10",
	},
	{
		key: "toei",
		label: "Toei Animation",
		kind: "Épisodes et synopsis",
		url: "https://lineup.toei-anim.co.jp/ja/search/list.php?type=search&val=ドラゴンボール",
		href: "/wiki/episodes",
		file: "toei_episodes_classic.json",
		accent: "border-blue-400/40 bg-blue-400/10",
	},
	{
		key: "jajanken",
		label: "Jajanken / Weekly Shōnen Jump",
		kind: "Classements et statistiques manga",
		url: "https://www.jajanken.net/sakuhins/QvL0By28NV",
		href: "/wiki/manga",
		file: "jajanken_jump_stats.json",
		accent: "border-dbz-gold/40 bg-dbz-gold/10",
	},
	{
		key: "toriyama",
		label: "Canon — Akira Toriyama",
		kind: "Biographies et repères historiques",
		url: "https://ja.wikipedia.org/wiki/鳥山明",
		href: "/wiki/toriyama",
		file: "toriyama_archives.json",
		accent: "border-emerald-400/40 bg-emerald-400/10",
	},
] as const;

export default async function DragonBallSourcesPage({
	searchParams,
}: {
	searchParams: Promise<{ q?: string; kind?: string; page?: string }>;
}) {
	const params = await searchParams;
	const q = (params.q ?? "").trim().slice(0, 120);
	const kind = EXTERNAL_SOURCE_KINDS.includes(params.kind as (typeof EXTERNAL_SOURCE_KINDS)[number])
		? params.kind!
		: "";
	const page = Math.max(1, Number(params.page) || 1);
	const pageSize = 18;
	const [datasets, bxcCatalog] = await Promise.all([
		Promise.all(SOURCES.map(async (source) => ({ source, data: await readDataset(source.file) }))),
		searchExternalSources({ q, kind, limit: pageSize, offset: (page - 1) * pageSize }),
	]);
	const toeiFiles = [
		"toei_episodes_classic.json",
		"toei_episodes_dbz.json",
		"toei_episodes_dbs.json",
		"toei_episodes_kai.json",
	];
	const toeiCount = (await Promise.all(toeiFiles.map((file) => readDataset(file)))).reduce(
		(sum, data) => sum + countRows(data),
		0
	);
	const feed = await readDataset("shenron_feed_actu.json");
	const totalRows =
		datasets.reduce((sum, item) => sum + countRows(item.data), 0) +
		toeiCount -
		countRows(datasets[1]?.data ?? null);

	const ld = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		name: "Sources Dragon Ball — BXC × Shenron",
		url: `${SITE_URL}/sources/dragon-ball`,
		isPartOf: { "@type": "WebSite", name: "Dragon Ball FR" },
		about: SOURCES.map((source) => ({
			"@type": "CreativeWork",
			name: source.label,
			url: source.url,
		})),
	};

	return (
		<PageShell rhythm="loose">
			<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
			<Breadcrumbs
				className="mb-8"
				items={[{ label: "Sources Dragon Ball", display: "Sources BXC × Shenron" }]}
			/>
			<header className="mb-10 max-w-3xl">
				<p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-dbz-orange">
					Collecte attribuée · BXC
				</p>
				<h1 className="font-display text-3xl font-bold text-white sm:text-5xl">
					Les sources qui nourrissent Shenron
				</h1>
				<p className="mt-4 text-base leading-7 text-white/65">
					Toutes les sources BXC sont indexées et classifiées ici : publications, références,
					archives, encyclopédies, statistiques et médias. Les textes restent attribués à leur
					origine ; le canon est un jugement séparé, jamais un filtre de recherche.
				</p>
				<div className="mt-5 flex flex-wrap gap-3 text-xs text-white/55">
					<span className="rounded-full border border-white/10 px-3 py-1">
						{totalRows.toLocaleString("fr-FR")} entrées collectées
					</span>
					<span className="rounded-full border border-white/10 px-3 py-1">
						BXC · profil HTTP / statique
					</span>
					{bxcCatalog.total > 0 && (
						<span className="rounded-full border border-dbz-orange/30 bg-dbz-orange/10 px-3 py-1 text-dbz-orange">
							{bxcCatalog.total.toLocaleString("fr-FR")} documents synchronisés
						</span>
					)}
					{Array.isArray(feed) && (
						<span className="rounded-full border border-white/10 px-3 py-1">
							{feed.length} actus prêtes à publier
						</span>
					)}
				</div>
			</header>

			<section className="grid gap-5 md:grid-cols-2" aria-label="Sources Dragon Ball">
				{datasets.map(({ source, data }) => {
					const count = source.key === "toei" ? toeiCount : countRows(data);
					return (
						<article key={source.key} className={`rounded-2xl border p-5 ${source.accent}`}>
							<div className="flex items-start justify-between gap-4">
								<div>
									<p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">
										{source.kind}
									</p>
									<h2 className="mt-2 text-xl font-bold text-white">{source.label}</h2>
								</div>
								<span className="rounded-full bg-black/25 px-3 py-1 text-sm font-semibold text-white">
									{count.toLocaleString("fr-FR")}
								</span>
							</div>
							<p className="mt-4 min-h-10 text-sm text-white/65">
								{firstTitle(data) ?? "Données collectées et vérifiées par le pipeline BXC."}
							</p>
							<div className="mt-5 flex flex-wrap gap-3 text-xs">
								<Link
									href={source.href}
									className="rounded-lg bg-white/10 px-3 py-2 font-semibold text-white hover:bg-white/20"
								>
									Ouvrir la page Shenron →
								</Link>
								<a
									href={source.url}
									target="_blank"
									rel="noreferrer"
									className="rounded-lg border border-white/15 px-3 py-2 text-white/70 hover:text-white"
								>
									Source première ↗
								</a>
							</div>
						</article>
					);
				})}
			</section>

			<section className="mt-10" aria-labelledby="bxc-live-title">
				<div className="flex flex-wrap items-end justify-between gap-3">
					<div>
						<p className="text-xs font-semibold uppercase tracking-[0.2em] text-dbz-orange">
							Moteur BXC
						</p>
						<h2 id="bxc-live-title" className="mt-2 text-2xl font-bold text-white">
							Rechercher dans toutes les collectes
						</h2>
					</div>
					<p className="max-w-lg text-sm leading-6 text-white/55">
						Chaque résultat garde sa classification et son lien d’origine. Aucune source n’est
						écartée du moteur.
					</p>
				</div>
				<form
					method="GET"
					className="mt-5 grid gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 md:grid-cols-[1fr_12rem_auto]"
				>
					<label className="sr-only" htmlFor="bxc-query">
						Rechercher dans les sources BXC
					</label>
					<input
						id="bxc-query"
						type="search"
						name="q"
						defaultValue={q}
						placeholder="Goku, Daima, Toriyama, tournoi…"
						className="min-h-11 w-full rounded-lg border border-white/15 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-dbz-orange"
					/>
					<select
						name="kind"
						defaultValue={kind}
						aria-label="Classification de source"
						className="min-h-11 rounded-lg border border-white/15 bg-black/20 px-3 text-sm text-white outline-none focus:border-dbz-orange"
					>
						<option value="">Toutes les classifications</option>
						{EXTERNAL_SOURCE_KINDS.map((value) => (
							<option key={value} value={value}>
								{KIND_LABEL[value] ?? value}
							</option>
						))}
					</select>
					<button
						type="submit"
						className="min-h-11 rounded-lg bg-dbz-orange px-5 text-sm font-bold text-black transition hover:bg-dbz-yellow"
					>
						Rechercher
					</button>
				</form>
				{bxcCatalog.records.length > 0 ? (
					<ul className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
						{bxcCatalog.records.map((record) => (
							<li
								key={record.url}
								className="rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-dbz-orange/45"
							>
								<p className="text-xs font-semibold uppercase tracking-[0.14em] text-dbz-orange">
									{sourceHost(record.url)} · {KIND_LABEL[record.kind] ?? record.kind}
								</p>
								<h3 className="mt-2 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-white">
									<Link href={externalSourceHref(record.url)} className="hover:text-dbz-orange">
										{record.title}
									</Link>
								</h3>
								{record.excerpt ? (
									<p className="mt-2 line-clamp-3 text-xs leading-5 text-white/55">
										{record.excerpt}
									</p>
								) : null}
								{provenanceLabel(record.provenance) ? (
									<p className="mt-2 truncate text-[11px] text-white/40">
										Collecte : {provenanceLabel(record.provenance)}
									</p>
								) : null}
								<div className="mt-3 flex items-center justify-between gap-2 text-xs text-white/45">
									<span>Relevée le {formatFetchedAt(record.fetchedAt)}</span>
									<span className="flex shrink-0 gap-3">
										<Link
											href={externalSourceHref(record.url)}
											className="font-semibold text-white/70 hover:text-dbz-orange"
										>
											Fiche ↗
										</Link>
										{safeExternalUrl(record.url) ? (
											<a
												href={safeExternalUrl(record.url)!}
												target="_blank"
												rel="noreferrer"
												className="font-semibold text-white/70 hover:text-dbz-orange"
											>
												Original ↗
											</a>
										) : null}
									</span>
								</div>
							</li>
						))}
					</ul>
				) : (
					<p className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] p-5 text-sm leading-6 text-white/60">
						{q || kind
							? "Aucune source ne correspond à ces filtres."
							: "La synchronisation BXC est en cours. Les données apparaîtront ici dès leur ingestion."}
					</p>
				)}
				{bxcCatalog.total > pageSize && (
					<nav
						className="mt-5 flex items-center justify-center gap-3 text-sm"
						aria-label="Pagination des sources BXC"
					>
						{page > 1 ? (
							<Link
								href={`/sources/dragon-ball?${new URLSearchParams({ ...(q ? { q } : {}), ...(kind ? { kind } : {}), page: String(page - 1) })}`}
								className="rounded-lg border border-white/15 px-4 py-2 text-white/70 hover:border-dbz-orange hover:text-white"
							>
								Précédent
							</Link>
						) : null}
						<span className="text-white/55">
							Page {page} · {bxcCatalog.total.toLocaleString("fr-FR")} résultats
						</span>
						{page * pageSize < bxcCatalog.total ? (
							<Link
								href={`/sources/dragon-ball?${new URLSearchParams({ ...(q ? { q } : {}), ...(kind ? { kind } : {}), page: String(page + 1) })}`}
								className="rounded-lg border border-white/15 px-4 py-2 text-white/70 hover:border-dbz-orange hover:text-white"
							>
								Suivant
							</Link>
						) : null}
					</nav>
				)}
			</section>

			<section className="mt-10 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm text-white/65">
				<h2 className="font-semibold text-white">Méthode et provenance</h2>
				<p className="mt-2 leading-6">
					Chaque document est relié à son URL d’origine et à sa collecte. Les synopsis,
					statistiques, archives et pages externes restent des documents attribués ; le canon est
					une information éditoriale séparée, sans effet sur leur présence dans le moteur.
				</p>
			</section>
		</PageShell>
	);
}
