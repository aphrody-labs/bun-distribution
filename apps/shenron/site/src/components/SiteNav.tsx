import Link from "next/link";
import { HeaderFrame } from "@shenron/ui/navigation/HeaderFrame";
import { KintoUn } from "@/components/KintoUn";
import { CommandMenu } from "@/components/CommandMenu";
import { NavAuth } from "@/components/NavAuth";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AdminNavLinks } from "@/components/AdminNavLinks";
import { NavMega, type MegaItem } from "@/components/NavMega";
import {
	LAUNCH_CATEGORIES,
	SITE_SECTIONS,
	orderedEntries,
	resolveAccess,
	type NavGroup,
} from "@/lib/wiki-launch";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { destinationsOf } from "@/lib/site-map";

/**
 * Navigation Souveraine 2026 — Akira Toriyama x Material Design 3 Expressive
 *
 * Principes architecturaux :
 *  - Architecture d'information quadripartite : Œuvres, Univers, Archives Toriyama, Communauté.
 *  - 64 dp (m3_comp_app_bar_small_container_height) : conformité stricte M3 Top App Bar.
 *  - Zéro débordement ni collision de texte entre 1024 px et 1920 px.
 *  - Esthétique Toriyama : trait d'encre vivant, Kinto-un aérien, typographie Daizenshuu.
 *  - Nav SANS session : config de lancement (DB) uniquement pour préserver le cache CDN/ISR.
 */

const STATIC_ADMIN = [{ href: "/admin", label: "Administration" }];

const linkClass =
	"group/lien relative inline-flex items-center gap-2 whitespace-nowrap font-display font-bold text-[13.5px] uppercase tracking-wider text-white/80 hover:text-white transition-all px-3 py-2 rounded-xl hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange after:absolute after:left-3 after:right-3 after:bottom-1 after:h-[2px] after:origin-left after:scale-x-0 after:bg-dbz-orange after:transition-transform after:duration-200 hover:after:scale-x-100 focus-visible:after:scale-x-100 motion-reduce:after:transition-none";

export async function SiteNav() {
	const cfg = await getLaunchConfig().catch(() => null);
	const snapshot = cfg ?? { openKeys: [], order: [], access: {} };

	// Registre combiné des catégories du wiki et des sections du site
	const tous = [...LAUNCH_CATEGORIES, ...SITE_SECTIONS];
	const ordered = orderedEntries(snapshot.order, tous);
	const isPublic = (key: string) => resolveAccess(key, snapshot).mode === "public";

	const publiques = ordered.filter((c) => c.href && isPublic(c.key));
	const dansGroupe = (g: NavGroup): MegaItem[] =>
		publiques
			.filter((c) => c.group === g)
			.map((c) => ({
				href: c.href as string,
				label: c.label,
				blurb: c.blurb,
			}));

	// Section Wiki claire (fusionne les catégories wiki et ancien univers)
	const wiki = [...dansGroupe("wiki"), ...dansGroupe("univers")];
	const oeuvres = dansGroupe("oeuvres"); // TV & Médias
	// Les sources de collecte sont consultables depuis leur page dédiée, mais ne
	// font pas partie de la navigation éditoriale publique.
	const archives = [
		...dansGroupe("archives"),
		...destinationsOf("archives")
			.filter(
				(destination) =>
					!destination.entryKey &&
					destination.audience === "public" &&
					destination.href !== "/sources/dragon-ball"
			)
			.map((destination) => ({
				href: destination.href,
				label: destination.label,
				blurb: destination.blurb,
			})),
	]; // Livres, Manga & Guides
	const communaute = dansGroupe("communaute"); // Communauté & Loisirs

	// Catégories encore fermées réservées au staff
	const wikiClosed = ordered
		.filter((c) => c.href && !isPublic(c.key))
		.map((c) => ({ href: c.href as string, label: c.label }));
	const adminOnly = [...wikiClosed, ...STATIC_ADMIN];

	return (
		<HeaderFrame>
				{/* Wordmark Daizenshuu avec Kinto-un interactif */}
				<Link
					href="/"
					className="group flex shrink-0 select-none items-center gap-3 whitespace-nowrap py-1.5 px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dbz-orange/60 rounded-xl hover:bg-white/[0.04] transition-all"
					aria-label="Dragon Ball France — Accueil"
				>
					<span
						aria-hidden
						className="inline-flex h-[38px] w-[62px] shrink-0 items-center justify-center"
					>
						<KintoUn
							hauteur={38}
							decorative
							className="transition-transform duration-300 group-hover:scale-105 group-hover:translate-x-1 group-hover:-translate-y-0.5"
						/>
					</span>
					<span className="hidden sm:flex flex-col leading-none select-none">
						<span className="font-display text-[15px] font-black tracking-tight text-white/95 transition-colors group-hover:text-dbz-orange">
							DRAGON BALL
						</span>
						<span className="font-serif text-[9px] font-bold tracking-[0.26em] text-white/50 uppercase mt-0.5">
							FRANCE
						</span>
					</span>
				</Link>

				{/* Navigation Desktop — 4 Familles Claires avec Icônes Dédiées */}
				<nav
					className="hidden min-w-0 flex-1 items-center justify-start gap-1 lg:flex xl:gap-2 ml-1"
					aria-label="Navigation principale"
				>
					{wiki.length > 0 && (
						<NavMega label="Wiki" groupe="wiki" icon="wiki" items={wiki} linkClass={linkClass} />
					)}
					{oeuvres.length > 0 && (
						<NavMega label="TV & Médias" groupe="oeuvres" icon="tv" items={oeuvres} linkClass={linkClass} />
					)}
					{archives.length > 0 && (
						<NavMega label="Manga & Guides" groupe="archives" icon="manga" items={archives} linkClass={linkClass} />
					)}
					{communaute.length > 0 && (
						<NavMega label="Communauté" groupe="communaute" icon="communaute" items={communaute} linkClass={linkClass} />
					)}

					{/* Liens d'administration réservés au staff */}
					{adminOnly.length > 0 && (
						<AdminNavLinks links={adminOnly} className="hidden 2xl:block ml-auto" />
					)}
				</nav>

				{/* Zone Actions & Identité (Desktop : Icon-Only Toolbar) */}
				<div className="hidden lg:flex items-center gap-2 shrink-0">
					<CommandMenu variant="icon" />
					<LanguageSwitcher />
					<NavAuth />
				</div>

				{/* Zone Actions Compacte (Mobile / Tablette sous 1024 px) */}
				<div className="ml-auto flex items-center gap-1.5 lg:hidden">
					<CommandMenu variant="icon" />
					<LanguageSwitcher variant="compact" />
					<NavAuth variant="compact" />
				</div>
		</HeaderFrame>
	);
}
