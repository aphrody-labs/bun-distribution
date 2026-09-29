import Link from "next/link";
import { FooterFrame } from "@shenron/ui/navigation/FooterFrame";
import { DragonBall } from "@/components/DragonBall";
import { FooterFabGuard } from "@/components/FooterFabGuard";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { T } from "@/components/T";
import { DISCORD_INVITE } from "@/lib/config";
import { isPathPublic } from "@/lib/wiki-launch";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { destinationsOf, type Journey } from "@/lib/site-map";

/**
 * Colonnes du pied de page — **dérivées** de la carte du site.
 *
 * Elles étaient écrites en dur, et avaient divergé du registre d'accès dans les
 * deux sens : le pied de page annonçait des rubriques refermées (307 en bas de
 * chaque page) et ignorait des sections réellement ouvertes (`/tierlists`,
 * `/wiki/databooks`, `/wiki/contribuer`, `/wiki/modifications`). Trois parcours
 * de `lib/site-map.ts` par colonne : ajouter une rubrique au registre la fait
 * apparaître ici sans toucher à ce fichier.
 */
const FOOTER_COLUMNS: Array<{
	titleKey: string;
	journeys: readonly Journey[];
	extra?: FooterLink[];
}> = [
	{
		titleKey: "footer.columns.explore",
		journeys: ["decouvrir", "encyclopedie", "oeuvres", "archives"],
	},
	{
		titleKey: "footer.columns.community",
		journeys: ["communaute", "participer"],
		extra: [{ href: DISCORD_INVITE, labelKey: "footer.joinDiscord", external: true }],
	},
	{
		titleKey: "footer.columns.site",
		journeys: ["legal"],
		extra: [{ href: "/credits#contact", labelKey: "footer.reportContent" }],
	},
];

/**
 * A destination carries the label of the site map; a footer-only link carries a
 * dictionary key instead, so the two are told apart at render.
 */
type FooterLink = { href: string; label?: string; labelKey?: string; external?: boolean };

export async function SiteFooter() {
	// Le pied de page liste des rubriques refermables depuis /admin/lancement : sans
	// cette lecture, il continuait de les annoncer sur TOUTES les pages du site
	// (une fermeture de « Sagas & arcs » y laissait un 307 en bas de chaque page).
	const cfg = await getLaunchConfig().catch(() => null);
	const ouvert = (href: string) => (cfg ? isPathPublic(href, cfg) : true);

	// Les destinations « membre » sont écartées : le pied de page est servi à des
	// anonymes sur des pages cacheables, il ne peut pas savoir qui lit.
	const columns: Array<{ titleKey: string; links: FooterLink[] }> = FOOTER_COLUMNS.map((col) => ({
		titleKey: col.titleKey,
		links: [
			...col.journeys.flatMap((j) =>
				destinationsOf(j)
					.filter((d) => d.audience === "public" && ouvert(d.href) && d.href !== "/")
					.map((d) => ({ href: d.href, label: d.label }) satisfies FooterLink)
			),
			...(col.extra ?? []),
		],
	}));

	return (
		<FooterFrame>
			{/* Sentinelle : efface les boutons flottants dès que le pied de page
			    arrive, sinon ils recouvrent ses liens (cf. FooterFabGuard). */}
			<FooterFabGuard />
			<div className="page-shell py-16 grid gap-10 lg:grid-cols-[1.4fr_3fr]">
				<div>
					<Link href="/" className="flex items-baseline select-none mb-5" aria-label="DBFR">
						<span className="font-display font-bold text-[28px] tracking-[0.06em] text-white leading-none">
							DB
						</span>
						<span className="font-display font-bold text-[28px] tracking-[0.06em] text-dbz-orange leading-none">
							FR
						</span>
						{/* Boule décorative centrée sur le wordmark (leading-none 28px) sans
						    grandir la flex-line → items-baseline garde le texte à sa place. */}
						<span
							aria-hidden
							className="ml-2 inline-flex h-[28px] w-[20px] shrink-0 items-center justify-center self-center"
						>
							<DragonBall stars={4} size={20} />
						</span>
					</Link>
					<p className="text-[14px] text-white/60 leading-relaxed max-w-sm">
						<T k="footer.tagline" />
					</p>
				</div>

				<div className="grid sm:grid-cols-3 gap-8">
					{columns.map((col) => (
						<div key={col.titleKey}>
							<h4 className="font-display font-semibold text-[12px] tracking-[0.16em] uppercase text-dbz-orange mb-4">
								<T k={col.titleKey} />
							</h4>
							<ul className="space-y-2.5">
								{col.links.map((l) => (
									<li key={l.href}>
										<Link
											href={l.href}
											{...(l.external
												? { target: "_blank", rel: "noopener noreferrer" }
												: {})}
											className="text-[14px] text-white/72 hover:text-white transition-colors"
										>
											{l.labelKey ? <T k={l.labelKey} /> : l.label}
										</Link>
									</li>
								))}
							</ul>
						</div>
					))}
				</div>
			</div>

			<div className="border-t border-white/[0.06]">
				<div className="page-shell py-6 flex flex-wrap items-center justify-between gap-3 text-[12px] text-white/50">
					<p className="leading-relaxed max-w-3xl">
						<T k="footer.copyright" values={{ year: new Date().getFullYear() }} />{" "}
						<Link
							href="/credits"
							className="underline decoration-white/30 hover:decoration-dbz-orange hover:text-white"
						>
							<T k="footer.credits" />
						</Link>
						.
					</p>
					{/* Le vrai sélecteur, pas le « FR · 日本語 » en texte mort qui tenait
					    cette place : il promettait un site japonais et ne cliquait pas.
					    Il s'ouvre vers le haut — c'est la dernière ligne de la page. */}
					<div className="shrink-0">
						<LanguageSwitcher drop="up" />
					</div>
				</div>
			</div>
		</FooterFrame>
	);
}
