import Link from "next/link";
import { GatedLink } from "@/components/GatedLink";
import type { Metadata } from "next";
import { PageHero } from "@/components/PageHero";
import { pageHero } from "@/lib/banner-config";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SITE_URL } from "@/lib/config";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { DomainBar, ContributeRail } from "@/components/kit";
import { UnifiedStaffExplorer, type StaffTier } from "@/components/wiki/UnifiedStaffExplorer";
import { buildUnifiedStaffCatalog } from "@/lib/unified-staff-catalog";
import { dbUniverse } from "@/lib/db-universe";
import { ogMeta } from "@/lib/og";
import { Sparkles, Award, ExternalLink, ArrowRight } from "lucide-react";
import { JsonLd } from "@/components/JsonLd";

export const revalidate = 3600;

export const metadata: Metadata = {
	title: "Autour de Dragon Ball — Staff de Production & Casting Vocal International",
	description:
		"La cartographie exhaustive des bâtisseurs de Dragon Ball en 6 niveaux : Akira Toriyama & Bird Studio, éditeurs Shueisha, animateurs et réalisateurs Toei, seiyū japonais, VF légendaire, VA américain et doublages internationaux.",
	...ogMeta({
		title: "Autour de Dragon Ball : Staff de Production & Casting Vocal — DBFR",
		description:
			"Découvrez ceux qui ont façonné Dragon Ball : Akira Toriyama, les éditeurs du Shōnen Jump, les réalisateurs Toei, le casting vocal japonais (VO), français (VF), américain (VA) et mondial.",
		canonical: "/wiki/staff",
		type: "website",
	}),
};

export default async function StaffHubPage({
	searchParams,
}: {
	searchParams?: Promise<{ tier?: string; section?: string }>;
}) {
	const heroImage = await pageHero("staff");
	const [rawContribs, rawVAs] = await Promise.all([
		dbUniverse.contributors().catch(() => []),
		dbUniverse.voiceActors().catch(() => []),
	]);
	const dbContribs = rawContribs ?? [];
	const dbVAs = rawVAs ?? [];

	const resolvedParams = searchParams ? await searchParams : undefined;
	const initialTierParam = resolvedParams?.tier || resolvedParams?.section;
	let initialTier: StaffTier = "all";
	if (initialTierParam === "voix" || initialTierParam === "voice") initialTier = "voice_ja";
	else if (initialTierParam === "vf") initialTier = "voice_fr";
	else if (initialTierParam === "va" || initialTierParam === "en") initialTier = "voice_en";
	else if (initialTierParam === "editorial") initialTier = "editorial";
	else if (initialTierParam === "production") initialTier = "production";

	// Chaque contributeur du hub staff relie vers sa fiche dédiée `/wiki/contributeurs/${c.slug}`
	const unifiedCatalog = buildUnifiedStaffCatalog(dbContribs, dbVAs);

	return (
		<div>
			<JsonLd
				data={{
					"@context": "https://schema.org",
					"@type": "CollectionPage",
					name: "Autour de Dragon Ball — L'Équipe de Production & Akira Toriyama",
					description:
						"Hub encyclopédique de l'équipe créative et de production de la franchise Dragon Ball : Akira Toriyama, éditeurs, animateurs, seiyū et compositeurs.",
					publisher: {
						"@type": "Organization",
						name: "Dragon Ball FR",
						url: SITE_URL,
					},
				} as never}
			/>

			<PageHero
				eyebrow="Encyclopédie & Archives Créatives"
				title="Autour de Dragon Ball"
				lead="Les démiurges, artisans et voix de légende qui ont donné vie à l'épopée. D'Akira Toriyama aux éditeurs du Shōnen Jump, aux scénaristes de Toei Animation et aux compositeurs symphoniques."
				image={heroImage}
				imageAlt="Planches et archives de création Dragon Ball"
			/>

			<WikiPageShell>
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs items={[{ label: "Autour de Dragon Ball (Staff & Créateurs)" }]} />
					<WikiDrawer />
				</div>

				{/* 1. HERO SPOTLIGHT : AKIRA TORIYAMA (1955 — 2024) */}
				<section aria-label="Hero Spotlight Akira Toriyama" className="relative overflow-hidden rounded-3xl border-2 border-orange-500/40 bg-gradient-to-br from-amber-950/40 via-black/80 to-black p-6 sm:p-10 shadow-2xl backdrop-blur-2xl">
					{/* Portrait d'archive, volontairement fondu : il accompagne l'accès à
					    l'anthologie sans concurrencer le texte ni fabriquer une illustration. */}
					<img
						src="https://upload.wikimedia.org/wikipedia/en/1/15/Akira_Toriyama_in_1982.jpg"
						alt=""
						aria-hidden="true"
						className="pointer-events-none absolute inset-y-0 right-0 h-full w-1/2 object-cover object-top opacity-20 [mask-image:linear-gradient(to_right,transparent,black_42%)]"
					/>
					{/* Motifs d'arrière-plan */}
					<div className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-orange-500/10 blur-3xl" />
					<div className="pointer-events-none absolute -left-20 -bottom-20 h-80 w-80 rounded-full bg-amber-500/10 blur-3xl" />

					<div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
						{/* En-tête du Spotlight */}
						<div className="flex-1 space-y-4">
							<div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-orange-400">
								<Sparkles className="h-3.5 w-3.5" /> Hero Spotlight · L&apos;Auteur &amp; Démiurge
							</div>

							<h2 className="font-saiyan text-4xl sm:text-5xl lg:text-6xl text-white tracking-wide">
								AKIRA TORIYAMA
							</h2>
							<div className="flex items-center gap-3 text-sm text-white/60">
								<span className="font-jp text-lg text-amber-300 font-bold">鳥山 明</span>
								<span>·</span>
								<span className="font-mono text-white/50">1955 — 2024 (Nagoya, Japon)</span>
							</div>

							<p className="max-w-2xl text-sm sm:text-base leading-relaxed text-white/80">
								Créateur visionnaire, mangaka de génie et architecte absolu de la mythologie Dragon Ball. En 42 tomes et 519 chapitres parus dans le <em>Weekly Shōnen Jump</em>, il a réinventé le récit d&apos;initiation martiale et fondé les codes du shōnen planétaire moderne.
							</p>

							{/* Repères capitaux */}
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-2">
								<div className="rounded-xl border border-white/10 bg-white/5 p-3">
									<div className="text-[10px] uppercase font-bold text-white/40">Manga Original</div>
									<div className="mt-0.5 font-bold text-sm text-white">42 Tomes · 519 Ch.</div>
								</div>
								<div className="rounded-xl border border-white/10 bg-white/5 p-3">
									<div className="text-[10px] uppercase font-bold text-white/40">Studio Personnel</div>
									<div className="mt-0.5 font-bold text-sm text-orange-300">Bird Studio (1983)</div>
								</div>
								<div className="rounded-xl border border-white/10 bg-white/5 p-3">
									<div className="text-[10px] uppercase font-bold text-white/40">Éditeur Découvreur</div>
									<div className="mt-0.5 font-bold text-sm text-white">Kazuhiko Torishima</div>
								</div>
								<div className="rounded-xl border border-white/10 bg-white/5 p-3">
									<div className="text-[10px] uppercase font-bold text-white/40">Distinction</div>
									<div className="mt-0.5 font-bold text-xs text-amber-300 flex items-center gap-1">
										<Award className="h-3.5 w-3.5 shrink-0" /> Arts et Lettres (2019)
									</div>
								</div>
							</div>

							{/* Citation vérifiée */}
							<blockquote className="border-l-2 border-orange-500/50 pl-4 text-xs italic text-white/70">
								« Je dessinais simplement ce qui me plaisait et m&apos;amusait, en espérant que les lecteurs y trouvent un peu de plaisir. Pour moi, le manga devait rester un divertissement pur. »
								<span className="block mt-1 font-semibold text-white/40 not-italic">— Akira Toriyama (Archives Daizenshuu 1)</span>
							</blockquote>
						</div>

						{/* Bouton de passerelle vers la biographie détaillée */}
						<div className="flex flex-col items-center lg:items-end justify-center shrink-0">
							<Link
								href="/wiki/toriyama"
								className="group relative inline-flex items-center gap-3 rounded-2xl bg-gradient-to-r from-orange-600 via-amber-600 to-orange-500 px-6 py-4 font-bold text-white shadow-xl shadow-orange-950/50 transition-all hover:scale-105 hover:from-orange-500 hover:to-amber-500"
							>
								<span>Consulter la Biographie Complète &amp; Anthologie Toriyama</span>
								<ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
							</Link>
							<span className="mt-2 text-[11px] text-white/40">
								Paroles d&apos;Akira Toriyama citées au mot près · /wiki/toriyama
							</span>
						</div>
					</div>
				</section>

				{/* 2. MATRICE RELATIONNELLE DES CONTRIBUTEURS */}
				<section className="space-y-6 pt-6">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between border-b border-white/10 pb-4">
						<div>
							<h2 className="font-saiyan text-2xl sm:text-3xl text-white tracking-wider">
								L&apos;ÉQUIPE DE PRODUCTION &amp; LES CRÉATEURS
							</h2>
							<p className="text-xs text-white/60">
								Les éditeurs qui ont guidé Toriyama, les scénaristes de la Toei, les animateurs de génie, les voix mythiques et les compositeurs.
							</p>
						</div>
					</div>

					{/* Explorateur matriciel hiérarchique à 6 niveaux */}
					<UnifiedStaffExplorer items={unifiedCatalog} initialTier={initialTier} />
				</section>

				{/* Rails d'interconnexion wiki */}
				<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6">
					<GatedLink
						href="/wiki/voix"
						className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 p-4 transition-colors hover:border-purple-500/40 hover:bg-purple-950/20"
					>
						<span className="text-2xl">🎙️</span>
						<div>
							<div className="text-xs font-bold text-white">Annuaire des Voix &amp; Seiyū</div>
							<div className="text-[11px] text-white/50">Casting VO et VF complet</div>
						</div>
					</GatedLink>

					<GatedLink
						href="/wiki/musiques"
						className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 p-4 transition-colors hover:border-rose-500/40 hover:bg-rose-950/20"
					>
						<span className="text-2xl">🎵</span>
						<div>
							<div className="text-xs font-bold text-white">Discographie &amp; OST</div>
							<div className="text-[11px] text-white/50">Génériques et musiques de combat</div>
						</div>
					</GatedLink>

					<Link
						href="/wiki/toriyama"
						className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/40 p-4 transition-colors hover:border-orange-500/40 hover:bg-orange-950/20"
					>
						<span className="text-2xl">👑</span>
						<div>
							<div className="text-xs font-bold text-white">Akira Toriyama</div>
							<div className="text-[11px] text-white/50">Anthologie et déclarations vérifiées</div>
						</div>
					</Link>
				</div>

				<ContributeRail quoiKey="kit.contribute.what.voice" />
			</WikiPageShell>
		</div>
	);
}
