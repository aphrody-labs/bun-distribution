// SPDX-License-Identifier: Apache-2.0

import "server-only";
import Link from "next/link";
import { dbUniverse } from "@/lib/db-universe";
import { ENCYCLOPEDIA_CATEGORIES } from "@/lib/wiki-categories";
import { isPathPublic } from "@/lib/wiki-launch";
import { getLaunchConfig } from "@/lib/wiki-launch-config";

/**
 * Nav des sous-entités encyclopédiques du wiki (Personnages, Cosmologie, Races,
 * Transformations, Techniques, Arcs) — **uniquement celles absentes de la
 * navbar principale** (SiteNav porte déjà Sagas/Films/Épisodes/Manga/Jeux) pour
 * ne JAMAIS doubler la sidebar. Compteurs réels (jamais codés en dur). Server
 * component, sans cookie/header → cache CDN/ISR préservé.
 */
export async function WikiCategoryNav({
	active,
	omit = [],
	className = "",
}: {
	active?: string;
	/** Clés à ne pas afficher (ex. perso/planetes quand ce sont déjà des onglets). */
	omit?: string[];
	className?: string;
}) {
	const counts = (await dbUniverse.counts()) ?? {};
	const cats = ENCYCLOPEDIA_CATEGORIES.filter((c) => !omit.includes(c.key));
	// Cette nav est montée par TOUTES les pages encyclopédiques : tant qu'elle
	// ignorait le gating, chacune publiait un lien mort par rubrique fermée
	// (`/wiki/{personnages,races,transformations}` → 307 vers `/wiki-bientot`).
	// Config illisible → on laisse tout ouvert, comme `GatedLink` : mieux vaut
	// une redirection qu'une nav éteinte parce que PostgreSQL a hoqueté.
	const cfg = await getLaunchConfig().catch(() => null);

	return (
		<nav
			aria-label="Catégories de l'encyclopédie"
			className={`flex gap-2 overflow-x-auto pb-2 -mx-6 px-6 lg:mx-0 lg:px-0 lg:flex-wrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
		>
			{cats.map((c) => {
				const n = (counts as Record<string, number>)[c.countKey];
				const isActive = active === c.key;
				const open = cfg ? isPathPublic(c.href, cfg) : true;
				const base =
					"inline-flex items-center gap-1.5 shrink-0 h-9 px-4 rounded-full border text-[13px] font-display font-semibold tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange focus-visible:ring-offset-2 focus-visible:ring-offset-black";
				const compteur = typeof n === "number" && n > 0 && (
					<span
						className={`text-[11px] tabular-nums ${isActive ? "text-black/55" : "text-white/50"}`}
					>
						{n}
					</span>
				);

				if (!open) {
					return (
						<span
							key={c.key}
							aria-disabled="true"
							title="Cette section n'est pas ouverte"
							className={`${base} cursor-default border-white/[0.06] bg-white/[0.02] text-white/50`}
						>
							{c.label}
							{compteur}
							<span className="rounded-full border border-white/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.12em] text-white/50">
								fermée
							</span>
						</span>
					);
				}

				return (
					<Link
						key={c.key}
						href={c.href}
						aria-current={isActive ? "page" : undefined}
						className={`${base} ${
							isActive
								? "bg-dbz-orange text-black border-dbz-orange"
								: "bg-white/[0.04] text-white/70 border-white/[0.1] hover:text-white hover:border-white/30"
						}`}
					>
						{c.label}
						{compteur}
					</Link>
				);
			})}
		</nav>
	);
}
