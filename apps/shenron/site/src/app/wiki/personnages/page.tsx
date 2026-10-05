import { ContributeRail } from "@/components/kit";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WikiDrawer } from "@/components/wiki/WikiDrawer";
// SPDX-License-Identifier: Apache-2.0

import { countVariantCards, getShenronCharacterCards } from "@/lib/shenron";
import { dbUniverse } from "@/lib/db-universe";
import { PageHero } from "@/components/PageHero";
import { pageHero } from "@/lib/banner-config";
import { UniverseTabs } from "@/components/wiki/UniverseTabs";
import { SectionUnavailable } from "@/components/wiki/SectionUnavailable";
import type { Metadata } from "next";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { comparerRichesse, scoreRichesse, type SignauxRichesse } from "@/lib/character-richesse";

import { ogMeta } from "@/lib/og";
import { assetUrl } from "@/lib/assets";
import { Shenron } from "@/components/icones";

export const revalidate = 3600;

/**
 * Note de richesse d'une fiche, ou 0 si la mesure n'a pas répondu.
 *
 * `characterRichesse()` passe par `safe()` : elle rend `null` plutôt que de
 * faire tomber la page si la requête échoue. Dans ce cas la grille se range par
 * ordre alphabétique (le départage de `comparerRichesse`) — dégradé, mais jamais
 * cassé, et jamais l'ordre d'insertion de l'ingest.
 */
function noteDe(signaux: Map<number, SignauxRichesse> | null, id: number): number {
	const s = signaux?.get(id);
	return s ? Math.round(scoreRichesse(s) * 10) / 10 : 0;
}

export const metadata: Metadata = {
	title: "Personnages Dragon Ball",
	description:
		"Tous les personnages canon de l'univers Dragon Ball. Fiches descriptives, ki, noms japonais, races, statuts et caractéristiques.",
	...ogMeta({
		title: "Personnages Dragon Ball — DBFR",
		description:
			"Tous les personnages canon de l'univers Dragon Ball. Fiches descriptives, ki, noms japonais, races, statuts et caractéristiques.",
		canonical: "/wiki/personnages",
		type: "website",
	}),
};

export default async function PersonnagesPage() {
	// `access` : instantané de la configuration de lancement, résolu ICI (serveur)
	// et passé aux grilles client, qui ne peuvent pas le lire elles-mêmes. Sans lui,
	// chaque vignette liait une fiche fermée → 307 vers `/wiki-bientot`.
	let characters: Awaited<ReturnType<typeof getShenronCharacterCards>>;
	let counts: Awaited<ReturnType<typeof dbUniverse.counts>>;
	let facets: Awaited<ReturnType<typeof dbUniverse.characterFacets>>;
	let access: Awaited<ReturnType<typeof getLaunchConfig>> | null;
	let variants: Awaited<ReturnType<typeof countVariantCards>>;
	let richesse: Awaited<ReturnType<typeof dbUniverse.characterRichesse>>;
	let dragons: Awaited<ReturnType<typeof dbUniverse.dragons>>;
	try {
		[characters, counts, facets, access, variants, richesse, dragons] = await Promise.all([
			getShenronCharacterCards(),
			dbUniverse.counts(),
			dbUniverse.characterFacets(),
			getLaunchConfig().catch(() => null),
			countVariantCards(),
			dbUniverse.characterRichesse(),
			dbUniverse.dragons(),
		]);
	} catch (error) {
		console.error("[wiki/personnages] data unavailable", error);
		return <SectionUnavailable title="Personnages Dragon Ball" />;
	}

	// Classement « les mieux documentés d'abord ». Sans lui, la grille servait les
	// 1 307 fiches dans l'ordre d'insertion de l'ingest : le visiteur tombait sur
	// des figures d'un seul chapitre avant Goku. La note est mesurée
	// (cf. `@/lib/character-richesse`), pas saisie à la main.
	const cartes = characters
		.map((c) => ({
			id: c.id,
			name: c.name,
			nameJa: c.nameJa,
			race: c.race,
			// `ki` retiré de la charge : déclaré dans le type de la grille mais
			// jamais rendu — 1 307 valeurs qui traversaient le réseau pour rien.
			image: c.image,
			portraitXv2: c.portraitXv2,
			// Arrondi au dixième : la note ne sert qu'à trier et à afficher une
			// jauge, deux décimales de plus ne feraient qu'alourdir la charge RSC.
			richesse: noteDe(richesse, c.id),
		}))
		.toSorted(comparerRichesse);
	const dragonsShown = dragons ?? [];

	return (
		<>
			<PageHero
				eyebrow="Encyclopédie"
				title="Personnages"
				lead={`${characters.length} fiches, des héros du récit aux figures d'un seul chapitre.`}
				image={await pageHero("personnages")}
				imageAlt="Personnages Dragon Ball"
			/>
			<div className="wiki-container">
				<div className="flex flex-wrap items-center justify-between gap-4 mb-8">
					<Breadcrumbs items={[{ label: "Personnages" }]} />
					<WikiDrawer />
				</div>
				<UniverseTabs
					access={access}
					characters={cartes}
					nbVariants={variants}
					counts={counts ?? {}}
					facets={facets ?? undefined}
				/>
				{dragonsShown.length > 0 && (
					<section
						aria-labelledby="dragons-personnages"
						className="mt-12 border-t border-white/10 pt-8"
					>
						<div className="mb-5">
							<h2
								id="dragons-personnages"
								className="font-saiyan text-2xl tracking-wide text-white"
							>
								Dragons sacrés
							</h2>
							<p className="mt-1 text-sm text-white/60">
								Ces personnages et leurs règles d&apos;invocation font partie de l&apos;encyclopédie
								des personnages.
							</p>
						</div>
						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							{dragonsShown.map((dragon) => (
								<article
									key={dragon.id}
									className="flex gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4"
								>
									{/* `image` est un chemin d'asset brut de la base (`./assets/wiki/…`) :
									    rendu tel quel, il se résolvait contre dragonballfr.com (404 Next)
									    au lieu de l'hôte d'assets qui sert le fichier. */}
									{dragon.image ? (
										<img
											src={assetUrl(dragon.image)}
											alt=""
											className="h-16 w-16 shrink-0 rounded-lg object-cover"
											loading="lazy"
										/>
									) : (
										<div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-300/80">
											<Shenron size={32} aria-hidden />
										</div>
									)}
									<div className="min-w-0">
										<h3 className="font-display font-semibold text-white">{dragon.name}</h3>
										{dragon.name_ja && (
											<p className="font-jp text-xs text-amber-300/80">{dragon.name_ja}</p>
										)}
										{dragon.creator && (
											<p className="mt-1 text-xs text-white/55">Créé par {dragon.creator}</p>
										)}
									</div>
								</article>
							))}
						</div>
					</section>
				)}
				<ContributeRail className="mt-14" quoiKey="kit.contribute.what.character" />
			</div>
		</>
	);
}
