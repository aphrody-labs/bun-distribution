import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Input, Skeleton } from "@rosegriffon/ui";

import { SERVEURS_DISCORD, serveurDiscord } from "@/lib/discord";
import type { CleServeur } from "@/lib/discord/hierarchie";
import { absoluteUrl } from "@/lib/site-url";
import { cn } from "@/lib/utils";

import { HierarchieServeur, ResumeServeur } from "./_components/hierarchie-serveur";

/**
 * Qui fait Rose Griffon — page UNIQUE, deux lectures.
 *
 * LA SÉPARATION
 * « Communauté » et « Staff » répondent à deux questions différentes : « qui
 * est là » et « qui décide ». Elles étaient mélangées dans un même flux, où
 * quatre sections dérivées (admins, modération, équipe Azalée, boosters)
 * répétaient les cartes d'une liste complète affichée trois écrans plus bas.
 *
 * LES COMPOSANTS, EUX, SONT UNIFIÉS
 * Une seule `CarteMembre`, une seule `GrilleMembres`, une seule
 * `HierarchieServeur` — la vue « Staff » n'est que le même rendu filtré sur les
 * permissions réelles. Un membre du staff apparaît DANS les deux vues, comme
 * sur Discord : la vue staff est une autre lecture, pas une soustraction.
 *
 * LA HIÉRARCHIE EST FACTUELLE
 * Sections = rôles détachés du serveur, ordre = positions Discord, staff =
 * permissions réellement accordées. Rien n'est codé en dur : la page suivait
 * jusqu'ici quatre identifiants de rôles recopiés et un barème inventé.
 */
export const metadata: Metadata = {
	alternates: { canonical: absoluteUrl("/community") },
	description:
		"Les membres des serveurs Rose Griffon et Achilléa, leur hiérarchie réelle, le bureau de l'association et ses équipes.",
	openGraph: {
		description:
			"Les membres des serveurs Rose Griffon et Achilléa, leur hiérarchie réelle, le bureau de l'association et ses équipes.",
		images: [
			{
				alt: "Rose Griffon - Association Inazuma Eleven",
				height: 630,
				url: "/opengraph-image.png",
				width: 1200,
			},
		],
		title: "Communauté | Rose Griffon",
		type: "website",
		url: absoluteUrl("/community"),
	},
	title: "Communauté | Rose Griffon",
};

// Lecture À LA REQUÊTE : figer la page au build servirait un annuaire vide le
// jour où la lecture échoue au prerender.
export const dynamic = "force-dynamic";

const VUES = [
	{ cle: "communaute", libelle: "Communauté" },
	{ cle: "staff", libelle: "Staff" },
] as const;

type Vue = (typeof VUES)[number]["cle"];

function SquelettedeSection() {
	return (
		<div className="space-y-4">
			<Skeleton className="h-6 w-48" />
			<div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
				{Array.from({ length: 12 }, (_, index) => (
					<Skeleton className="h-16 rounded-xl" key={index} />
				))}
			</div>
		</div>
	);
}

/** Onglets rendus côté serveur : changer de vue ne coûte pas un octet de JS. */
function Onglets<T extends string>({
	entrees,
	actif,
	lien,
	compact,
}: {
	entrees: readonly { cle: T; libelle: string }[];
	actif: T;
	lien: (cle: T) => string;
	compact?: boolean;
}) {
	return (
		<nav className="flex gap-1 rounded-full bg-surface-container p-1">
			{entrees.map((entree) => (
				<Link
					key={entree.cle}
					href={lien(entree.cle)}
					aria-current={actif === entree.cle ? "page" : undefined}
					className={cn(
						"rounded-full font-medium transition-colors",
						compact ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm",
						actif === entree.cle
							? "bg-primary text-on-primary"
							: "text-on-surface-variant hover:text-on-surface"
					)}
				>
					{entree.libelle}
				</Link>
			))}
		</nav>
	);
}

export default async function CommunityPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const params = await searchParams;
	const recherche = typeof params.q === "string" ? params.q.trim() : "";
	const vue: Vue = params.vue === "staff" ? "staff" : "communaute";
	const serveur = serveurDiscord(typeof params.serveur === "string" ? params.serveur : "");
	const cleServeur = serveur.cle as CleServeur;

	const lienVue = (cle: Vue) =>
		cle === "communaute"
			? `/community?serveur=${serveur.cle}`
			: `/community?vue=${cle}&serveur=${serveur.cle}`;
	const lienServeur = (cle: string) =>
		vue === "communaute" ? `/community?serveur=${cle}` : `/community?vue=${vue}&serveur=${cle}`;

	const selecteurServeur = (
		<Onglets
			entrees={SERVEURS_DISCORD.map((s) => ({ cle: s.cle, libelle: s.nom }))}
			actif={serveur.cle}
			lien={lienServeur}
			compact
		/>
	);

	return (
		<div className="container mx-auto flex flex-col gap-6 px-4 py-4 min-[600px]:px-6 min-[600px]:py-6 min-[840px]:gap-8">
			<header className="flex min-h-16 flex-col gap-3 border-b border-border pb-4 min-[600px]:flex-row min-[600px]:items-center min-[600px]:justify-between">
				<div>
					<h1 className="text-fluid-2xl font-bold text-foreground">Communauté</h1>
				</div>
				<Onglets entrees={VUES} actif={vue} lien={lienVue} />
			</header>

			{vue === "communaute" ? (
				<div className="flex flex-col gap-6">
					<section className="flex flex-col gap-4">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="space-y-1">
								<h2 className="text-lg font-bold text-on-surface">Hiérarchie — {serveur.nom}</h2>
								<Suspense fallback={<Skeleton className="h-4 w-56" />}>
									<ResumeServeur cle={cleServeur} />
								</Suspense>
							</div>
							{selecteurServeur}
						</div>

						<form action="/community" className="max-w-md">
							<input type="hidden" name="serveur" value={serveur.cle} />
							<Input
								name="q"
								defaultValue={recherche}
								placeholder={`Chercher un membre sur ${serveur.nom}`}
								className="h-10 rounded-full"
							/>
						</form>

						<Suspense key={`${serveur.cle}-${recherche}`} fallback={<SquelettedeSection />}>
							<HierarchieServeur cle={cleServeur} recherche={recherche} />
						</Suspense>
					</section>
				</div>
			) : (
				<div className="flex flex-col gap-6">
					<section className="flex flex-col gap-4">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div className="space-y-1">
								<h2 className="text-lg font-bold text-on-surface">Staff Discord — {serveur.nom}</h2>
								<p className="text-xs text-on-surface-variant/70">
									Déduit des permissions réellement accordées aux rôles, pas d&apos;une liste tenue
									à la main.
								</p>
							</div>
							{selecteurServeur}
						</div>
						<Suspense key={serveur.cle} fallback={<SquelettedeSection />}>
							<HierarchieServeur cle={cleServeur} staffSeulement />
						</Suspense>
					</section>

					{/* Les équipes de l'association vivent sur la page dédiée /notre-equipe */}
					<div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 min-[600px]:flex-row">
						<div className="text-center min-[600px]:text-left">
							<h3 className="text-base font-bold text-foreground">
								Équipes & Pôles de l&apos;Association Rose Griffon
							</h3>
						</div>
						<Link
							href="/notre-equipe"
							className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-on-primary text-xs sm:text-sm font-semibold hover:bg-primary/90 transition-colors whitespace-nowrap shadow-sm"
						>
							Consulter Notre Équipe →
						</Link>
					</div>
				</div>
			)}
		</div>
	);
}
