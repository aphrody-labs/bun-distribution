import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { TierlistView } from "@/components/tierlist/TierlistView";
import { TierlistLike } from "@/components/tierlist/TierlistLike";
import { getTierlistBySlug, listTierlists } from "@/lib/tierlists";
import { ogMeta } from "@/lib/og";

export const revalidate = 60;
export const dynamicParams = true;

export async function generateStaticParams() {
	try {
		const lists = await listTierlists(100);
		return lists.map((t) => ({ slug: t.slug }));
	} catch {
		return [];
	}
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const tl = await getTierlistBySlug(slug);
	if (!tl) return { title: "Tierlist introuvable" };
	const desc =
		tl.description || `Tierlist Dragon Ball par ${tl.author?.username ?? "la communauté"}.`;
	return {
		title: tl.title,
		description: desc,
		...ogMeta({ title: tl.title, description: desc, canonical: `/tierlists/${slug}` }),
	};
}

export default async function TierlistPage({ params }: { params: Promise<{ slug: string }> }) {
	const { slug } = await params;
	const tl = await getTierlistBySlug(slug);
	if (!tl) notFound();

	const totalItems = tl.tiers.reduce((n, t) => n + t.items.length, 0);

	return (
		<div className="container w-full mx-auto max-w-4xl px-4 py-12">
			<PageHeader
				eyebrow="Tierlist"
				title={tl.title}
				subtitle={
					<>
						par <strong className="text-white/80">{tl.author?.username ?? "un Saiyan"}</strong> ·{" "}
						{totalItems} carte{totalItems > 1 ? "s" : ""} classée{totalItems > 1 ? "s" : ""}
					</>
				}
			/>

			{(tl.official || tl.featured) && (
				<div className="mb-4 flex flex-wrap justify-center gap-2">
					{tl.official && (
						<span className="rounded-full bg-dbz-yellow/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-dbz-yellow border border-dbz-yellow/40">
							Tier list officielle
						</span>
					)}
					{tl.featured && (
						<span className="rounded-full bg-dbz-orange/20 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-dbz-orange border border-dbz-orange/40">
							★ Mise en avant
						</span>
					)}
				</div>
			)}

			{tl.description && <p className="mb-6 text-center text-white/65">{tl.description}</p>}

			<div className="dbz-panel p-4">
				<TierlistView tiers={tl.tiers} />
			</div>

			<div className="mt-6 flex justify-center">
				<TierlistLike tierlistId={tl.id} />
			</div>

			<div className="mt-8 flex justify-center gap-4">
				<Link href="/tierlists" className="text-sm text-white/55 hover:text-white/90">
					← Toutes les tierlists
				</Link>
				<Link
					href="/tierlists/creer"
					className="rounded-lg bg-dbz-orange px-4 py-2 text-sm font-bold text-black transition-opacity hover:opacity-90"
				>
					Créer la mienne
				</Link>
			</div>
		</div>
	);
}
