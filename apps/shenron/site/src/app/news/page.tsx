import type { Metadata } from "next";
import Link from "next/link";
import { JournalIndex, journalPageCount, journalHref } from "./_journal";
import { PageHero } from "@/components/PageHero";
import { PageShell } from "@/components/kit";
import { pageHero } from "@/lib/banner-config";

// Aucun `searchParams` lu ici : la page 1 est PRÉRENDUE et cachée par le CDN.
// La pagination vit sous `/news/page/[n]` (cf. `_journal.tsx`).
export const revalidate = 60;

export const metadata: Metadata = {
	title: "News — actualités Dragon Ball",
	description:
		"Sorties anime, chapitres du manga, films, événements et analyses. Les actualités Dragon Ball de la communauté francophone.",
	alternates: {
		canonical: "/news",
		types: { "application/rss+xml": [{ url: "/news/rss.xml", title: "News & Actualités — DBFR" }] },
	},
};

export default async function ActualitesPage() {
	// `rel="next"` en <head> : indique explicitement à un crawler que la série
	// continue, sans qu'il ait à découvrir le lien dans le corps de page.
	const pages = await journalPageCount().catch(() => 1);
	return (
		<>
			<PageHero
				eyebrow="Dragon Ball France"
				title="Actualités"
				lead="Sorties anime, chapitres manga, films, événements et analyses de la communauté."
				image={await pageHero("news")}
				imageAlt="Actualités Dragon Ball"
			/>
			{pages > 1 && <link rel="next" href={journalHref(2)} />}
			<PageShell rhythm="none" className="mb-6">
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dbz-orange/20 bg-dbz-orange/5 px-4 py-3 text-sm text-white/70">
					<span>Les actus officielles Dragon Ball sont importées avec leur lien canonique.</span>
					<Link href="/sources/dragon-ball" className="font-semibold text-dbz-orange hover:text-white">Voir les sources BXC →</Link>
				</div>
			</PageShell>
			<JournalIndex page={1} />
		</>
	);
}
