import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { GatedLink } from "@/components/GatedLink";
import { dbUniverse } from "@/lib/db-universe";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { WikiEditBar } from "@/components/wiki/WikiEditBar";
import { ogMeta } from "@/lib/og";
import { resolveCharacterSlugByName } from "@/lib/wiki-slugs";
import { WikiArticle, WikiSources } from "@/components/wiki/WikiArticle";

export const revalidate = 3600;

export async function generateMetadata({
	params,
}: {
	params: Promise<{ slug: string }>;
}): Promise<Metadata> {
	const { slug } = await params;
	const va = await dbUniverse.voiceActorBySlug(slug);
	if (!va) return { title: "Comédien introuvable" };

	return {
		title: `${va.name} — Casting Vocal Dragon Ball`,
		description: va.biography,
		...ogMeta({
			title: `${va.name} — Dragon Ball FR`,
			description: va.biography,
			type: "article",
			canonical: `/wiki/voix/${slug}`,
		}),
	};
}

export default async function VoiceActorDetailPage({
	params,
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	const va = await dbUniverse.voiceActorBySlug(slug);
	if (!va) notFound();

	return (
		<WikiPageShell>
			<Breadcrumbs
				items={[
					{ label: "Encyclopédie", href: "/wiki" },
					{ label: "Casting & Voix", href: "/wiki/voix" },
					{ label: va.name, href: `/wiki/voix/${va.slug}` },
				]}
			/>
			<WikiEditBar table="db_voice_actors" id={va.id} indexHref="/wiki/voix" label={va.name} />

			{/* Fiche d'en-tête */}
			<div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] p-6 sm:p-8 backdrop-blur-md space-y-6">
				<div className="flex flex-wrap items-center justify-between gap-4">
					<div className="space-y-1">
						<div className="flex items-center gap-2">
							<span className="rounded-md bg-purple-500/20 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-purple-300">
								{va.nationality === "ja" ? "🇯🇵 Seiyū (Version Originale)" : "🇫🇷 Version Française (VF)"}
							</span>
							{va.birth_date && (
								<span className="rounded-md bg-white/5 px-2.5 py-1 text-xs text-white/60">
									Né(e) le {va.birth_date}
								</span>
							)}
						</div>
						<h1 className="text-3xl font-black text-white sm:text-4xl">
							{va.name}
						</h1>
						{va.name_ja && (
							<div className="text-sm font-medium text-white/50">
								{va.name_ja}
							</div>
						)}
					</div>
				</div>

				<div className="rounded-2xl border border-white/10 bg-black/30 p-5 leading-relaxed text-sm text-white/80">
					{va.biography}
				</div>
			</div>

			{/* Rôles majeurs */}
			<div className="space-y-4">
				<h2 className="text-xl font-bold text-white flex items-center gap-2">
					<span>🎙️</span> Personnages & Rôles Emblématiques
				</h2>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					{va.roles.map((r) => {
						const charSlug = resolveCharacterSlugByName(r.characterName);
						return (
							<div
								key={r.characterName}
								className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-2"
							>
								<div className="flex items-center justify-between">
									{charSlug ? (
										<GatedLink
											href={`/wiki/personnages/${charSlug}`}
											className="font-bold text-white text-lg text-orange-400 hover:underline inline-flex items-center gap-1.5"
										>
											<span>{r.characterName}</span>
											<span className="text-xs text-orange-400/50">↗</span>
										</GatedLink>
									) : (
										<h3 className="font-bold text-white text-lg text-orange-400">
											{r.characterName}
										</h3>
									)}
									{r.series && (
										<span className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/60">
											{r.series}
										</span>
									)}
								</div>
								{r.notes && (
									<p className="text-xs leading-relaxed text-white/70">
										{r.notes}
									</p>
								)}
							</div>
						);
					})}
				</div>
			</div>

			{va.article && <WikiArticle article={va.article} sources={va.article_sources} heading="Parcours & crédits" accent="purple" />}
			{!va.article && <WikiSources sources={va.article_sources} accent="purple" />}

			{/* Retour navigation */}
			<div className="pt-4 border-t border-white/10 flex justify-between">
				<Link
					href="/wiki/voix"
					className="text-xs font-semibold text-orange-400 hover:text-orange-300 transition-colors"
				>
					← Retour à la liste du casting
				</Link>
			</div>
		</WikiPageShell>
	);
}
