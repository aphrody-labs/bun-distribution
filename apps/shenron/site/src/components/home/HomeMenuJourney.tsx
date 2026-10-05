import Image from "next/image";
import { FlecheCoin } from "@/components/icones";
import { ClientGatedWrap } from "@/components/GatedClientLink";
import { assetUrl } from "@/lib/assets";
import type { HomeJourneyConfig } from "@/lib/home-scenes";
import { MOBILE_MENU_DESTINATIONS } from "@/lib/site-menu";
import type { AccessSnapshot } from "@/lib/wiki-launch";

const HOME_MENU_HREFS = MOBILE_MENU_DESTINATIONS.map((destination) => destination.href);

/**
 * Atlas des destinations non-média. Les quatre supports ont leurs vrais rails
 * juste au-dessus ; chaque autre page du menu reçoit ici son propre panneau.
 */
export function HomeMenuJourney({
	access,
	config,
	covered = [],
}: {
	access: AccessSnapshot;
	config: HomeJourneyConfig;
	/** Destinations déjà présentées plus haut (sections du deck, rails du catalogue). */
	covered?: readonly string[];
}) {
	const skip = new Set(covered);
	const kept = config.destinations.filter(
		(destination) => destination.enabled && !skip.has(destination.href)
	);
	// La grille fait deux colonnes : un nombre IMPAIR de cartes normales laisse un
	// trou en fin de ligne — visible dès qu'une carte est retirée pour doublon.
	// La première carte passe alors pleine largeur et referme la composition.
	const oddNarrow = kept.filter((destination) => !destination.wide).length % 2 === 1;
	const destinations = kept.map((destination, index) =>
		oddNarrow && index === 0 && !destination.wide ? Object.assign(destination, { wide: true }) : destination
	);
	if (!config.enabled || destinations.length === 0) return null;

	return (
		<section
			aria-labelledby="menu-complet-title"
			className="home-menu-journey w-full border-t border-white/10 bg-[#080808] py-16 text-white md:py-24"
		>
			<div className="page-shell">
				<header className="mb-9 max-w-3xl lg:mb-12">
					<p className="text-xs font-bold uppercase tracking-[0.22em] text-dbz-orange">
						{config.eyebrow}
					</p>
					<h2
						id="menu-complet-title"
						className="mt-3 text-balance font-saiyan text-4xl sm:text-6xl"
					>
						{config.title}
					</h2>
					<p className="mt-4 max-w-2xl text-pretty text-sm leading-6 text-white/60 sm:text-base">
						{config.subtitle}
					</p>
				</header>
				<div className="home-menu-grid">
					{destinations.map((destination, index) => {
						return (
							<HomeDestinationPanel
								key={destination.href}
								access={access}
								href={destination.href}
								label={destination.label}
								note={destination.note}
								image={destination.image}
								kanji={destination.kanji}
								kicker={destination.kicker}
								accent={destination.accent}
								cta={destination.cta}
								index={index + 1}
								wide={destination.wide}
							/>
						);
					})}
				</div>
			</div>
		</section>
	);
}

function HomeDestinationPanel({
	access,
	href,
	label,
	note,
	image,
	kanji,
	kicker,
	accent,
	cta,
	index,
	wide = false,
}: {
	access: AccessSnapshot;
	href: string;
	label: string;
	note: string;
	image: string;
	kanji: string;
	kicker: string;
	accent: string;
	cta: string;
	index: number;
	wide?: boolean;
}) {
	return (
		<section
			aria-labelledby={`destination-${index}`}
			className={`home-menu-card ${wide ? "home-menu-card--wide" : ""}`}
			style={{ ["--panel-accent" as string]: accent }}
		>
			<div className="home-menu-card__media" aria-hidden>
				<Image
					src={assetUrl(image)}
					alt=""
					fill
					sizes={wide ? "(min-width: 1024px) 70vw, 100vw" : "(min-width: 1024px) 45vw, 100vw"}
					quality={70}
					className="object-cover object-[center_25%]"
				/>
				<div className="home-menu-card__wash" />
			</div>
			<span className="home-menu-card__kanji" aria-hidden>
				{kanji}
			</span>
			<div className="home-menu-card__copy">
				<p className="home-menu-card__kicker">
					<span>{String(index).padStart(2, "0")}</span> {kicker}
				</p>
				<h3 id={`destination-${index}`} className="home-menu-card__title">
					{label}
				</h3>
				<p className="home-menu-card__note">{note}</p>
				<ClientGatedWrap
					access={access}
					href={href}
					className="home-menu-card__cta"
					aria-label={`${cta} — ${label}`}
				>
					{cta} <FlecheCoin size={16} aria-hidden />
				</ClientGatedWrap>
			</div>
		</section>
	);
}
