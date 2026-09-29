import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JournalIndex, journalPageCount, journalHref } from "../../_journal";

export const revalidate = 60;
export const dynamicParams = true;

/** Pages 2..N prérendues — la page 1 reste `/news` (pas de doublon). */
export async function generateStaticParams() {
	const pages = await journalPageCount().catch(() => 1);
	return Array.from({ length: Math.max(0, pages - 1) }, (_, i) => ({ n: String(i + 2) }));
}

const parsePage = (raw: string): number | null => {
	// `/news/page/01` ou `/page/1` créeraient des doublons de `/news`
	// : on n'accepte QUE la forme canonique d'un entier ≥ 2.
	if (!/^[1-9][0-9]*$/.test(raw)) return null;
	const n = Number(raw);
	return n >= 2 ? n : null;
};

export async function generateMetadata({
	params,
}: {
	params: Promise<{ n: string }>;
}): Promise<Metadata> {
	const page = parsePage((await params).n);
	if (!page) return {};
	return {
		title: `Le Journal — page ${page}`,
		description:
			"Sorties anime, chapitres du manga, films, événements et analyses. Le journal Dragon Ball de la communauté francophone.",
		alternates: { canonical: journalHref(page) },
		// Les pages de série n'ont pas vocation à ranker : elles existent pour la
		// découverte des articles. `follow` seul suffit à faire crawler les liens.
		robots: { index: false, follow: true },
	};
}

export default async function JournalPagedPage({ params }: { params: Promise<{ n: string }> }) {
	const page = parsePage((await params).n);
	if (!page) notFound();
	const pages = await journalPageCount().catch(() => 1);
	if (page > pages) notFound();
	return (
		<>
			<link rel="prev" href={journalHref(page - 1)} />
			{page < pages && <link rel="next" href={journalHref(page + 1)} />}
			<JournalIndex page={page} />
		</>
	);
}
