import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiPageShell } from "@/components/wiki/WikiPageShell";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
import { DomainBar, ContributeRail } from "@/components/kit";
import { dbUniverse } from "@/lib/db-universe";
import { ogMeta } from "@/lib/og";
import { JsonLd } from "@/components/JsonLd";
import { Award, Calendar, BookOpen, Film, Music, Mic, Building2, ArrowLeft, CheckCircle2 } from "lucide-react";

export const revalidate = 3600;

interface ContributorPageProps {
	params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ContributorPageProps): Promise<Metadata> {
	const { slug } = await params;
	if (slug === "akira-toriyama") {
		return ogMeta({
			title: "Akira Toriyama — L'Auteur & Créateur Démiurge de Dragon Ball",
			description: "Biographie officielle et paroles authentiques d'Akira Toriyama, créateur de Dragon Ball.",
			canonical: "/wiki/toriyama",
			type: "website",
		});
	}

	const contributor = await dbUniverse.contributorBySlug(slug);
	if (!contributor) return {};

	return {
		title: `${contributor.name} — Bâtisseurs de Dragon Ball`,
		description: contributor.biography_fr
			? `${contributor.name} : ${contributor.biography_fr.slice(0, 160)}...`
			: `Fiche encyclopédique de ${contributor.name}, contributeur officiel de Dragon Ball.`,
		...ogMeta({
			title: `${contributor.name} (${contributor.name_ja ?? ""}) — DBFR`,
			description: contributor.biography_fr ?? `Profil officiel de ${contributor.name}.`,
			canonical: `/wiki/contributeurs/${slug}`,
			type: "website",
		}),
	};
}

export default async function ContributorDetailPage({ params }: ContributorPageProps) {
	const { slug } = await params;

	// Redirection canonique vers la page dédiée consacrée à Toriyama
	if (slug === "akira-toriyama") {
		redirect("/wiki/toriyama");
	}

	const contributor = await dbUniverse.contributorBySlug(slug);
	if (!contributor) {
		notFound();
	}

	const categoryLabels: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
		author: { label: "Auteur & Mangaka", icon: <BookOpen className="h-4 w-4" />, color: "border-orange-500/30 bg-orange-950/60 text-orange-400" },
		editorial_staff: { label: "Éditeur Shueisha (Jump)", icon: <Building2 className="h-4 w-4" />, color: "border-blue-500/30 bg-blue-950/60 text-blue-400" },
		scenario: { label: "Scénariste Toei", icon: <Film className="h-4 w-4" />, color: "border-purple-500/30 bg-purple-950/60 text-purple-400" },
		animation: { label: "Directeur Animation & Chara-design", icon: <Film className="h-4 w-4" />, color: "border-emerald-500/30 bg-emerald-950/60 text-emerald-400" },
		voice: { label: "Comédien & Seiyū", icon: <Mic className="h-4 w-4" />, color: "border-rose-500/30 bg-rose-950/60 text-rose-400" },
		music: { label: "Compositeur & Musicien", icon: <Music className="h-4 w-4" />, color: "border-amber-500/30 bg-amber-950/60 text-amber-400" },
		publisher: { label: "Maison d'Édition / Studio", icon: <Building2 className="h-4 w-4" />, color: "border-cyan-500/30 bg-cyan-950/60 text-cyan-400" },
		other: { label: "Staff & Contributeur", icon: <Award className="h-4 w-4" />, color: "border-white/20 bg-white/5 text-white/80" },
	};

	const catMeta = categoryLabels[contributor.category] || categoryLabels.other!;

	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "Person",
		name: contributor.name,
		alternateName: [contributor.name_ja, contributor.name_romaji].filter(Boolean),
		jobTitle: catMeta.label,
		description: contributor.biography_fr,
		birthDate: contributor.birth_date,
		deathDate: contributor.death_date,
	};

	return (
		<div>
			<JsonLd data={jsonLd as never} />

			<WikiPageShell>
				<DomainBar domain="wiki" />
				<div className="flex flex-wrap items-center justify-between gap-4">
					<Breadcrumbs
						items={[
							{ label: "Staff & Créateurs", href: "/wiki/staff" },
							{ label: contributor.name },
						]}
					/>
					<WikiDrawer />
				</div>

				{/* Profil Card Header */}
				<header className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.08] via-black/80 to-black p-6 sm:p-10 backdrop-blur-2xl shadow-2xl">
					<div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
						<div className="space-y-3">
							<div className="flex flex-wrap items-center gap-2">
								<span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-bold uppercase tracking-wider ${catMeta.color}`}>
									{catMeta.icon}
									<span>{catMeta.label}</span>
								</span>
								{contributor.spotlight_rank !== null && (
									<span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-950/60 px-2.5 py-1 text-xs font-bold text-amber-300">
										<CheckCircle2 className="h-3.5 w-3.5" /> Personnalité Majeure
									</span>
								)}
							</div>

							<h1 className="font-saiyan text-3xl sm:text-4xl lg:text-5xl text-white tracking-wide">
								{contributor.name}
							</h1>

							<div className="flex flex-wrap items-center gap-3 text-sm text-white/60">
								{contributor.name_ja && (
									<span className="font-jp text-lg font-bold text-amber-300">{contributor.name_ja}</span>
								)}
								{contributor.name_romaji && (
									<>
										<span>·</span>
										<span className="font-mono text-white/50">{contributor.name_romaji}</span>
									</>
								)}
								{(contributor.birth_date || contributor.death_date) && (
									<>
										<span>·</span>
										<span className="inline-flex items-center gap-1 font-mono text-white/50">
											<Calendar className="h-3.5 w-3.5" />
											{contributor.birth_date?.slice(0, 4) ?? "???"} — {contributor.death_date?.slice(0, 4) ?? "Présent"}
										</span>
									</>
								)}
							</div>
						</div>

						<div className="shrink-0">
							<Link
								href="/wiki/staff"
								className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-semibold text-white hover:bg-white/20 transition-colors"
							>
								<ArrowLeft className="h-4 w-4" />
								<span>Retour au hub staff</span>
							</Link>
						</div>
					</div>
				</header>

				{/* Contenu biographique & impact */}
				<section className="grid gap-6 md:grid-cols-3">
					{/* Biographie & archives */}
					<div className="space-y-6 md:col-span-2">
						<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md space-y-4">
							<h2 className="text-sm font-bold uppercase tracking-wider text-orange-400">
								Notice Biographique &amp; Rôle Clé
							</h2>
							<p className="text-sm leading-relaxed text-white/80 whitespace-pre-line">
								{contributor.biography_fr ?? "Notice encyclopédique en cours de documentation vérifiée."}
							</p>
						</div>

						{/* Crédits officiels */}
						{contributor.credits.length > 0 && (
							<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md space-y-4">
								<h2 className="text-sm font-bold uppercase tracking-wider text-amber-400">
									Crédits &amp; Contributions Officielles ({contributor.credits.length})
								</h2>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
									{contributor.credits.map((cr) => (
										<div key={cr.id} className="rounded-xl border border-white/10 bg-black/40 p-3.5">
											<div className="text-[10px] font-bold uppercase tracking-wider text-white/40">
												Portée : {cr.credit_scope}
											</div>
											<div className="mt-1 text-sm font-bold text-white">{cr.role}</div>
										</div>
									))}
								</div>
							</div>
						)}
					</div>

					{/* Barre latérale d'informations */}
					<aside className="space-y-6">
						<div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 backdrop-blur-md space-y-4">
							<h3 className="text-xs font-bold uppercase tracking-wider text-white/50">
								Rattachement Institutionnel
							</h3>
							<div>
								<div className="text-[11px] text-white/40">Catégorie Métier</div>
								<div className="text-sm font-semibold text-white">{catMeta.label}</div>
							</div>
							{contributor.birth_date && (
								<div>
									<div className="text-[11px] text-white/40">Date de Naissance</div>
									<div className="text-sm font-mono text-white/80">{contributor.birth_date}</div>
								</div>
							)}
							{contributor.death_date && (
								<div>
									<div className="text-[11px] text-white/40">Date de Décès</div>
									<div className="text-sm font-mono text-white/80">{contributor.death_date}</div>
								</div>
							)}
							<div>
								<div className="text-[11px] text-white/40">Source des Données</div>
								<div className="text-xs text-white/60">Archives éditoriales Shūeisha / Toei Animation</div>
							</div>
						</div>

						<div className="rounded-2xl border border-orange-500/20 bg-orange-950/20 p-5 backdrop-blur-md">
							<div className="text-xs font-bold text-orange-300">À propos de l&apos;auteur démiurge</div>
							<p className="mt-1 text-[11px] leading-relaxed text-orange-200/80">
								Pour consulter les déclarations textuelles et l&apos;anthologie complète d&apos;Akira Toriyama, rendez-vous sur l&apos;espace dédié.
							</p>
							<Link
								href="/wiki/toriyama"
								className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-white hover:text-orange-400 transition-colors"
							>
								<span>Anthologie Toriyama</span>
								<span>→</span>
							</Link>
						</div>
					</aside>
				</section>

				<ContributeRail quoiKey="kit.contribute.what.character" />
			</WikiPageShell>
		</div>
	);
}
