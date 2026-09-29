import { WikiMarkdown } from "@/components/wiki/WikiMarkdown";
import { db } from "@/lib/db";
import { isCurrentUserAdmin } from "@/lib/session";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Image from "next/image";

/** Extrait lisible du corps markdown, pour la balise description. */
function extrait(body: string, max = 160): string {
	const nu = body
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/[#>*_`|-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	return nu.length > max ? `${nu.slice(0, max - 1).trimEnd()}…` : nu;
}

// Chaque page wiki éditoriale portait le titre générique du site : ni résultat
// de recherche exploitable, ni aperçu de partage distinct sur Discord.
export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const page = await db.query.wikiPages.findFirst({
		where: (p, { eq }) => eq(p.slug, slug[slug.length - 1]!),
		columns: { title: true, body: true, slug: true },
	});
	if (!page) return { title: "Page introuvable", robots: { index: false, follow: true } };
	return {
		title: page.title,
		// Pas de champ résumé sur `WikiPage` : on dérive un extrait du corps
		// (markdown débarrassé de sa syntaxe la plus bruyante).
		description: extrait(page.body) || `${page.title} — article du wiki Dragon Ball France.`,
		// La canonique suit le SLUG, jamais le chemin demandé. La recherche ne
		// retient que le dernier segment : `/wiki/n-importe-quoi/toriyama` servait
		// donc la même page que `/wiki/toriyama` en se déclarant canonique à SA
		// propre URL — une famille infinie de doublons indexables, fabricable
		// depuis l'extérieur. Le sitemap, lui, n'a jamais publié qu'un segment.
		alternates: { canonical: `/wiki/${page.slug}` },
	};
}

export default async function WikiPage({ params }: { params: Promise<{ slug: string[] }> }) {
	const { slug } = await params;
	const pageSlug = slug[slug.length - 1];

	const page = await db.query.wikiPages.findFirst({
		where: (p, { eq }) => eq(p.slug, pageSlug),
		with: { category: { with: { parent: true } } },
	});

	if (!page) notFound();

	const isAdmin = await isCurrentUserAdmin();

	return (
		<div className="wiki-container">
			<nav className="flex gap-2 text-xs text-gray-400 mb-8 uppercase tracking-widest font-saiyan">
				<Link href="/wiki" className="hover:text-dbz-orange transition-colors">WIKI</Link>
				<span>/</span>
				{page.category.parent && (
					<>
						<span>{page.category.parent.name}</span>
						<span>/</span>
					</>
				)}
				<span className="text-dbz-orange">{page.category.name}</span>
			</nav>
			<div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8 overflow-hidden">
				<Image
					src="/dbz/kinto-un.svg"
					alt=""
					aria-hidden
					width={240}
					height={135}
					className="pointer-events-none absolute right-0 top-1/2 hidden -translate-y-1/2 opacity-[0.1] md:block"
				/>
				<h1 className="font-saiyan text-4xl sm:text-5xl md:text-6xl font-bold tracking-wider text-white drop-shadow-[0_4px_16px_rgba(255,107,0,0.35)]">
					{page.title}
				</h1>
				{isAdmin && (
					<Link
						href={`/admin/wiki/page/${page.id}`}
						className="shrink-0 inline-flex items-center gap-2 rounded border-2 border-black bg-dbz-orange/20 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-dbz-orange shadow-[2px_2px_0px_#000] hover:bg-dbz-orange hover:text-black transition-all"
					>
						Éditer cette page
					</Link>
				)}
			</div>
			<div className="wiki-content-card">
				<div className="prose prose-invert max-w-none wiki-content">
					<WikiMarkdown body={page.body} />
				</div>
			</div>
			<div className="mt-16 pt-8 border-t border-dbz-border text-xs text-gray-500">
				Dernière mise à jour le {new Date(page.updatedAt).toLocaleDateString("fr-FR")}
			</div>
		</div>
	);
}

export const dynamic = "force-dynamic";
